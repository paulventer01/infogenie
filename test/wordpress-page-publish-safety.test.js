'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');

test('WordPress page publish gates exact title/body, fails closed, returns warnings and limits attempts', async t => {
  const gate = require('../services/ai_governance/route_gate');
  const realGate = gate.gateRouteText, realFetch = global.fetch;
  const {scanOutput} = require('../services/ai_governance/output_gate');
  let mode = 'enforce', providerMode = 'success', calls = [], scans = [], route;
  gate.gateRouteText = async opts => {
    scans.push(opts);
    if (mode === 'throw') throw Error('private scanner failure');
    if (mode === 'unavailable') return {ok:false,error:'content_safety_unavailable'};
    const result = scanOutput({text:opts.text});
    return {ok:mode === 'warning' || result.verdict !== 'block', error:'content_safety_blocked', warnings:result.warnings};
  };
  require('../services/ai_content/routes')({get(){},post(path,...handlers){
    if(path === '/api/publish-to-wordpress') route = handlers;
  }}, {_tkvCtx:{resolveTenantId:async req => req.tenant?.id}});
  gate.gateRouteText = realGate;
  global.fetch = async (url,opts) => {
    assert.equal(url,'https://wordpress.example.test/wp-json/wp/v2/pages');
    calls.push(JSON.parse(opts.body));
    if(providerMode === 'throw') throw Error('private provider credential');
    return {ok:providerMode === 'success',json:async()=>({id:41,link:'https://wordpress.example.test/page/41',status:calls.at(-1).status})};
  };
  t.after(()=>{gate.gateRouteText=realGate;global.fetch=realFetch;});
  async function publish(overrides={},tid=11) {
    let status=200,body;
    await route.at(-1)({tenant:{id:tid},user:{id:7},body:{siteUrl:'https://wordpress.example.test',username:'fixture',appPassword:'synthetic-only',title:'A guide',content:'Learn more.',...overrides}}, {
      status(n){status=n;return this;},json(value){body=value;return this;},
    });
    return {status,body};
  }
  for(const status of ['draft','pending','publish']) for(const field of ['title','content']) {
    assert.equal((await publish({status,[field]:'guaranteed returns'})).status,403);
  }
  for(const content of ['guaran<b>teed</b> ret&#117;rns','<template>guaran<b>teed</b> returns</template>','<iframe>guaran<b>teed</b> returns</iframe>','<img alt="guaranteed ret&#117;rns">']) {
    assert.equal((await publish({content})).status,403);
  }
  for(mode of ['unavailable','throw']) {
    const r=await publish();assert.equal(r.status,503);assert.equal(r.body.error,'content_safety_unavailable');
    assert.doesNotMatch(JSON.stringify(r.body),/private/);
  }
  mode='warning';
  for(const content of ['a'.repeat(100001),'a'.repeat(60000)]) assert.equal((await publish({content})).status,403);
  assert.equal((await publish({},null)).status,503);
  for(const input of [{title:{}},{content:{}},{status:'future'}]) assert.equal((await publish(input)).status,400);
  assert.equal(calls.length,0);
  const warning=await publish({title:'guaranteed returns',content_safety_warnings:['forged']});
  assert.equal(warning.status,200);assert.ok(warning.body.content_safety_warnings.length);
  assert.doesNotMatch(JSON.stringify(warning.body),/forged/);
  assert.equal(calls.at(-1).title,'guaranteed returns');assert.equal(calls.at(-1).status,'draft');
  assert.equal(scans.at(-1).tenantId,11);assert.equal(scans.at(-1).userId,7);
  mode='enforce';
  assert.equal((await publish({title:''})).status,200);
  assert.equal(calls.at(-1).title,'Campaign Landing Page');assert.match(scans.at(-1).text,/Campaign Landing Page/);
  for(providerMode of ['reject','throw']) {
    const r=await publish();assert.equal(r.status,502);assert.doesNotMatch(JSON.stringify(r.body),/private/);
    if(providerMode==='throw') assert.match(r.body.userMessage,/before retrying/);
  }
  // Real middleware: rejected attempts must never reach the handler or provider.
  const express=require('express'),app=express();app.use(express.json());
  app.use((req,res,next)=>{req.tenant={id:req.headers['x-tenant']};req.user={id:req.headers['x-user']};next();});
  let reached=0;app.post('/publish',route[0],(req,res)=>{reached++;res.json({ok:true});});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const endpoint=`http://127.0.0.1:${server.address().port}/publish`;
  const send=headers=>realFetch(endpoint,{method:'POST',headers});
  for(let i=0;i<20;i++) assert.equal((await send({'x-tenant':'11','x-user':'7'})).status,200);
  const limited=await send({'x-tenant':'11','x-user':'7'});assert.equal(limited.status,429);assert.ok(limited.headers.get('retry-after'));
  assert.equal((await send({'x-tenant':'22','x-user':'7'})).status,200);
  assert.equal((await send({'x-tenant':'11','x-user':'8'})).status,200);
  assert.equal((await send({})).status,429);assert.equal(reached,22);
});
