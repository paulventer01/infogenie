'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// Fixture accounts and assets exist only inside the disposable CI preview DB.
// They are deliberately not seeded into user previews or production databases.
module.exports = async function campaignJourney(page, account, origin) {
  assert.equal(process.env.INFOGENIE_REQUIRE_PREVIEW_TEST, '1');
  const pool = new (require('pg').Pool)({ connectionString: 'postgresql://preview:preview-container-only@127.0.0.1:5432/infogenie_preview', ssl: { rejectUnauthorized: false } });
  let briefId;
  const wf = 'journey-' + crypto.randomUUID(), art = 'creative-' + crypto.randomUUID(), run = 'research-' + crypto.randomUUID();
  const hash = crypto.randomBytes(32).toString('hex');
  try {
    assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, 'infogenie_preview');
    const user = (await pool.query('SELECT id FROM users WHERE email=$1', [account.email])).rows[0];
    const tid = account.tenantId;
    const brief = (await pool.query(`INSERT INTO marketing_briefs (tenant_id,brand,headline,greeting,generated_by)
      VALUES ($1,'DEMO fixture','DEMO campaign journey','Synthetic acceptance-test content.','test') RETURNING id`, [tid])).rows[0];
    briefId = brief.id;
    await pool.query(`INSERT INTO orchestrator_workflows (id,tenant_id,name,objective,landing_page_url,selected_platforms,advertising_budget,currency,target_markets,target_audiences)
      VALUES ($1,$2,'DEMO campaign workspace','traffic','https://example.com','["meta"]',10,'USD','["US"]','["Test audience"]')`, [wf,tid]);
    const approval = (await pool.query(`INSERT INTO orchestrator_approvals
      (tenant_id,workflow_id,gate,content_hash,decision,object_version,object_type,object_id,approved_platforms)
      VALUES ($1,$2,'research_execution',$3,'approved',1,'workflow',$2,'["meta"]') RETURNING id`, [tid,wf,hash])).rows[0];
    await pool.query(`INSERT INTO orchestrator_research_runs (id,tenant_id,workflow_id,approval_id,approval_object_version,requested_platforms,idempotency_key,state)
      VALUES ($1,$2,$3,$4,1,$5::text[],$1,'completed')`, [run,tid,wf,approval.id,['meta']]);
    async function seedApprovedCreative(artifact) {
    await pool.query(`INSERT INTO orchestrator_creative_artifacts (id,tenant_id,artifact_id,kind,workflow_id,research_run_id,version,status,content_hash,evidence_hash,payload,created_by)
      VALUES ($1,$2,$1,'creative_brief',$3,$4,1,'draft',$5,$5,'{"format":"image","objective":"DEMO fixture"}',$6)`, [artifact,tid,wf,run,hash,user.id]);
    const creativeApproval = (await pool.query(`INSERT INTO orchestrator_approvals
      (tenant_id,workflow_id,gate,content_hash,decision,object_version,object_type,object_id,actor_user_id,approved_platforms)
      VALUES ($1,$2,'creative_generation',$3,'approved',1,'creative_artifact',$4,$5,'[]') RETURNING id`,
      [tid,wf,require('../../services/agent_orchestrator/creative_validate').approvalContentHash(hash,hash),artifact,user.id])).rows[0];
    await pool.query(`UPDATE orchestrator_creative_artifacts SET status='approved',approval_id=$3,approval_object_version=1,approved_by=$4,approved_at=now() WHERE tenant_id=$1 AND id=$2`, [tid,artifact,creativeApproval.id,user.id]);
    }
    await seedApprovedCreative(art);
    const zero = Buffer.from([0]);
    await pool.query(`INSERT INTO user_integrations (user_id,platform,ciphertext,iv,tag,status) VALUES ($1,'meta_ads',$2,$2,$2,'connected')`, [user.id,zero]);
    await page.setViewport({width:1440,height:1000});
    await page.goto(origin + '/manage/campaign-journey', {waitUntil:'networkidle2'});
    await page.waitForSelector('[name="marketing_brief"]:enabled');
    await page.select('[name="marketing_brief"]',String(brief.id));
    const click = async text => {
      await page.waitForFunction(t=>[...document.querySelectorAll('section[aria-label="Campaign journey"] button')].some(b=>b.textContent===t&&!b.disabled),{},text);
      await page.evaluate(t=>[...document.querySelectorAll('section[aria-label="Campaign journey"] button')].find(b=>b.textContent===t).click(),text);
    };
    await click('Create campaign workspace');
    await page.type('[name="workspace_name"]','DEMO inline workspace');
    await page.type('[name="workspace_landing"]','https://example.com');
    await page.setViewport({width:390,height:844});
    await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1);
    await page.screenshot({path:'/tmp/preview-artifacts/campaign-workspace-setup-mobile.png',fullPage:true});
    await click('Create and select workspace');
    await page.waitForFunction(()=>document.body.innerText.includes('Campaign workspace created and selected.'));
    const createdId=await page.$eval('[name="campaign_workflow"]',el=>el.value);
    assert.ok(createdId && createdId!==wf);
    assert.equal(await page.$eval('[name="marketing_brief"]',el=>el.value),String(brief.id));
    const created=(await pool.query('SELECT tenant_id,credit_ceiling_micros,current_state FROM orchestrator_workflows WHERE id=$1',[createdId])).rows[0];
    assert.equal(created.tenant_id,tid);assert.equal(Number(created.credit_ceiling_micros),0);assert.equal(created.current_state,'draft');
    const reviewLink = await page.$eval('a[target="_blank"][href*="workflow_id="]',el=>el.href);
    assert.equal(new URL(reviewLink).searchParams.get('workflow_id'),createdId);
    const reviewPage=await page.browser().newPage();
    try {
      await reviewPage.goto(reviewLink,{waitUntil:'networkidle2'});
      await reviewPage.waitForFunction(()=>document.querySelector('#campaign-workspace-details')?.textContent.includes('DEMO inline workspace'));
      assert.ok(await reviewPage.$eval('#campaign-workspace-details',el=>el.innerText.includes('DEMO inline workspace')));
      assert.equal(await page.$eval('[name="campaign_workflow"]',el=>el.value),createdId);
      await page.bringToFront();
      await click('Refresh creative briefs');
      await page.waitForFunction(()=>document.body.innerText.includes('No approved creative brief yet.'));
      assert.equal(await page.$eval('[name="marketing_brief"]',el=>el.value),String(brief.id));
    } finally { await reviewPage.close(); }
    await page.setViewport({width:1440,height:1000});
    await page.select('[name="campaign_workflow"]',wf);
    await page.waitForFunction(()=>document.querySelector('[name="creative"] option')?.parentElement?.options.length>1);
    await page.select('[name="creative"]',art);
    await click('Refresh creative briefs');
    await page.waitForFunction(()=>document.body.innerText.includes('Creative briefs refreshed.'));
    assert.equal(await page.$eval('[name="creative"]',el=>el.value),art);
    const draftName=await page.$eval('[name="label"]',el=>el.value);
    await pool.query("UPDATE orchestrator_creative_artifacts SET status='superseded' WHERE tenant_id=$1 AND id=$2",[tid,art]);
    await click('Refresh creative briefs');
    await page.waitForFunction(()=>document.body.innerText.includes('The selected creative brief is no longer available'));
    assert.equal(await page.$eval('[name="creative"]',el=>el.value),'');
    assert.equal(await page.$eval('[name="label"]',el=>el.value),draftName);
    const replacement=art+'-replacement';
    await seedApprovedCreative(replacement);
    await click('Refresh creative briefs');
    await page.waitForFunction(()=>document.querySelector('[name="creative"]')?.options.length>1);
    await page.select('[name="creative"]',replacement);
    await page.$eval('[name="start"]',(el,value)=>{
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);
      el.dispatchEvent(new Event('input',{bubbles:true}));
    },new Date(Date.now()+864e5).toISOString().slice(0,16));
    await click('Save campaign draft');
    await page.waitForFunction(()=>document.body.innerText.includes('Campaign draft saved.'));
    await click('Validate saved campaign');
    await page.waitForFunction(()=>document.body.innerText.includes('Validation passed.'));
    await page.click('section[aria-label="Campaign journey"] input[type="checkbox"]');
    await click('Approve saved campaign');
    await page.waitForFunction(()=>document.body.innerText.includes('Approved — not published'));
    await click('Withdraw approval');
    await page.waitForFunction(()=>document.body.innerText.includes('Validation passed.'));
    await page.click('section[aria-label="Campaign journey"] input[type="checkbox"]');
    await click('Approve saved campaign');
    await page.waitForFunction(()=>document.body.innerText.includes('Approved — not published'));
    await page.screenshot({path:'/tmp/preview-artifacts/campaign-journey-desktop.png',fullPage:true});
    await page.setViewport({width:390,height:844});
    await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1);
    await page.screenshot({path:'/tmp/preview-artifacts/campaign-journey-mobile.png',fullPage:true});
    await page.reload({waitUntil:'networkidle2'});
    await page.waitForSelector('[name="marketing_brief"]:enabled');
    await page.select('[name="marketing_brief"]',String(brief.id)); await page.select('[name="campaign_workflow"]',wf);
    await page.waitForFunction(()=>document.querySelector('[name="saved_campaign"]')?.options.length>1);
    const id=await page.$eval('[name="saved_campaign"]',el=>el.options[1].value);
    await page.select('[name="saved_campaign"]',id);
    await page.waitForFunction(()=>document.body.innerText.includes('Approved — not published'));
    const status=(await pool.query('SELECT status FROM orchestrator_campaign_drafts WHERE tenant_id=$1 AND id=$2',[tid,id])).rows[0];
    assert.equal(status.status,'approved_for_publish');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM orchestrator_campaign_publish_requests WHERE tenant_id=$1 AND draft_id=$2',[tid,id])).rows[0].n,0);
    // Restore a persisted proposal sourced from a single-platform run, without generating or spending.
    const proposal='proposal-'+crypto.randomUUID();
    await pool.query(`INSERT INTO orchestrator_proposal_generations
      (id,tenant_id,workflow_id,research_run_id,status,prompt_template_version,provider,model,
       evidence_snapshot_hash,research_approval_id,research_approval_hash,research_approval_object_version,
       content_hash,idempotency_key,artifact_ids)
      VALUES ($1,$2,$3,$4,'pending_review','v1','fixture','fixture-proposal-v1',$5,$6,$5,1,$5,$1,$7::jsonb)`,
      [proposal,tid,wf,run,hash,approval.id,JSON.stringify([replacement])]);
    const {getProposalContext}=require('../../services/agent_orchestrator/proposal_store');
    const context=await getProposalContext(pool,tid,wf);
    assert.deepEqual(context.research_runs.map(r=>r.id),[run]);
    assert.equal(context.generation.id,proposal);
    assert.equal(context.generation.artifacts[0].artifact_id,replacement);
    assert.equal(context.estimated_cost_micros,'10000');
    assert.equal(context.can_generate_in_state,false);
    await assert.rejects(getProposalContext(pool,tid+999999,wf),error=>error.code==='not_found');
    await assert.rejects(getProposalContext(pool,tid,'missing-workflow'),error=>error.code==='not_found');
    // Existing proposal routes remain deployment-owner gated. Verify the ordinary
    // preview account is denied, then exercise the owner path with a separate
    // synthetic owner/session only inside this disposable acceptance database.
    const denied=await page.evaluate(async w=>{
      const response=await fetch('/api/agent-orchestrator/proposals?workflow_id='+encodeURIComponent(w));
      return {status:response.status,body:await response.json()};
    },wf);
    assert.equal(denied.status,403);assert.equal(denied.body.error,'owner_only');
    const ownerEmail='creative-owner-'+crypto.randomUUID()+'@example.test';
    const ownerPassword=crypto.randomBytes(24).toString('hex')+'Aa7';
    const owner=(await pool.query(`INSERT INTO users (email,password_hash,name,is_owner,email_verified_at)
      VALUES ($1,$2,'DEMO creative-review owner',true,now()) RETURNING id`,
      [ownerEmail,await require('bcryptjs').hash(ownerPassword,10)])).rows[0];
    await pool.query(`INSERT INTO tenant_users (tenant_id,user_id,role_id,status,joined_at)
      SELECT $1,$2,id,'active',now() FROM roles WHERE tenant_id IS NULL AND key='tenant_owner'`,[tid,owner.id]);
    const ownerContext=await page.browser().createBrowserContext();
    try {
      const ownerPage=await ownerContext.newPage();ownerPage.setDefaultTimeout(60000);
      await ownerPage.setViewport({width:1440,height:1000});
      await ownerPage.goto(origin+'/login',{waitUntil:'networkidle2'});
      await ownerPage.locator('#email').fill(ownerEmail);await ownerPage.locator('#pass').fill(ownerPassword);
      const [login]=await Promise.all([
        ownerPage.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/login'&&r.request().method()==='POST'),
        ownerPage.locator('form button[type="submit"]').click(),
      ]);
      assert.equal(login.status(),200);
      const mutations=[];
      ownerPage.on('request',request=>{if(request.method()!=='GET'&&request.url().includes('/api/agent-orchestrator/'))mutations.push(request.url());});
      await ownerPage.goto(origin+'/manage/agent-orchestrator?workflow_id='+wf,{waitUntil:'networkidle2'});
      await ownerPage.waitForSelector('[aria-label="Completed research snapshot"]');
      assert.equal(await ownerPage.$eval('[aria-label="Completed research snapshot"]',el=>el.value),run);
      await ownerPage.waitForFunction(p=>document.body.innerText.includes('Proposal '+p),{},proposal);
      await ownerPage.reload({waitUntil:'networkidle2'});
      await ownerPage.waitForFunction(p=>document.body.innerText.includes('Proposal '+p),{},proposal);
      const read=await ownerPage.evaluate(async w=>{
        const response=await fetch('/api/agent-orchestrator/proposals?workflow_id='+encodeURIComponent(w));
        return {status:response.status,body:await response.json()};
      },wf);
      assert.equal(read.status,200);assert.equal(read.body.generation.id,proposal);
      assert.equal(await ownerPage.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Generate proposals').disabled),true);
      assert.deepEqual(mutations,[]);
      await ownerPage.screenshot({path:'/tmp/preview-artifacts/creative-review-restored.png',fullPage:true});
    } finally {await ownerContext.close();}

  } finally {
    if (briefId) await pool.query('DELETE FROM marketing_briefs WHERE tenant_id=$1 AND id=$2',[account.tenantId,briefId]);
    await pool.end();
  }
};
