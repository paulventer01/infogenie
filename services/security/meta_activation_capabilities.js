'use strict';

// PR7A is an authority boundary only.  This module deliberately contains no
// provider connector, credential resolver, scheduler, retry, or status update.
const crypto = require('crypto');
const {accountFingerprintOfMetaAdAccount} = require('../credentials/vault');
const {sha256Hex} = require('../agent_orchestrator/hash');

const PERMISSION = 'advertising.campaign.activate';
const CONFIRMATION = 'ACTIVATE VERIFIED META CAMPAIGN';
const MAX_CONFIRMATION_AGE_MS = 5 * 60 * 1000;
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_TTL_MS = 10 * 60 * 1000;
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const HEX64 = /^[0-9a-f]{64}$/;

function deny(code) {
  const error = new Error(code);
  error.code = code; error.blocked = true; error.external_action_taken = false;
  return error;
}
function positiveInt(value) { return Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null; }
function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function actor(opts) {
  const id = positiveInt(opts.actorUserId);
  if (!id || opts.actorType !== 'human' || !SAFE_ID.test(String(opts.sessionId || ''))
    || ['api_key','worker','service','autonomous','agent'].includes(String(opts.principalType || '').toLowerCase())) {
    throw deny('human_session_required');
  }
  // This intentionally does not accept req.can(), role names, owner/admin, or
  // wildcard authority. The API adapter must inspect the active tenant role's
  // concrete permission array and provide this exact-grant predicate.
  if (typeof opts.hasExplicitTenantPermission !== 'function'
    || opts.hasExplicitTenantPermission(PERMISSION) !== true) throw deny('permission_denied');
  return id;
}
function validId(value) { return SAFE_ID.test(String(value || '')); }
function nowOf(opts) { return opts.now instanceof Date ? opts.now : new Date(); }

async function audit(client, tenantId, actorId, workflowId, event, capabilityId) {
  await client.query(`INSERT INTO orchestrator_audit_events
    (tenant_id,workflow_id,event,actor_user_id,detail) VALUES ($1,$2,$3,$4,$5::jsonb)`,
  [tenantId,workflowId,event,actorId,JSON.stringify({ capability_id: capabilityId })]);
}

