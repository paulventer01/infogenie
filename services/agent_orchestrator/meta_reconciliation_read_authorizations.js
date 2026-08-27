'use strict';

const crypto = require('crypto');
const { getCredentialsAtVersion, accountFingerprintOfMetaAdAccount } = require('../credentials/vault');
const metaObserver = require('./connectors/meta_reconciliation_observer');

const PERMISSION = 'advertising.reconciliation.read';
const KINDS = Object.freeze(['campaign', 'adset', 'creative', 'ad']);
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_TTL_MS = 10 * 60 * 1000;
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const HEX64 = /^[0-9a-f]{64}$/;

function deny(code) {
  const e = new Error(code);
  e.code = code; e.blocked = true; e.external_action_taken = false;
  return e;
}
function positiveInt(v) { return Number.isSafeInteger(v) && v > 0 ? v : null; }
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function ledgerRoot(rows) {
  return hash(KINDS.map((kind) => {
    const row = rows.find((r) => r.object_kind === kind);
    return `${kind}:${row.provider_object_id_digest}:${row.parent_campaign_digest || ''}:${row.parent_adset_digest || ''}:${row.parent_creative_digest || ''}`;
  }).join('|'));
}
function validateLineage(rows, execution) {
  if (!Array.isArray(rows) || rows.length !== 4) throw deny('invalid_ledger_lineage');
  const by = Object.fromEntries(rows.map((r) => [r.object_kind, r]));
  if (Object.keys(by).length !== 4 || KINDS.some((k) => !by[k])) throw deny('invalid_ledger_lineage');
  for (const r of rows) {
    if (!HEX64.test(String(r.provider_object_id_digest || '')) || r.compensated
      || typeof r.provider_object_id !== 'string'
      || !same(hash(r.provider_object_id), r.provider_object_id_digest)
      || !same(r.account_fingerprint, execution.account_fingerprint)
      || !same(r.snapshot_hash, execution.snapshot_hash)) throw deny('invalid_ledger_lineage');
  }
  if (!same(by.adset.parent_campaign_digest, by.campaign.provider_object_id_digest)
    || !same(by.creative.parent_campaign_digest, by.campaign.provider_object_id_digest)
    || !same(by.ad.parent_campaign_digest, by.campaign.provider_object_id_digest)
    || !same(by.ad.parent_adset_digest, by.adset.provider_object_id_digest)
    || !same(by.ad.parent_creative_digest, by.creative.provider_object_id_digest)) throw deny('invalid_ledger_lineage');
  return ledgerRoot(rows);
}
function checkActor(opts) {
  const actor = positiveInt(opts && opts.requestedBy);
  if (!actor) throw deny('authentication_required');
  // The caller supplies the request-bound permission evaluator installed by
  // permission_enforce; accepting a permission-name string would let an
  // untrusted options object self-assert authority.
  if (!opts || typeof opts.hasPermission !== 'function' || opts.hasPermission(PERMISSION) !== true) throw deny('permission_denied');
  return actor;
}
async function audit(c, tenantId, actor, workflowId, event, authorizationId) {
  await c.query(`INSERT INTO orchestrator_audit_events
    (tenant_id, workflow_id, event, actor_user_id, detail)
    VALUES ($1,$2,$3,$4,$5::jsonb)`, [tenantId, workflowId, event, actor,
    JSON.stringify({ authorization_id: authorizationId })]);
}
async function authoritativeGraph(c, tenantId, executionId) {
  const ex = await c.query(`SELECT e.id, e.tenant_id, e.requested_by, e.publishing_request_id,
      e.intent_id, e.intent_hash, e.snapshot_hash, e.credential_ref_id, e.credential_ref_version,
      e.account_fingerprint, e.status, e.outcome, e.objects_created, e.objects_compensated,
      e.draft_id, d.workflow_id
    FROM orchestrator_campaign_provider_draft_executions e
    JOIN orchestrator_campaign_publish_requests r
      ON r.tenant_id=e.tenant_id AND r.id=e.publishing_request_id AND r.draft_id=e.draft_id
    JOIN orchestrator_campaign_drafts d
      ON d.tenant_id=r.tenant_id AND d.id=r.draft_id
    WHERE e.tenant_id=$1 AND e.id=$2 FOR SHARE OF e, r, d`, [tenantId, executionId]);
  if (ex.rowCount !== 1) throw deny('authorization_lineage_mismatch');
  const execution = ex.rows[0];
  if (Number(execution.tenant_id) !== tenantId
    || execution.status !== 'complete' || execution.outcome !== 'complete'
    || Number(execution.objects_created) !== 4 || Number(execution.objects_compensated) !== 0) throw deny('authorization_lineage_mismatch');
  const objects = await c.query(`SELECT object_kind, provider_object_id, provider_object_id_digest,
      parent_campaign_digest, parent_adset_digest, parent_creative_digest,
      account_fingerprint, snapshot_hash, compensated
    FROM orchestrator_campaign_provider_objects
    WHERE tenant_id=$1 AND execution_id=$2 ORDER BY sequence_number FOR SHARE`, [tenantId, executionId]);
  const root = validateLineage(objects.rows, execution);
  return { execution, objects: objects.rows, ledgerRoot: root };
}

