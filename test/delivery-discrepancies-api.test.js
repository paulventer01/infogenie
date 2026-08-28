'use strict';

const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const db = require('../db');
const service = require('../services/agent_orchestrator/delivery_discrepancies');
const router = require('../services/agent_orchestrator/delivery_discrepancies_api');

const originals = Object.fromEntries(['createOrGet','get','list','transition'].map(k => [k,service[k]]));
const originalPool = db.getPool;
let server;
let port;
let calls;

const safeCase = (overrides={}) => ({
  id:'case-1', monitoring_run_id:'run-1', source_state:'failed', source_classifications:['read_failure'],
  state:'open', version:1, classification:null, note:null, events:[], audit_ref:'audit-1',
  created_at:'2026-01-01T00:00:00.000Z', updated_at:'2026-01-01T00:00:00.000Z', resolved_at:null,
  ...overrides,
});

before(async () => {
  const app=express();
  app.use((req,_res,next)=>{
    const kind=req.headers['x-principal']||'user';
    req.user={id:7,principalType:kind,isOwner:req.headers['x-owner']==='1'};
    req.session={userId:req.headers['x-session-user'] ? Number(req.headers['x-session-user']) : 7};
    req.sessionID='session-7';req.tenant={id:41};
    req.tenantRole={permissions:req.headers['x-no-grant']==='1'?[]:[service.PERMISSION]};
    if(kind==='api_key')req.viaApiKey=true;
    next();
  });
  app.use('/api/agent-orchestrator/delivery-discrepancies',router);
  server=http.createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  port=server.address().port;
});

after(async()=>{for(const [k,v] of Object.entries(originals))service[k]=v;db.getPool=originalPool;
  await new Promise(resolve=>server.close(resolve));});

beforeEach(()=>{
  calls=[];router._limiter.reset();db.getPool=()=>({testPool:true});
  service.createOrGet=async o=>{calls.push(['create',o]);return safeCase();};
  service.get=async o=>{calls.push(['get',o]);return safeCase();};
  service.list=async o=>{calls.push(['list',o]);return {items:[safeCase()],next_cursor:null};};
  service.transition=async o=>{calls.push([o.action,o]);return safeCase({state:{acknowledge:'acknowledged',escalate:'escalated',resolve:'resolved'}[o.action],version:2});};
});
afterEach(()=>{for(const [k,v] of Object.entries(originals))service[k]=v;db.getPool=originalPool;});

function request(method,path,body,headers={}){return new Promise((resolve,reject)=>{
  const payload=body===undefined?null:JSON.stringify(body);
  const req=http.request({hostname:'127.0.0.1',port,method,path,headers:{...headers,...(payload?{'content-type':'application/json','content-length':Buffer.byteLength(payload)}:{})}},res=>{
    let raw='';res.on('data',chunk=>raw+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(raw||'{}')}));
  });req.on('error',reject);if(payload)req.write(payload);req.end();
});}

test('all six HTTP operations derive tenant and actor from the authenticated context',async()=>{
  const specs=[
    ['POST','/',{monitoring_run_id:'run-1'},'create'],['GET','/case-1',undefined,'get'],
    ['GET','/?limit=20&cursor=0&state=open',undefined,'list'],
    ['POST','/case-1/acknowledge',{expected_version:1,decision_id:'decision-a'},'acknowledge'],
    ['POST','/case-1/escalate',{expected_version:1,decision_id:'decision-e',classification:'provider_delay_accepted'},'escalate'],
    ['POST','/case-1/resolve',{expected_version:1,decision_id:'decision-r',classification:'false_positive'},'resolve'],
  ];
  for(const [method,path,body,action] of specs){const response=await request(method,`/api/agent-orchestrator/delivery-discrepancies${path}`,body);
    assert.equal(response.status,200,`${method} ${path}`);const call=calls.at(-1);assert.equal(call[0],action);
    assert.equal(call[1].tenantId,41);assert.equal(call[1].actorUserId,7);assert.equal(call[1].actorType,'human');
    assert.equal(call[1].hasExplicitTenantPermission(service.PERMISSION),true);
  }
});

