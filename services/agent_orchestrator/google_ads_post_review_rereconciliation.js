'use strict';

// Google-only PR10C.4 coordinator. Authority, secret scope and GAQL construction
// remain owned by the existing hardened Google reconciliation boundary.
const crypto=require('crypto');
const authority=require('../security/google_ads_paused_draft_reconciliation');
const reconciliation=require('./google_ads_paused_draft_reconciliation');
const PERMISSION=authority.POST_REVIEW_PERMISSION;
const SAFE_ID=/^[A-Za-z0-9_.:-]{1,128}$/;
const hash=(v)=>crypto.createHash('sha256').update(String(v)).digest('hex');
function fail(code){const e=new Error(code);e.code=code;e.blocked=true;e.external_action_taken=false;return e;}
function authorize(o){authority._human({...o,authorizationPurpose:'post_review'});if(!Number.isSafeInteger(Number(o.tenantId))||!SAFE_ID.test(String(o.reviewCaseId||''))||!SAFE_ID.test(String(o.invocationId||'')))throw fail('validation_failed');}
function payloadHash(o){return hash(JSON.stringify({review_case_id:String(o.reviewCaseId),invocation_id:String(o.invocationId)}));}
function project(a,run){return Object.freeze({rereconciliation_attempt_id:a.id,review_case_id:a.review_case_id,
  review_version:a.review_version,closure_event_reference:a.closure_audit_ref,reconciliation:run,
  audit_reference:a.audit_ref,created_at:a.created_at,external_action_taken:false});}
async function find(pool,tenantId,caseId){const r=await pool.query(`SELECT a.*,e.audit_ref closure_audit_ref,r.*,
  a.id attempt_id,a.audit_ref attempt_audit_ref,a.created_at attempt_created_at FROM orchestrator_google_ads_rereconciliation_attempts a
  JOIN orchestrator_google_ads_reconciliation_review_events e ON e.tenant_id=a.tenant_id AND e.id=a.closure_event_id
  JOIN orchestrator_google_ads_reconciliation_runs r ON r.tenant_id=a.tenant_id AND r.id=a.new_reconciliation_run_id
  WHERE a.tenant_id=$1 AND a.review_case_id=$2`,[tenantId,caseId]);if(!r.rowCount)return null;const x=r.rows[0];
  return {attempt:{...x,id:x.attempt_id,audit_ref:x.attempt_audit_ref,created_at:x.attempt_created_at},run:reconciliation.publicRun(x)};}
