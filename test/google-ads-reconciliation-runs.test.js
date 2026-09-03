'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const R=require('../services/agent_orchestrator/google_ads_paused_draft_reconciliation');
const authority=require('../services/security/google_ads_paused_draft_reconciliation');

const observed=(kind,over={})=>({object_kind:kind,outcome:'observed',status_classification:'paused',
  account_binding_matches:true,campaign_parent_matches:kind==='ad_group'?true:'not_applicable',
  budget_parent_matches:kind==='campaign'?true:'not_applicable',observed_at:'2026-09-03T00:00:00.000Z',...over});
const complete=(over={})=>({attempted_observations:3,completed_observations:3,
  observations:R.KINDS.map((kind)=>observed(kind)),...over});

test('classifies exactly the fixed three-kind ledger and sanitizes provider data',()=>{
  const verified=R.evaluate(complete());
  assert.deepEqual([verified.state,verified.classifications,verified.observations.map((x)=>x.object_kind)],
    ['verified',[],R.KINDS]);
  assert.equal(R.evaluate(complete({observations:R.KINDS.map((kind)=>observed(kind,
    kind==='campaign'?{budget_parent_matches:false}:{}))})).state,'discrepancy_detected');
  assert.equal(R.evaluate(complete({observations:R.KINDS.map((kind)=>observed(kind,
    kind==='ad_group'?{outcome:'transient_failure',error_classification:'rate_limited'}:{}))})).state,'failed');
  for(const malformed of [[],[observed('campaign')],R.KINDS.map(()=>observed('campaign'))]) {
    const result=R.evaluate(complete({observations:malformed}));
    assert.deepEqual([result.state,result.classifications],['failed',['partial_observation']]);
  }
  const result=R.evaluate(complete({observations:R.KINDS.map((kind)=>observed(kind,{provider_object_id:'raw-id',
    customer_id:'1234567890',access_token:'secret',request_body:'raw'}))}));
  assert.doesNotMatch(JSON.stringify(result),/raw-id|1234567890|secret|request_body/);
});

test('observing creation commits before provider observation and rolls back an audit failure',async(t)=>{
  const log=[];
  const client={query:async(sql)=>{log.push(sql);},release:()=>log.push('release')};
  const pool={connect:async()=>client};
  await R._test.createObservingRun(pool,{},new Date(),async(_c,_o,run)=>({row:{id:run.id}}),async()=>{});
  assert.deepEqual(log.slice(0,2),['BEGIN','COMMIT']);
  log.length=0;
  await assert.rejects(R._test.createObservingRun(pool,{},new Date(),async(_c,_o,run)=>({row:{id:run.id}}),
    async()=>{throw new Error('audit failed');}),/audit failed/);
  assert.equal(log.includes('ROLLBACK'),true);

  const original=authority.observeWithConsumedCredential;
  t.after(()=>{authority.observeWithConsumedCredential=original;});
  authority.observeWithConsumedCredential=async()=>{log.push('provider');return complete();};
  log.length=0;await R._test.observe(pool,{});
  assert.deepEqual(log.slice(0,3),['BEGIN','provider','COMMIT']);
});

test('lease exceeds the bounded three-request provider runtime',()=>{
  assert.ok(R.OBSERVATION_LEASE_MS>3*8000);
});

test('late terminal settlement is atomically classified as interrupted',async(t)=>{
  const now=new Date('2026-09-03T00:04:00.000Z');
  const row={tenant_id:7,id:'run',authorization_id:'auth',invocation_id_hash:'hash',requested_by:3,
    workflow_id:'wf',operation_id:'op',state:'observing',observation_deadline:'2026-09-03T00:03:00.000Z',
    observations:[],classifications:[],audit_ref:'audit',created_at:'2026-09-03T00:00:00.000Z'};
  const calls=[];
  const client={query:async(sql,params)=>{
    calls.push([sql,params]);
    if(/^SELECT \*/.test(sql.trim()))return {rowCount:1,rows:[row]};
    if(/^UPDATE/.test(sql.trim()))return {rowCount:1,rows:[{...row,state:'failed',
      classifications:['interrupted_observation'],completed_at:now}]};
    return {rowCount:0,rows:[]};
  },release:()=>{}};
  const original=authority.reproveMetadataAuthority;
  t.after(()=>{authority.reproveMetadataAuthority=original;});
  authority.reproveMetadataAuthority=async()=>({tenant_id:7,authorization_id:'auth',invocation_id_hash:'hash',
    requested_by:3,workflow_id:'wf',operation_id:'op'});
  const events=[];
  const result=await R._test.finishRun({connect:async()=>client},{},7,'run',
    {state:'verified',classifications:[],observations:[]},now,async(_c,_row,event)=>events.push(event));
  assert.deepEqual([result.state,result.failure_classifications],['failed',['interrupted_observation']]);
  assert.equal(calls.some(([sql])=>/SET state='verified'/.test(sql)),false);
  assert.deepEqual(events,['google_ads_paused_draft_reconciliation_failed']);
});

