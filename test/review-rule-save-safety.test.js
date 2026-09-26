'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');

test('review rule create/update gate retained snapshots without cross-tenant or stale writes',async t=>{
  const db=require('../db'),ctx=require('../services/tenants/context'),gate=require('../services/ai_governance/route_gate');
  const {scanOutput}=require('../services/ai_governance/output_gate');
  const path=require.resolve('../services/review_monitor/reply_api'),old={pool:db.getPool,tid:ctx.resolveTenantId,gate:gate.gateRouteText};
  t.after(()=>{db.getPool=old.pool;ctx.resolveTenantId=old.tid;gate.gateRouteText=old.gate;delete require.cache[path];});
  const clean={name:'DEMO',trigger_type:'after_purchase',channel:'email',delay_hours:24,message_template:'Please review {{link}}',target_platform_url:'https://example.test',active:true};
  let row,mode,scans,writes,queries,race;
  const reset=()=>{row={...clean,id:1,tenant_id:11,save_version:'10',content_safety_warnings:[]};mode='enforce';scans=[];writes=0;queries=0;race=false;};reset();
  ctx.resolveTenantId=async req=>req.tenant.id;
  db.getPool=()=>({query:async(sql,args)=>{
    queries++;if(mode==='db-error')throw new Error('private db data');
    if(sql.startsWith('SELECT')){assert.match(sql,/id=\$1 AND tenant_id=\$2/);return {rows:args[0]==='1'&&args[1]===11&&row?[{...row}]:[]};}
    if(sql.includes('SET active=false')){assert.deepEqual(args,['1',11]);writes++;row.active=false;return {rows:[{...row}]};}
    if(sql.startsWith('UPDATE')){
      assert.match(sql,/id=\$9 AND tenant_id=\$10 AND xmin::text=\$11/);
      assert.equal(args[9],11);if(!row||row.save_version!==args[10])return {rows:[]};
    } else {assert.match(sql,/INSERT INTO review_request_rules/);assert.equal(args[8],11);}
    writes++;row={...row,...Object.fromEntries(Object.keys(clean).map((k,i)=>[k,args[i]])),content_safety_warnings:JSON.parse(args[7]),save_version:'11'};
    return {rows:[{...row}]};
  }});
  gate.gateRouteText=async opts=>{
    scans.push(opts);if(race)row.save_version='12';
    if(mode==='throw')throw new Error('private scan data');
    if(mode==='unavailable')return {ok:false,error:'content_safety_unavailable'};
    const result=scanOutput({text:opts.text});return {ok:mode==='warning'||result.verdict!=='block',warnings:result.warnings,error:'content_safety_blocked'};
  };
  delete require.cache[path];const router=require(path);
  async function save(body,update=false,tid=11){
    const handler=router.stack.find(l=>l.route?.path===(update?'/request-rules/:id':'/request-rules')&&l.route.methods[update?'put':'post']).route.stack.at(-1).handle;
    let status=200,payload;const res={status(s){status=s;return this;},json(b){payload=b;return this;}};
    await handler({body,params:update?{id:'1'}:{},tenant:{id:tid},user:{id:3}},res);return {status,body:payload};
  }
  for(const update of [false,true])for(const field of ['name','message_template','target_platform_url','trigger_type','channel']){
    reset();const r=await save({...clean,[field]:'guaranteed returns'},update);assert.equal(r.status,403);assert.equal(writes,0);assert.ok(r.body.userMessage);assert.doesNotMatch(JSON.stringify(r.body),/guaranteed returns/);
  }
  for(const state of ['throw','unavailable'])for(const update of [false,true]){
    reset();mode=state;assert.equal((await save(clean,update)).status,503);assert.equal(writes,0);
  }
  reset();row.message_template='guaranteed returns';assert.equal((await save({active:true},true)).status,403);assert.equal(writes,0);
  reset();mode='throw';row.message_template='guaranteed returns';row.content_safety_warnings=['old'];let r=await save({active:false},true);assert.equal(r.status,200);assert.equal(scans.length,0);assert.equal(row.active,false);assert.deepEqual(row.content_safety_warnings,['old']);
  reset();r=await save({active:false,message_template:'guaranteed returns'},true);assert.equal(r.status,403);assert.equal(writes,0,'disable cannot smuggle edited text');
  reset();assert.equal((await save(clean,true,22)).status,404);assert.equal(scans.length,0);assert.equal(writes,0);
  for(const body of [{...clean,name:7},{...clean,message_template:{}},{...clean,delay_hours:-1},{...clean,active:'true'}]){reset();assert.equal((await save(body)).status,400);assert.equal(scans.length,0);}
  reset();mode='warning';assert.equal((await save({...clean,message_template:'x'.repeat(100001)})).status,403);assert.equal(scans.length,0);
  reset();race=true;assert.equal((await save({message_template:'New text'},true)).status,409);assert.equal(writes,0);
  reset();r=await save({...clean,tenant_id:99,content_safety_warnings:['forged']});assert.equal(r.status,200);assert.deepEqual(row.content_safety_warnings,[]);assert.equal(scans[0].tenantId,11);
  reset();mode='warning';r=await save({message_template:'guaranteed returns'},true);assert.equal(r.status,200);assert.ok(row.content_safety_warnings.length);assert.deepEqual(r.body.rule.content_safety_warnings,row.content_safety_warnings);
  reset();r=await save({message_template:'Exact updated text'},true);assert.equal(r.status,200);assert.equal(row.name,clean.name);assert.equal(row.message_template,'Exact updated text');assert.ok(scans[0].text.includes(row.message_template));
  reset();mode='db-error';r=await save(clean);assert.equal(r.status,503);assert.doesNotMatch(JSON.stringify(r.body),/private/);
  const express=require('express'),app=express();app.use(express.json());app.use((req,res,next)=>{req.tenant={id:Number(req.headers['x-tenant']||11)};req.user=req.headers['x-anonymous']?null:{id:3};next();});app.use(router);
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}`;
  async function request(method,path,headers={}){const r=await fetch(url+path,{method,headers});await r.json();return r;}
  reset();for(let i=0;i<20;i++)assert.equal((await request('POST','/request-rules')).status,400);
  const before=queries,limited=await request('PUT','/request-rules/1');assert.equal(limited.status,429);assert.ok(Number(limited.headers.get('Retry-After'))>0);assert.equal(queries,before);
  assert.equal((await request('POST','/request-rules',{'x-anonymous':'1'})).status,429);assert.equal(queries,before);
  assert.equal((await request('POST','/request-rules',{'x-tenant':'22'})).status,400);
});
