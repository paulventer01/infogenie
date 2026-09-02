'use strict';

// PR10B.1 — metadata-only Google Ads provider-operation ledger. Funds exactly one
// operation row from one consumed PR10A capability and settles it as failed or
// unknown. It performs no provider call, resolves no secret, takes no external
// action, and never claims provider success.
//
// PR10B.2 deferred interface — DOCUMENTED ONLY, deliberately not implemented here:
//   createPausedGoogleAdsDraft({ operation, credentials })
//   Preconditions: a persisted in_progress operation row, a consumed PR10A
//   capability, a metadata-verified credential binding, and both the global and
//   tenant kill switches still off.
//   Obligations: create only PAUSED / non-serving objects; persist the provider
//   operation and its result before returning success; fail closed on timeout or
//   ambiguous outcome; never enable, activate, schedule, publish, launch, or
//   increase spend.
//   Only after the provider returns a certain paused-draft result may PR10B.2
//   settle 'succeeded' with result code 'provider_create_succeeded'. Making
//   external_action_taken true at that point requires a later CHECK migration.

const crypto = require('crypto');
const capability = require('./google_ads_provider_draft_capabilities');
const vault = require('../credentials/vault');

const TABLE = 'orchestrator_google_ads_provider_draft_operations';
const PERMISSION = capability.PERMISSION;
const OPERATION_STATUSES = Object.freeze(['pending', 'in_progress', 'succeeded', 'failed', 'unknown']);
// PR10B.1 may only settle a non-success outcome. 'provider_create_succeeded' is
// reserved for PR10B.2 and is intentionally unreachable from this module.
const RESULT_CODES = Object.freeze({ failed: 'provider_create_failed', unknown: 'provider_outcome_unknown' });
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const SAFE_KEY = /^[A-Za-z0-9_.:-]{1,256}$/;
const deny = capability._deny;
const human = capability._human;
function hash(v) { return crypto.createHash('sha256').update(String(v)).digest('hex'); }
function same(a,b) { if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y); }
function int(v) { const n=Number(v);return Number.isSafeInteger(n)&&n>0?n:null; }
function valid(v) { return SAFE_ID.test(String(v||'')); }
function project(x,replay) { const iso=k=>x[k]?new Date(x[k]).toISOString():null;
  return Object.freeze({operation_id:x.id,status:x.status,result_code:x.result_code||null,replay:!!replay,
    created_at:iso('created_at'),started_at:iso('started_at'),settled_at:iso('settled_at'),
    published:false,activated:false,external_action_taken:false}); }
// Audit detail carries no session, credential, account or payload material.
async function audit(c,row,event) { await c.query(`INSERT INTO orchestrator_audit_events
  (tenant_id,workflow_id,event,actor_user_id,detail) VALUES($1,$2,$3,$4,$5::jsonb)`,
[row.tenant_id,row.workflow_id,event,row.actor_user_id,
  JSON.stringify({operation_id:row.id,capability_id:row.capability_id,status:row.status})]); }
function lineage(row,o,actorId) { return same(String(row.capability_id),String(o.capabilityId))
  &&Number(row.actor_user_id)===actorId&&Number(row.requested_by)===actorId
  &&same(String(row.session_id_hash),hash(o.sessionId))
  &&same(String(row.reservation_id_hash),hash(o.reservationId))
  &&same(String(row.invocation_id_hash),hash(o.invocationId)); }