test('terminal replay is metadata-only, authority-gated and tenant/idempotency-bound',async(t)=>{
  const row={tenant_id:7,id:'run',authorization_id:'auth',invocation_id_hash:'hash',requested_by:3,
    workflow_id:'wf',operation_id:'op',state:'verified',observations:[],classifications:[],audit_ref:'audit',created_at:nowString()};
  const calls=[];
  const client={query:async(sql,params)=>{
    calls.push([sql,params]);
    if(/^SELECT \*/.test(sql.trim()))return {rowCount:1,rows:[row]};
    return {rowCount:0,rows:[]};
  },release:()=>{}};
  const pool={connect:async()=>client};
  const originalReprove=authority.reproveMetadataAuthority;
  const originalObserve=authority.observeWithConsumedCredential;
  t.after(()=>{authority.reproveMetadataAuthority=originalReprove;authority.observeWithConsumedCredential=originalObserve;});
  authority.reproveMetadataAuthority=async()=>{calls.push(['reproved']);return {tenant_id:7,authorization_id:'auth',
    invocation_id_hash:'hash',requested_by:3,workflow_id:'wf',operation_id:'op'};};
  authority.observeWithConsumedCredential=async()=>{throw new Error('provider/vault must not open');};
  const replay=await R._test.existingOrRecover(pool,{},7,'auth','hash',new Date());
  assert.equal(replay.state,'verified');
  assert.equal(calls.some(([sql])=>sql==='reproved'),true);
  assert.equal(calls.some(([sql])=>/observe|vault|credential|mutate/i.test(sql)),false);
  assert.deepEqual(calls.find(([sql])=>/^SELECT \*/.test(sql.trim()))[1],[7,'auth','hash']);

  authority.reproveMetadataAuthority=async()=>{const error=new Error('stale authority');error.code='authorization_lineage_mismatch';throw error;};
  await assert.rejects(R._test.existingOrRecover(pool,{},7,'auth','hash',new Date()),
    (error)=>error.code==='authorization_lineage_mismatch');
  authority.reproveMetadataAuthority=async()=>({tenant_id:7,authorization_id:'auth',invocation_id_hash:'hash',
    requested_by:3,workflow_id:'wf',operation_id:'op'});
  await assert.rejects(R._test.existingOrRecover(pool,{},7,'other-auth','hash',new Date()),
    (error)=>error.code==='idempotency_conflict');
});

test('getRun rejects proof belonging to a different authorization/run binding',async(t)=>{
  const row={tenant_id:7,id:'run',authorization_id:'auth-a',invocation_id_hash:'hash',requested_by:3,
    workflow_id:'wf',operation_id:'op',state:'verified',observations:[],classifications:[]};
  const client={query:async(sql)=>/^SELECT \*/.test(sql.trim())?{rowCount:1,rows:[row]}:{},release:()=>{}};
  const original=authority.reproveMetadataAuthority;t.after(()=>{authority.reproveMetadataAuthority=original;});
  authority.reproveMetadataAuthority=async()=>({tenant_id:7,authorization_id:'auth-b',invocation_id_hash:'hash',
    requested_by:3,workflow_id:'wf',operation_id:'op'});
  await assert.rejects(R.getRun({connect:async()=>client},{tenantId:7,runId:'run',actorType:'human',
    principalType:'user',actorUserId:3,sessionId:'session',hasExplicitTenantPermission:()=>true}),
  (error)=>error.code==='authorization_lineage_mismatch');
});

function nowString(){return '2026-09-03T00:00:00.000Z';}

test('coordinator contains no provider-write surface',()=>{
  const fs=require('node:fs');
  const source=fs.readFileSync(require.resolve('../services/agent_orchestrator/google_ads_paused_draft_reconciliation'),'utf8');
  assert.doesNotMatch(source,/googleAds:mutate|mutateCampaign|provider.*(?:create|update|delete)/i);
});
