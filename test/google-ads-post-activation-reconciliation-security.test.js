'use strict';
process.env.NODE_ENV='test';
require('./helpers/env');
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('crypto');
const fs=require('node:fs');
const path=require('node:path');
const service=require('../services/agent_orchestrator/google_ads_post_activation_reconciliation');
const api=require('../services/agent_orchestrator/google_ads_post_activation_reconciliation_api');
const lineage=require('../services/security/google_ads_paused_draft_reconciliation');
const vault=require('../services/credentials/vault');

const base=[
  {object_kind:'campaign_budget',outcome:'observed',status_classification:'paused',account_binding_matches:true,
    campaign_parent_matches:'not_applicable',budget_parent_matches:'not_applicable',observed_at:'2026-09-07T00:00:00.000Z'},
  {object_kind:'campaign',outcome:'observed',status_classification:'active',account_binding_matches:true,
    campaign_parent_matches:'not_applicable',budget_parent_matches:true,observed_at:'2026-09-07T00:00:00.000Z'},
  {object_kind:'ad_group',outcome:'observed',status_classification:'active',account_binding_matches:true,
    campaign_parent_matches:true,budget_parent_matches:'not_applicable',observed_at:'2026-09-07T00:00:00.000Z'},
];
const result=observations=>({attempted_observations:3,completed_observations:3,observations});

test('classifies complete active and inactive graphs without inventing activation',()=>{
  assert.equal(service.evaluate(result(base),'succeeded').state,'verified_active');
  const inactive=base.map(x=>x.object_kind==='campaign_budget'?x:{...x,status_classification:'paused'});
  assert.equal(service.evaluate(result(inactive),'unknown').state,'verified_inactive');
  const claimed=service.evaluate(result(inactive),'succeeded');
  assert.equal(claimed.state,'discrepancy_detected');
  assert.ok(claimed.classifications.includes('activation_success_not_observed'));
  const mixed=service.evaluate(result(base.map(x=>x.object_kind==='ad_group'?{...x,status_classification:'paused'}:x)),'unknown');
  assert.equal(mixed.state,'discrepancy_detected');
  assert.ok(mixed.classifications.includes('mixed_activation_state'));
});

test('missing, relationship drift, unsafe status, and transport failure are bounded',()=>{
  const missing=service.evaluate(result(base.map(x=>x.object_kind==='campaign'?{...x,outcome:'missing'}:x)),'unknown');
  assert.equal(missing.state,'discrepancy_detected');assert.ok(missing.classifications.includes('campaign_missing'));
  const drift=service.evaluate(result(base.map(x=>x.object_kind==='ad_group'?{...x,campaign_parent_matches:false}:x)),'succeeded');
  assert.equal(drift.state,'discrepancy_detected');assert.ok(drift.classifications.includes('ad_group_campaign_mismatch'));
  const failed=service.evaluate(result(base.map(x=>x.object_kind==='campaign'?{...x,outcome:'transient_failure',error_classification:'rate_limited'}:x)),'unknown');
  assert.equal(failed.state,'failed');assert.ok(failed.classifications.includes('campaign_rate_limited'));
  assert.equal(service.evaluate({attempted_observations:2,completed_observations:2,observations:base.slice(0,2)},'unknown').state,'failed');
});

test('public metadata and observations cannot expose provider or credential material',()=>{
  const out=service.publicRun({id:'safe',activation_attempt_id:'attempt',activation_status:'unknown',state:'failed',
    observations:[{...base[0],provider_object_id:'123456',customer_id:'9999999999',access_token:'token'}],
    classifications:['provider_unavailable'],audit_ref:'audit',observing_at:'start',completed_at:'done',
    account_fingerprint:'secret',credential_ref_id:'secret',ledger_root_hash:'secret',objects_digest:'secret'});
  const text=JSON.stringify(out);
  for(const forbidden of ['provider_object_id','customer_id','account_fingerprint','credential_ref','ledger_root','objects_digest','access_token','googleapis.com'])
    assert.equal(text.includes(forbidden),false,forbidden);
  assert.equal(out.external_action_taken,false);
});

test('API requires matching human session and explicit monitor grant with no owner bypass',()=>{
  const req={user:{id:7,isOwner:true},session:{userId:7},sessionID:'session',tenantRole:{permissions:[]}};
  assert.equal(api._human(req),true);assert.equal(api._grant(req),false);
  assert.equal(api._human({...req,viaApiKey:true}),false);
  assert.equal(api._human({...req,user:{...req.user,principalType:'worker'}}),false);
  assert.equal(api._grant({...req,tenantRole:{permissions:[service.PERMISSION]}}),true);
});