test('API-key and non-human principals cannot reach any service operation',async()=>{
  for(const kind of ['api_key','service','service_account','worker','automation','autonomous','agent']){
    const response=await request('GET','/api/agent-orchestrator/delivery-discrepancies/',undefined,{'x-principal':kind});
    assert.equal(response.status,401,kind);assert.equal(response.body.error,'human_session_required');
  }
  assert.equal(calls.length,0);
});

test('mismatched sessions and owner/platform principals without the exact tenant grant fail closed',async()=>{
  let response=await request('GET','/api/agent-orchestrator/delivery-discrepancies/',undefined,{'x-session-user':'8'});
  assert.equal(response.status,401);assert.equal(response.body.error,'human_session_required');
  for(const kind of ['user','platform_owner','platform_admin']){response=await request('GET','/api/agent-orchestrator/delivery-discrepancies/',undefined,
    {'x-principal':kind,'x-owner':'1','x-no-grant':'1'});assert.equal(response.status,403);
    assert.equal(response.body.error,'permission_denied');}
  assert.equal(calls.length,0);
});

test('unknown and identity-override properties are rejected before service dispatch',async()=>{
  for(const body of [{monitoring_run_id:'run-1',unknown:true},{monitoring_run_id:'run-1',tenant_id:99},{monitoring_run_id:'run-1',actor_id:99}]){
    const response=await request('POST','/api/agent-orchestrator/delivery-discrepancies/',body);assert.equal(response.status,400);assert.equal(response.body.error,'validation_failed');}
  let response=await request('POST','/api/agent-orchestrator/delivery-discrepancies/case-1/resolve',
    {expected_version:1,decision_id:'d',classification:'false_positive',session_id:'override'});
  assert.equal(response.status,400);assert.equal(response.body.error,'validation_failed');
  response=await request('GET','/api/agent-orchestrator/delivery-discrepancies/?order=state');
  assert.equal(response.status,400);assert.equal(response.body.error,'validation_failed');assert.equal(calls.length,0);
});

test('every route installs the same fail-closed tenant-and-human rate limiter',()=>{
  const routes=router.stack.filter(layer=>layer.route).map(layer=>layer.route);
  assert.equal(routes.length,6);
  for(const route of routes){assert.ok(route.stack.some(layer=>layer.handle===router._limiter),`${Object.keys(route.methods)[0]} ${route.path}`);}
});

test('list forwards bounded pagination/state input and reports invalid values safely',async()=>{
  let response=await request('GET','/api/agent-orchestrator/delivery-discrepancies/?limit=50&cursor=10&state=escalated');
  assert.equal(response.status,200);assert.deepEqual({limit:calls[0][1].limit,cursor:calls[0][1].cursor,state:calls[0][1].state},{limit:'50',cursor:'10',state:'escalated'});
  service.list=async()=>{const e=new Error('validation_failed');e.code='validation_failed';throw e;};
  for(const query of ['limit=51','cursor=-1','state=verified_active']){response=await request('GET',`/api/agent-orchestrator/delivery-discrepancies/?${query}`);
    assert.equal(response.status,400);assert.equal(response.body.error,'validation_failed');}
});

test('version conflicts, exact replay, and decision collisions preserve safe errors and projections',async()=>{
  const durable=safeCase({state:'resolved',version:2,classification:'false_positive',note:'Reviewed externally'});
  service.transition=async o=>{calls.push([o.action,o]);if(o.decisionId==='stale'){const e=new Error();e.code='version_conflict';throw e;}
    if(o.decisionId==='collision'){const e=new Error();e.code='decision_id_conflict';throw e;}return durable;};
  const path='/api/agent-orchestrator/delivery-discrepancies/case-1/resolve';
  const body={expected_version:1,decision_id:'replay',classification:'false_positive'};
  const first=await request('POST',path,body),replay=await request('POST',path,body);
  assert.equal(first.status,200);assert.deepEqual(replay.body,first.body);
  for(const id of ['stale','collision']){const response=await request('POST',path,{...body,decision_id:id});assert.equal(response.status,409);
    assert.equal(response.body.error,id==='stale'?'version_conflict':'decision_id_conflict');}
  const serialized=JSON.stringify(first.body);
  for(const forbidden of ['tenant_id','actor_user_id','decision_id','credential_ref','account_fingerprint','ledger_root','provider_id','input_hash'])assert.doesNotMatch(serialized,new RegExp(forbidden));
});
