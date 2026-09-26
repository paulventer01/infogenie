'use strict';
const assert=require('node:assert/strict');

// Real UI/login/policy/PG. Intercept only the SDK transport; never approve or execute.
module.exports=async function safeGeneration({page,baseUrl,actors,db,fx}) {
  const pool=db.getPool(),tid=actors.owner.tid,otherTid=actors.other.tid;
  const scanner=require('../../services/ai_governance/output_gate'),scan=scanner.scanOutput;
  const OpenAI=require('openai').OpenAI,transport=OpenAI.prototype.fetchWithTimeout;
  const oldKey=process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY='synthetic-safe-agent-generation';
  let calls=0, parsed={title:'DEMO generated proposal',proposal:{actions:[{step:1,action:'DEMO',detail:'guaranteed\nreturns'}]},simulation:{}};
  OpenAI.prototype.fetchWithTimeout=async function(url,...args){
    const target=new URL(url);
    if(target.hostname!=='api.openai.com'||target.pathname!=='/v1/chat/completions')return transport.call(this,url,...args);
    calls++;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(parsed)}}]}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const rows=async (tenant=tid)=>(await pool.query('SELECT * FROM safe_agent_proposals WHERE tenant_id=$1 ORDER BY id',[tenant])).rows;
  const audits=async()=>(await pool.query('SELECT * FROM safe_agent_audit_log WHERE tenant_id=ANY($1::int[]) ORDER BY id',[[tid,otherTid]])).rows;
  const baseline=await rows(),otherBaseline=await rows(otherTid),auditBefore=await audits();
  try {
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='enforce' WHERE tenant_id=$1",[tid]);
    page.removeAllListeners('request');page.on('request',r=>{
      const u=new URL(r.url());
      if(!['data:','blob:'].includes(u.protocol)&&u.origin!==baseUrl)return void r.abort('blockedbyclient');
      if(r.method()==='GET'&&u.pathname.startsWith('/api/')&&u.pathname!=='/api/auth/me'&&!u.pathname.startsWith('/api/safe-agent/'))return void r.respond({status:200,contentType:'application/json',body:'{"ok":false}'});
      void r.continue();
    });
    await page.goto(baseUrl+'/grow/safe-agent',{waitUntil:'networkidle2'});
    await page.locator('textarea[placeholder^="e.g. Improve ROAS"]').fill('DEMO retained objective');
    const submit=async()=>{
      await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Propose Action Plan')&&!b.disabled));
      const [r]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/safe-agent/propose'&&r.request().method()==='POST'),
        page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Propose Action Plan')).click())]);
      return {status:r.status(),body:await r.json()};
    };
    const blocked=await submit();assert.equal(blocked.status,403);assert.equal(blocked.body.proposal,undefined);
    await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes('Revise'));
    assert.equal(await page.$eval('textarea[placeholder^="e.g. Improve ROAS"]',e=>e.value),'DEMO retained objective');
    assert.deepEqual(await rows(),baseline);assert.deepEqual(await audits(),auditBefore);
    scanner.scanOutput=()=>{throw Error('synthetic scanner outage');};assert.equal((await submit()).status,503);
    await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes('temporarily unavailable'));
    assert.deepEqual(await rows(),baseline);assert.deepEqual(await audits(),auditBefore);scanner.scanOutput=scan;
    parsed.proposal={actions:[{step:1,action:'guaranteed',detail:'returns'}]};
    assert.equal((await submit()).status,403,'values split by field names must still block');
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='warning_only' WHERE tenant_id=$1",[tid]);
    const allowed=await submit();assert.equal(allowed.status,200);assert.ok(allowed.body.content_safety_warnings.length);
    await page.waitForFunction(()=>document.body.innerText.includes('CONTENT SAFETY WARNINGS'));
    const saved=(await rows()).find(r=>r.id===allowed.body.id);assert.ok(saved);assert.equal(saved.status,'pending_approval');
    assert.deepEqual(saved.proposal,allowed.body.proposal);assert.deepEqual(saved.simulation,allowed.body.simulation);
    assert.deepEqual(saved.content_safety_warnings,allowed.body.content_safety_warnings);assert.equal(saved.approved_at,null);assert.equal(saved.executed_at,null);
    assert.deepEqual((await audits()).filter(r=>r.proposal_id===saved.id).map(r=>r.event),['proposed']);
    const beforeReload=calls;await page.reload({waitUntil:'networkidle2'});
    await page.waitForFunction(()=>[...document.querySelectorAll('.ig-card')].some(e=>e.style.cursor==='pointer'&&e.textContent.includes('DEMO generated proposal')));
    await page.evaluate(()=>[...document.querySelectorAll('.ig-card')].find(e=>e.style.cursor==='pointer'&&e.textContent.includes('DEMO generated proposal')).click());
    await page.waitForFunction(()=>document.body.innerText.includes('CONTENT SAFETY WARNINGS'));assert.equal(calls,beforeReload);
    // Refuse oversized output even under warning-only policy without saving it.
    parsed.proposal={detail:'x'.repeat(55000)};
    const apiBody={objective:'DEMO bounded proposal',tenant_id:tid};
    const api=body=>page.evaluate(async body=>{const r=await fetch('/api/safe-agent/propose',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};},body);
    assert.equal((await api(apiBody)).status,403);assert.equal((await rows()).length,baseline.length+1);
    const {login,request}=require('./index');
    parsed.proposal={detail:'guaranteed\treturns'};
    const other=await fx.seedUser({tenantId:otherTid,owner:true}), logged=await login(baseUrl,other.email,other.password);assert.equal(logged.status,200);
    const foreign=await request(baseUrl,'POST','/api/safe-agent/propose',{cookie:logged.cookie,headers:{Origin:baseUrl},body:apiBody});
    assert.equal(foreign.status,403);assert.deepEqual(await rows(otherTid),otherBaseline);
    const viewer=await login(baseUrl,actors.viewer.email,actors.viewer.password),beforeDenied=calls;
    assert.equal((await request(baseUrl,'POST','/api/safe-agent/propose',{cookie:viewer.cookie,headers:{Origin:baseUrl},body:apiBody})).status,403);assert.equal(calls,beforeDenied);
  } finally {
    OpenAI.prototype.fetchWithTimeout=transport;scanner.scanOutput=scan;
    if(oldKey===undefined)delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;else process.env.AI_INTEGRATIONS_OPENAI_API_KEY=oldKey;
    const prior=baseline.map(r=>r.id);
    await pool.query('DELETE FROM safe_agent_audit_log WHERE tenant_id=$1 AND NOT(proposal_id=ANY($2::int[]))',[tid,prior]);
    await pool.query('DELETE FROM safe_agent_proposals WHERE tenant_id=$1 AND NOT(id=ANY($2::int[]))',[tid,prior]);
    await pool.query('DELETE FROM ai_governance_events WHERE tenant_id=ANY($1::int[])',[[tid,otherTid]]);
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='enforce' WHERE tenant_id=$1",[tid]);
  }
};