async function issue(client, opts = {}) {
  const tenantId = positiveInt(opts.tenantId); const actor = checkActor(opts);
  if (!tenantId || !SAFE_ID.test(String(opts.executionId || ''))) throw deny('validation_failed');
  const graph = await authoritativeGraph(client, tenantId, String(opts.executionId));
  const e = graph.execution;
  const matches = Number(e.requested_by) === actor
    && same(e.publishing_request_id, opts.publishingRequestId)
    && same(e.snapshot_hash, opts.snapshotHash) && same(e.intent_id, opts.intentId)
    && same(e.intent_hash, opts.intentHash) && same(e.credential_ref_id, opts.credentialRefId)
    && Number(e.credential_ref_version) === Number(opts.credentialRefVersion)
    && same(e.account_fingerprint, opts.accountFingerprint)
    && same(graph.ledgerRoot, opts.ledgerRootHash);
  if (!matches) throw deny('authorization_lineage_mismatch');
  const now = opts.now instanceof Date ? opts.now : new Date();
  const ttl = positiveInt(opts.ttlMs || DEFAULT_TTL_MS);
  if (!ttl || ttl > MAX_TTL_MS) throw deny('validation_failed');
  const id = `mra_${crypto.randomUUID()}`; const nonceHash = hash(crypto.randomBytes(32));
  await client.query(`INSERT INTO orchestrator_campaign_reconciliation_read_authorizations
    (tenant_id,id,nonce_hash,requested_by,workflow_id,draft_id,publishing_request_id,execution_id,snapshot_hash,
     intent_id,intent_hash,credential_ref_id,credential_ref_version,account_fingerprint,
     ledger_root_hash,issued_at,expires_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
  [tenantId,id,nonceHash,actor,e.workflow_id,e.draft_id,e.publishing_request_id,e.id,e.snapshot_hash,e.intent_id,e.intent_hash,
    e.credential_ref_id,e.credential_ref_version,e.account_fingerprint,graph.ledgerRoot,now,new Date(now.getTime()+ttl)]);
  await audit(client, tenantId, actor, e.workflow_id, 'meta_reconciliation_read_authorization_issued', id);
  return Object.freeze({ authorization_id: id, expires_at: new Date(now.getTime()+ttl).toISOString() });
}

// Must run in the caller's transaction. The row lock and issued-only UPDATE
// make reservation+consumption a single atomic, replay-proof operation.
async function prepareConsumption(client, opts = {}) {
  const tenantId = positiveInt(opts.tenantId); const actor = checkActor(opts);
  const id = String(opts.authorizationId || ''); const invocationHash = hash(opts.invocationId || '');
  if (!tenantId || !SAFE_ID.test(id) || !SAFE_ID.test(String(opts.invocationId || ''))) throw deny('validation_failed');
  const r = await client.query(`SELECT * FROM orchestrator_campaign_reconciliation_read_authorizations
    WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId,id]);
  if (r.rowCount !== 1) throw deny('authorization_rejected');
  const row = r.rows[0];
  const reject = async (code) => {
    // This audit contains only the opaque authorization identifier. consumeAtomic
    // commits blocked decisions so the rejection survives the rejected call.
    await audit(client,tenantId,actor,row.workflow_id,'meta_reconciliation_read_authorization_rejected',id);
    throw deny(code);
  };
  if (row.status !== 'issued' || Number(row.requested_by) !== actor) return reject('authorization_rejected');
  const now = opts.now instanceof Date ? opts.now : new Date();
  if (!(new Date(row.expires_at) > now)) {
    await client.query(`UPDATE orchestrator_campaign_reconciliation_read_authorizations SET status='expired' WHERE tenant_id=$1 AND id=$2`, [tenantId,id]);
    return reject('authorization_expired');
  }
  let graph;
  try { graph = await authoritativeGraph(client, tenantId, row.execution_id); }
  catch (e) { if (e && e.blocked) return reject(e.code); throw e; }
  if (!same(graph.ledgerRoot,row.ledger_root_hash)) return reject('authorization_lineage_mismatch');
  return { client,tenantId,actor,id,invocationHash,now,row,graph };
}
async function markConsumed(prepared) {
  const {client,tenantId,actor,id,invocationHash,now,row,graph}=prepared;
  await client.query(`UPDATE orchestrator_campaign_reconciliation_read_authorizations
    SET status='reserved', invocation_id_hash=$3, reserved_at=$4 WHERE tenant_id=$1 AND id=$2`, [tenantId,id,invocationHash,now]);
  await audit(client,tenantId,actor,row.workflow_id,'meta_reconciliation_read_authorization_reserved',id);
  await client.query(`UPDATE orchestrator_campaign_reconciliation_read_authorizations
    SET status='consumed', consumed_at=$3 WHERE tenant_id=$1 AND id=$2`, [tenantId,id,now]);
  await audit(client,tenantId,actor,row.workflow_id,'meta_reconciliation_read_authorization_consumed',id);
  return Object.freeze({ authorization_id:id, invocation_id_hash:invocationHash, tenant_id:tenantId,
    requested_by:actor, workflow_id:row.workflow_id, draft_id:row.draft_id, execution_id:row.execution_id, publishing_request_id:row.publishing_request_id,
    snapshot_hash:row.snapshot_hash, intent_id:row.intent_id, intent_hash:row.intent_hash,
    credential_ref_id:row.credential_ref_id, credential_ref_version:Number(row.credential_ref_version),
    account_fingerprint:row.account_fingerprint, ledger_root_hash:row.ledger_root_hash,
    ledger_objects:Object.freeze(graph.objects.map((o)=>Object.freeze({...o}))) });
}
async function consume(client, opts = {}) { return markConsumed(await prepareConsumption(client,opts)); }

