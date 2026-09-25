'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');

test('checklist save gates retained text before atomic tenant-owned persistence', async t => {
  const db = require('../db'), ctx = require('../services/tenants/context');
  const gate = require('../services/ai_governance/route_gate');
  const {scanOutput} = require('../services/ai_governance/output_gate');
  const {DEFAULT_ITEMS} = require('../services/launch_compliance/schema');
  const path = require.resolve('../services/launch_compliance/api');
  const old = {pool:db.getPool, tid:ctx.resolveTenantId, gate:gate.gateRouteText};
  t.after(() => {db.getPool=old.pool;ctx.resolveTenantId=old.tid;gate.gateRouteText=old.gate;delete require.cache[path];});
  let queries, scans, mode, released, record, connections=0;
  const reset = () => {queries=[];scans=[];mode='enforce';released=false;record=null;}; reset();
  ctx.resolveTenantId = async req => req.tenant.id;
  db.getPool = () => ({connect:async () => {
    connections++;
    return {release(){released=true;},query:async (sql,args) => {
      queries.push({sql,args});
      if (sql.startsWith('INSERT INTO campaign_')) {
        record = {id:7,tenant_id:args[0],campaign_name:args[1],platform:args[2],landing_page_url:args[3],ad_copy:args[4],content_safety_warnings:JSON.parse(args[5])};
        return {rows:[record]};
      }
      if (sql.startsWith('INSERT INTO compliance_') && mode==='db-error') throw new Error('private db details');
      return {rows:[]};
    }};
  }});
  gate.gateRouteText = async opts => {
    scans.push(opts);
    if (mode==='throw') throw new Error('private scanner details');
    if (mode==='unavailable') return {ok:false,error:'content_safety_unavailable'};
    const s=scanOutput({text:opts.text});
    return {ok:mode==='warning'||s.verdict!=='block',warnings:s.warnings,error:'content_safety_blocked'};
  };
  delete require.cache[path];const router=require(path);
  const handler=router.stack.find(l=>l.route?.path==='/checklists' && l.route.methods.post).route.stack.at(-1).handle;
  async function save(body,tid=11) {
    let status=200,payload;const res={status(s){status=s;return this;},json(b){payload=b;return this;}};
    await handler({body,tenant:{id:tid},user:{id:3}},res);return {status,body:payload};
  }
  for (const field of ['campaign_name','ad_copy','platform','landing_page_url']) {
    reset();const r=await save({campaign_name:'DEMO', [field]:'guaranteed returns'});
    assert.equal(r.status,403);assert.equal(queries.length,0);assert.ok(r.body.userMessage);
    assert.doesNotMatch(JSON.stringify(r.body),/guaranteed returns/);
  }
  for (const state of ['throw','unavailable']) {
    reset();mode=state;const r=await save({campaign_name:'DEMO'});
    assert.equal(r.status,503);assert.equal(queries.length,0);assert.doesNotMatch(JSON.stringify(r.body),/private/);
  }
  for (const body of [{}, {campaign_name:' '}, {campaign_name:9}, {campaign_name:'DEMO',ad_copy:{}}, {campaign_name:'DEMO',platform:[]}]) {
    reset();assert.equal((await save(body)).status,400);assert.equal(scans.length,0);assert.equal(queries.length,0);
  }
  reset();mode='warning';assert.equal((await save({campaign_name:'DEMO',ad_copy:'x'.repeat(100001)})).status,403);assert.equal(scans.length,0);
  reset();const body={campaign_name:' DEMO exact ',ad_copy:'Exact saved copy.',platform:'meta',landing_page_url:'https://example.test',tenant_id:99,content_safety_warnings:['forged'],status:'passed'};
  let r=await save(body);assert.equal(r.status,200);assert.equal(scans[0].text,[body.campaign_name,body.platform,body.landing_page_url,body.ad_copy].join('\n'));
  assert.equal(scans[0].tenantId,11);assert.equal(record.tenant_id,11);assert.equal(record.ad_copy,body.ad_copy);assert.deepEqual(record.content_safety_warnings,[]);
  assert.equal(queries[0].sql,'BEGIN');assert.equal(queries.at(-1).sql,'COMMIT');assert.ok(released);
  const items=queries.filter(q=>q.sql.startsWith('INSERT INTO compliance_'));
  assert.equal(items.length,DEFAULT_ITEMS.length);assert.ok(items.every(q=>q.args[0]===11&&q.args[1]===7));
  reset();mode='warning';r=await save({campaign_name:'DEMO',ad_copy:'guaranteed returns'});assert.equal(r.status,200);assert.ok(record.content_safety_warnings.length);assert.deepEqual(r.body.checklist.content_safety_warnings,record.content_safety_warnings);
  reset();mode='db-error';r=await save({campaign_name:'DEMO'});assert.equal(r.status,503);assert.equal(queries.at(-1).sql,'ROLLBACK');assert.ok(released);assert.doesNotMatch(JSON.stringify(r.body),/private/);
  // Exercise the actual shared limiter, including missing identity and independent tenants/users.
  const express=require('express'),app=express();app.use(express.json());
  app.use((req,res,next)=>{req.tenant={id:Number(req.headers['x-tenant']||11)};req.user=req.headers['x-anonymous']?null:{id:Number(req.headers['x-user']||3)};next();});app.use(router);
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}/checklists`;
  const request=async(headers={})=>{const r=await fetch(url,{method:'POST',headers});await r.json();return r;};
  for(let i=0;i<20;i++) assert.equal((await request()).status,400);
  const before=connections, limited=await request();assert.equal(limited.status,429);assert.ok(Number(limited.headers.get('Retry-After'))>0);
  assert.equal((await request({'x-anonymous':'1'})).status,429);assert.equal(connections,before);
  assert.equal((await request({'x-tenant':'22'})).status,400);assert.equal((await request({'x-user':'4'})).status,400);
});
