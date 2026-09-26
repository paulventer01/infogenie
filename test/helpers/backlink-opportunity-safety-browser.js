'use strict';
const assert=require('node:assert/strict');

// Real UI/login/API/tenant policy/PostgreSQL audit; synthetic upstream SDK only.
module.exports=async function backlinkOpportunitySafety({page,baseUrl,actors,db,fx}) {
  const pool=db.getPool(), tid=actors.owner.tid;
  const scanner=require('../../services/ai_governance/output_gate'), scan=scanner.scanOutput;
  const OpenAI=require('openai').OpenAI, transport=OpenAI.prototype.fetchWithTimeout;
  const cleanOpp={site:'DEMO site',url:'https://demo.example.test',type:'Guest Post',angle:'DEMO angle',difficulty:'Easy',dr:50};
  const priorMode=(await pool.query('SELECT data_mode_default FROM tenants WHERE id=$1',[tid])).rows[0].data_mode_default;
  let output={opportunities:[{...cleanOpp,angle:'guaranteed\nreturns'}]}, calls=0;
  OpenAI.prototype.fetchWithTimeout=async function(url,...args){
    const u=new URL(url);
    if(u.hostname!=='api.openai.com'||u.pathname!=='/v1/chat/completions')return transport.call(this,url,...args);
    calls++;
    return new Response(JSON.stringify({choices:[{message:{content:typeof output==='string'?output:JSON.stringify(output)}}]}),
      {status:200,headers:{'Content-Type':'application/json'}});
  };
  try {
    await pool.query("UPDATE tenants SET data_mode_default='demo' WHERE id=$1",[tid]);
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
    await click('🔗 Backlink Targets');
    async function generate(button='🔍 Find Backlink Targets'){
      const [r]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/backlink-opportunities'&&r.request().method()==='POST'),click(button)]);
      return {status:r.status(),body:await r.json()};
    }
    const blocked=await generate();assert.equal(blocked.status,403);assert.equal(blocked.body.opportunities,undefined);
    await page.waitForFunction(()=>document.querySelector('#view-autoseo [role="alert"]')?.textContent.length>0);
    scanner.scanOutput=()=>{throw Error('synthetic scanner outage');};
    assert.equal((await generate()).status,503);scanner.scanOutput=scan;
    output={opportunities:[{...cleanOpp,angle:'crypto\nsafe investment'}]};assert.equal((await generate()).status,403);
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='warning_only' WHERE tenant_id=$1",[tid]);
    output={opportunities:[{...cleanOpp,site:'DEMO retained site',extra:'guaranteed returns'}]};
    const warned=await generate();assert.equal(warned.status,200);assert.deepEqual(warned.body.opportunities,output.opportunities);assert.ok(warned.body.content_safety_warnings.length);assert.equal(warned.body._dataMode,'demo');
    await page.waitForFunction(()=>document.querySelector('#view-autoseo')?.textContent.includes('CONTENT SAFETY WARNINGS'));
    await page.evaluate(()=>{window.__backlinkPitch='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__backlinkPitch=text;}}});});
    await click('📧 Copy Pitch');
    assert.match(await page.evaluate(()=>window.__backlinkPitch),/CONTENT SAFETY WARNINGS/);
    assert.ok((await page.evaluate(()=>window.__backlinkPitch)).includes(warned.body.content_safety_warnings[0]));
    output='guaranteed returns';const malformed=await generate('🔍 Refresh Opportunities');assert.equal(malformed.status,502);
    assert.doesNotMatch(JSON.stringify(malformed.body),/guaranteed|Unexpected token/);
    await page.waitForFunction(()=>document.querySelector('#view-autoseo [role="alert"]')?.textContent.includes('unavailable'));
    assert.ok((await page.$eval('#view-autoseo',el=>el.textContent)).includes('DEMO retained site'));
    output={opportunities:[{...cleanOpp,angle:'x'.repeat(50001)}]};assert.equal((await generate('🔍 Refresh Opportunities')).status,403);
    await page.waitForFunction(()=>document.querySelector('#view-autoseo [role="alert"]')?.textContent.includes('fewer results'));
    assert.ok((await page.$eval('#view-autoseo',el=>el.textContent)).includes('DEMO retained site'));
    await click('📬 Outreach Sequencer');
    assert.ok((await page.$eval('#view-autoseo',el=>el.textContent)).includes('CONTENT SAFETY WARNINGS'));
    await click('🔗 Backlink Targets');
    output={opportunities:[{...cleanOpp,site:'DEMO fresh site'}]};assert.equal((await generate('🔍 Refresh Opportunities')).status,200);
    await page.waitForFunction(()=>document.querySelector('#view-autoseo')?.textContent.includes('DEMO fresh site'));
    assert.equal(await page.$('#view-autoseo [role="alert"]'),null);
    assert.equal((await page.$eval('#view-autoseo',el=>el.textContent)).includes('CONTENT SAFETY WARNINGS'),false);
    await pool.query("UPDATE tenants SET data_mode_default='strict' WHERE id=$1",[tid]);
    const strict=await generate('🔍 Refresh Opportunities');assert.equal(strict.body.data_unavailable,true);assert.equal(strict.body.opportunities,undefined);
    await page.waitForFunction(()=>document.querySelector('#view-autoseo')?.textContent.includes('estimated results are hidden'));
    assert.equal((await page.$eval('#view-autoseo',el=>el.textContent)).includes('DEMO fresh site'),false);
    await click('📬 Outreach Sequencer');
    assert.ok((await page.$eval('#view-autoseo',el=>el.textContent)).includes('No Backlink Targets Yet'));
    output={opportunities:[{...cleanOpp,angle:'guaranteed\treturns'}]};
    const {login,request}=require('./index');
    const other=await fx.seedUser({tenantId:actors.other.tid,owner:true});
    const logged=await login(baseUrl,other.email,other.password);assert.equal(logged.status,200);
    const foreign=await request(baseUrl,'POST','/api/backlink-opportunities',{cookie:logged.cookie,headers:{Origin:baseUrl},body:{tenant_id:tid,domain:'demo.example.test'}});
    assert.equal(foreign.status,403);assert.equal(foreign.json.opportunities,undefined);
    const viewer=await login(baseUrl,actors.viewer.email,actors.viewer.password);assert.equal(viewer.status,200);
    const before=calls;
    assert.equal((await request(baseUrl,'POST','/api/backlink-opportunities',{cookie:viewer.cookie,headers:{Origin:baseUrl},body:{domain:'demo.example.test'}})).status,403);assert.equal(calls,before);
  } finally {
    OpenAI.prototype.fetchWithTimeout=transport;scanner.scanOutput=scan;
    await pool.query('UPDATE tenants SET data_mode_default=$2 WHERE id=$1',[tid,priorMode]);
    await pool.query('DELETE FROM ai_governance_events WHERE tenant_id=ANY($1::int[])',[[tid,actors.other.tid]]);
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='enforce' WHERE tenant_id=$1",[tid]);
  }
};