const digest=v=>crypto.createHash('sha256').update(v).digest('hex');
function ledger(){const ids={campaign_budget:'11',campaign:'22',ad_group:'33'},rows=Object.entries(ids).map(([object_kind,provider_object_id],i)=>({
  object_kind,sequence_number:i+1,provider_object_id,provider_object_id_digest:digest(provider_object_id),
  account_fingerprint:digest('account'),provider_status:'PAUSED',serving:false,published:false,activated:false,
 }));return rows;}
test('ledger binding rejects object substitution, credential account drift, and changed ledger root',()=>{
  const rows=ledger(),proof={account_fingerprint:digest('account'),ledger_root_hash:lineage.ledgerRoot(rows),objects_digest:service._test.objectDigest(rows)};
  assert.equal(service._test.validateObjects(rows,proof),rows);
  for(const mutate of [
    r=>{r[0].provider_object_id='12';},
    r=>{r[1].account_fingerprint=digest('other');},
    r=>{r[2].provider_status='ENABLED';},
  ]){const copy=structuredClone(rows);mutate(copy);assert.throws(()=>service._test.validateObjects(copy,proof));}
  assert.throws(()=>service._test.validateObjects(rows,{...proof,ledger_root_hash:digest('wrong')}),{code:'authoritative_binding_mismatch'});
  assert.throws(()=>service._test.validateObjects(rows,{...proof,objects_digest:digest('wrong')}),{code:'authoritative_binding_mismatch'});
});

function lifecyclePool(seed=null){
 const objects=ledger(),fingerprint=digest('account'),attempt={tenant_id:7,id:'attempt-1',status:'succeeded',
  capability_id:'cap-1',workflow_id:'wf-1',operation_id:'op-1',reconciliation_run_id:'source-run-1',
  credential_owner_user_id:11,credential_ref_id:'cred-1',credential_ref_version:3,
  account_fingerprint:fingerprint,ledger_root_hash:lineage.ledgerRoot(objects),objects_digest:service._test.objectDigest(objects),
  actor_user_id:11,session_id_hash:digest('session-1'),objects_expected:2,objects_activated:2,
  requires_reconciliation:false,external_action_taken:true,
  capability_status:'consumed',capability_operation_id:'op-1',capability_reconciliation_run_id:'source-run-1',
  capability_actor_user_id:11,capability_session_id_hash:digest('session-1'),capability_workflow_id:'wf-1',
  capability_credential_owner_user_id:11,
  capability_credential_ref_id:'cred-1',capability_credential_ref_version:3,
  capability_account_fingerprint:fingerprint,capability_ledger_root_hash:lineage.ledgerRoot(objects),
  operation_status:'succeeded',operation_workflow_id:'wf-1',operation_reconciliation_run_id:'source-run-1',
  operation_credential_ref_id:'cred-1',operation_credential_ref_version:3,operation_account_fingerprint:fingerprint,
  operation_published:false,operation_activated:false,operation_acted:true,credential_status:'active',revoked_at:null,current_credential_version:3,
  current_account_fingerprint:fingerprint,owner_user_id:11};
 let run=seed;
 const client={async query(sql,params=[]){
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return{rows:[],rowCount:null};
  if(sql.includes(`FROM ${service.TABLE}`)&&sql.includes('(activation_attempt_id=$2 OR invocation_id_hash=$3)'))
    return{rowCount:run?1:0,rows:run?[{id:run.id}]:[]};
  if(sql.includes('SELECT capability_id,operation_id FROM orchestrator_google_ads_activation_attempts'))
    return{rowCount:1,rows:[{capability_id:'cap-1',operation_id:'op-1'}]};
  if(sql.includes('SELECT id FROM orchestrator_google_ads_activation_capabilities'))return{rowCount:1,rows:[{id:'cap-1'}]};
  if(sql.includes('SELECT id FROM orchestrator_google_ads_provider_draft_operations'))return{rowCount:1,rows:[{id:'op-1'}]};
  if(sql.includes('SELECT a.*,cap.status capability_status'))return{rowCount:1,rows:[attempt]};
  if(sql.includes('FROM orchestrator_google_ads_provider_draft_objects'))return{rowCount:3,rows:objects};
  if(sql.includes('SELECT clock_timestamp() now'))return{rowCount:1,rows:[{now:new Date()}]};
  if(sql.startsWith(`INSERT INTO ${service.TABLE}`)){run={tenant_id:7,id:params[1],activation_attempt_id:'attempt-1',
    activation_status:'succeeded',invocation_id_hash:params[4],requested_by:11,session_id_hash:params[6],workflow_id:'wf-1',
    state:'observing',observations:[],classifications:[],audit_ref:params[8],observing_at:params[9],
    observation_deadline:params[10],completed_at:null};return{rowCount:1,rows:[run]};}
  if(sql.includes(`FROM ${service.TABLE}`)&&sql.includes('FOR UPDATE'))return{rowCount:run?1:0,rows:run?[run]:[]};
  if(sql.startsWith(`UPDATE ${service.TABLE} SET state=$3`)){run={...run,state:params[2],observations:JSON.parse(params[3]),
    classifications:params[4],completed_at:params[5]};return{rowCount:1,rows:[run]};}
  if(sql.startsWith(`UPDATE ${service.TABLE} SET state='failed'`)){run={...run,state:'failed',
    classifications:['interrupted_observation'],completed_at:params[2]};return{rowCount:1,rows:[run]};}
  if(sql.startsWith('INSERT INTO orchestrator_audit_events'))return{rowCount:1,rows:[]};
  throw new Error(`unexpected SQL: ${sql}`);
 },release(){}};
 return{connect:async()=>client};
}

