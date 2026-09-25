'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');

test('review reply approval checks exact text and atomically transitions only owned pending copy', async t => {
  const db=require('../db'), ctx=require('../services/tenants/context');
  const gate=require('../services/ai_governance/route_gate');
  const {scanOutput}=require('../services/ai_governance/output_gate');
  const saved={pool:db.getPool,tid:ctx.resolveTenantId,gate:gate.gateRouteText};
  const path=require.resolve('../services/review_monitor/reply_api');
  t.after(()=>{db.getPool=saved.pool;ctx.resolveTenantId=saved.tid;gate.gateRouteText=saved.gate;delete require.cache[path];});
  let row, scans=[], writes=0, mode='enforce', race, dbCalls=0;
  function reset(text='Thanks for your feedback.') { row={ai_draft_reply:text,status:'pending'};scans=[];writes=0;mode='enforce';race=null; }
  reset();
  ctx.resolveTenantId=async req=>req.tenant.id;
  db.getPool=()=>({query:async (sql,args)=>{
    dbCalls++;
    if (mode==='db-error') throw new Error('private database detail');
    assert.match(sql,/tenant_id=\$2/);
    if (sql.startsWith('SELECT')) return {rows:args[0]==='1'&&args[1]===11 ? [{...row}] : []};
    assert.match(sql,/status='pending'/);assert.match(sql,/ai_draft_reply IS NOT DISTINCT FROM \$5/);
    if (row.status!=='pending'||row.ai_draft_reply!==args[4]) return {rows:[]};
    writes++;row={status:'approved',ai_draft_reply:args[2],warnings:JSON.parse(args[3])};return {rows:[{id:1}]};
  }});
  gate.gateRouteText=async opts=>{
    scans.push(opts);if (race) race();
    if(mode==='throw') throw new Error('private scanner detail');
    if(mode==='unavailable') return {ok:false,error:'content_safety_unavailable'};
    const s=scanOutput({text:opts.text});
    return {ok:mode==='warning'||s.verdict!=='block',error:'content_safety_blocked',warnings:s.warnings};
  };
  delete require.cache[path];
  const router=require(path);
  const handler=router.stack.find(l=>l.route?.path==='/replies/:id/approve').route.stack.at(-1).handle;
  async function approve(body={},tid=11,id='1') {
    let status=200,payload;const res={status(s){status=s;return this;},json(b){payload=b;return this;}};
    await handler({body,params:{id},tenant:{id:tid},user:{id:3}},res);return {status,body:payload};
  }
  reset('guaranteed returns');assert.equal((await approve()).status,403);assert.equal(writes,0);assert.equal(row.status,'pending');
  reset();let r=await approve({ai_draft_reply:'guaranteed returns',status:'approved',content_safety_warnings:[]});
  assert.equal(r.status,403);assert.equal(writes,0);assert.ok(r.body.userMessage);assert.doesNotMatch(JSON.stringify(r.body),/guaranteed returns/);
  for(const state of ['throw','unavailable']) { reset();mode=state;r=await approve();assert.equal(r.status,503);assert.equal(writes,0);assert.doesNotMatch(JSON.stringify(r.body),/private/); }
  reset();mode='warning';assert.equal((await approve({ai_draft_reply:'x'.repeat(100001)})).status,403);assert.equal(scans.length,0);
  for(const bad of ['',null,{},7]) { reset();assert.equal((await approve({ai_draft_reply:bad})).status,400);assert.equal(writes,0); }
  reset();assert.equal((await approve({},22)).status,404);assert.equal((await approve({},11,'2')).status,404);assert.equal(scans.length,0);
  for(const state of ['approved','dismissed']) { reset();row.status=state;assert.equal((await approve()).status,409);assert.equal(scans.length,0); }
  reset();race=()=>{row.ai_draft_reply='guaranteed returns';};assert.equal((await approve()).status,409);assert.equal(writes,0);
  reset();race=()=>{row.status='dismissed';};assert.equal((await approve()).status,409);assert.equal(writes,0);
  reset();assert.equal((await approve({ai_draft_reply:'The exact edited reply.'})).status,200);
  assert.equal(row.ai_draft_reply,'The exact edited reply.');assert.equal(scans[0].text,row.ai_draft_reply);assert.equal(scans[0].tenantId,11);
  assert.equal((await approve()).status,409);assert.equal(writes,1);
  reset();mode='warning';r=await approve({ai_draft_reply:'guaranteed returns'});assert.equal(r.status,200);assert.ok(r.body.content_safety_warnings.length);assert.deepEqual(row.warnings,r.body.content_safety_warnings);
  reset();assert.equal((await approve()).status,200);assert.equal(scans[0].text,'Thanks for your feedback.');
  reset();mode='db-error';r=await approve();assert.equal(r.status,503);assert.doesNotMatch(JSON.stringify(r.body),/private/);
  // Exercise the real route middleware: IDs cannot create fresh rate buckets,
  // missing identity fails closed, and a different tenant/user is independent.
  const express=require('express'), app=express();
  app.use(express.json());app.use((req,res,next)=>{
    req.tenant={id:Number(req.headers['x-tenant']||11)};
    req.user=req.headers['x-anonymous'] ? null : {id:Number(req.headers['x-user']||3)};next();
  });app.use(router);
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}`;
  reset();
  for(let n=0;n<20;n++) {
    const response=await fetch(`${url}/replies/${n+10}/approve`,{method:'POST'});
    assert.equal(response.status,404);await response.json();
  }
  const before=dbCalls;
  const limited=await fetch(`${url}/replies/99/approve`,{method:'POST'});
  assert.equal(limited.status,429);assert.ok(Number(limited.headers.get('Retry-After'))>0);
  assert.equal((await limited.json()).error,'rate_limited');assert.equal(dbCalls,before);
  const anonymous=await fetch(`${url}/replies/1/approve`,{method:'POST',headers:{'x-anonymous':'1'}});
  assert.equal(anonymous.status,429);await anonymous.json();assert.equal(dbCalls,before);
  const other=await fetch(`${url}/replies/99/approve`,{method:'POST',headers:{'x-tenant':'22'}});
  assert.equal(other.status,404);await other.json();
});
