'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const cleanOpp={site:'DEMO site',url:'https://demo.example.test',type:'Guest Post',angle:'DEMO angle',difficulty:'Easy',dr:50};
const {scanOutput}=require('../services/ai_governance/output_gate');

test('backlink opportunity gate exact retained output, isolate policy and withhold refused content',async t=>{
  const gate=require('../services/ai_governance/route_gate'), real=gate.gateRouteText;
  let output={opportunities:[cleanOpp]}, mode='enforce', scans=[];
  gate.gateRouteText=async opts=>{
    scans.push(opts);
    if(mode==='throw') throw Error('private scanner diagnostic');
    if(mode==='unavailable') return {ok:false,error:'content_safety_unavailable'};
    const result=scanOutput({text:opts.text});
    return {ok:mode==='warning'||result.verdict!=='block',error:'content_safety_blocked',warnings:result.warnings};
  };
  let route;
  require('../services/ai_content/routes')({get(){},post(path,...handlers){if(path==='/api/backlink-opportunities')route=handlers.at(-1);}}, {
    _tkvCtx:{resolveTenantId:async req=>req.tenant.id},
    openai:{chat:{completions:{create:async()=>({choices:[{message:{content:typeof output==='string'?output:JSON.stringify(output)}}]})}}},
  });
  gate.gateRouteText=real;t.after(()=>{gate.gateRouteText=real;});
  async function send(tid=17){let status=200,body;await route({tenant:{id:tid},user:{id:31},body:{domain:'demo.example.test',tenant_id:99}},
    {status(n){status=n;return this;},json(b){body=b;return this;}});return {status,body};}
  for(const fields of [{angle:'guaranteed\nreturns'}, {angle:'guaranteed',difficulty:'returns'},
    {...cleanOpp,site:'crypto',angle:'guaranteed safe investment'}, {angle:'crypto\nsafe investment'},
    {angle:'guaranteed\treturns'}, {extra:{copy:'guaranteed returns'}}, {'guaranteed returns':'demo'}]) {
    output={opportunities:[{...cleanOpp,...fields}]};
    const r=await send();assert.equal(r.status,403);assert.equal(r.body.opportunities,undefined);
  }
  for(mode of ['throw','unavailable']) {const r=await send();assert.equal(r.status,503);assert.equal(r.body.opportunities,undefined);assert.doesNotMatch(JSON.stringify(r.body),/private/);}
  mode='warning';output={opportunities:[{...cleanOpp,site:'crypto',angle:'guaranteed safe investment'}]};
  const warned=await send();assert.equal(warned.status,200);assert.deepEqual(warned.body.opportunities,output.opportunities);assert.ok(warned.body.content_safety_warnings.length);
  assert.equal(scans.at(-1).tenantId,17);assert.equal(scans.at(-1).userId,31);
  output={opportunities:[{...cleanOpp,angle:'x'.repeat(50001)}]};assert.equal((await send()).status,403);
  output={opportunities:[cleanOpp]};assert.equal((await send(null)).status,503);
  mode='enforce';const clean=await send();assert.equal(clean.status,200);assert.deepEqual(clean.body.opportunities,output.opportunities);
  for(const opportunities of [undefined,null,false,0,'',{title:'bad'},[null],[{...cleanOpp,site:{text:'bad'}}], [{...cleanOpp,url:'javascript:alert(1)'}]]) {output={opportunities};const r=await send();assert.equal(r.status,502);assert.equal(r.body.opportunities,undefined);}
  output='guaranteed returns';const malformed=await send();
  assert.equal(malformed.status,502);assert.equal(malformed.body.opportunities,undefined);
  assert.doesNotMatch(JSON.stringify(malformed.body),/guaranteed|Unexpected token/);
  for(const envelope of [[cleanOpp],{backlinks:[cleanOpp]},{sites:[cleanOpp]}]) {output=envelope;assert.deepEqual((await send()).body.opportunities,[cleanOpp]);}
  assert.equal(clean.body.source,'demo');assert.equal(clean.body._estimated,true);
  output={opportunities:[]};assert.deepEqual((await send()).body.opportunities,[]);

});
