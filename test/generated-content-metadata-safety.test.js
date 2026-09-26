'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');

test('generated HTML gates all echoed metadata and decoded copy before returning it',async t=>{
  const gate=require('../services/ai_governance/route_gate'), real=gate.gateRouteText;
  const {scanOutput}=require('../services/ai_governance/output_gate');
  let mode='enforce', output='<p>DEMO safe body</p>', scans=[], calls=0;
  gate.gateRouteText=async opts=>{
    scans.push(opts);
    if(mode==='throw') throw Error('private scanner error');
    if(mode==='unavailable') return {ok:false,error:'content_safety_unavailable'};
    const result=scanOutput({text:opts.text});
    return {ok:mode==='warning'||result.verdict!=='block',error:'content_safety_blocked',warnings:result.warnings};
  };
  const routes={};
  require('../services/ai_content/routes')({get(){},post(path,...handlers){routes[path]=handlers.at(-1);}}, {
    _tkvCtx:{resolveTenantId:async req=>req.tenant.id},
    openai:{chat:{completions:{create:async()=>{calls++;return {choices:[{message:{content:output}}]};}}}},
  });
  gate.gateRouteText=real;t.after(()=>{gate.gateRouteText=real;});
  for(const [path,body,fields,copy] of [
    ['/api/landing-page',{campName:'DEMO campaign',domain:'demo.example.test'},['campName','domain'],'html'],
    ['/api/generate-seo-article',{title:'DEMO guide',keyword:'marketing'},['title','keyword'],'content'],
  ]) {
    async function send(overrides={},tid=17){let status=200,result;await routes[path]({tenant:{id:tid},user:{id:31},body:{...body,...overrides}},
      {status(n){status=n;return this;},json(b){result=b;return this;}});return {status,body:result};}
    mode='enforce';output='<p>DEMO safe body</p>';
    for(const field of fields){
      const refused=await send({[field]:'guaranteed returns'});assert.equal(refused.status,403);assert.equal(refused.body[copy],undefined);assert.equal(refused.body[field],undefined);
      const before=calls;assert.equal((await send({[field]:{nested:'guaranteed returns'}})).status,400);assert.equal(calls,before);
    }
    output='<p>guaran<b>teed</b> ret&#117;rns</p>';assert.equal((await send()).status,403);
    output='<p>DEMO safe body</p>';
    for(mode of ['throw','unavailable']) {const r=await send();assert.equal(r.status,503);assert.doesNotMatch(JSON.stringify(r.body),/private|DEMO safe body/);}
    mode='warning';
    for(const field of fields) assert.equal((await send({[field]:'x'.repeat(100001)})).status,403);
    assert.equal((await send({},null)).status,503);
    const accepted=await send({[fields[0]]:'guaranteed returns',content_safety_warnings:['forged']});
    assert.equal(accepted.status,200);assert.equal(accepted.body[fields[0]],'guaranteed returns');assert.equal(accepted.body[copy],output);
    assert.ok(accepted.body.content_safety_warnings.length);assert.doesNotMatch(JSON.stringify(accepted.body),/forged/);
    assert.equal(scans.at(-1).tenantId,17);assert.equal(scans.at(-1).userId,31);
    mode='enforce';assert.equal((await send()).status,200);
  }
});

test('landing preview shows warnings as text and clears previous copy on refusal',async()=>{
  const {JSDOM}=require('jsdom'), vm=require('node:vm'), fs=require('node:fs');
  const dom=new JSDOM('<div id="landingPageModal"><div id="lp-loading"></div><iframe id="lp-preview-frame"></iframe><div id="lp-error"><span id="lp-error-msg"></span></div><button id="lp-download-btn"></button><button id="lp-copy-btn"></button><button id="lp-wp-btn"></button><p id="lp-subtitle"></p></div>');
  let payload={html:'<p>DEMO page</p>',content_safety_warnings:['<img src=x> warning']};
  const context=vm.createContext({document:dom.window.document,window:dom.window,analysisData:{url:'demo.example.test'},fetch:async()=>({json:async()=>payload})});
  const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
  vm.runInContext(source.slice(source.indexOf('function generateLandingPageForCamp(camp) {'),source.indexOf('window.closeLandingPageModal =')),context);
  try {
    context.generateLandingPageForCamp({name:'DEMO campaign'});await new Promise(setImmediate);
    assert.equal(dom.window.document.querySelector('#lp-safety-warnings').textContent,'Content safety warnings: <img src=x> warning');
    assert.equal(dom.window.document.querySelector('#lp-safety-warnings img'),null);
    assert.equal(dom.window._currentLandingPageHTML,payload.html);
    payload={ok:false,error:'content_safety_blocked',userMessage:'Revise metadata.'};
    context.generateLandingPageForCamp({name:'DEMO refused'});await new Promise(setImmediate);
    assert.equal(dom.window._currentLandingPageHTML,null);assert.equal(dom.window.document.querySelector('#lp-safety-warnings'),null);
    assert.equal(dom.window.document.querySelector('#lp-error-msg').textContent,'Revise metadata.');
    for(const id of ['lp-download-btn','lp-copy-btn','lp-wp-btn','lp-preview-frame']) assert.equal(dom.window.document.getElementById(id).style.display,'none');
  } finally {dom.window.close();}
});
