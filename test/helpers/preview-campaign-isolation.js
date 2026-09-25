'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// A second ordinary reviewer exists only in the disposable preview acceptance DB.
// Real login and same-tenant writes distinguish tenant isolation from auth/CSRF denial.
module.exports = async function previewCampaignIsolation(pool, foreign, origin) {
  assert.equal(process.env.INFOGENIE_REQUIRE_PREVIEW_TEST, '1');
  const identity = (await pool.query('SELECT current_database() AS name, ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()')).rows[0];
  assert.deepEqual(identity, { name: 'infogenie_preview', ssl: true });
  const suffix = crypto.randomUUID();
  const tenant = (await pool.query("INSERT INTO tenants (name,slug,status) VALUES ('DEMO isolation reviewer',$1,'active') RETURNING id", ['preview-isolation-'+suffix])).rows[0];
  assert.notEqual(tenant.id, foreign.tenantId);
  const email = 'isolation-'+suffix+'@example.test';
  const password = crypto.randomBytes(24).toString('hex')+'Aa7';
  const user = (await pool.query(`INSERT INTO users (email,password_hash,name,is_owner,email_verified_at)
    VALUES ($1,$2,'DEMO isolation reviewer',false,now()) RETURNING id,is_owner`,
  [email,await require('bcryptjs').hash(password,10)])).rows[0];
  assert.equal(user.is_owner, false);
  const membership = await pool.query(`INSERT INTO tenant_users (tenant_id,user_id,role_id,status,joined_at)
    SELECT $1,$2,id,'active',now() FROM roles WHERE tenant_id IS NULL AND key='tenant_owner'`, [tenant.id,user.id]);
  assert.equal(membership.rowCount, 1);
  const workflowId = 'isolation-'+suffix;
  await pool.query(`INSERT INTO orchestrator_workflows (id,tenant_id,name,objective,landing_page_url,selected_platforms,advertising_budget,currency)
    VALUES ($1,$2,'DEMO isolated workflow','traffic','https://example.com','["meta"]',0,'USD')`, [workflowId,tenant.id]);
  const brief = (await pool.query(`INSERT INTO marketing_briefs (tenant_id,brand,headline,greeting,generated_by)
    VALUES ($1,'DEMO isolation','DEMO isolation brief','Synthetic isolation control.','test') RETURNING *`, [tenant.id])).rows[0];
  const ownBrief = require('../../services/agent_orchestrator/campaign_briefs').publicBrief(brief);
  let ownDraft;
  return async function verify(browser, phase) {
    const context = await browser.createBrowserContext();
    try {
      const page = await context.newPage();page.setDefaultTimeout(60000);
      await page.goto(origin+'/login', {waitUntil:'networkidle2'});
      await page.locator('#email').fill(email);await page.locator('#pass').fill(password);
      const [login] = await Promise.all([
        page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/login'&&r.request().method()==='POST'),
        page.waitForNavigation({waitUntil:'networkidle2'}),
        page.locator('form button[type="submit"]').click(),
      ]);
      assert.equal(login.status(), 200);
      const request = (path, method='GET', body) => page.evaluate(async ({path,method,body})=>{
        const response = await fetch('/api/agent-orchestrator/'+path, {
          method, headers:{'Content-Type':'application/json'},
          ...(body === undefined ? {} : {body:JSON.stringify(body)}),
        });
        return {status:response.status,body:await response.json()};
      }, {path,method,body});
      const ownWorkflow = await request('workflows/'+workflowId);
      assert.equal(ownWorkflow.status, 200);
      assert.equal(ownWorkflow.body.workflow.id, workflowId);
      if (!ownDraft) {
        // An unvalidated synthetic draft is sufficient for the positive edit control.
        // Its creative reference is deliberately unresolved; no approval or provider call.
        const contract = {...foreign.draft.contract, provenance:{workflow_id:workflowId,
          marketing_brief_id:ownBrief.id,marketing_brief_hash:ownBrief.content_hash},
          creatives:foreign.draft.contract.creatives.map(c=>({...c,asset_id:'unresolved-'+suffix}))};
        const created = await request('campaign-drafts','POST', {
          workflow_id:workflowId, idempotency_key:'isolation-'+suffix,
          label:'DEMO unvalidated isolation control', contract,
        });
        assert.equal(created.status, 201);
        assert.equal(created.body.draft.tenant_id, tenant.id);
        ownDraft = created.body.draft;
      }
      const ownRead = await request('campaign-drafts/'+ownDraft.id);
      assert.equal(ownRead.status, 200);
      assert.equal(ownRead.body.draft.tenant_id, tenant.id);
      assert.equal(ownRead.body.draft.status, 'draft');
      assert.equal(ownRead.body.draft.label, ownDraft.label, 'own saved draft survives restart');
      const edited = await request('campaign-drafts/'+ownDraft.id,'PATCH', {label:'DEMO isolation control '+phase});
      assert.equal(edited.status, 200, 'same route and role can edit their own draft');
      assert.equal(edited.body.draft.label, 'DEMO isolation control '+phase);
      ownDraft = edited.body.draft;
      const options = await request('campaign-drafts/journey-options?workflow_id='+encodeURIComponent(foreign.workflowId));
      assert.equal(options.status, 200);assert.equal(options.body.ok, true);
      assert.deepEqual(options.body.briefs.map(b=>b.id), [brief.id]);
      assert.deepEqual(options.body.creatives, []);
      const list = await request('campaign-drafts?workflow_id='+encodeURIComponent(foreign.workflowId));
      assert.deepEqual(list, {status:200,body:{ok:true,drafts:[]}});
      for (const [path,method,body] of [
        ['workflows/'+foreign.workflowId,'GET'],
        ['campaign-drafts/'+foreign.draft.id,'GET'],
        ['campaign-drafts/'+foreign.draft.id,'PATCH',{label:'Cross-tenant edit must fail'}],
      ]) {
        assert.deepEqual(await request(path,method,body), {status:404,body:{ok:false,error:'not_found'}}, method+' foreign object is hidden');
      }
      const proposals = await request('proposals?workflow_id='+workflowId);
      assert.equal(proposals.status,403);assert.equal(proposals.body.error,'owner_only');
      // The browser selectors must also stay tenant-scoped, including a foreign deep link.
      await page.goto(origin+'/manage/campaign-journey?workflow_id='+encodeURIComponent(foreign.workflowId), {waitUntil:'networkidle2'});
      await page.waitForSelector('[name="marketing_brief"]:enabled');
      await page.waitForFunction(id=>[...(document.querySelector('[name="campaign_workflow"]')?.options||[])].some(o=>o.value===id),{},workflowId);
      await page.select('[name="marketing_brief"]',String(brief.id));
      await page.select('[name="campaign_workflow"]',workflowId);
      await page.waitForFunction(id=>[...(document.querySelector('[name="saved_campaign"]')?.options||[])].some(o=>o.value===id),{},ownDraft.id);
      await page.select('[name="saved_campaign"]',ownDraft.id);
      await page.waitForFunction(label=>document.querySelector('[name="label"]')?.value===label,{},ownDraft.label);
      const visible = await page.evaluate(()=>({
        briefs:[...document.querySelector('[name="marketing_brief"]').options].map(o=>o.value),
        workflows:[...document.querySelector('[name="campaign_workflow"]').options].map(o=>o.value),
        drafts:[...(document.querySelector('[name="saved_campaign"]')?.options||[])].map(o=>o.value),
      }));
      assert.ok(!visible.briefs.includes(String(foreign.briefId)));
      assert.ok(!visible.workflows.includes(foreign.workflowId));
      assert.ok(!visible.drafts.includes(foreign.draft.id));
      await page.screenshot({path:'/tmp/preview-artifacts/campaign-tenant-isolation-'+phase+'.png',fullPage:true});
      const rows = (await pool.query('SELECT tenant_id,label,status FROM orchestrator_campaign_drafts WHERE id=$1',[ownDraft.id])).rows;
      assert.deepEqual(rows,[{tenant_id:tenant.id,label:ownDraft.label,status:'draft'}]);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM orchestrator_campaign_publish_requests WHERE tenant_id=$1',[tenant.id])).rows[0].n,0);
    } finally {await context.close();}
  };
};
