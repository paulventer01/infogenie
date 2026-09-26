'use strict';
const assert=require('node:assert/strict');

// Actual generation routes/policy/login/PG; only the upstream SDK is synthetic.
module.exports=async function generatedMetadata({page,baseUrl,actors,db,fx}) {
  const pool=db.getPool(), tid=actors.owner.tid;
  const scanner=require('../../services/ai_governance/output_gate'), scan=scanner.scanOutput;
  const OpenAI=require('openai').OpenAI, transport=OpenAI.prototype.fetchWithTimeout;
  let title='guaranteed returns', output='<p>DEMO safe generated body.</p>', calls=0;
  OpenAI.prototype.fetchWithTimeout=async function(url,...args){
    const target=new URL(url);
    if(target.hostname!=='api.openai.com'||target.pathname!=='/v1/chat/completions') return transport.call(this,url,...args);
    calls++;
    return new Response(JSON.stringify({choices:[{message:{content:output}}]}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const api=(path,body)=>page.evaluate(async(path,body)=>{
    const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    return {status:r.status,body:await r.json()};
  },path,body);
  try {
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='enforce' WHERE tenant_id=$1",[tid]);
    page.removeAllListeners('request');
    page.on('request',r=>{
      const u=new URL(r.url());
      if(!['data:','blob:'].includes(u.protocol)&&u.origin!==baseUrl) return void r.abort('blockedbyclient');
      if(u.pathname==='/api/generate-article-topics') return void r.respond({status:200,contentType:'application/json',body:JSON.stringify({topics:[{title,keyword:'marketing'}]})});
      if(r.method()==='GET'&&u.pathname.startsWith('/api/')&&u.pathname!=='/api/auth/me') return void r.respond({status:200,contentType:'application/json',body:'{"ok":false}'});
      void r.continue();
    });
    await page.goto(baseUrl+'/grow/autoseo',{waitUntil:'networkidle2'});
    for(const [path,body,fields,copy] of [
      ['/api/landing-page',{campName:'DEMO campaign',domain:'demo.example.test'},['campName','domain'],'html'],
      ['/api/generate-seo-article',{title:'DEMO article',keyword:'marketing'},['title','keyword'],'content'],
    ]) {
      for(const field of fields) {
        const r=await api(path,{...body,[field]:'guaranteed returns'});
        assert.equal(r.status,403);assert.equal(r.body[copy],undefined);assert.equal(r.body[field],undefined);
      }
      scanner.scanOutput=()=>{throw Error('synthetic scanner outage');};
      const outage=await api(path,body);assert.equal(outage.status,503);assert.equal(outage.body[copy],undefined);
      scanner.scanOutput=scan;
      const clean=await api(path,body);assert.equal(clean.status,200);assert.equal(clean.body[copy],output);
    }
    await page.evaluate(()=>{window.analysisData={domain:'demo.example.test',industry:'Marketing',competitors:[]};});
    async function click(text){
      await page.waitForFunction(text=>[...document.querySelectorAll('#view-autoseo button')].some(b=>b.textContent.trim()===text&&!b.matches(':disabled')),{},text);
      await page.evaluate(text=>[...document.querySelectorAll('#view-autoseo button')].find(b=>b.textContent.trim()===text&&!b.matches(':disabled')).click(),text);
    }
    await page.waitForFunction(()=>!document.querySelector('#view-autoseo')?.textContent.includes('Set Domain →'));
    await click('✨ Generate 30 Article Topics');
    const write=async()=>{
      const [r]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/generate-seo-article'&&r.request().method()==='POST'),click('✍️ Write')]);
      return {status:r.status(),body:await r.json()};
    };
    assert.equal((await write()).status,403);
    await page.waitForFunction(()=>[...document.querySelectorAll('#view-autoseo button')].some(b=>b.textContent.trim()==='✍️ Write'));
    assert.equal(await page.$eval('#view-autoseo',e=>e.textContent.includes('🟦 Publish')),false);
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='warning_only' WHERE tenant_id=$1",[tid]);
    const warned=await write();assert.equal(warned.status,200);assert.ok(warned.body.content_safety_warnings.length);
    await page.waitForFunction(()=>document.querySelector('#view-autoseo')?.textContent.includes('CONTENT SAFETY WARNINGS'));
    const landing=await api('/api/landing-page',{campName:'guaranteed returns',domain:'demo.example.test'});
    assert.equal(landing.status,200);assert.ok(landing.body.content_safety_warnings.length);
    // A body tenant ID cannot borrow the warning-only tenant's policy.
    const {login,request}=require('./index');
    const other=await fx.seedUser({tenantId:actors.other.tid,owner:true});
    const logged=await login(baseUrl,other.email,other.password);assert.equal(logged.status,200);
    const foreign=await request(baseUrl,'POST','/api/generate-seo-article',{cookie:logged.cookie,headers:{Origin:baseUrl},body:{tenant_id:tid,title:'guaranteed returns',keyword:'marketing'}});
    assert.equal(foreign.status,403);assert.equal(foreign.json.content,undefined);
    assert.ok(calls>0);
    assert.ok((await pool.query('SELECT id FROM ai_governance_events WHERE tenant_id=$1',[tid])).rows.length);
  } finally {
    OpenAI.prototype.fetchWithTimeout=transport;scanner.scanOutput=scan;
    await pool.query('DELETE FROM ai_governance_events WHERE tenant_id=ANY($1::int[])',[[tid,actors.other.tid]]);
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='enforce' WHERE tenant_id=$1",[tid]);
  }
};
