'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {generationText}=require('../services/safe_agent/generation_text');
const {scanOutput}=require('../services/ai_governance/output_gate');

test('proposal scan decodes whitespace and joins values without JSON key boundaries',()=>{
  for(const proposal of [{detail:'guaranteed\nreturns'},{detail:'guaranteed\treturns'},
    {first:'guaranteed',second:'returns'},{nested:['guaranteed','returns']},{'guaranteed returns':'DEMO'}]) {
    assert.equal(scanOutput({text:generationText({proposal})}).verdict,'block');
  }
  assert.equal(scanOutput({text:generationText({simulation:{expected:'guaranteed\nreturns'}})}).verdict,'block');
  assert.throws(()=>generationText({proposal:{tail:'x'.repeat(100001)}}));
  assert.throws(()=>generationText({proposal:{tail:'x'.repeat(55000)}}),'combined streams are bounded');
  let deep={};for(let i=0;i<45;i++)deep={deep};assert.throws(()=>generationText({proposal:deep}));
  assert.throws(()=>generationText({proposal:Array(21000).fill(null)}));
});

test('proposal generation blocks before any write; warnings bind to retained copy and tenant',async t=>{
  const db=require('../db'), tenant=require('../services/tenants/context'), gate=require('../services/ai_governance/route_gate');
  const sdkPath=require.resolve('openai'), routePath=require.resolve('../services/safe_agent/api');
  const old={pool:db.getPool,tenant:tenant.resolveTenantId,gate:gate.gateRouteText,sdk:require.cache[sdkPath],route:require.cache[routePath]};
  let parsed, mode='enforce', writes=[], scans=[], providerCalls=0, fallback=false;
  require.cache[sdkPath]={id:sdkPath,filename:sdkPath,loaded:true,exports:class{
    constructor(){this.chat={completions:{create:async()=>{providerCalls++;if(fallback)throw Error('synthetic provider failure');return {choices:[{message:{content:JSON.stringify(parsed)}}]};}}};}
  }};
  delete require.cache[routePath];
  db.getPool=()=>({query:async(sql,params)=>{writes.push({sql,params});return {rows:[{id:42}]};}});
  tenant.resolveTenantId=async req=>req.tenant.id;
  gate.gateRouteText=async opts=>{
    scans.push(opts);if(mode==='throw')throw Error('private scanner failure');
    if(mode==='unavailable')return {ok:false,error:'content_safety_unavailable'};
    const r=scanOutput({text:opts.text});return {ok:mode==='warning'||r.verdict!=='block',error:'content_safety_blocked',warnings:r.warnings};
  };
  const router=require('../services/safe_agent/api');
  const route=router.stack.find(l=>l.route?.path==='/propose').route.stack.at(-1).handle;
  t.after(()=>{db.getPool=old.pool;tenant.resolveTenantId=old.tenant;gate.gateRouteText=old.gate;
    for(const [path,value] of [[sdkPath,old.sdk],[routePath,old.route]]){if(value)require.cache[path]=value;else delete require.cache[path];}});
  async function send(body={}){let status=200,result;await route({tenant:{id:23},user:{id:8},body:{objective:'DEMO objective',...body}},
    {status(n){status=n;return this;},json(b){result=JSON.parse(JSON.stringify(b));return this;}});return {status,body:result};}
  for(const patch of [{proposal:{detail:'guaranteed\nreturns'}},{proposal:{first:'guaranteed',second:'returns'}},
    {simulation:{outcome:'guaranteed\treturns'}},{title:'guaranteed\nreturns'},
    {proposal:{unknown:{detail:'guaranteed\nreturns'}}}]) {
    parsed={title:'DEMO title',proposal:{},simulation:{},...patch};const r=await send();assert.equal(r.status,403);assert.equal(r.body.proposal,undefined);assert.equal(r.body.simulation,undefined);assert.equal(r.body.title,undefined);
  }
  parsed={title:'DEMO title',proposal:{detail:'Schedule a demo.'},simulation:{}};
  for(mode of ['throw','unavailable']){const r=await send();assert.equal(r.status,503);assert.doesNotMatch(JSON.stringify(r.body),/private|Schedule a demo/);}
  mode='warning';parsed.proposal={detail:'x'.repeat(55000)};assert.equal((await send()).status,403);assert.equal(writes.length,0);
  const before=providerCalls;assert.equal((await send({objective:{}})).status,400);assert.equal(providerCalls,before);
  parsed.proposal={first:'guaranteed',second:'returns'};
  const accepted=await send({tenant_id:99,content_safety_warnings:['forged']});assert.equal(accepted.status,200);assert.ok(accepted.body.content_safety_warnings.length);
  assert.equal(scans.at(-1).tenantId,23);assert.equal(scans.at(-1).userId,8);
  assert.equal(writes[0].params[0],23);assert.equal(writes[0].params[1],accepted.body.title);
  assert.deepEqual(JSON.parse(writes[0].params[2]),accepted.body.proposal);
  assert.deepEqual(JSON.parse(writes[0].params[5]),accepted.body.content_safety_warnings);
  assert.match(writes[0].sql,/pending_approval/);assert.equal(writes.length,2);
  mode='enforce';fallback=true;writes=[];const refused=await send({objective:'guaranteed\nreturns'});assert.equal(refused.status,403);assert.equal(writes.length,0);
  const clean=await send();assert.equal(clean.status,200);assert.equal(writes.length,2);
});
