'use strict';
const assert=require('node:assert/strict');
module.exports=async function reviewRules({page,baseUrl,actors,db,fx}) {
  await require('../../services/review_monitor/reply_schema').ensureReviewReplySchema();
  const pool=db.getPool(),tid=actors.owner.tid,otherTid=actors.other.tid;
  const scanner=require('../../services/ai_governance/output_gate'),scan=scanner.scanOutput;
  const name='DEMO request rule',copy='DEMO guaranteed returns {{link}}';
  const rows=async()=> (await pool.query('SELECT * FROM review_request_rules WHERE tenant_id=$1 ORDER BY id',[tid])).rows;
  const api=(method,path,body)=>page.evaluate(async(method,path,body)=>{
    const r=await fetch('/api/review-monitor/request-rules'+path,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:r.status,body:await r.json()};
  },method,path,body);
  async function click(label,selector='button') {
    await page.waitForFunction((label,selector)=>[...document.querySelectorAll(selector)].some(b=>b.textContent.trim()===label&&!b.disabled),{},label,selector);
    await page.evaluate((label,selector)=>[...document.querySelectorAll(selector)].find(b=>b.textContent.trim()===label&&!b.disabled).click(),label,selector);
  }
  async function submit(status){const [r]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/review-monitor/request-rules'&&r.request().method()==='POST'),click('Save Rule')]);assert.equal(r.status(),status);return r.json();}
  try {
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='enforce',content_safety_explicit=true WHERE tenant_id=$1",[tid]);
    page.removeAllListeners('request');page.on('request',r=>{
      const url=new URL(r.url());
      if(!['data:','blob:'].includes(url.protocol)&&url.origin!==baseUrl)return void r.abort('blockedbyclient');
      if(r.method()==='GET'&&url.pathname.startsWith('/api/')&&url.pathname!=='/api/auth/me'&&!url.pathname.startsWith('/api/review-monitor/'))return void r.respond({status:200,contentType:'application/json',body:'{"ok":false}'});
      void r.continue();
    });
    await page.goto(baseUrl+'/analyse/review-automation',{waitUntil:'networkidle2'});await click('Review Request Rules');await click('+ Create Rule');
    await page.locator('input[placeholder="e.g. Post-Purchase Feedback"]').fill(name);await page.locator('.rules-section textarea').fill(copy);
    const before=await rows();
    for(const unavailable of [false,true]) {
      if(unavailable)scanner.scanOutput=()=>{throw new Error('synthetic scanner outage');};
      const r=await submit(unavailable?503:403);assert.equal(r.ok,false);assert.ok(r.userMessage);
      await page.waitForSelector('.rules-section [role="alert"]');
      assert.equal(await page.$eval('.rules-section textarea',e=>e.value),copy);assert.deepEqual(await rows(),before);
    }
    scanner.scanOutput=scan;await pool.query("UPDATE ai_governance_policies SET content_safety_mode='warning_only' WHERE tenant_id=$1",[tid]);
    const allowed=await submit(200),rule=allowed.rule,warnings=rule.content_safety_warnings;
    assert.ok(warnings.length);assert.equal(rule.message_template,copy);assert.equal(rule.tenant_id,tid);
    await page.waitForSelector(`[data-rule-id="${rule.id}"]`);
    assert.deepEqual((await rows()).find(r=>r.id===rule.id).content_safety_warnings,warnings);
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='enforce' WHERE tenant_id=$1",[tid]);
    // Disable remains available with a broken scanner; enabling rescans retained copy.
    scanner.scanOutput=()=>{throw new Error('synthetic scanner outage');};
    const [disabled]=await Promise.all([page.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith('/request-rules/'+rule.id)),click('Disable',`[data-rule-id="${rule.id}"] button`)]);
    assert.equal(disabled.status(),200);assert.equal((await rows()).find(r=>r.id===rule.id).active,false);
    for(const unavailable of [true,false]){
      if(!unavailable)scanner.scanOutput=scan;
      const [refused]=await Promise.all([page.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith('/request-rules/'+rule.id)),click('Enable',`[data-rule-id="${rule.id}"] button`)]);
      assert.equal(refused.status(),unavailable?503:403);assert.equal((await rows()).find(r=>r.id===rule.id).active,false);
    }
    scanner.scanOutput=scan;
    const snapshot=(await rows()).find(r=>r.id===rule.id);
    assert.equal((await api('PUT','/'+rule.id,{message_template:'guaranteed returns changed'})).status,403);assert.deepEqual((await rows()).find(r=>r.id===rule.id),snapshot);
    const foreign=(await pool.query("INSERT INTO review_request_rules (tenant_id,name,trigger_type,channel,message_template) VALUES ($1,'PRIVATE foreign rule','manual','email','PRIVATE foreign copy') RETURNING id",[otherTid])).rows[0].id;
    assert.equal((await api('PUT','/'+foreign,{active:false})).status,404);
    const {login,request}=require('./index');const viewer=await login(baseUrl,actors.viewer.email,actors.viewer.password);assert.equal(viewer.status,200);
    assert.equal((await request(baseUrl,'POST','/api/review-monitor/request-rules',{cookie:viewer.cookie,body:{name:'Forbidden'}})).status,403);
    const otherOwner=await fx.seedUser({tenantId:otherTid,owner:true}),other=await login(baseUrl,otherOwner.email,otherOwner.password);assert.equal(other.status,200);
    assert.equal((await request(baseUrl,'PUT','/api/review-monitor/request-rules/'+rule.id,{cookie:other.cookie,body:{active:true}})).status,404);
    assert.equal((await request(baseUrl,'POST','/api/review-monitor/request-rules',{body:{name:'Anonymous'}})).status,401);
    // A row lock forces a real concurrent edit between select/scan and CAS update.
    const lock=await pool.connect();let pending;
    try {
      await lock.query('BEGIN');await lock.query('SELECT id FROM review_request_rules WHERE id=$1 FOR UPDATE',[rule.id]);
      pending=api('PUT','/'+rule.id,{message_template:'Safe updated template'});
      let waiting=false;
      for(let n=0;n<200&&!waiting;n++){
        waiting=(await pool.query('SELECT pid FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))',[lock.processID])).rows.length>0;
        if(!waiting)await new Promise(r=>setTimeout(r,25));
      }
      assert.ok(waiting,'save reaches locked row after scanning');
      await lock.query("UPDATE review_request_rules SET message_template='Concurrent edited copy' WHERE id=$1",[rule.id]);
      await lock.query('COMMIT');assert.equal((await pending).status,409);
      assert.equal((await rows()).find(r=>r.id===rule.id).message_template,'Concurrent edited copy');
    } finally {await lock.query('ROLLBACK');lock.release();if(pending)await pending;}
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='warning_only' WHERE tenant_id=$1",[tid]);
    const updated=await api('PUT','/'+rule.id,{message_template:copy});assert.equal(updated.status,200);assert.ok(updated.body.rule.content_safety_warnings.length);
    await page.reload({waitUntil:'networkidle2'});await click('Review Request Rules');
    await page.waitForFunction(id=>document.querySelector(`[data-rule-id="${id}"]`)?.textContent.includes('CONTENT SAFETY WARNINGS'),{},rule.id);
    for(const w of updated.body.rule.content_safety_warnings)assert.ok((await page.$eval(`[data-rule-id="${rule.id}"]`,e=>e.textContent)).includes(w));
    assert.doesNotMatch(await page.evaluate(()=>document.body.innerText),/PRIVATE foreign/);
    assert.equal((await rows()).length,before.length+1);
    assert.equal((await pool.query('SELECT id FROM review_request_log WHERE tenant_id=ANY($1::int[])',[[tid,otherTid]])).rows.length,0,'save acceptance never sends or triggers requests');
  } finally {
    scanner.scanOutput=scan;
    await pool.query('DELETE FROM review_request_rules WHERE tenant_id=ANY($1::int[])',[[tid,otherTid]]);
    await pool.query('DELETE FROM ai_governance_events WHERE tenant_id=ANY($1::int[])',[[tid,otherTid]]);
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='enforce' WHERE tenant_id=$1",[tid]);
  }
};
