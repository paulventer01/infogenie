'use strict';
const assert = require('node:assert/strict');

module.exports = async function marketingBrief({page,baseUrl,actors,db}) {
  const pool=db.getPool(), tid=actors.owner.tid, tenants=[tid,actors.other.tid];
  await require('../../services/marketing_brief/schema').ensureMarketingBriefSchema();
  const scanner=require('../../services/ai_governance/output_gate'), scan=scanner.scanOutput;
  let body={headline:'DEMO guaranteed\nreturns',greeting:'Synthetic provider fixture',sections:[],actions:[]};
  let provider=()=>body;
  const restore=require('./marketing-brief-provider')(()=>provider());
  const request=path=>page.evaluate(async path=>{
    const r=await fetch('/api/marketing-brief/'+path,{method:path==='generate'?'POST':'GET'});
    return {status:r.status,body:await r.json()};
  },path);
  const rows=async()=> (await pool.query('SELECT * FROM marketing_briefs WHERE tenant_id=$1 ORDER BY id',[tid])).rows;
  const click=async label=>page.evaluate(label=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes(label)).click(),label);
  const refresh=async(label='🔄 Refresh')=>{
    const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/marketing-brief/merged'),click(label)]);
    return {status:response.status(),body:await response.json()};
  };
  try {
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='enforce',content_safety_explicit=true WHERE tenant_id=$1",[tid]);
    await pool.query(`INSERT INTO marketing_briefs(tenant_id,headline) VALUES($1,'DEMO saved brief'),($2,'PRIVATE foreign brief')`,tenants);
    const foreign=(await pool.query('SELECT id FROM marketing_briefs WHERE tenant_id=$1',[actors.other.tid])).rows[0].id;
    page.removeAllListeners('request');
    page.on('request',r=>{
      const url=new URL(r.url());
      if(!['data:','blob:'].includes(url.protocol)&&url.origin!==baseUrl) return void r.abort('blockedbyclient');
      if(r.method()==='GET'&&url.pathname.startsWith('/api/')&&url.pathname!=='/api/auth/me'&&!url.pathname.startsWith('/api/marketing-brief/'))
        return void r.respond({status:200,contentType:'application/json',body:'{"ok":false}'});
      void r.continue();
    });
    await page.goto(baseUrl+'/manage/marketing-brief',{waitUntil:'networkidle2'});
    await page.waitForFunction(()=>document.body.innerText.toLowerCase().includes('demo saved brief'));
    const before=await rows();
    assert.equal((await refresh()).status,403);
    await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes('showing previously saved content'));
    assert.match(await page.evaluate(()=>document.body.innerText),/Previously saved Marketing Brief/i);
    assert.deepEqual(await rows(),before);
    for(const path of ['today?force=1','generate']) assert.equal((await request(path)).status,403);
    assert.equal((await request(String(foreign))).status,404);
    assert.doesNotMatch(JSON.stringify((await request('history')).body),/PRIVATE foreign/);
    assert.doesNotMatch(await page.evaluate(()=>document.body.innerText),/PRIVATE foreign/i);
    scanner.scanOutput=()=>{throw new Error('synthetic private scanner error');};
    assert.equal((await refresh('Retry refresh')).status,503);
    await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes('temporarily unavailable'));
    for(const path of ['today?force=1','generate']) assert.equal((await request(path)).status,503);
    assert.deepEqual(await rows(),before);
    // Initial failed generation must also return an explicitly stale previous payload.
    await pool.query("UPDATE marketing_briefs SET created_at=NOW()-INTERVAL '2 days' WHERE tenant_id=$1",[tid]);
    await page.reload({waitUntil:'networkidle2'});
    await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes('showing previously saved content'));
    assert.match(await page.evaluate(()=>document.body.innerText),/DEMO saved brief/i);
    scanner.scanOutput=scan;
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='warning_only' WHERE tenant_id=$1",[tid]);
    const allowed=await refresh('Retry refresh');assert.equal(allowed.status,200);
    assert.ok(allowed.body.brief.content_safety_warnings.length);
    await page.waitForFunction(()=>document.body.innerText.toLowerCase().includes('content safety warnings')&&!document.querySelector('[role="alert"]'));
    const saved=await rows();assert.equal(saved.length,before.length+1);
    assert.deepEqual(saved.at(-1).content_safety_warnings,allowed.body.brief.content_safety_warnings);
    await page.reload({waitUntil:'networkidle2'});
    await page.waitForFunction(()=>document.body.innerText.toLowerCase().includes('content safety warnings'));
    // Hold the real provider, fire multiple refresh events, then release. No overlapping
    // generation request may arrive and the superseded response must not render.
    let release, started, calls=0;
    const start=new Promise(r=>{started=r;});
    provider=()=>{calls++;if(calls===1){started();return new Promise(r=>{release=()=>r({...body,headline:'DEMO superseded result'});});}
      return {...body,headline:'DEMO newest result'};};
    await click('🔄 Refresh');await start;
    await page.evaluate(()=>{
      document.dispatchEvent(new Event('ig:analysis-ready'));
      document.dispatchEvent(new Event('ig:analysis-updated'));
      window.__briefSawSuperseded=false;
      window.__briefObserver=new MutationObserver(()=>{
        if(document.body.innerText.toLowerCase().includes('demo superseded result')) window.__briefSawSuperseded=true;
      });
      window.__briefObserver.observe(document.body,{subtree:true,childList:true,characterData:true});
    });
    assert.equal(calls,1);release();
    await page.waitForFunction(()=>document.body.innerText.toLowerCase().includes('demo newest result'));
    assert.equal(calls,2,'queued refreshes coalesce and run after the first completes');
    assert.equal(await page.evaluate(()=>{window.__briefObserver.disconnect();return window.__briefSawSuperseded;}),false);
    // No saved brief: refusal is an error state, not an empty successful dashboard.
    await pool.query('DELETE FROM marketing_briefs WHERE tenant_id=$1',[tid]);
    scanner.scanOutput=()=>{throw new Error('synthetic outage');};
    await page.reload({waitUntil:'networkidle2'});
    await page.waitForFunction(()=>document.body.innerText.toLowerCase().includes('could not load brief'));
    assert.equal((await rows()).length,0);
    scanner.scanOutput=scan;provider=()=>({...body,headline:'DEMO retry recovered'});
    assert.equal((await refresh('Retry')).status,200);
    await page.waitForFunction(()=>document.body.innerText.toLowerCase().includes('demo retry recovered'));
  } finally {
    restore();scanner.scanOutput=scan;
    await pool.query('DELETE FROM marketing_briefs WHERE tenant_id=ANY($1::int[])',[tenants]);
    await pool.query('DELETE FROM marketing_brief_settings WHERE tenant_id=ANY($1::int[])',[tenants]);
    await pool.query('DELETE FROM decision_recommendations WHERE tenant_id=ANY($1::int[])',[tenants]);
    await pool.query('DELETE FROM ai_governance_events WHERE tenant_id=ANY($1::int[])',[tenants]);
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='enforce' WHERE tenant_id=$1",[tid]);
  }
};
