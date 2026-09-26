'use strict';
const assert=require('node:assert/strict');
// Real login/UI/API/policy/database; only upstream provider transports are synthetic.
module.exports=async function contentClusterSafety({page,baseUrl,actors,db,fx}) {
  const pool=db.getPool(), tid=actors.owner.tid;
  const scanner=require('../../services/ai_governance/output_gate'), scan=scanner.scanOutput;
  const OpenAI=require('openai').OpenAI, transport=OpenAI.prototype.fetchWithTimeout;
  const Anthropic=require('@anthropic-ai/sdk').default, anthropicTransport=Anthropic.prototype.fetchWithTimeout;
  const clean={pillar:'Retained cluster',topics:['Planning'],questions:['How to begin?'],aiNote:'Use clear headings'};
  let output={...clean,pillar:'guaranteed\nreturns'}, extra={}, calls=0;
  OpenAI.prototype.fetchWithTimeout=async function(url,...args){
    const u=new URL(url);
    if(u.hostname!=='api.openai.com'||u.pathname!=='/v1/chat/completions')return transport.call(this,url,...args);
    calls++;
    return new Response(JSON.stringify({choices:[{message:{content:typeof output==='string'?output:JSON.stringify(output)}}]}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  Anthropic.prototype.fetchWithTimeout=async function(url,...args){
    const u=new URL(url);
    if(u.hostname!=='api.anthropic.com'||u.pathname!=='/v1/messages')return anthropicTransport.call(this,url,...args);
    return new Response(JSON.stringify({content:[{type:'text',text:JSON.stringify(extra)}]}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  try {
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='enforce' WHERE tenant_id=$1",[tid]);
    page.removeAllListeners('request');
    page.on('request',r=>{
      const u=new URL(r.url());
      if(!['data:','blob:'].includes(u.protocol)&&u.origin!==baseUrl)return void r.abort('blockedbyclient');
      if(r.method()==='GET'&&u.pathname.startsWith('/api/')&&u.pathname!=='/api/auth/me')return void r.respond({status:200,contentType:'application/json',body:'{"ok":false}'});
      void r.continue();
    });
    await page.goto(baseUrl+'/create/content',{waitUntil:'networkidle2'});
    async function click(text){
      await page.waitForFunction(text=>[...document.querySelectorAll('[data-react-view=content] button')].some(b=>b.textContent.trim()===text&&!b.matches(':disabled')),{},text);
      await page.evaluate(text=>[...document.querySelectorAll('[data-react-view=content] button')].find(b=>b.textContent.trim()===text&&!b.matches(':disabled')).click(),text);
    }
    await click('🧩 Topical Clusters');
    await page.type('[data-react-view=content] input[placeholder^="e.g. email marketing"]','Marketing');
    async function generate(){
      const [r]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/ai-content-clusters'&&r.request().method()==='POST'),click('🧩 Build Cluster')]);
      return {status:r.status(),body:await r.json()};
    }
    assert.equal((await generate()).status,403);
    await page.waitForFunction(()=>document.querySelector('[data-react-view=content] [role="alert"]')?.textContent.length>0);
    assert.ok((await page.$eval('[data-react-view=content]',el=>el.textContent)).includes('No clusters yet'));
    scanner.scanOutput=()=>{throw Error('synthetic outage');};assert.equal((await generate()).status,503);scanner.scanOutput=scan;
    output={...clean,pillar:'crypto',topics:['safe investment']};assert.equal((await generate()).status,403);
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='warning_only' WHERE tenant_id=$1",[tid]);
    output={...clean,aiNote:'guaranteed returns'};const warned=await generate();assert.equal(warned.status,200);assert.ok(warned.body.content_safety_warnings.length);
    await page.waitForFunction(()=>document.querySelector('[data-react-view=content] [role="note"]')?.textContent.includes('CONTENT SAFETY WARNINGS'));
    output='guaranteed returns';assert.equal((await generate()).status,502);
    await page.waitForFunction(()=>document.querySelector('[data-react-view=content] [role="alert"]')?.textContent.includes('unavailable'));
    assert.ok((await page.$eval('[data-react-view=content]',el=>el.textContent)).includes('Retained cluster'));
    output={...clean,extra:'x'.repeat(50001)};assert.equal((await generate()).status,403);
    assert.equal(await page.$$eval('[data-react-view=content] [role="note"]',els=>els.length),1);
    output={...clean,pillar:'Fresh cluster'};assert.equal((await generate()).status,200);
    await page.waitForFunction(()=>document.querySelector('[data-react-view=content]')?.textContent.includes('Fresh cluster'));
    assert.equal(await page.$('[data-react-view=content] [role="alert"]'),null);
    assert.equal(await page.$$eval('[data-react-view=content] [role="note"]',els=>els.length),1); // old warning stays with old cluster
    await click('Remove'); // clean first cluster removed; warned cluster remains
    assert.ok((await page.$eval('[data-react-view=content]',el=>el.textContent)).includes(warned.body.content_safety_warnings[0]));
    await click('Remove');assert.equal(await page.$('[data-react-view=content] [role="note"]'),null);
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='enforce' WHERE tenant_id=$1",[tid]);
    output=clean;extra={extraQuestions:['guaranteed returns']};assert.equal((await generate()).status,403);extra={};
    const {login,request}=require('./index');
    const other=await fx.seedUser({tenantId:actors.other.tid,owner:true});
    const logged=await login(baseUrl,other.email,other.password);assert.equal(logged.status,200);
    output={...clean,aiNote:'guaranteed returns'};
    assert.equal((await request(baseUrl,'POST','/api/ai-content-clusters',{cookie:logged.cookie,headers:{Origin:baseUrl},body:{seed:'Marketing',tenant_id:tid}})).status,403);
    const viewer=await login(baseUrl,actors.viewer.email,actors.viewer.password);assert.equal(viewer.status,200);const before=calls;
    assert.equal((await request(baseUrl,'POST','/api/ai-content-clusters',{cookie:viewer.cookie,headers:{Origin:baseUrl},body:{seed:'Marketing'}})).status,403);assert.equal(calls,before);
  } finally {
    OpenAI.prototype.fetchWithTimeout=transport;Anthropic.prototype.fetchWithTimeout=anthropicTransport;scanner.scanOutput=scan;
    await pool.query('DELETE FROM ai_governance_events WHERE tenant_id=ANY($1::int[])',[[tid,actors.other.tid]]);
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='enforce' WHERE tenant_id=$1",[tid]);
  }
};
