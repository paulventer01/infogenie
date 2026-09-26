'use strict';
const assert=require('node:assert/strict');

// Real UI/login/API/tenant policy/PostgreSQL audit; synthetic upstream SDK only.
module.exports=async function keywordResearchSafety({page,baseUrl,actors,db,fx}) {
  const pool=db.getPool(), tid=actors.owner.tid;
  const scanner=require('../../services/ai_governance/output_gate'), scan=scanner.scanOutput;
  const OpenAI=require('openai').OpenAI, transport=OpenAI.prototype.fetchWithTimeout;
  let output={keywords:[{keyword:'guaranteed\nreturns',content_angle:'marketing'}]}, calls=0;
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
    await click('🔍 Keyword Research');
    async function generate(button='🔍 Research Keywords'){
      const [r]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/keyword-research'&&r.request().method()==='POST'),click(button)]);
      return {status:r.status(),body:await r.json()};
    }
    const blocked=await generate();assert.equal(blocked.status,403);assert.equal(blocked.body.keywords,undefined);
    await page.waitForFunction(()=>document.querySelector('#view-autoseo [role="alert"]')?.textContent.length>0);
    scanner.scanOutput=()=>{throw Error('synthetic scanner outage');};
    assert.equal((await generate()).status,503);scanner.scanOutput=scan;
    output={keywords:[{keyword:'crypto',content_angle:'safe investment'}]};assert.equal((await generate()).status,403);
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='warning_only' WHERE tenant_id=$1",[tid]);
    output={keywords:[{keyword:'DEMO retained keyword',content_angle:'DEMO calendar idea',extra:'guaranteed returns'}]};
    const warned=await generate();assert.equal(warned.status,200);assert.deepEqual(warned.body.keywords,output.keywords);assert.ok(warned.body.content_safety_warnings.length);
    await page.waitForFunction(()=>document.querySelector('#view-autoseo')?.textContent.includes('CONTENT SAFETY WARNINGS'));
    await page.evaluate(()=>{window.__keywordCSV='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__keywordCSV=text;}}});});
    await click('📋 Copy as CSV');
    assert.match(await page.evaluate(()=>window.__keywordCSV),/Safety Warnings/);
    assert.ok((await page.evaluate(()=>window.__keywordCSV)).includes(warned.body.content_safety_warnings[0]));
    output='guaranteed returns';const malformed=await generate('🔍 Refresh');assert.equal(malformed.status,502);
    assert.doesNotMatch(JSON.stringify(malformed.body),/guaranteed|Unexpected token/);
    await page.waitForFunction(()=>document.querySelector('#view-autoseo [role="alert"]')?.textContent.includes('unavailable'));
    assert.ok((await page.$eval('#view-autoseo',el=>el.textContent)).includes('DEMO retained keyword'));
    output={keywords:[{keyword:'x'.repeat(50001)}]};assert.equal((await generate('🔍 Refresh')).status,403);
    await page.waitForFunction(()=>document.querySelector('#view-autoseo [role="alert"]')?.textContent.includes('fewer results'));
    assert.ok((await page.$eval('#view-autoseo',el=>el.textContent)).includes('DEMO retained keyword'));
    await click('📅 Add Top Keywords to Calendar');
    await page.waitForFunction(()=>document.querySelector('#view-autoseo')?.textContent.includes('DEMO calendar idea'));
    assert.ok((await page.$eval('#view-autoseo',el=>el.textContent)).includes('CONTENT SAFETY WARNINGS'));
    await click('🔍 Keyword Research');
    output={keywords:[{keyword:'DEMO fresh keyword',content_angle:'DEMO fresh angle'}]};assert.equal((await generate('🔍 Refresh')).status,200);
    await page.waitForFunction(()=>document.querySelector('#view-autoseo')?.textContent.includes('DEMO fresh keyword'));
    assert.equal(await page.$('#view-autoseo [role="alert"]'),null);
    assert.equal((await page.$eval('#view-autoseo',el=>el.textContent)).includes('CONTENT SAFETY WARNINGS'),false);
    output={keywords:[{keyword:'guaranteed\treturns'}]};
    const {login,request}=require('./index');
    const other=await fx.seedUser({tenantId:actors.other.tid,owner:true});
    const logged=await login(baseUrl,other.email,other.password);assert.equal(logged.status,200);
    const foreign=await request(baseUrl,'POST','/api/keyword-research',{cookie:logged.cookie,headers:{Origin:baseUrl},body:{tenant_id:tid,domain:'demo.example.test'}});
    assert.equal(foreign.status,403);assert.equal(foreign.json.keywords,undefined);
    const viewer=await login(baseUrl,actors.viewer.email,actors.viewer.password);assert.equal(viewer.status,200);
    const before=calls;
    assert.equal((await request(baseUrl,'POST','/api/keyword-research',{cookie:viewer.cookie,headers:{Origin:baseUrl},body:{domain:'demo.example.test'}})).status,403);assert.equal(calls,before);
  } finally {
    OpenAI.prototype.fetchWithTimeout=transport;scanner.scanOutput=scan;
    await pool.query('DELETE FROM ai_governance_events WHERE tenant_id=ANY($1::int[])',[[tid,actors.other.tid]]);
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='enforce' WHERE tenant_id=$1",[tid]);
  }
};
