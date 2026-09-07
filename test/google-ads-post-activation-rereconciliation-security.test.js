'use strict';
process.env.NODE_ENV='test';require('./helpers/env');
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const R=require('../services/agent_orchestrator/google_ads_post_activation_rereconciliation');
const source=require('../services/agent_orchestrator/google_ads_post_activation_reconciliation');
const api=require('../services/agent_orchestrator/google_ads_post_activation_review_api');
const observations=[
 {object_kind:'campaign_budget',outcome:'observed',status_classification:'paused',account_binding_matches:true,
  campaign_parent_matches:'not_applicable',budget_parent_matches:'not_applicable',observed_at:'2026-09-07T00:00:00.000Z'},
 {object_kind:'campaign',outcome:'observed',status_classification:'active',account_binding_matches:true,
  campaign_parent_matches:'not_applicable',budget_parent_matches:true,observed_at:'2026-09-07T00:00:00.000Z'},
 {object_kind:'ad_group',outcome:'observed',status_classification:'active',account_binding_matches:true,
  campaign_parent_matches:true,budget_parent_matches:'not_applicable',observed_at:'2026-09-07T00:00:00.000Z'},
];
const opts=over=>({tenantId:1,reviewCaseId:'gaparv_case',invocationId:'human-rereconcile',actorUserId:7,
 actorType:'human',principalType:'user',sessionId:'session',hasExplicitTenantPermission:key=>key===R.PERMISSION,...over});

test('authorization is human-only, tenant-scoped and requires the review grant',()=>{
 assert.deepEqual(R._test.authorize(opts()),{actor:7,tenant:1});
 for(const over of [{actorUserId:null},{actorType:'agent'},{principalType:'service'},{sessionId:''},
  {hasExplicitTenantPermission:()=>false},{tenantId:null}])assert.throws(()=>R._test.authorize(opts(over)),
   e=>['human_session_required','permission_denied','validation_failed'].includes(e.code));
 assert.equal(source._test.requiredPermission({authorizationPurpose:'post_review'}),R.PERMISSION);
 assert.equal(source._test.requiredPermission({}),source.PERMISSION);
});

test('invocation identity binds the exact case, human and request',()=>{
 const digest=R._test.requestHash(opts(),7);assert.match(digest,/^[0-9a-f]{64}$/);
 assert.notEqual(digest,R._test.requestHash(opts({reviewCaseId:'gaparv_other'}),7));
 assert.notEqual(digest,R._test.requestHash(opts(),8));
 const row={review_case_id:'gaparv_case',invocation_id_hash:digest,requested_by:7,
  session_id_hash:require('node:crypto').createHash('sha256').update('session').digest('hex')};
 assert.doesNotThrow(()=>R._test.sameRequest(row,opts(),7,digest));
 assert.throws(()=>R._test.sameRequest(row,opts({sessionId:'other'}),7,digest),{code:'idempotency_conflict'});
});

test('public evidence is sanitized, immutable and never claims an external action',()=>{
 const row={id:'gaparra_attempt',review_case_id:'gaparv_case',review_version:2,closure_audit_ref:'closure-audit',
  activation_attempt_id:'attempt',activation_status:'succeeded',state:'verified_active',observations:[{...observations[0],
   customer_id:'1234567890',provider_object_id:'secret-object',access_token:'secret-token'}],classifications:[],
  observing_at:new Date(),completed_at:new Date(),audit_ref:'attempt-audit',credential_ref_id:'secret-credential'};
 const out=R.publicAttempt(row),text=JSON.stringify(out);assert.equal(out.external_action_taken,false);assert.ok(Object.isFrozen(out));
 for(const secret of ['customer_id','1234567890','provider_object_id','secret-object','access_token','secret-token',
  'credential_ref_id','secret-credential'])assert.equal(text.includes(secret),false,secret);
 const stored=R._test.storageObservations(observations);assert.equal(stored.length,3);
 assert.equal(stored[0].error_classification,null);assert.ok(Object.hasOwn(stored[0],'error_classification'));
});

