'use strict';

const crypto=require('crypto');
const authorizations=require('./meta_reconciliation_read_authorizations');
const reconciliation=require('./meta_paused_draft_reconciliation');

const PERMISSION='advertising.reconciliation.review';
const ALLOWED_CLOSURES=Object.freeze(['external_remediation_required']);
const SAFE_ID=/^[A-Za-z0-9_.:-]{1,128}$/;
function hash(v){return crypto.createHash('sha256').update(String(v)).digest('hex');}
function fail(code){const e=new Error(code);e.code=code;e.blocked=true;e.external_action_taken=false;return e;}
function authorize(opts){
  if(!Number.isSafeInteger(opts.actorUserId)||opts.actorUserId<1||opts.actorType!=='human') throw fail('authentication_required');
  if(typeof opts.hasPermission!=='function'||opts.hasPermission(PERMISSION)!==true) throw fail('permission_denied');
  if(!Number.isSafeInteger(opts.tenantId)||opts.tenantId<1||!SAFE_ID.test(String(opts.reviewCaseId||''))
    ||!SAFE_ID.test(String(opts.invocationId||''))) throw fail('validation_failed');
}
function publicAttempt(row,run){return Object.freeze({
  rereconciliation_attempt_id:row.id,review_case_id:row.review_case_id,review_version:row.review_version,
  closure_event_reference:row.closure_audit_ref,reconciliation:run,
  audit_reference:row.audit_ref,created_at:row.created_at,
});}
async function findAttempt(c,tenantId,caseId){
  const r=await c.query(`SELECT a.*,e.audit_ref AS closure_audit_ref,r.*,
      a.id AS attempt_id,a.audit_ref AS attempt_audit_ref,a.created_at AS attempt_created_at
    FROM orchestrator_campaign_reconciliation_rereconciliation_attempts a
    JOIN orchestrator_campaign_reconciliation_review_events e ON e.tenant_id=a.tenant_id AND e.id=a.closure_event_id
    JOIN orchestrator_campaign_reconciliation_runs r ON r.tenant_id=a.tenant_id AND r.id=a.new_reconciliation_run_id
    WHERE a.tenant_id=$1 AND a.review_case_id=$2`,[tenantId,caseId]);
  if(!r.rowCount)return null;
  const x=r.rows[0];
  return {attempt:{...x,id:x.attempt_id,audit_ref:x.attempt_audit_ref,created_at:x.attempt_created_at},run:reconciliation.publicRun(x)};
}
async function start(pool,opts,now){
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    const locked=await c.query(`SELECT * FROM orchestrator_campaign_reconciliation_review_cases
      WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[opts.tenantId,opts.reviewCaseId]);
    if(locked.rowCount!==1)throw fail('review_case_not_found');
    const review=locked.rows[0];
    const prior=await findAttempt(c,opts.tenantId,review.id);
    if(prior){await c.query('COMMIT');return {existing:prior};}
    if(review.state!=='closed')throw fail('review_case_ineligible');
    if(!ALLOWED_CLOSURES.includes(review.classification))throw fail('closure_classification_ineligible');
    const closure=(await c.query(`SELECT * FROM orchestrator_campaign_reconciliation_review_events
      WHERE tenant_id=$1 AND case_id=$2 AND to_state='closed' AND classification=$3 FOR SHARE`,
    [opts.tenantId,review.id,review.classification])).rows;
    if(closure.length!==1)throw fail('closure_event_mismatch');
    const original=(await c.query(`SELECT r.*,a.status AS original_authorization_status,
        a.credential_owner_user_id AS original_credential_owner_user_id,
        a.requested_by AS original_authorization_requested_by
      FROM orchestrator_campaign_reconciliation_runs r JOIN orchestrator_campaign_reconciliation_read_authorizations a
        ON a.tenant_id=r.tenant_id AND a.id=r.authorization_id
      WHERE r.tenant_id=$1 AND r.id=$2 FOR SHARE OF r,a`,[opts.tenantId,review.reconciliation_run_id])).rows[0];
    if(!original||original.authorization_id!==review.authorization_id||original.original_authorization_status!=='consumed'
      ||!['discrepancy_detected','failed'].includes(original.state))throw fail('original_lineage_mismatch');
    for(const key of ['workflow_id','draft_id','publishing_request_id','snapshot_hash','intent_id','intent_hash','execution_id',
      'credential_ref_id','account_fingerprint','ledger_root_hash']) if(original[key]!==review[key])throw fail('original_lineage_mismatch');
    if(Number(original.credential_ref_version)!==Number(review.credential_ref_version))throw fail('original_lineage_mismatch');
    const credentialOwner=Number(original.original_credential_owner_user_id??original.original_authorization_requested_by);
    if(!Number.isSafeInteger(credentialOwner)||credentialOwner<1
      ||credentialOwner!==Number(review.original_requested_by))throw fail('original_lineage_mismatch');
    // Lock and validate authoritative metadata before any authorization, run,
    // attempt, or audit is created. The lock remains held through COMMIT, so a
    // concurrent revocation/rotation cannot consume the one permitted attempt.
    await authorizations.assertCredentialMetadata(c,{tenantId:opts.tenantId,
      credentialRefId:review.credential_ref_id,credentialRefVersion:Number(review.credential_ref_version),
      credentialOwnerUserId:credentialOwner,accountFingerprint:review.account_fingerprint});
    const issued=await authorizations.issue(c,{...opts,requestedBy:opts.actorUserId,purpose:'post_review',
      executionId:review.execution_id,publishingRequestId:review.publishing_request_id,snapshotHash:review.snapshot_hash,
      intentId:review.intent_id,intentHash:review.intent_hash,credentialRefId:review.credential_ref_id,
      credentialRefVersion:Number(review.credential_ref_version),credentialOwnerUserId:credentialOwner,
      accountFingerprint:review.account_fingerprint,ledgerRootHash:review.ledger_root_hash,
      reviewCaseId:review.id,reviewVersion:Number(review.version),closureEventId:Number(closure[0].id),now});
    const runId=`mrr_${crypto.randomUUID()}`;const auditRef=`mrr-audit:${hash(runId).slice(0,20)}`;
    const started=await authorizations.consumeIntoReconciliationRun(c,{...opts,requestedBy:opts.actorUserId,
      authorizationId:issued.authorization_id,authorizationPurpose:'post_review',now},{id:runId,auditRef,observingAt:now,
      observationDeadline:new Date(now.getTime()+reconciliation.OBSERVATION_LEASE_MS)});
    const attemptId=`mrrra_${crypto.randomUUID()}`;const attemptAudit=`mrrra-audit:${hash(attemptId).slice(0,20)}`;
    const inserted=(await c.query(`INSERT INTO orchestrator_campaign_reconciliation_rereconciliation_attempts
      (tenant_id,id,review_case_id,review_version,closure_event_id,original_reconciliation_run_id,original_authorization_id,
       new_authorization_id,new_reconciliation_run_id,invocation_id_hash,initiated_by,audit_ref)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[opts.tenantId,attemptId,review.id,review.version,
      closure[0].id,review.reconciliation_run_id,review.authorization_id,issued.authorization_id,runId,hash(opts.invocationId),opts.actorUserId,attemptAudit])).rows[0];
    await c.query(`INSERT INTO orchestrator_audit_events(tenant_id,workflow_id,event,actor_user_id,detail)
      VALUES($1,$2,'meta_post_review_rereconciliation_started',$3,$4::jsonb)`,[opts.tenantId,review.workflow_id,opts.actorUserId,
      JSON.stringify({rereconciliation_attempt_id:attemptId,review_case_id:review.id,audit_reference:attemptAudit})]);
    await c.query('COMMIT');return {started,attempt:{...inserted,closure_audit_ref:closure[0].audit_ref}};
  }catch(e){try{await c.query('ROLLBACK');}catch(_){}throw e;}finally{c.release();}
}
async function rereconcile(pool,opts={},observerOptions={},getCredentialsImpl){
  authorize(opts);const now=opts.now instanceof Date?opts.now:new Date();
  let begun;
  try{begun=await start(pool,opts,now);}catch(e){
    if(e&&['23505','40001'].includes(e.code)){const existing=await findAttempt(pool,opts.tenantId,opts.reviewCaseId);if(existing)return publicAttempt(existing.attempt,existing.run);}
    throw e;
  }
  if(begun.existing)return publicAttempt(begun.existing.attempt,begun.existing.run);
  let evaluation;
  try{evaluation=reconciliation.evaluate(await authorizations.observeWithConsumedCredential(pool,begun.started.consumed,observerOptions,getCredentialsImpl));}
  catch(e){evaluation={state:'failed',classifications:[e&&e.code==='credential_boundary_mismatch'?'credential_boundary_failure':'observation_failure'],observations:[]};}
  const run=await reconciliation._test.finishRun(pool,opts.tenantId,begun.started.row.id,evaluation,new Date());
  return publicAttempt(begun.attempt,run);
}

module.exports={PERMISSION,ALLOWED_CLOSURES,rereconcile,_test:{authorize,findAttempt,start,publicAttempt}};
