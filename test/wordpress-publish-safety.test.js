'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');

test('WordPress publish safety gates retained fields before provider and log writes', async t => {
  const db = require('../db'), ctx = require('../services/tenants/context');
  const gate = require('../services/ai_governance/route_gate');
  const {scanOutput} = require('../services/ai_governance/output_gate');
  const originals = {hasDb:db.hasDb,getPool:db.getPool,resolve:ctx.resolveTenantId,gate:gate.gateRouteText};
  const provider = require('./helpers/wordpress-provider-fixture')();
  let logs = [], scans = [], mode = 'enforce';
  const path = require.resolve('../services/wordpress/api');
  t.after(() => {
    db.hasDb=originals.hasDb; db.getPool=originals.getPool; ctx.resolveTenantId=originals.resolve;
    gate.gateRouteText=originals.gate; provider.restore(); delete require.cache[path];
  });
  db.hasDb=() => true;
  db.getPool=() => ({query:async (sql, args) => {
    if (sql.includes('SELECT * FROM wordpress_sites')) return {rows: args[0]===1 && args[1]===11
      ? [{site_url:'https://wordpress.example.test',username:'fixture',app_password:'synthetic-password'}] : []};
    assert.match(sql,/INSERT INTO wordpress_publish_log/); logs.push(args); return {rows:[]};
  }});
  ctx.resolveTenantId=async req => req.tenant.id;
  gate.gateRouteText=async opts => {
    scans.push(opts);
    if (mode==='throw') throw new Error('private scanner failure');
    if (mode==='unavailable') return {ok:false,error:'content_safety_unavailable'};
    const result=scanOutput({text:opts.text});
    return {ok:mode==='warning' || result.verdict!=='block',error:'content_safety_blocked',warnings:result.warnings};
  };
  delete require.cache[path];
  const router=require(path), handler=router.stack.find(l=>l.route?.path==='/publish').route.stack[0].handle;
  async function publish(overrides={},tid=11) {
    let status=200,body;
    const res={status(code){status=code;return this;},json(value){body=value;return this;}};
    await handler({body:{site_id:1,title:'A useful guide',content:'Schedule a demo.',excerpt:'Learn more.',...overrides},tenant:{id:tid},user:{id:3}},res);
    return {status,body};
  }
  const prohibited='guaranteed returns';
  for (const status of ['draft','pending','publish']) for (const field of ['title','content','excerpt','tags']) {
    const before=provider.calls.length, writes=logs.length;
    const r=await publish({status,[field]:field==='tags'?[prohibited]:prohibited});
    assert.equal(r.status,403,field+' '+status); assert.equal(r.body.ok,false);
    assert.ok(r.body.userMessage); assert.equal(JSON.stringify(r.body).includes(prohibited),false);
    if (field==='tags') assert.match(r.body.userMessage,/tags/);
    assert.equal(provider.calls.length,before); assert.equal(logs.length,writes);
  }
  for (const content of ['guaran<b>teed</b> ret&#117;rns','<p>guaranteed</p><p>returns</p>','x'.repeat(8100)+' guaranteed returns']) {
    assert.equal((await publish({content})).status,403);
  }
  assert.equal((await publish({title:'<template>',content:'guaran<b>teed</b> returns'})).status,403);
  assert.equal((await publish({content:'<template><template>guaran<b>teed</b> returns</template></template>'})).status,403);
  assert.equal((await publish({content:'<img alt="guaranteed ret&#117;rns">'})).status,403);
  for (const tag of ['iframe','noscript','xmp','plaintext']) {
    assert.equal((await publish({content:`<${tag}>guaran<b>teed</b> returns</${tag}>`})).status,403,tag);
  }
  for (const tag of ['blockquote','pre','address','figure','header']) {
    assert.equal((await publish({content:`<${tag}>guaranteed</${tag}><${tag}>returns</${tag}>`})).status,403,tag);
  }
  assert.equal((await publish({content:'<blockquote>guaran<b>teed</b></blockquote><blockquote title=">">returns</blockquote>'})).status,403);
  assert.equal((await publish({content:'<iframe>guaran<b title=">">teed</b> returns</iframe>'})).status,403);
  for (mode of ['unavailable','throw']) {
    const r=await publish(); assert.equal(r.status,503); assert.equal(r.body.error,'content_safety_unavailable');
    assert.equal(JSON.stringify(r.body).includes('private scanner failure'),false);
  }
  mode='warning';
  assert.equal((await publish({content:'a'.repeat(100001)})).status,403);
  assert.equal((await publish({content:'a'.repeat(60000)})).status,403,'combined scan ceiling cannot be bypassed by warning-only');
  assert.equal(provider.calls.length,0); assert.equal(logs.length,0);
  const count=scans.length;
  assert.equal((await publish({},22)).status,404); assert.equal(scans.length,count);
  mode='enforce';
  for (const status of ['draft','pending','publish']) {
    const r=await publish({status}); assert.equal(r.status,200);
    assert.equal(provider.calls.at(-1).body.status,status); assert.equal(logs.at(-1)[0],11);
  }
  mode='warning';
  const warning=await publish({content:'Act now for this discount offer'});
  assert.equal(warning.status,200); assert.ok(warning.body.content_safety_warnings.length);
  assert.equal(scans.at(-1).tenantId,11); assert.equal(scans.at(-1).userId,3);
  assert.equal(scans.at(-1).action,'generate_content');
  provider.status=500;
  const writes=logs.length;
  assert.equal((await publish()).status,502); assert.equal(logs.length,writes);
});