test('route and dependency surfaces permit one exact read-only human action only',()=>{
 assert.equal(api._exact({invocation_id:'once'},['invocation_id']),true);
 assert.equal(api._exact({invocation_id:'once',retry:true},['invocation_id']),false);
 const code=fs.readFileSync(require.resolve('../services/agent_orchestrator/google_ads_post_activation_rereconciliation'),'utf8');
 assert.match(code,/authorizationPurpose:'post_review'/);assert.match(code,/external_remediation_required/);
 assert.match(code,/reconciliation\._test\.observe/);assert.doesNotMatch(code,/googleAds:mutate|\.mutate\(|ENABLED|partialFailure|setTimeout|setInterval/);
 assert.doesNotMatch(code,/require\(['"].*(?:activation_execution|worker|scheduler|webhook)/i);
 const apiCode=fs.readFileSync(require.resolve('../services/agent_orchestrator/google_ads_post_activation_review_api'),'utf8');
 assert.match(apiCode,/post\('\/:caseId\/rereconcile'/);assert.match(apiCode,/exact\(req\.body,\['invocation_id'\]\)/);
 assert.doesNotMatch(apiCode,/tokenTransport|fetch\s*\(|client_secret|refresh_token/);
});

test('source lineage proof uses exact database equality for copied D4 evidence',()=>{
 const code=fs.readFileSync(require.resolve('../services/agent_orchestrator/google_ads_post_activation_rereconciliation'),'utf8');
 for(const fragment of ['observing_at=$7','completed_at=$8','classifications=$9',
  'orchestrator_gaparv_safe_observations(observations)=$10::jsonb'])assert.ok(code.includes(fragment),fragment);
 assert.match(code,/state='closed'/);assert.match(code,/FOR SHARE/);
});

test('one human request observes once and replay never reopens the provider boundary',async()=>{const calls=[];let attempt=null,observes=0;
 const review={tenant_id:1,id:'gaparv_case',version:2,state:'closed',disposition:'external_remediation_required',
  closed_at:new Date(),reconciliation_run_id:'gapar_source',activation_attempt_id:'activation',activation_status:'succeeded',
  workflow_id:'workflow',source_requested_by:4,source_observing_at:new Date('2026-09-07T00:00:00Z'),
  source_completed_at:new Date('2026-09-07T00:01:00Z'),source_discrepancy_classifications:['mixed_activation_state'],
  observed_provider_state:observations};
 const event={id:12,case_id:review.id,case_version:2,to_state:'closed',disposition:'external_remediation_required',audit_ref:'closure-audit'};
 const client={release(){},async query(sql,p=[]){calls.push(sql.trim());
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return{rows:[],rowCount:0};
  if(sql.includes(`SELECT activation_attempt_id,reconciliation_run_id FROM ${'orchestrator_google_ads_post_activation_review_cases'}`))return{rows:[review],rowCount:1};
  if(sql.includes('SELECT * FROM orchestrator_google_ads_post_activation_review_cases'))return{rows:[review],rowCount:1};
  if(sql.includes('SELECT * FROM orchestrator_google_ads_post_activation_review_events'))return{rows:[event],rowCount:1};
  if(sql.includes('SELECT * FROM orchestrator_google_ads_post_activation_reconciliation_runs'))return{rows:[{id:'gapar_source'}],rowCount:1};
  if(sql.includes(`SELECT a.*,e.audit_ref closure_audit_ref FROM ${R.TABLE}`))return{rows:attempt?[{...attempt,closure_audit_ref:event.audit_ref}]:[],rowCount:attempt?1:0};
  if(sql.startsWith('SELECT clock_timestamp() now'))return{rows:[{now:new Date()}],rowCount:1};
  if(sql.startsWith(`INSERT INTO ${R.TABLE}`)){attempt={tenant_id:1,id:p[1],review_case_id:p[2],review_version:p[3],
    closure_event_id:p[4],original_reconciliation_run_id:p[5],activation_attempt_id:p[6],activation_status:p[7],
    invocation_id_hash:p[8],requested_by:p[9],session_id_hash:p[10],workflow_id:p[11],state:'observing',observations:[],
    classifications:[],audit_ref:p[12],observing_at:p[13],observation_deadline:p[14],completed_at:null};return{rows:[attempt],rowCount:1};}
  if(sql.startsWith(`SELECT * FROM ${R.TABLE}`))return{rows:attempt?[{...attempt}]:[],rowCount:attempt?1:0};
  if(sql.startsWith(`UPDATE ${R.TABLE}`)){attempt={...attempt,state:p[2],observations:JSON.parse(p[3]),classifications:p[4],completed_at:p[5]};
    return{rows:[attempt],rowCount:1};}
  if(sql.startsWith('INSERT INTO orchestrator_audit_events'))return{rows:[],rowCount:1};
  throw Error(`unexpected SQL: ${sql}`);}};const pool={connect:async()=>client};
 const priorProof=source._test.proof,priorObserve=source._test.observe;
 source._test.proof=async()=>({row:{id:'activation',status:'succeeded',workflow_id:'workflow'},objects:[]});
 source._test.observe=async()=>{observes++;return{attempted_observations:3,completed_observations:3,observations};};
 try{const first=await R.rereconcile(opts({pool}));assert.equal(first.state,'verified_active');assert.equal(first.replay,false);
  const replay=await R.rereconcile(opts({pool}));assert.equal(replay.state,'verified_active');assert.equal(replay.replay,true);assert.equal(observes,1);
  assert.ok(calls.indexOf('COMMIT')<calls.findIndex(x=>x.startsWith(`UPDATE ${R.TABLE}`)));
 }finally{source._test.proof=priorProof;source._test.observe=priorObserve;}
});
