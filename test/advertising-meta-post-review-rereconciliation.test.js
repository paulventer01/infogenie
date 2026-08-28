'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');
const R=require('../services/agent_orchestrator/meta_post_review_rereconciliation');
const A=require('../services/agent_orchestrator/meta_reconciliation_read_authorizations');

const opts=(x={})=>({tenantId:1,actorUserId:7,actorType:'human',reviewCaseId:'case',invocationId:'invoke',
  hasPermission:(p)=>p===R.PERMISSION,...x});

test('exact review grant and authenticated human are required before database access',()=>{
  assert.equal(R.PERMISSION,'advertising.reconciliation.review');
  for(const x of [{actorUserId:null},{actorType:'agent'},{hasPermission:()=>false},
    {hasPermission:(p)=>p==='advertising.reconciliation.read'}]) {
    assert.throws(()=>R._test.authorize({...opts(),...x}),{code:x.hasPermission?'permission_denied':'authentication_required'});
  }
  assert.doesNotThrow(()=>R._test.authorize(opts()));
});

function eligibilityPool(state,classification){
  const calls=[];const client={query:async(sql)=>{
    calls.push(sql);
    if(/SELECT \* FROM orchestrator_campaign_reconciliation_review_cases/.test(sql)) return {rowCount:1,rows:[{
      tenant_id:1,id:'case',state,classification,version:2,reconciliation_run_id:'original',authorization_id:'original-auth',
    }]};
    if(/SELECT a\.\*,e\.audit_ref/.test(sql))return {rowCount:0,rows:[]};
    return {rowCount:0,rows:[]};
  },release(){}};
  return {connect:async()=>client,calls};
}

test('open, acknowledged and escalated cases fail before authorization issuance',async()=>{
  for(const state of ['open','acknowledged','escalated']){
    const pool=eligibilityPool(state,'external_remediation_required');
    await assert.rejects(R._test.start(pool,opts(),new Date()),{code:'review_case_ineligible'});
    assert.equal(pool.calls.some((q)=>/INSERT INTO orchestrator_campaign_reconciliation_read_authorizations/.test(q)),false);
  }
});

test('only explicit external-remediation closure is eligible',async()=>{
  assert.deepEqual(R.ALLOWED_CLOSURES,['external_remediation_required']);
  for(const classification of ['accepted_risk','false_positive','closed_unresolved','provider_investigation_required']){
    const pool=eligibilityPool('closed',classification);
    await assert.rejects(R._test.start(pool,opts(),new Date()),{code:'closure_classification_ineligible'});
    assert.equal(pool.calls.some((q)=>/reconciliation_read_authorizations[\s\S]*INSERT/.test(q)),false);
  }
});

test('pre-issuance credential assertion locks authoritative metadata without resolving secrets',async()=>{
  let sql='';let params;
  const client={query:async(q,p)=>{sql=q;params=p;return {rowCount:1,rows:[{tenant_id:1,id:'credential',platform:'meta',
    version:4,status:'active',revoked_at:null,owner_user_id:9,account_fingerprint:'a'.repeat(64)}]};}};
  const out=await A.assertCredentialMetadata(client,{tenantId:1,credentialRefId:'credential',credentialRefVersion:4,
    credentialOwnerUserId:9,accountFingerprint:'a'.repeat(64)});
  assert.match(sql,/orchestrator_tenant_meta_credential_refs[\s\S]*FOR UPDATE/);
  assert.deepEqual(params,[1,'credential']);
  assert.equal(out.credential_ref_version,4);
  assert.doesNotMatch(sql,/token|secret|cipher|vault/i);
});

test('credential metadata mismatch fails closed at the production boundary',async()=>{
  const base={tenant_id:1,id:'credential',platform:'meta',version:4,status:'active',revoked_at:null,
    owner_user_id:9,account_fingerprint:'a'.repeat(64)};
  const binding={tenantId:1,credentialRefId:'credential',credentialRefVersion:4,credentialOwnerUserId:9,
    accountFingerprint:'a'.repeat(64)};
  for(const changed of [{version:5},{status:'revoked',revoked_at:new Date()},{owner_user_id:10},
    {account_fingerprint:'b'.repeat(64)},{tenant_id:2},{platform:'google'}]) {
    const client={query:async()=>({rowCount:1,rows:[{...base,...changed}]})};
    await assert.rejects(A.assertCredentialMetadata(client,binding),{code:'credential_boundary_mismatch'});
  }
  await assert.rejects(A.assertCredentialMetadata({query:async()=>({rowCount:0,rows:[]})},binding),
    {code:'credential_boundary_mismatch'});
});

test('public attempt is sanitized and does not imply closure verified provider state',()=>{
  const out=R._test.publicAttempt({id:'attempt',review_case_id:'case',review_version:2,closure_audit_ref:'closure-audit',
    audit_ref:'attempt-audit',created_at:'now',new_authorization_id:'secret-auth',invocation_id_hash:'secret-hash'},
  {reconciliation_run_id:'fresh-run',state:'discrepancy_detected',observations:[],discrepancy_classifications:['ad_missing'],
    failure_classifications:[],audit_reference:'run-audit',created_at:'now',completed_at:'later'});
  assert.deepEqual(Object.keys(out).sort(),['audit_reference','closure_event_reference','created_at','reconciliation',
    'rereconciliation_attempt_id','review_case_id','review_version']);
  assert.equal(out.reconciliation.state,'discrepancy_detected');
  assert.equal(out.reconciliation.reconciliation_run_id,'fresh-run');
  assert.equal(out.reconciliation.audit_reference,'run-audit');
  assert.doesNotMatch(JSON.stringify(out),/secret|authorization|credential|fingerprint|ledger|token|header|provider_id/i);
});

test('workflow has no provider mutation, correction, retry, or review-update reachability',()=>{
  const source=fs.readFileSync(require.resolve('../services/agent_orchestrator/meta_post_review_rereconciliation'),'utf8');
  assert.doesNotMatch(source,/\b(?:POST|PUT|PATCH|DELETE)\b|axios|fetch\s*\(|UPDATE orchestrator_campaign_reconciliation_review_cases/i);
  assert.match(source,/observeWithConsumedCredential/);
});