// Narrow PR6F-2 primitive: it creates only the tenant-leading reconciliation
// row from the locked authorization's frozen bindings, then consumes that
// authorization. It neither resolves credentials nor accepts provider inputs.
async function consumeIntoReconciliationRun(client, opts = {}, run = {}) {
  const prepared=await prepareConsumption(client,opts);
  const {tenantId,id:authorizationId,invocationHash,row}=prepared;
  if (!SAFE_ID.test(String(run.id||'')) || !SAFE_ID.test(String(run.auditRef||''))
    || !(run.observingAt instanceof Date) || !(run.observationDeadline instanceof Date)
    || !(run.observationDeadline>run.observingAt)) throw deny('validation_failed');
  const inserted=await client.query(`INSERT INTO orchestrator_campaign_reconciliation_runs
    (tenant_id,id,authorization_id,invocation_id_hash,requested_by,workflow_id,draft_id,publishing_request_id,
     execution_id,snapshot_hash,intent_id,intent_hash,credential_ref_id,credential_ref_version,account_fingerprint,
     ledger_root_hash,state,audit_ref,observing_at,observation_deadline) VALUES
    ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'observing',$17,$18,$19) RETURNING *`,
  [tenantId,run.id,authorizationId,invocationHash,prepared.actor,row.workflow_id,row.draft_id,row.publishing_request_id,
    row.execution_id,row.snapshot_hash,row.intent_id,row.intent_hash,row.credential_ref_id,row.credential_ref_version,
    row.account_fingerprint,row.ledger_root_hash,run.auditRef,run.observingAt,run.observationDeadline]);
  const consumed=await markConsumed(prepared);
  return { consumed,row:inserted.rows[0] };
}

// Owns the transaction boundary: reservation and consumption are committed
// before this function returns a credential-capable proof. Rejections for a
// known authorization are committed as audit-only/expiry state; infrastructure
// errors roll back. This prevents callers from accidentally reading while the
// consume transaction is still reversible.
async function consumeAtomic(pool, opts = {}) {
  if (!pool || typeof pool.connect !== 'function') throw deny('validation_failed');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      const consumed = await consume(client, opts);
      await client.query('COMMIT');
      return consumed;
    } catch (e) {
      if (e && e.blocked) await client.query('COMMIT');
      else await client.query('ROLLBACK');
      throw e;
    }
  } finally { client.release(); }
}

// Complete safe ordering contract. No secret resolution or transport can run
// until consumeAtomic has committed. Provider/transport failure never restores
// the one-shot authorization.
async function consumeAndObserve(pool, opts = {}, observerOptions = {}, getCredentialsImpl = getCredentialsAtVersion) {
  const consumed = await consumeAtomic(pool, opts);
  return observeWithConsumedCredential(pool, consumed, observerOptions, getCredentialsImpl);
}

