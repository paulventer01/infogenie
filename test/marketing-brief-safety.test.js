'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { briefText } = require('../services/marketing_brief/brief_text');
const { scanOutput } = require('../services/ai_governance/output_gate');

test('brief scans decoded text including retained signals and brand with bounded traversal', () => {
  for (const value of [{headline:'guaranteed\nreturns'}, {sections:[{items:['guaranteed\treturns']}]},
    {brand:'guaranteed returns'}, {signals:[{detail:'guaranteed\nreturns',horizon:'tomorrow'}]}]) {
    assert.equal(scanOutput({text:briefText(value)}).verdict,'block');
  }
  assert.throws(()=>briefText({headline:'x'.repeat(100001)}));
  let value='suffix'; for(let i=0;i<42;i++) value=[value];
  assert.throws(()=>briefText(value));
  assert.throws(()=>briefText(Array(20001).fill('')));
});

test('brief generation gates provider text, signals and brand before INSERT, preserves warning metadata', async t => {
  const db=require('../db'), hooks=require('../services/ai_governance/hooks');
  const old={pool:db.getPool,gate:hooks.gateGeneratedContent};
  let inserts=0, seen, result={ok:true,content_safety_warnings:['Review this claim']};
  db.getPool=()=>({async query(sql,params){
    if(sql.includes('INSERT INTO marketing_briefs')) {inserts++;return {rows:[{content_safety_warnings:JSON.parse(params[9])}]};}
    if(sql.includes('FROM crisis_incidents')) return {rows:[{headline:'Retained signal',severity:'high'}]};
    return {rows:[]};
  }});
  hooks.gateGeneratedContent=async opts=>{seen=opts; if(result instanceof Error) throw result; return result;};
  let body={headline:'guaranteed\nreturns',greeting:'DEMO',sections:[],actions:[]};
  const restore=require('./helpers/marketing-brief-provider')(()=>body);
  t.after(()=>{restore();db.getPool=old.pool;hooks.gateGeneratedContent=old.gate;});
  const {generateBrief}=require('../services/marketing_brief/generator');
  assert.deepEqual((await generateBrief('Brand leaf',42)).content_safety_warnings,['Review this claim']);
  assert.equal(inserts,1);assert.equal(seen.tenantId,42);
  assert.match(seen.text,/guaranteed\nreturns/);assert.match(seen.text,/Retained signal/);assert.match(seen.text,/Brand leaf/);
  for(const code of ['content_safety_blocked','content_safety_unavailable']) {
    result={ok:false,error:code,userMessage:'Synthetic refusal'};
    await assert.rejects(generateBrief('Brand',42),{code});
  }
  result=new Error('sensitive scanner internals');
  await assert.rejects(generateBrief('Brand',42),{code:'content_safety_unavailable'});
  body={headline:'x'.repeat(100001)};result={ok:true};
  await assert.rejects(generateBrief('Brand',42),{code:'content_safety_unavailable'});
  assert.equal(inserts,1,'refusals never persist');
});

test('all brief generation routes use safe HTTP errors and merged marks prior tenant data stale', async t => {
  const db=require('../db'), tenant=require('../services/tenants/context'), generator=require('../services/marketing_brief/generator');
  const old={pool:db.getPool,has:db.hasDb,tid:tenant.resolveTenantId,generate:generator.generateBrief};
  let code='content_safety_blocked', existing=true;
  const brief={id:7,headline:'Saved tenant content',created_at:new Date().toISOString()};
  db.hasDb=()=>true;tenant.resolveTenantId=async()=>42;
  db.getPool=()=>({async query(sql,params){assert.equal(params[0],42);return {rows:sql.includes('FROM marketing_briefs')&&existing?[brief]:[]};}});
  generator.generateBrief=async()=>{const e=new Error('private provider detail');e.code=code;throw e;};
  delete require.cache[require.resolve('../services/marketing_brief/api')];
  const app=require('express')();app.use('/api/marketing-brief',require('../services/marketing_brief/api'));
  const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
  t.after(async()=>{await new Promise(r=>server.close(r));db.getPool=old.pool;db.hasDb=old.has;tenant.resolveTenantId=old.tid;generator.generateBrief=old.generate;delete require.cache[require.resolve('../services/marketing_brief/api')];});
  for(code of ['content_safety_blocked','content_safety_unavailable','unknown']) {
    for(const path of ['merged?force=1','today?force=1','generate']) {
      const r=await fetch(`http://127.0.0.1:${server.address().port}/api/marketing-brief/${path}`,{method:path==='generate'?'POST':'GET'});
      const body=await r.json();assert.equal(r.status,code==='unknown'?500:code.endsWith('blocked')?403:503);
      assert.equal(body.ok,false);assert.doesNotMatch(JSON.stringify(body),/private provider/);
      if(path.startsWith('merged')) {assert.equal(body.stale,true);assert.equal(body.previous_data.brief.id,7);}
      else assert.equal(body.previous_data,undefined);
    }
  }
  existing=false;
  const empty=await fetch(`http://127.0.0.1:${server.address().port}/api/marketing-brief/merged`);
  assert.equal((await empty.json()).previous_data,undefined);
});
