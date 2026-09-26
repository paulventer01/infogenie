'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {scanOutput}=require('../services/ai_governance/output_gate');
const clean={pillar:'Marketing guide',topics:['Planning'],questions:['How to begin?'],aiNote:'Use clear headings'};
test('content clusters scan decoded retained fields and fail closed without fabricated fallback',async t=>{
  const gate=require('../services/ai_governance/route_gate'), real=gate.gateRouteText;
  const context=require('../services/tenants/context'), resolve=context.resolveTenantId;
  let output=clean, extra={}, mode='enforce', scans=[];
  context.resolveTenantId=async req=>req.tenant.id;
  gate.gateRouteText=async opts=>{
    scans.push(opts); if(mode==='throw')throw Error('private scanner diagnostic');
    const result=scanOutput({text:opts.text});
    return {ok:mode==='warning'||result.verdict!=='block',error:'content_safety_blocked',warnings:result.warnings};
  };
  let route;
  require('../services/market_signals/routes')({get(){},post(path,...handlers){if(path==='/api/ai-content-clusters')route=handlers.at(-1);}}, {
    openai:{chat:{completions:{create:async()=>({choices:[{message:{content:typeof output==='string'?output:JSON.stringify(output)}}]})}}},
    anthropic:{messages:{create:async()=>({content:[{text:JSON.stringify(extra)}]})}},
  });
  gate.gateRouteText=real;t.after(()=>{gate.gateRouteText=real;context.resolveTenantId=resolve;});
  async function send(tid=17){let status=200,body;await route({tenant:{id:tid},user:{id:31},body:{seed:'Marketing',tenant_id:99}},
    {status(n){status=n;return this;},json(b){body=b;return this;}});return {status,body};}
  for(const fields of [{pillar:'guaranteed\nreturns'},{pillar:'guaranteed',topics:['returns']},
    {pillar:'crypto',topics:['safe investment']},{aiNote:'crypto\nsafe investment'},{aiNote:'guaranteed\treturns'}]) {
    output={...clean,...fields};const r=await send();assert.equal(r.status,403);assert.equal(r.body.cluster,undefined);
  }
  mode='throw';assert.equal((await send()).status,503);
  mode='warning';output={...clean,aiNote:'guaranteed returns'};
  const warned=await send();assert.equal(warned.status,200);assert.equal(warned.body.cluster.aiNote,output.aiNote);assert.ok(warned.body.content_safety_warnings.length);
  assert.equal(scans.at(-1).tenantId,17);assert.equal(scans.at(-1).userId,31);
  output={...clean,extra:'x'.repeat(50001)};assert.equal((await send()).status,403);
  output=clean;assert.equal((await send(null)).status,503);
  mode='enforce';extra={extraQuestions:['guaranteed returns']};assert.equal((await send()).status,403);
  extra={llmTip:'crypto safe investment'};assert.equal((await send()).status,403);
  extra={};const accepted=await send();assert.equal(accepted.status,200);assert.equal(accepted.body.cluster.pillar,clean.pillar);
  for(output of ['guaranteed returns',null,[],{}, {...clean,topics:'wrong'}, {...clean,questions:[{}]}, {...clean,aiNote:{text:'wrong'}}]) {
    const r=await send();assert.equal(r.status,502);assert.equal(r.body.cluster,undefined);assert.doesNotMatch(JSON.stringify(r.body),/guaranteed|Unexpected token/);
  }
});
