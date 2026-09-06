'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');
const R=require('../services/agent_orchestrator/google_ads_post_review_rereconciliation');
const opts=(x={})=>({tenantId:1,actorUserId:7,actorType:'human',principalType:'user',sessionId:'real-session',
  reviewCaseId:'case',invocationId:'invoke',hasExplicitTenantPermission:(p)=>p===R.PERMISSION,...x});

test('post-review invocation requires a human session and exact review grant before database access',()=>{
  assert.equal(R.PERMISSION,'advertising.reconciliation.review');
  for(const x of [{sessionId:null},{actorType:'agent'},{principalType:'api_key'},{hasExplicitTenantPermission:()=>false}])
    assert.throws(()=>R._test.authorize(opts(x)),(e)=>['human_session_required','permission_denied'].includes(e.code));
});

test('invocation idempotency binds the complete request payload',()=>{
  const base=R._test.payloadHash(opts());assert.equal(base,R._test.payloadHash(opts()));
  for(const changed of [{invocationId:'other'},{reviewCaseId:'other-case'}])
    assert.notEqual(base,R._test.payloadHash(opts(changed)));
});

test('public projection excludes credentials, provider IDs, fingerprints, tokens and session material',()=>{
  const attempt={id:'attempt',review_case_id:'case',review_version:2,closure_audit_ref:'closure',audit_ref:'audit',created_at:'now',
    invocation_payload_hash:'secret-hash',new_authorization_id:'secret-auth'};
  const out=R._test.project(attempt,{reconciliation_run_id:'run',state:'failed',observations:[],failure_classifications:['observation_failure']});
  assert.deepEqual(Object.keys(out).sort(),['audit_reference','closure_event_reference','created_at','external_action_taken','reconciliation','rereconciliation_attempt_id','review_case_id','review_version']);
  assert.doesNotMatch(JSON.stringify(out),/secret|credential|fingerprint|token|session|provider.object|customer.?id/i);
});

test('database start failures fail closed without an automatic second attempt',async()=>{
  let connections=0;
  const failure=Object.assign(new Error('serialization failure'),{code:'40001'});
  const client={
    query:async(sql)=>{
      if(sql==='BEGIN')throw failure;
      if(sql==='ROLLBACK')return {rows:[],rowCount:0};
      throw new Error(`unexpected query: ${sql}`);
    },
    release(){}
  };
  await assert.rejects(
    R.rereconcile({connect:async()=>{connections++;return client;}},opts()),
    (error)=>error===failure
  );
  assert.equal(connections,1);
});

test('post-review replay locks the shared operation before the review case',async(t)=>{
  const digest=R._test.payloadHash(opts()),calls=[];
  const client={query:async(sql)=>{calls.push(sql);
    if(sql==='BEGIN'||sql==='COMMIT')return {rowCount:0,rows:[]};
    if(sql.startsWith('SELECT operation_id FROM'))return {rowCount:1,rows:[{operation_id:'operation'}]};
    if(sql.startsWith('SELECT id FROM orchestrator_google_ads_provider_draft_operations'))return {rowCount:1,rows:[{id:'operation'}]};
    if(sql.startsWith('SELECT * FROM orchestrator_google_ads_reconciliation_review_cases'))return {rowCount:1,rows:[{id:'case',operation_id:'operation'}]};
    if(sql.startsWith('SELECT a.*'))return {rowCount:1,rows:[{attempt_id:'attempt',review_case_id:'case',
      invocation_payload_hash:digest,new_authorization_id:'authorization',state:'verified'}]};
    throw new Error(`unexpected query: ${sql}`);
  },release(){}};
  const authority=require('../services/security/google_ads_paused_draft_reconciliation');
  const original=authority.reproveMetadataAuthority;t.after(()=>{authority.reproveMetadataAuthority=original;});
  authority.reproveMetadataAuthority=async()=>({});
  const result=await R._test.start({connect:async()=>client},opts(),new Date());
  assert.equal(result.existing.attempt.id,'attempt');
  const operationLock=calls.findIndex(sql=>sql.startsWith('SELECT id FROM orchestrator_google_ads_provider_draft_operations'));
  const reviewLock=calls.findIndex(sql=>sql.startsWith('SELECT * FROM orchestrator_google_ads_reconciliation_review_cases'));
  assert.ok(operationLock>0&&operationLock<reviewLock,'operation lock must precede review-case lock');
});

test('coordinator reaches only the existing read observer and contains no provider-write or retry surface',()=>{
  const source=fs.readFileSync(require.resolve('../services/agent_orchestrator/google_ads_post_review_rereconciliation'),'utf8');
  assert.match(source,/reconciliation\._test\.observe/);assert.match(source,/consumeIntoReconciliationRun/);
  assert.doesNotMatch(source,/mutate|providerTransport|automatic|setInterval|setTimeout|worker|scheduler|retry|draft creation/i);
  assert.doesNotMatch(source,/googleads\.googleapis|fetch\s*\(|axios|UPDATE orchestrator_google_ads_reconciliation_review_cases/i);
});