// Every mutable source of authority is locked and compared again.  The query
// selects no provider object ids, secrets, tokens, headers, or raw responses.
async function authoritative(client, tenantId, reconciliationRunId) {
  const result = await client.query(`SELECT rr.*, d.current_revision, d.contract_hash AS current_contract_hash,
      pr.revision AS request_revision, pr.contract_hash AS request_contract_hash,
      pr.workflow_approval_id AS request_workflow_approval_id, pr.publish_approval_id,
      pr.snapshot_hash AS request_snapshot_hash, di.intent_hash AS current_intent_hash,
      pa.draft_id AS approval_draft_id, pa.revision AS approval_revision,
      pa.contract_hash AS approval_contract_hash, pa.snapshot_json AS approval_snapshot_json,
      pa.workflow_approval_id AS approval_workflow_approval_id, pa.revoked_at AS approval_revoked_at,
      (pa.expires_at > now()) AS approval_active,
      ex.revision AS execution_revision, ex.publish_approval_id AS execution_publish_approval_id,
      ex.platform, ex.connector, ex.status AS execution_status,
      ex.outcome AS execution_outcome, ex.objects_created, ex.objects_compensated, ex.published,
      ex.external_action_taken, ra.id AS rereconciliation_attempt_id,
      ra.original_reconciliation_run_id, ra.review_case_id, ra.review_version,
      rc.state AS review_state, rc.version AS current_review_version
    FROM orchestrator_campaign_reconciliation_runs rr
    JOIN orchestrator_campaign_drafts d ON d.tenant_id=rr.tenant_id AND d.id=rr.draft_id
    JOIN orchestrator_campaign_publish_requests pr ON pr.tenant_id=rr.tenant_id AND pr.id=rr.publishing_request_id
    JOIN orchestrator_campaign_publish_approvals pa
      ON pa.tenant_id=pr.tenant_id AND pa.id=pr.publish_approval_id
    JOIN orchestrator_campaign_delivery_intents di ON di.tenant_id=rr.tenant_id AND di.id=rr.intent_id
    JOIN orchestrator_campaign_provider_draft_executions ex ON ex.tenant_id=rr.tenant_id AND ex.id=rr.execution_id
    LEFT JOIN orchestrator_campaign_reconciliation_rereconciliation_attempts ra
      ON ra.tenant_id=rr.tenant_id AND ra.new_reconciliation_run_id=rr.id
    LEFT JOIN orchestrator_campaign_reconciliation_review_cases rc
      ON rc.tenant_id=ra.tenant_id AND rc.id=ra.review_case_id
    WHERE rr.tenant_id=$1 AND rr.id=$2
    FOR UPDATE OF rr,d,pr,pa,di,ex`, [tenantId,reconciliationRunId]);
  if (result.rowCount !== 1) throw deny('reconciliation_not_verified');
  const row = result.rows[0];
  if (row.state !== 'verified' || !row.completed_at || row.platform !== 'meta' || row.connector !== 'meta'
    || row.execution_status !== 'complete' || row.execution_outcome !== 'complete'
    || Number(row.objects_created) !== 4 || Number(row.objects_compensated) !== 0
    || row.published === true || row.external_action_taken !== true
    || Number(row.current_revision) !== Number(row.request_revision)
    || Number(row.current_revision) !== Number(row.execution_revision)
    || row.approval_revoked_at || row.approval_active !== true
    || !same(row.approval_draft_id,row.draft_id)
    || Number(row.approval_revision) !== Number(row.current_revision)
    || Number(row.approval_workflow_approval_id) !== Number(row.request_workflow_approval_id)
    || !same(row.approval_contract_hash,row.current_contract_hash)
    || !same(row.approval_contract_hash,row.request_contract_hash)
    || !same(row.snapshot_hash,row.request_snapshot_hash)
    || !same(sha256Hex(row.approval_snapshot_json),row.snapshot_hash)
    || !same(row.publish_approval_id,row.execution_publish_approval_id)
    || !same(row.intent_hash,row.current_intent_hash)) throw deny('authoritative_binding_mismatch');
  const prior = await client.query(`SELECT id,state FROM orchestrator_campaign_reconciliation_review_cases
    WHERE tenant_id=$1 AND execution_id=$2 FOR UPDATE`, [tenantId,row.execution_id]);
  if (prior.rowCount > 0) {
    if (!row.rereconciliation_attempt_id || row.review_state !== 'closed'
      || Number(row.review_version) !== Number(row.current_review_version)
      || !prior.rows.some((item) => item.id === row.review_case_id && item.state === 'closed')) {
      throw deny('post_review_reconciliation_required');
    }
  }
  return row;
}

function assertBindings(row, opts) {
  const checks = [['draftId','draft_id'],['snapshotHash','snapshot_hash'],['publishApprovalId','publish_approval_id'],
    ['publishingRequestId','publishing_request_id'],['intentId','intent_id'],['executionId','execution_id'],
    ['reconciliationRunId','id'],['credentialRefId','credential_ref_id'],['accountFingerprint','account_fingerprint'],
    ['ledgerRootHash','ledger_root_hash']];
  if (checks.some(([input,column]) => !same(String(opts[input] || ''),String(row[column] || '')))
    || Number(opts.draftRevision) !== Number(row.current_revision)
    || Number(opts.credentialRefVersion) !== Number(row.credential_ref_version)
    || !HEX64.test(String(opts.accountFingerprint || '')) || !HEX64.test(String(opts.ledgerRootHash || ''))) {
    throw deny('authoritative_binding_mismatch');
  }
}