async function revoke(client, opts = {}) {
  const tenantId=positiveInt(opts.tenantId); const actor=checkActor(opts); const id=String(opts.authorizationId||'');
  const r=await client.query(`UPDATE orchestrator_campaign_reconciliation_read_authorizations
    SET status='revoked', revoked_at=COALESCE($3,now()) WHERE tenant_id=$1 AND id=$2
      AND requested_by=$4 AND status IN ('issued','reserved') RETURNING workflow_id`,
  [tenantId,id,opts.now||null,actor]);
  if (r.rowCount!==1) throw deny('authorization_rejected');
  await audit(client,tenantId,actor,r.rows[0].workflow_id,'meta_reconciliation_read_authorization_revoked',id);
}

// This is deliberately not a general-purpose credential callback. The token
// crosses only into the dedicated GET-only observer and is never returned to
// the caller, even as a non-enumerable handle.
async function observeWithConsumedCredential(client, consumed, options = {}, getCredentialsImpl = getCredentialsAtVersion) {
  if (!client || typeof client.query !== 'function' || !consumed || typeof consumed !== 'object') throw deny('validation_failed');
  const r=await client.query(`SELECT status,invocation_id_hash,workflow_id,draft_id,credential_ref_id,credential_ref_version,
      account_fingerprint,requested_by,publishing_request_id,snapshot_hash,intent_id,intent_hash,ledger_root_hash
      FROM orchestrator_campaign_reconciliation_read_authorizations
    WHERE tenant_id=$1 AND id=$2 AND execution_id=$3`,[consumed.tenant_id,consumed.authorization_id,consumed.execution_id]);
  if (r.rowCount!==1 || r.rows[0].status!=='consumed' || !same(r.rows[0].invocation_id_hash,consumed.invocation_id_hash)
    || !same(r.rows[0].workflow_id,consumed.workflow_id)
    || !same(r.rows[0].draft_id,consumed.draft_id)
    || !same(r.rows[0].credential_ref_id,consumed.credential_ref_id)
    || Number(r.rows[0].credential_ref_version)!==consumed.credential_ref_version
    || !same(r.rows[0].account_fingerprint,consumed.account_fingerprint)
    || Number(r.rows[0].requested_by)!==consumed.requested_by
    || !same(r.rows[0].publishing_request_id,consumed.publishing_request_id)
    || !same(r.rows[0].snapshot_hash,consumed.snapshot_hash)
    || !same(r.rows[0].intent_id,consumed.intent_id)
    || !same(r.rows[0].intent_hash,consumed.intent_hash)
    || !same(r.rows[0].ledger_root_hash,consumed.ledger_root_hash)) throw deny('credential_boundary_mismatch');
  const graph=await authoritativeGraph(client,consumed.tenant_id,consumed.execution_id);
  if (!same(graph.ledgerRoot,consumed.ledger_root_hash)) throw deny('credential_boundary_mismatch');
  const ref=await client.query(`SELECT version,status,revoked_at,owner_user_id,account_fingerprint FROM orchestrator_tenant_meta_credential_refs
    WHERE tenant_id=$1 AND id=$2 AND platform='meta'`,[consumed.tenant_id,consumed.credential_ref_id]);
  if (ref.rowCount!==1 || ref.rows[0].status!=='active' || ref.rows[0].revoked_at
    || Number(ref.rows[0].version)!==consumed.credential_ref_version
    || Number(ref.rows[0].owner_user_id)!==consumed.requested_by
    || !same(ref.rows[0].account_fingerprint,consumed.account_fingerprint)) throw deny('credential_boundary_mismatch');
  const secret=await getCredentialsImpl(consumed.requested_by,'meta_ads',consumed.credential_ref_version);
  if (!secret || typeof secret.accessToken!=='string'
    || !same(accountFingerprintOfMetaAdAccount(secret.adAccountId),consumed.account_fingerprint)) throw deny('credential_boundary_mismatch');
  return metaObserver.observeMetaLedger({
    accessToken: String(secret.accessToken),
    adAccountId: String(secret.adAccountId),
    ledgerObjects: graph.objects,
    authorizationId: consumed.authorization_id,
    ledgerReference: consumed.ledger_root_hash,
    transport: options.transport,
    now: options.now,
  });
}

module.exports={ PERMISSION,KINDS,DEFAULT_TTL_MS,MAX_TTL_MS,ledgerRoot,validateLineage,issue,consume,
  consumeIntoReconciliationRun,consumeAtomic,consumeAndObserve,revoke,observeWithConsumedCredential };