async function start(pool,o,now){const c=await pool.connect();try{await c.query('BEGIN');
  const q=await c.query(`SELECT * FROM orchestrator_google_ads_reconciliation_review_cases WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[o.tenantId,o.reviewCaseId]);
  if(q.rowCount!==1)throw fail('review_case_not_found');const review=q.rows[0],digest=payloadHash(o),prior=await find(c,o.tenantId,review.id);
  if(prior){if(prior.attempt.invocation_payload_hash!==digest)throw fail('idempotency_conflict');
    await authority.reproveMetadataAuthority(c,{...o,authorizationPurpose:'post_review',authorizationId:prior.attempt.new_authorization_id});
    await c.query('COMMIT');return {existing:prior};}
  if(review.state!=='closed')throw fail('review_case_ineligible');if(review.classification!=='external_remediation_required')throw fail('closure_classification_ineligible');
  const events=await c.query(`SELECT * FROM orchestrator_google_ads_reconciliation_review_events WHERE tenant_id=$1 AND case_id=$2
    AND to_state='closed' AND classification='external_remediation_required' FOR SHARE`,[o.tenantId,review.id]);if(events.rowCount!==1)throw fail('closure_event_mismatch');
  const original=(await c.query(`SELECT r.*,a.status original_authorization_status,a.credential_owner_user_id,a.purpose,a.account_fingerprint
    FROM orchestrator_google_ads_reconciliation_runs r JOIN orchestrator_google_ads_reconciliation_read_authorizations a
    ON a.tenant_id=r.tenant_id AND a.id=r.authorization_id WHERE r.tenant_id=$1 AND r.id=$2 FOR SHARE OF r,a`,[o.tenantId,review.reconciliation_run_id])).rows[0];
  if(!original||original.original_authorization_status!=='consumed'||original.purpose!=='initial'||original.authorization_id!==review.authorization_id
    ||!['discrepancy_detected','failed'].includes(original.state))throw fail('original_lineage_mismatch');
  for(const k of ['workflow_id','draft_id','publishing_request_id','operation_id','snapshot_hash','intent_id','intent_hash','credential_ref_id','ledger_root_hash'])if(original[k]!==review[k])throw fail('original_lineage_mismatch');
  if(Number(original.credential_ref_version)!==Number(review.credential_ref_version)||Number(original.requested_by)!==Number(review.original_requested_by))throw fail('original_lineage_mismatch');
  const credential=await c.query(`SELECT id,version,status,owner_user_id,account_fingerprint FROM orchestrator_tenant_google_ads_credential_refs
    WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[o.tenantId,review.credential_ref_id]);
  if(credential.rowCount!==1||credential.rows[0].status!=='active'||Number(credential.rows[0].version)!==Number(review.credential_ref_version)
    ||Number(credential.rows[0].owner_user_id)!==Number(original.credential_owner_user_id)
    ||credential.rows[0].account_fingerprint!==original.account_fingerprint)throw fail('credential_boundary_mismatch');
  const common={...o,authorizationPurpose:'post_review',operationId:review.operation_id,credentialOwnerUserId:Number(original.credential_owner_user_id),
    reviewCaseId:review.id,reviewVersion:Number(review.version),closureEventId:Number(events.rows[0].id)};
  const issued=await authority.issue(c,common),runId=`garrun_${crypto.randomUUID()}`,runAudit=`garrun-audit:${hash(runId).slice(0,20)}`;
  const started=await authority.consumeIntoReconciliationRun(c,{...common,authorizationId:issued.authorization_id},
    {id:runId,auditRef:runAudit,observationLeaseMs:reconciliation.OBSERVATION_LEASE_MS});
  const id=`garra_${crypto.randomUUID()}`,auditRef=`garra-audit:${hash(id).slice(0,20)}`;
  const attempt=(await c.query(`INSERT INTO orchestrator_google_ads_rereconciliation_attempts(tenant_id,id,review_case_id,review_version,
    closure_event_id,original_reconciliation_run_id,original_authorization_id,new_authorization_id,new_reconciliation_run_id,
    invocation_payload_hash,initiated_by,audit_ref) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
  [o.tenantId,id,review.id,review.version,events.rows[0].id,review.reconciliation_run_id,review.authorization_id,
    issued.authorization_id,runId,digest,o.actorUserId,auditRef])).rows[0];
  await c.query(`INSERT INTO orchestrator_audit_events(tenant_id,workflow_id,event,actor_user_id,detail) VALUES($1,$2,
    'google_ads_post_review_rereconciliation_started',$3,$4::jsonb)`,[o.tenantId,review.workflow_id,o.actorUserId,JSON.stringify({rereconciliation_attempt_id:id,review_case_id:review.id,audit_reference:auditRef})]);
  await c.query('COMMIT');return {started,attempt:{...attempt,closure_audit_ref:events.rows[0].audit_ref},common};
}catch(e){try{await c.query('ROLLBACK');}catch(_){}throw e;}finally{c.release();}}
async function rereconcile(pool,o={}){authorize(o);const begun=await start(pool,o,new Date());
  if(begun.existing)return project(begun.existing.attempt,begun.existing.run);let evaluation;
  const observeOpts={...begun.common,authorizationId:begun.started.consumed.authorization_id};
  try{evaluation=reconciliation.evaluate(await reconciliation._test.observe(pool,observeOpts));}catch(e){evaluation={state:'failed',classifications:[e&&e.code==='credential_boundary_mismatch'?'credential_boundary_failure':'observation_failure'],observations:[]};}
  const run=await reconciliation._test.finishRun(pool,observeOpts,o.tenantId,begun.started.row.id,evaluation,new Date());return project(begun.attempt,run);}
module.exports={PERMISSION,rereconcile,_test:{authorize,payloadHash,project,find,start}};
