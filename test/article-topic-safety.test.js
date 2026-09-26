'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {jsonGateText}=require('../services/ai_governance/json_text');
const {scanOutput}=require('../services/ai_governance/output_gate');

test('topic scan covers decoded leaves, unknown keys, field splits and bounded suffixes',()=>{
  for(const payload of [{title:'guaranteed\nreturns'}, {title:'guaranteed\treturns'},
    {title:'guaranteed',keyword:'returns'}, {'guaranteed returns':'demo'}, {extra:{nested:'guaranteed returns'}}]) {
    assert.equal(scanOutput({text:jsonGateText(payload)}).verdict,'block');
  }
  assert.equal(jsonGateText({title:'x'.repeat(50001)}),null);
  let deep='demo';for(let i=0;i<42;i++) deep={next:deep};assert.equal(jsonGateText(deep),null);
  assert.equal(jsonGateText(Array(20001).fill(null)),null);
  assert.ok(jsonGateText({title:'DEMO guide',volume:0}).includes('0'));
});

test('topic scan preserves dot-based compliance across fields and decoded whitespace',()=>{
  for(const whitespace of [' ', '\n', '\r\n', '\t', '\u2028', '\u2029']) {
    for(const payload of [{title:'crypto',keyword:'guaranteed safe investment'},
      {title:'crypto'+whitespace+'safe investment'}, {title:'crypto',extra:{copy:whitespace+'no risk'}}]) {
      const result=scanOutput({text:jsonGateText(payload)});
      assert.equal(result.verdict,'block');
      assert.ok(result.checks.some(c=>c.detail.rule_id==='crypto_risk_missing'));
    }
    const urgency=scanOutput({text:jsonGateText({title:'act now',keyword:whitespace+'free offer'})});
    assert.ok(urgency.checks.some(c=>c.detail.rule_id==='misleading_urgency'));
    assert.ok(urgency.warnings.length);
  }
  assert.equal(jsonGateText({title:' '.repeat(50001)}),null,'original size is bounded before whitespace folding');
});

test('article topics gate exact retained output, isolate policy and withhold refused content',async t=>{
  const gate=require('../services/ai_governance/route_gate'), real=gate.gateRouteText;
  let output={topics:[{title:'DEMO guide',keyword:'marketing'}]}, mode='enforce', scans=[];
  gate.gateRouteText=async opts=>{
    scans.push(opts);
    if(mode==='throw') throw Error('private scanner diagnostic');
    if(mode==='unavailable') return {ok:false,error:'content_safety_unavailable'};
    const result=scanOutput({text:opts.text});
    return {ok:mode==='warning'||result.verdict!=='block',error:'content_safety_blocked',warnings:result.warnings};
  };
  let route;
  require('../services/ai_content/routes')({get(){},post(path,...handlers){if(path==='/api/generate-article-topics')route=handlers.at(-1);}}, {
    _tkvCtx:{resolveTenantId:async req=>req.tenant.id},
    openai:{chat:{completions:{create:async()=>({choices:[{message:{content:JSON.stringify(output)}}]})}}},
  });
  gate.gateRouteText=real;t.after(()=>{gate.gateRouteText=real;});
  async function send(tid=17){let status=200,body;await route({tenant:{id:tid},user:{id:31},body:{domain:'demo.example.test',tenant_id:99}},
    {status(n){status=n;return this;},json(b){body=b;return this;}});return {status,body};}
  for(const fields of [{title:'guaranteed\nreturns'}, {title:'guaranteed',keyword:'returns'},
    {title:'crypto',keyword:'guaranteed safe investment'}, {title:'crypto\nsafe investment'},
    {intent:'guaranteed\treturns'}, {extra:{copy:'guaranteed returns'}}, {'guaranteed returns':'demo'}]) {
    output={topics:[{title:'DEMO guide',keyword:'marketing',...fields}]};
    const r=await send();assert.equal(r.status,403);assert.equal(r.body.topics,undefined);
  }
  for(mode of ['throw','unavailable']) {const r=await send();assert.equal(r.status,503);assert.equal(r.body.topics,undefined);assert.doesNotMatch(JSON.stringify(r.body),/private/);}
  mode='warning';output={topics:[{title:'crypto',keyword:'guaranteed safe investment'}]};
  const warned=await send();assert.equal(warned.status,200);assert.deepEqual(warned.body.topics,output.topics);assert.ok(warned.body.content_safety_warnings.length);
  assert.equal(scans.at(-1).tenantId,17);assert.equal(scans.at(-1).userId,31);
  output={topics:[{title:'x'.repeat(50001),keyword:'marketing'}]};assert.equal((await send()).status,403);
  output={topics:[{title:'DEMO guide',keyword:'marketing'}]};assert.equal((await send(null)).status,503);
  mode='enforce';const clean=await send();assert.equal(clean.status,200);assert.deepEqual(clean.body.topics,output.topics);
  for(const topics of [{title:'bad'},[null],[{title:{text:'bad'},keyword:'demo'}]]) {output={topics};const r=await send();assert.equal(r.status,502);assert.equal(r.body.topics,undefined);}
});
