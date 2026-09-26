'use strict';
const assert=require('node:assert/strict');

// Real UI/login/API/tenant policy/PostgreSQL audit; synthetic upstream SDK only.
module.exports=async function articleTopicSafety({page,baseUrl,actors,db,fx}) {
  const pool=db.getPool(), tid=actors.owner.tid;
  const scanner=require('../../services/ai_governance/output_gate'), scan=scanner.scanOutput;
  const OpenAI=require('openai').OpenAI, transport=OpenAI.prototype.fetchWithTimeout;
  let output={topics:[{title:'guaranteed\nreturns',keyword:'marketing'}]}, calls=0;
  OpenAI.prototype.fetchWithTimeout=async function(url,...args){
    const u=new URL(url);
    if(u.hostname!=='api.openai.com'||u.pathname!=='/v1/chat/completions')return transport.call(this,url,...args);
    calls++;
    return new Response(JSON.stringify({choices:[{message:{content:typeof output==='string'?output:JSON.stringify(output)}}]}),
      {status:200,headers:{'Content-Type':'application/json'}});
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
    await page.goto(baseUrl+'/grow/autoseo',{waitUntil:'networkidle2'});
    await page.evaluate(()=>{window.analysisData={domain:'demo.example.test',industry:'Marketing',competitors:[]};});
    await page.waitForFunction(()=>!document.querySelector('#view-autoseo')?.textContent.includes('Set Domain →'));
    async function click(text){
      await page.waitForFunction(text=>[...document.querySelectorAll('#view-autoseo button')].some(b=>b.textContent.trim()===text&&!b.matches(':disabled')),{},text);
      await page.evaluate(text=>[...document.querySelectorAll('#view-autoseo button')].find(b=>b.textContent.trim()===text&&!b.matches(':disabled')).click(),text);
    }
    async function generate(button='✨ Generate 30 Article Topics'){
      const [r]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/generate-article-topics'&&r.request().method()==='POST'),click(button)]);
      return {status:r.status(),body:await r.json()};
    }
    const blocked=await generate();assert.equal(blocked.status,403);assert.equal(blocked.body.topics,undefined);
    await page.waitForFunction(()=>document.querySelector('#view-autoseo [role="alert"]')?.textContent.length>0);
    assert.equal(await page.$$eval('#view-autoseo button',bs=>bs.some(b=>b.textContent.trim()==='✍️ Write')),false);
    scanner.scanOutput=()=>{throw Error('synthetic scanner outage');};
    assert.equal((await generate()).status,503);scanner.scanOutput=scan;
    output={topics:[{title:'guaranteed',keyword:'returns'}]};assert.equal((await generate()).status,403);
    output={topics:[{title:'crypto',keyword:'guaranteed safe investment'}]};
    const crypto=await generate();assert.equal(crypto.status,403);assert.equal(crypto.body.topics,undefined);
    output={topics:[{title:'crypto\nsafe investment',keyword:'demo'}]};assert.equal((await generate()).status,403);
    output={topics:[{title:'act now',keyword:'free offer'}]};
    const urgency=await generate();assert.equal(urgency.status,200);assert.ok(urgency.body.content_safety_warnings.length);
    await page.waitForFunction(()=>document.querySelector('#view-autoseo')?.textContent.includes('CONTENT SAFETY WARNINGS'));
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='warning_only' WHERE tenant_id=$1",[tid]);
    // Warning comes from an extra retained topic field; article generation itself is clean.
    output={topics:[{title:'DEMO retained topic',keyword:'marketing',extra:'guaranteed returns'}]};
    const warned=await generate('✨ Regenerate Topics');assert.equal(warned.status,200);assert.deepEqual(warned.body.topics,output.topics);assert.ok(warned.body.content_safety_warnings.length);
    await page.waitForFunction(()=>document.querySelector('#view-autoseo')?.textContent.includes('CONTENT SAFETY WARNINGS'));
    await page.waitForFunction(()=>document.querySelector('#view-autoseo')?.textContent.includes('DEMO retained topic'));
    const warningsBefore=await page.$eval('#view-autoseo',el=>el.textContent);
    assert.ok(warningsBefore.includes('DEMO retained topic'));
    output='<p>DEMO useful article.</p>';
    const [article]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/generate-seo-article'&&r.request().method()==='POST'),click('✍️ Write')]);
    assert.equal(article.status(),200);assert.equal((await article.json()).content_safety_warnings?.length||0,0);
    await page.waitForFunction(()=>[...document.querySelectorAll('#view-autoseo button')].some(b=>b.textContent.trim()==='👁 Preview'));
    assert.ok((await page.$eval('#view-autoseo',el=>el.textContent)).includes('CONTENT SAFETY WARNINGS'),'topic warnings survive writing');
    output={topics:[{title:'x'.repeat(50001),keyword:'marketing'}]};assert.equal((await generate('✨ Regenerate Topics')).status,403);
    await page.waitForFunction(()=>document.querySelector('#view-autoseo [role="alert"]')?.textContent.includes('fewer topics'));
    assert.ok((await page.$eval('#view-autoseo',el=>el.textContent)).includes('DEMO retained topic'),'failed regeneration keeps prior topics');
    output={topics:[{title:'DEMO fresh topic',keyword:'marketing'}]};assert.equal((await generate('✨ Regenerate Topics')).status,200);
    await page.waitForFunction(()=>document.querySelector('#view-autoseo')?.textContent.includes('DEMO fresh topic'));
    assert.equal(await page.$('#view-autoseo [role="alert"]'),null);
    assert.equal((await page.$eval('#view-autoseo',el=>el.textContent)).includes('CONTENT SAFETY WARNINGS'),false);
    output={topics:[{title:'guaranteed\treturns',keyword:'marketing'}]};
    const {login,request}=require('./index');
    const other=await fx.seedUser({tenantId:actors.other.tid,owner:true});
    const logged=await login(baseUrl,other.email,other.password);assert.equal(logged.status,200);
    const foreign=await request(baseUrl,'POST','/api/generate-article-topics',{cookie:logged.cookie,headers:{Origin:baseUrl},body:{tenant_id:tid,domain:'demo.example.test'}});
    assert.equal(foreign.status,403);assert.equal(foreign.json.topics,undefined);
    const viewer=await login(baseUrl,actors.viewer.email,actors.viewer.password);assert.equal(viewer.status,200);
    const before=calls;
    assert.equal((await request(baseUrl,'POST','/api/generate-article-topics',{cookie:viewer.cookie,headers:{Origin:baseUrl},body:{domain:'demo.example.test'}})).status,403);assert.equal(calls,before);
    assert.ok((await pool.query('SELECT id FROM ai_governance_events WHERE tenant_id=$1',[tid])).rows.length);
  } finally {
    OpenAI.prototype.fetchWithTimeout=transport;scanner.scanOutput=scan;
    await pool.query('DELETE FROM ai_governance_events WHERE tenant_id=ANY($1::int[])',[[tid,actors.other.tid]]);
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='enforce' WHERE tenant_id=$1",[tid]);
  }
};
