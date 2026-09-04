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

test('coordinator reaches only the existing read observer and contains no provider-write or retry surface',()=>{
  const source=fs.readFileSync(require.resolve('../services/agent_orchestrator/google_ads_post_review_rereconciliation'),'utf8');
  assert.match(source,/reconciliation\._test\.observe/);assert.match(source,/consumeIntoReconciliationRun/);
  assert.doesNotMatch(source,/mutate|providerTransport|automatic|setInterval|setTimeout|worker|scheduler|retry|draft creation/i);
  assert.doesNotMatch(source,/googleads\.googleapis|fetch\s*\(|axios|UPDATE orchestrator_google_ads_reconciliation_review_cases/i);
});