test('one human request performs exactly three reads and replay performs no secret or provider work',async()=>{
 const saved=vault.withGoogleAdsPausedDraftSecretScope;let scopes=0,sends=0;
 vault.withGoogleAdsPausedDraftSecretScope=async(_c,_o,fn)=>{scopes++;return fn({accessToken:'access',developerToken:'developer',
   customerId:'1234567890',loginCustomerId:null});};
 const transport=async request=>{sends++;const query=JSON.parse(request.body).query;
  if(query.includes('FROM campaign_budget'))return{status:200,json:{results:[{campaignBudget:{
    resourceName:'customers/1234567890/campaignBudgets/11',status:'PAUSED'}}]}};
  if(query.includes('FROM campaign '))return{status:200,json:{results:[{campaign:{
    resourceName:'customers/1234567890/campaigns/22',status:'ENABLED',
    campaignBudget:'customers/1234567890/campaignBudgets/11'}}]}};
  return{status:200,json:{results:[{adGroup:{resourceName:'customers/1234567890/adGroups/33',status:'ENABLED',
    campaign:'customers/1234567890/campaigns/22'}}]}};};
 const input={pool:lifecyclePool(),tenantId:7,activationAttemptId:'attempt-1',invocationId:'invoke-1',actorUserId:11,
  actorType:'human',principalType:'user',sessionId:'session-1',hasExplicitTenantPermission:p=>p===service.PERMISSION,
  observerTransport:transport};
 try{const first=await service.reconcile(input);assert.equal(first.state,'verified_active');assert.equal(first.replay,false);
  assert.equal(scopes,1);assert.equal(sends,3);
  const replay=await service.reconcile(input);assert.equal(replay.state,'verified_active');assert.equal(replay.replay,true);
  assert.equal(scopes,1);assert.equal(sends,3);
 }finally{vault.withGoogleAdsPausedDraftSecretScope=saved;}
});

test('expired observing replay is durably failed without reopening secret scope',async()=>{
 const invocationHash=digest('invoke-expired'),seed={tenant_id:7,id:'gapar-expired',activation_attempt_id:'attempt-1',
  activation_status:'succeeded',invocation_id_hash:invocationHash,requested_by:11,session_id_hash:digest('session-1'),
  workflow_id:'wf-1',state:'observing',observations:[],classifications:[],audit_ref:'audit-expired',
  observing_at:new Date(Date.now()-300000),observation_deadline:new Date(Date.now()-1000),completed_at:null};
 const saved=vault.withGoogleAdsPausedDraftSecretScope;let scopes=0;
 vault.withGoogleAdsPausedDraftSecretScope=async()=>{scopes++;throw new Error('must not open');};
 try{const out=await service.reconcile({pool:lifecyclePool(seed),tenantId:7,activationAttemptId:'attempt-1',
   invocationId:'invoke-expired',actorUserId:11,actorType:'human',principalType:'user',sessionId:'session-1',
   hasExplicitTenantPermission:p=>p===service.PERMISSION,observerTransport:async()=>{throw new Error('must not call');}});
  assert.equal(out.state,'failed');assert.equal(out.replay,true);assert.deepEqual(out.failure_classifications,['interrupted_observation']);
  assert.equal(scopes,0);
 }finally{vault.withGoogleAdsPausedDraftSecretScope=saved;}
});

test('implementation has no Google mutate or write-connector reachability',()=>{
  const src=fs.readFileSync(path.join(__dirname,'../services/agent_orchestrator/google_ads_post_activation_reconciliation.js'),'utf8');
  const route=fs.readFileSync(path.join(__dirname,'../services/agent_orchestrator/google_ads_post_activation_reconciliation_api.js'),'utf8');
  assert.match(src,/google_ads_paused_draft_reconciliation_observer/);
  assert.doesNotMatch(src,/googleAds:mutate|connectors\/google_ads_activation|connectors\/google_ads_paused_draft\.js|setInterval|setTimeout/i);
  assert.match(route,/Object\.keys\(body\)\.length!==2/);
  assert.match(route,/activation_attempt_id/);assert.match(route,/invocation_id/);
});