async function issue(client, opts = {}) {
  const tenantId=positiveInt(opts.tenantId); const actorId=actor(opts); const now=nowOf(opts);
  const confirmedAt=opts.confirmedAt instanceof Date ? opts.confirmedAt : new Date(opts.confirmedAt);
  const ttl=positiveInt(opts.ttlMs || DEFAULT_TTL_MS);
  if (!tenantId || !validId(opts.reconciliationRunId) || !validId(opts.finalConfirmationId)
    || !validId(opts.advertisingAccountId)
    || opts.finalConfirmation !== CONFIRMATION || !Number.isFinite(confirmedAt.getTime())
    || confirmedAt > now || now-confirmedAt > MAX_CONFIRMATION_AGE_MS || !ttl || ttl > MAX_TTL_MS) throw deny('fresh_confirmation_required');
  const row=await authoritative(client,tenantId,String(opts.reconciliationRunId)); assertBindings(row,opts);
  const canonicalAccountHash=accountFingerprintOfMetaAdAccount(opts.advertisingAccountId);
  if (!canonicalAccountHash || !same(canonicalAccountHash,row.account_fingerprint)) {
    throw deny('authoritative_binding_mismatch');
  }
  const id=`mac_${crypto.randomUUID()}`;
  const confirmationHash=hash(`${tenantId}|${actorId}|${opts.sessionId}|${opts.finalConfirmationId}|${CONFIRMATION}|${confirmedAt.toISOString()}`);
  const auditRef=`mac-audit-${crypto.randomUUID()}`;
  await client.query(`INSERT INTO orchestrator_campaign_activation_capabilities
    (tenant_id,id,actor_user_id,session_id_hash,draft_id,draft_revision,snapshot_hash,publish_approval_id,
     publishing_request_id,intent_id,execution_id,reconciliation_run_id,advertising_account_id_hash,
     credential_ref_id,credential_ref_version,account_fingerprint,ledger_root_hash,final_confirmation_hash,
     confirmed_at,issued_at,expires_at,audit_ref) VALUES
    ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
  [tenantId,id,actorId,hash(opts.sessionId),row.draft_id,row.current_revision,row.snapshot_hash,row.publish_approval_id,
    row.publishing_request_id,row.intent_id,row.execution_id,row.id,canonicalAccountHash,row.credential_ref_id,
    row.credential_ref_version,row.account_fingerprint,row.ledger_root_hash,confirmationHash,confirmedAt,now,
    new Date(now.getTime()+ttl),auditRef]);
  await audit(client,tenantId,actorId,row.workflow_id,'meta_activation_capability_issued',id);
  return Object.freeze({capability_id:id,expires_at:new Date(now.getTime()+ttl).toISOString()});
}

async function locked(client, opts, allowed) {
  const tenantId=positiveInt(opts.tenantId); const actorId=actor(opts);
  if (!tenantId || !validId(opts.capabilityId)) throw deny('capability_rejected');
  const result=await client.query(`SELECT * FROM orchestrator_campaign_activation_capabilities
    WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[tenantId,String(opts.capabilityId)]);
  if(result.rowCount!==1) throw deny('capability_rejected');
  const cap=result.rows[0]; const now=nowOf(opts);
  if(!allowed.includes(cap.status) || Number(cap.actor_user_id)!==actorId || !same(cap.session_id_hash,hash(opts.sessionId))) throw deny('capability_rejected');
  if(!(new Date(cap.expires_at)>now)) {
    // The append-only audit table requires a real workflow FK. Resolve it from
    // the capability's tenant-bound reconciliation rather than trusting input
    // or using NULL; keep the provenance row locked through the transition.
    const provenance=await client.query(`SELECT workflow_id FROM orchestrator_campaign_reconciliation_runs
      WHERE tenant_id=$1 AND id=$2 FOR KEY SHARE`,[tenantId,cap.reconciliation_run_id]);
    if(provenance.rowCount!==1 || !validId(provenance.rows[0].workflow_id)) throw deny('capability_rejected');
    await client.query(`UPDATE orchestrator_campaign_activation_capabilities SET status='expired'
      WHERE tenant_id=$1 AND id=$2`,[tenantId,cap.id]);
    // Do not throw while the lifecycle transaction is open: a conventional
    // catch/ROLLBACK would undo the terminal expiry.  The adapter commits this
    // sanitized sentinel, then maps it to a denied HTTP response.
    await audit(client,tenantId,actorId,provenance.rows[0].workflow_id,'meta_activation_capability_expired',cap.id);
    return Object.freeze({expired:true,capability_id:cap.id,error:'capability_expired',external_action_taken:false});
  }
  const row=await authoritative(client,tenantId,cap.reconciliation_run_id);
  assertBindings(row,{draftId:cap.draft_id,draftRevision:cap.draft_revision,snapshotHash:cap.snapshot_hash,
    publishApprovalId:cap.publish_approval_id,publishingRequestId:cap.publishing_request_id,intentId:cap.intent_id,
    executionId:cap.execution_id,reconciliationRunId:cap.reconciliation_run_id,credentialRefId:cap.credential_ref_id,
    credentialRefVersion:cap.credential_ref_version,accountFingerprint:cap.account_fingerprint,ledgerRootHash:cap.ledger_root_hash});
  return {tenantId,actorId,cap,row,now};
}
async function reserve(client,opts={}) {
  if(!validId(opts.reservationId)) throw deny('capability_rejected');
  const x=await locked(client,opts,['issued']);
  if(x.expired) return x;
  await client.query(`UPDATE orchestrator_campaign_activation_capabilities SET status='reserved',reservation_id_hash=$3,reserved_at=$4
    WHERE tenant_id=$1 AND id=$2`,[x.tenantId,x.cap.id,hash(opts.reservationId),x.now]);
  await audit(client,x.tenantId,x.actorId,x.row.workflow_id,'meta_activation_capability_reserved',x.cap.id);
  return Object.freeze({capability_id:x.cap.id,reservation_id_hash:hash(opts.reservationId)});
}
async function consume(client,opts={}) {
  if(!validId(opts.reservationId)||!validId(opts.invocationId)) throw deny('capability_rejected');
  const x=await locked(client,opts,['reserved']);
  if(x.expired) return x;
  if(!same(x.cap.reservation_id_hash,hash(opts.reservationId))) throw deny('capability_rejected');
  await client.query(`UPDATE orchestrator_campaign_activation_capabilities SET status='consumed',consumed_at=$3,invocation_id_hash=$4
    WHERE tenant_id=$1 AND id=$2`,[x.tenantId,x.cap.id,x.now,hash(opts.invocationId)]);
  await audit(client,x.tenantId,x.actorId,x.row.workflow_id,'meta_activation_capability_consumed',x.cap.id);
  return Object.freeze({capability_id:x.cap.id,consumed:true,external_action_taken:false});
}
async function revoke(client,opts={}) {
  const x=await locked(client,opts,['issued','reserved']);
  if(x.expired) return x;
  await client.query(`UPDATE orchestrator_campaign_activation_capabilities SET status='revoked',revoked_at=$3,revoked_by=$4
    WHERE tenant_id=$1 AND id=$2`,[x.tenantId,x.cap.id,x.now,x.actorId]);
  await audit(client,x.tenantId,x.actorId,x.row.workflow_id,'meta_activation_capability_revoked',x.cap.id);
  return Object.freeze({capability_id:x.cap.id,revoked:true});
}

module.exports={PERMISSION,CONFIRMATION,MAX_CONFIRMATION_AGE_MS,MAX_TTL_MS,issue,reserve,consume,revoke,_authoritative:authoritative,_deny:deny};
