'use strict';
require('./helpers/env');
const test=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');
const service=require('../services/agent_orchestrator/google_ads_campaign_activation');
const caps=require('../services/security/google_ads_activation_capabilities');
const vault=require('../services/credentials/vault');
const CUSTOMER='1234567890',sha=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
const objects=[
 {object_kind:'campaign_budget',sequence_number:1,provider_object_id:'100',provider_status:'PAUSED',published:false,activated:false,serving:false},
 {object_kind:'campaign',sequence_number:2,provider_object_id:'200',provider_status:'PAUSED',published:false,activated:false,serving:false},
 {object_kind:'ad_group',sequence_number:3,provider_object_id:'300',provider_status:'PAUSED',published:false,activated:false,serving:false},
];
const cap={id:'cap-1',tenant_id:7,actor_user_id:11,session_id_hash:sha('session'),workflow_id:'wf',operation_id:'op',
 reconciliation_run_id:'run',credential_owner_user_id:11,credential_ref_id:'cred',credential_ref_version:3,
 account_fingerprint:sha(CUSTOMER),ledger_root_hash:sha('ledger'),status:'consumed'};
const authority={id:'run'};
const input={tenantId:7,capabilityId:'cap-1',invocationId:'invoke-1',actorUserId:11,actorType:'human',principalType:'user',
 sessionId:'session',hasExplicitTenantPermission:p=>p===caps.PERMISSION};
function creds(){const x=Object.create(null);Object.defineProperties(x,{object_kind:{value:'google_ads_activation_secret_scope',enumerable:true},
 [Symbol.for('infogenie.google_ads_activation_secret_scope')]:{value:true},customerId:{value:CUSTOMER},
 accessToken:{value:'access'},developerToken:{value:'developer'}});return Object.freeze(x);}
function pool(){
 let attempt=null;
 const client={async query(sql,params=[]){
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)||sql.startsWith('SAVEPOINT ')||sql.startsWith('RELEASE SAVEPOINT ')
    ||sql.startsWith('ROLLBACK TO SAVEPOINT '))return{rows:[],rowCount:null};
  if(sql.includes(`FROM ${service.TABLE} WHERE tenant_id=$1 AND capability_id=$2`))return{rowCount:attempt?1:0,rows:attempt?[attempt]:[]};
  if(sql.includes('FROM orchestrator_google_ads_activation_capabilities'))return{rowCount:1,rows:[cap]};
  if(sql.includes('FROM orchestrator_google_ads_provider_draft_objects'))return{rowCount:3,rows:objects};
  if(sql.includes('SELECT clock_timestamp() now'))return{rowCount:1,rows:[{now:new Date()}]};
  if(sql.startsWith(`INSERT INTO ${service.TABLE}`)){attempt={tenant_id:7,id:params[1],capability_id:cap.id,
    actor_user_id:11,session_id_hash:cap.session_id_hash,workflow_id:'wf',operation_id:'op',reconciliation_run_id:'run',
    credential_owner_user_id:11,credential_ref_id:'cred',credential_ref_version:3,account_fingerprint:cap.account_fingerprint,
    ledger_root_hash:cap.ledger_root_hash,objects_digest:service._objectDigest(objects),invocation_id_hash:sha('invoke-1'),
    status:'in_progress',result_code:null,objects_expected:2,objects_activated:0,requires_reconciliation:false,
    external_action_taken:false,created_at:params[15],started_at:params[15],settled_at:null};return{rowCount:1,rows:[]};}
  if(sql.includes(`FROM ${service.TABLE} WHERE tenant_id=$1 AND id=$2`))return{rowCount:attempt?1:0,rows:attempt?[attempt]:[]};
  if(sql.startsWith(`UPDATE ${service.TABLE} SET status=`)){attempt={...attempt,status:params[2],result_code:params[3],
    objects_activated:params[4],requires_reconciliation:params[5],external_action_taken:params[6],settled_at:new Date()};
    return{rowCount:1,rows:[attempt]};}
  if(sql.startsWith(`INSERT INTO ${service.OUTCOMES}`))return{rowCount:1,rows:[]};
  if(sql.startsWith('INSERT INTO orchestrator_audit_events'))return{rowCount:1,rows:[]};
  throw new Error(`unexpected SQL: ${sql}`);
 },release(){}};
 return{connect:async()=>client,state:()=>attempt};
}
function patch(){
 const saved={reserve:caps.reserve,consume:caps.consume,auth:caps._authoritative,bound:caps._bound,scope:vault.withGoogleAdsActivationSecretScope};
 caps.reserve=async()=>({status:'reserved'});caps.consume=async()=>({status:'consumed'});
 caps._authoritative=async()=>authority;caps._bound=()=>true;
 vault.withGoogleAdsActivationSecretScope=async(_c,_o,fn)=>fn(creds());
 return()=>{caps.reserve=saved.reserve;caps.consume=saved.consume;caps._authoritative=saved.auth;caps._bound=saved.bound;vault.withGoogleAdsActivationSecretScope=saved.scope;};
}

test('one human invocation performs one atomic provider send and replay performs none',async()=>{
 const restore=patch(),p=pool();let sends=0;
 try{
  const transport=async request=>{sends++;assert.equal(request.body.mutateOperations.length,2);
   return{status:200,json:{mutateOperationResponses:[
    {campaignResult:{resourceName:`customers/${CUSTOMER}/campaigns/200`}},
    {adGroupResult:{resourceName:`customers/${CUSTOMER}/adGroups/300`}}]}};};
  const first=await service.execute(p,{...input,providerTransport:transport,tokenTransport:async()=>({})});
  assert.equal(first.status,'succeeded');assert.equal(first.external_action_taken,true);assert.equal(sends,1);
  const replay=await service.execute(p,{...input,providerTransport:transport,tokenTransport:async()=>({})});
  assert.equal(replay.status,'succeeded');assert.equal(replay.replay,true);assert.equal(sends,1);
 }finally{restore();}
});

test('incomplete provider evidence is unknown, requires reconciliation, and is never retried',async()=>{
 const restore=patch(),p=pool();let sends=0;
 try{const out=await service.execute(p,{...input,providerTransport:async()=>{sends++;return{status:200,json:{mutateOperationResponses:[]}};},
   tokenTransport:async()=>({})});
  assert.equal(out.status,'unknown');assert.equal(out.external_action_taken,null);
  assert.equal(out.requires_reconciliation,true);assert.equal(sends,1);
 }finally{restore();}
});

test('automation principals, missing permission and caller provider fields are rejected before execution',async()=>{
 for(const bad of [{...input,actorType:'worker'},{...input,principalType:'service_account'},
  {...input,hasExplicitTenantPermission:()=>false}])await assert.rejects(service.execute(pool(),{...bad,providerTransport:async()=>{}}));
 assert.deepEqual(Object.keys(input).filter(k=>/customer|status|budget|bid|url|payload/i.test(k)),[]);
});