// Caller owns the transaction: this never issues BEGIN/COMMIT/ROLLBACK. The
// savepoint below only unwinds the INSERT attempt, never the capability spend.
async function fund(c,o={}) {
  const tenantId=int(o.tenantId),actorId=human(o);
  if(!tenantId||![o.capabilityId,o.reservationId,o.invocationId].every(valid)
    ||!SAFE_KEY.test(String(o.idempotencyKey||'')))throw deny('operation_rejected');
  const idempotencyKey=String(o.idempotencyKey);
  const existing=await c.query(`SELECT * FROM ${TABLE} WHERE tenant_id=$1 AND idempotency_key=$2 FOR UPDATE`,
    [tenantId,idempotencyKey]);
  if(existing.rowCount===1) {
    if(!lineage(existing.rows[0],o,actorId))throw deny('operation_conflict');
    return project(existing.rows[0],true);
  }
  // PR10A revalidates authority, kill switches, actor lineage, credential
  // version and fingerprints inside reserve/consume.
  const reserved=await capability.reserve(c,o);if(reserved.expired)return reserved;
  const consumed=await capability.consume(c,o);if(consumed.expired)return consumed;
  const cap=(await c.query(`SELECT * FROM orchestrator_google_ads_provider_draft_capabilities
    WHERE tenant_id=$1 AND id=$2 AND status='consumed' AND actor_user_id=$3 FOR UPDATE`,
  [tenantId,o.capabilityId,actorId])).rows[0];
  if(!cap||!same(String(cap.session_id_hash),hash(o.sessionId)))throw deny('operation_rejected');
  await vault.assertGoogleAdsProviderDraftCredentialRefMetadata(c,{tenantId,ownerUserId:actorId,
    credentialRefId:cap.credential_ref_id,credentialRefVersion:cap.credential_ref_version,
    accountFingerprint:cap.account_fingerprint});
  const operationKey=hash(`${tenantId}|${cap.id}|${cap.draft_id}|${cap.draft_revision}|${cap.intent_id}|${cap.account_fingerprint}`);
  const id=`gapo_${crypto.randomUUID()}`;
  await c.query('SAVEPOINT gapdo_fund');
  try {
    await c.query(`INSERT INTO ${TABLE}
      (tenant_id,id,status,actor_user_id,session_id_hash,workflow_id,draft_id,draft_revision,contract_hash,
       publishing_request_id,publish_approval_id,workflow_approval_id,snapshot_hash,intent_id,intent_hash,
       capability_id,credential_ref_id,credential_ref_version,account_fingerprint,reservation_id_hash,
       invocation_id_hash,idempotency_key,provider_operation_key,requested_by,created_at,audit_ref)
      VALUES($1,$2,'pending',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$3,clock_timestamp(),$23)`,
    [tenantId,id,actorId,cap.session_id_hash,cap.workflow_id,cap.draft_id,cap.draft_revision,cap.contract_hash,
      cap.publishing_request_id,cap.publish_approval_id,cap.workflow_approval_id,cap.snapshot_hash,cap.intent_id,
      cap.intent_hash,cap.id,cap.credential_ref_id,cap.credential_ref_version,cap.account_fingerprint,
      hash(o.reservationId),hash(o.invocationId),idempotencyKey,operationKey,`gapo-audit-${crypto.randomUUID()}`]);
    await c.query('RELEASE SAVEPOINT gapdo_fund');
  } catch (error) {
    if(error?.code!=='23505')throw error;
    await c.query('ROLLBACK TO SAVEPOINT gapdo_fund');
    await c.query('RELEASE SAVEPOINT gapdo_fund');
    const raced=await c.query(`SELECT * FROM ${TABLE} WHERE tenant_id=$1 AND idempotency_key=$2 FOR UPDATE`,
      [tenantId,idempotencyKey]);
    if(raced.rowCount!==1||!lineage(raced.rows[0],o,actorId))throw deny('operation_conflict');
    return project(raced.rows[0],true);
  }
  const started=(await c.query(`UPDATE ${TABLE} SET status='in_progress',started_at=clock_timestamp()
    WHERE tenant_id=$1 AND id=$2 AND status='pending' RETURNING *`,[tenantId,id])).rows[0];
  if(!started)throw deny('operation_rejected');
  await audit(c,started,'google_ads_provider_draft_operation_funded');
  return project(started,false);
}

// Non-success settlement only. 'succeeded' is rejected before any query runs.
async function settle(c,o={}) {
  const tenantId=int(o.tenantId),actorId=human(o);
  const status=String(o.status||'');
  if(!tenantId||!valid(o.operationId)||!Object.hasOwn(RESULT_CODES,status)
    ||String(o.resultCode||'')!==RESULT_CODES[status])throw deny('operation_rejected');
  const r=await c.query(`SELECT * FROM ${TABLE} WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[tenantId,o.operationId]);
  if(r.rowCount!==1)throw deny('operation_rejected');
  const row=r.rows[0];
  if(Number(row.actor_user_id)!==actorId||!same(String(row.session_id_hash),hash(o.sessionId))
    ||row.status!=='in_progress')throw deny('operation_rejected');
  const settled=(await c.query(`UPDATE ${TABLE} SET status=$3,result_code=$4,settled_at=clock_timestamp()
    WHERE tenant_id=$1 AND id=$2 AND status='in_progress' RETURNING *`,
  [tenantId,o.operationId,status,RESULT_CODES[status]])).rows[0];
  if(!settled)throw deny('operation_rejected');
  await audit(c,settled,'google_ads_provider_draft_operation_settled');
  return project(settled,false);
}

async function get(c,o={}) {
  const tenantId=int(o.tenantId),actorId=human(o);
  if(!tenantId||!valid(o.operationId))throw deny('operation_rejected');
  const r=await c.query(`SELECT op.* FROM ${TABLE} op
    JOIN tenants t ON t.id=op.tenant_id AND t.status='active'
    JOIN tenant_users tu ON tu.tenant_id=t.id AND tu.user_id=$3 AND tu.status='active'
    JOIN roles role ON role.id=tu.role_id AND (role.tenant_id=t.id OR role.tenant_id IS NULL)
    WHERE op.tenant_id=$1 AND op.id=$2 AND op.actor_user_id=$3 AND op.session_id_hash=$4
      AND role.permissions ? $5 FOR UPDATE OF op,t,tu,role`,
  [tenantId,o.operationId,actorId,hash(o.sessionId),PERMISSION]);
  if(r.rowCount!==1)throw deny('operation_rejected');
  return project(r.rows[0],false);
}

module.exports={PERMISSION,OPERATION_STATUSES,RESULT_CODES,fund,settle,get,_project:project,_deny:deny};
