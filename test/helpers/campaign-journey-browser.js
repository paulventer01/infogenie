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
    await pool.query(`INSERT INTO orchestrator_creative_artifacts (id,tenant_id,artifact_id,kind,workflow_id,research_run_id,version,status,content_hash,evidence_hash,payload,created_by)
      VALUES ($1,$2,$1,'creative_brief',$3,$4,1,'draft',$5,$5,'{"format":"image","objective":"DEMO fixture"}',$6)`, [art,tid,wf,run,hash,user.id]);
    const creativeApproval = (await pool.query(`INSERT INTO orchestrator_approvals
      (tenant_id,workflow_id,gate,content_hash,decision,object_version,object_type,object_id,actor_user_id,approved_platforms)
      VALUES ($1,$2,'creative_generation',$3,'approved',1,'creative_artifact',$4,$5,'[]') RETURNING id`,
      [tid,wf,require('../../services/agent_orchestrator/creative_validate').approvalContentHash(hash,hash),art,user.id])).rows[0];
    await pool.query(`UPDATE orchestrator_creative_artifacts SET status='approved',approval_id=$3,approval_object_version=1,approved_by=$4,approved_at=now() WHERE tenant_id=$1 AND id=$2`, [tid,art,creativeApproval.id,user.id]);
    const zero = Buffer.from([0]);
    await pool.query(`INSERT INTO user_integrations (user_id,platform,ciphertext,iv,tag,status) VALUES ($1,'meta_ads',$2,$2,$2,'connected')`, [user.id,zero]);
    await page.setViewport({width:1440,height:1000});
    await page.goto(origin + '/manage/campaign-journey', {waitUntil:'networkidle2'});
    await page.waitForSelector('[name="marketing_brief"]:enabled');
    await page.select('[name="marketing_brief"]',String(brief.id));
    await page.select('[name="campaign_workflow"]',wf);
    await page.waitForFunction(()=>document.querySelector('[name="creative"] option')?.parentElement?.options.length>1);
    await page.select('[name="creative"]',art);
    await page.$eval('[name="start"]',(el,value)=>{
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);
      el.dispatchEvent(new Event('input',{bubbles:true}));
    },new Date(Date.now()+864e5).toISOString().slice(0,16));
    const click = async text => {
      await page.waitForFunction(t=>[...document.querySelectorAll('section[aria-label="Campaign journey"] button')].some(b=>b.textContent===t&&!b.disabled),{},text);
      await page.evaluate(t=>[...document.querySelectorAll('section[aria-label="Campaign journey"] button')].find(b=>b.textContent===t).click(),text);
    };
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
  } finally {
    if (briefId) await pool.query('DELETE FROM marketing_briefs WHERE tenant_id=$1 AND id=$2',[account.tenantId,briefId]);
    await pool.end();
  }
};
