'use strict';

const { fail } = require('./errors');
const { newId } = require('./runner');
const { sha256Hex } = require('./hash');
const { checkCredentials } = require('./campaign_validate');
const { assertPublishAuthorizedOnClient } = require('./campaign_drafts');
const { lockPublishRequest } = require('./campaign_publish_requests');
const { enqueueCampaignDeliveryV1, normalizeCredentialRef } = require('./outbox');
const C = require('./campaign_contracts');
const D = require('./campaign_delivery_contracts');

const UNIQUE_VIOLATION = '23505';
const SAVEPOINT = 'sp_campaign_delivery_intent';
const CONFIRMATION_VERSION = 1;

const AUDIT_DETAIL_KEYS = Object.freeze([
  'action', 'from', 'to', 'state', 'gate', 'version',
  'intent_id', 'request_id', 'draft_id', 'publish_approval_id', 'workflow_approval_id',
  'outbox_id', 'revision', 'contract_hash', 'snapshot_hash', 'intent_hash',
  'requested_by', 'contract_version', 'operation', 'status', 'platform',
]);

function one(c, sql, p) { return c.query(sql, p).then((r) => r.rows[0] || null); }

async function withTx(pool, fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally { c.release(); }
}

function boundActorId(pub) {
  const snap = pub && pub.snapshot_json;
  const fromSnap = snap && snap.actor_user_id != null ? Number(snap.actor_user_id) : NaN;
  const fromPub = pub && pub.actor_user_id != null ? Number(pub.actor_user_id) : NaN;
  if (!Number.isInteger(fromSnap) || fromSnap < 1) fail('approval_stale');
  if (!Number.isInteger(fromPub) || fromPub < 1) fail('approval_stale');
  if (fromSnap !== fromPub) fail('approval_stale');
  return fromSnap;
}

async function assertActiveMember(c, tenantId, userId) {
  const r = await c.query(
    `SELECT 1 FROM tenant_users WHERE tenant_id=$1 AND user_id=$2 AND status='active' LIMIT 1`,
    [tenantId, userId]
  );
  if (!r.rowCount) fail('permission_denied');
}

function publicIntent(row) {
  return {
    object_kind: D.OBJECT_KIND,
    id: row.id,
    tenant_id: row.tenant_id,
    publishing_request_id: row.publishing_request_id,
    draft_id: row.draft_id,
    publish_approval_id: row.publish_approval_id,
    workflow_approval_id: row.workflow_approval_id,
    outbox_id: row.outbox_id,
    revision: Number(row.revision),
    contract_hash: row.contract_hash,
    snapshot_hash: row.snapshot_hash,
    intent_hash: row.intent_hash,
    contract_version: row.contract_version,
    operation: row.operation,
    status: row.status,
    requested_by: row.requested_by,
    created_at: row.created_at,
  };
}

function sanitizeAuditDetail(detail) {
  const out = {};
  if (!detail || typeof detail !== 'object') return out;
  for (const k of AUDIT_DETAIL_KEYS) {
    const v = detail[k];
    if (v === undefined || v === null) continue;
    if (typeof v === 'boolean' || typeof v === 'number') { out[k] = v; continue; }
    if (typeof v === 'string') { out[k] = v.slice(0, 120); continue; }
  }
  return out;
}

function outboxIdempotencyKeyOf({ tenantId, publishingRequestId, intentHash }) {
  return `cdv1:${sha256Hex({
    kind: D.CONTRACT_VERSION,
    tenant_id: Number(tenantId),
    publishing_request_id: String(publishingRequestId),
    operation: D.OPERATION,
    intent_hash: String(intentHash),
  })}`;
}

function platformAccount(contract, platform) {
  if (!C.PLATFORMS.includes(platform)) fail('validation_failed', { field: 'platform' });
  const platforms = contract && Array.isArray(contract.platforms) ? contract.platforms : [];
  if (!platforms.includes(platform)) fail('validation_failed', { field: 'platform' });
  const accounts = contract && Array.isArray(contract.accounts) ? contract.accounts : [];
  const matches = accounts.filter((a) => a && a.platform === platform);
  if (matches.length !== 1) fail('validation_failed', { field: 'platform' });
  const opaque = normalizeCredentialRef(matches[0].credential_ref);
  if (!opaque) fail('validation_failed', { field: 'platform' });
  return { platform, credentialRef: opaque };
}

function assertRequestMatchesAuthorized(reqRow, draft, pub, snapshotHash) {
  if (!reqRow) fail('not_found');
  if (reqRow.status !== 'requested') fail('invalid_transition');
  if (Number(reqRow.confirmation_version) !== CONFIRMATION_VERSION) fail('validation_failed');
  if (String(reqRow.draft_id) !== String(draft.id)) fail('approval_stale');
  if (String(reqRow.publish_approval_id) !== String(pub.id)) fail('approval_stale');
  if (Number(reqRow.workflow_approval_id) !== Number(pub.workflow_approval_id)) fail('approval_stale');
  if (Number(reqRow.workflow_approval_id) !== Number(draft.approval_id)) fail('approval_stale');
  if (Number(reqRow.revision) !== Number(pub.revision) || Number(reqRow.revision) !== Number(draft.current_revision)) {
    fail('approval_stale');
  }
  if (String(reqRow.contract_hash) !== String(pub.contract_hash) || String(reqRow.contract_hash) !== String(draft.contract_hash)) {
    fail('approval_stale');
  }
  if (String(reqRow.snapshot_hash) !== String(snapshotHash)) fail('approval_stale');
}

function assertExistingSafe(existing, ctx) {
  if (!existing) return;
  if (String(existing.publishing_request_id) !== String(ctx.request.id)) {
    fail('idempotency_conflict', { field: 'idempotency_key' });
  }
  if (String(existing.draft_id) !== String(ctx.draft.id)) {
    fail('idempotency_conflict', { field: 'idempotency_key' });
  }
  if (String(existing.publish_approval_id) !== String(ctx.pub.id)) {
    fail('idempotency_conflict', { field: 'idempotency_key' });
  }
  if (Number(existing.workflow_approval_id) !== Number(ctx.pub.workflow_approval_id)) {
    fail('idempotency_conflict', { field: 'idempotency_key' });
  }
  if (Number(existing.revision) !== Number(ctx.pub.revision)) fail('approval_stale');
  if (String(existing.contract_hash) !== String(ctx.pub.contract_hash)) fail('approval_stale');
  if (String(existing.snapshot_hash) !== String(ctx.snapshotHash)) fail('approval_stale');
  if (Number(existing.requested_by) !== Number(ctx.userId)) fail('permission_denied');
  if (existing.status !== D.STATUS) fail('invalid_transition');
  if (existing.contract_version !== D.CONTRACT_VERSION) fail('validation_failed');
  if (existing.operation !== D.OPERATION) fail('validation_failed');
}

function replayOf(existing, ctx) {
  assertExistingSafe(existing, ctx);
  if (String(existing.intent_hash) !== String(ctx.intentHash)) {
    fail('idempotency_conflict', { field: 'idempotency_key' });
  }
  return { row: existing, replay: true };
}

async function loadByKey(c, tenantId, key) {
  return one(c,
    `SELECT * FROM orchestrator_campaign_delivery_intents WHERE tenant_id=$1 AND idempotency_key=$2`,
    [tenantId, key]);
}

async function loadByRequest(c, tenantId, publishingRequestId) {
  return one(c,
    `SELECT * FROM orchestrator_campaign_delivery_intents
      WHERE tenant_id=$1 AND publishing_request_id=$2`,
    [tenantId, publishingRequestId]);
}

async function resolveExisting(c, ctx) {
  const byKey = await loadByKey(c, ctx.tenantId, ctx.idempotencyKey);
  if (byKey) {
    if (String(byKey.intent_hash) !== String(ctx.intentHash)) {
      fail('idempotency_conflict', { field: 'idempotency_key' });
    }
    return replayOf(byKey, ctx);
  }
  const byReq = await loadByRequest(c, ctx.tenantId, ctx.request.id);
  if (byReq) return replayOf(byReq, ctx);
  return null;
}

async function insertIntentRow(c, ctx) {
  const id = newId('cdi');
  return (await c.query(
    `INSERT INTO orchestrator_campaign_delivery_intents
       (id, tenant_id, publishing_request_id, draft_id, publish_approval_id, workflow_approval_id,
        outbox_id, revision, contract_hash, snapshot_hash, intent_hash, contract_version,
        operation, status, idempotency_key, requested_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING *`,
    [
      id, ctx.tenantId, ctx.request.id, ctx.draft.id, ctx.pub.id, ctx.pub.workflow_approval_id,
      ctx.outboxId, Number(ctx.pub.revision), ctx.pub.contract_hash, ctx.snapshotHash,
      ctx.intentHash, D.CONTRACT_VERSION, D.OPERATION, D.STATUS, ctx.idempotencyKey, ctx.userId,
    ]
  )).rows[0];
}

async function insertIntentAudit(c, { tenantId, workflowId, actorUserId, row, platform }) {
  const detail = sanitizeAuditDetail({
    action: 'request',
    from: 'none',
    to: D.STATUS,
    state: row.status,
    gate: D.GATE,
    version: Number(row.revision),
    intent_id: row.id,
    request_id: row.publishing_request_id,
    draft_id: row.draft_id,
    publish_approval_id: row.publish_approval_id,
    workflow_approval_id: Number(row.workflow_approval_id),
    outbox_id: row.outbox_id,
    revision: Number(row.revision),
    contract_hash: row.contract_hash,
    snapshot_hash: row.snapshot_hash,
    intent_hash: row.intent_hash,
    requested_by: Number(row.requested_by),
    contract_version: row.contract_version,
    operation: row.operation,
    status: row.status,
    platform,
  });
  await c.query(
    `INSERT INTO orchestrator_audit_events
       (tenant_id, workflow_id, event, actor_user_id, detail)
     VALUES ($1,$2,'campaign_delivery_requested',$3,$4::jsonb)`,
    [tenantId, workflowId, actorUserId || null, JSON.stringify(detail)]
  );
}

async function insertOrReplay(c, ctx) {
  const existing = await resolveExisting(c, ctx);
  if (existing) return existing;
  let row;
  try {
    await c.query(`SAVEPOINT ${SAVEPOINT}`);
    row = await insertIntentRow(c, ctx);
    await enqueueCampaignDeliveryV1(c, {
      id: ctx.outboxId,
      tenantId: ctx.tenantId,
      workflowId: ctx.draft.workflow_id,
      credentialRef: ctx.credentialRef,
      idempotencyKey: ctx.outboxIdempotencyKey,
    });
    await insertIntentAudit(c, {
      tenantId: ctx.tenantId, workflowId: ctx.draft.workflow_id, actorUserId: ctx.userId,
      row, platform: ctx.platform,
    });
    await c.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
  } catch (err) {
    try { await c.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`); } catch (_) { /* ignore */ }
    if (!err || err.code !== UNIQUE_VIOLATION) throw err;
    const raced = await resolveExisting(c, ctx);
    if (raced) return raced;
    fail('idempotency_conflict', { field: 'idempotency_key' });
  }
  return { row, replay: false };
}

async function createDeliveryIntent(pool, o) {
  if (o.bodyTenantId != null && Number(o.bodyTenantId) !== Number(o.tenantId)) fail('validation_failed');
  const parsed = D.parseDeliveryBody(o.body, { idempotencyKey: o.idempotencyKey });
  const draftId = String(o.draftId || '');
  const publishingRequestId = String(o.publishingRequestId || '');
  if (!draftId || !publishingRequestId) fail('not_found');

  return withTx(pool, async (c) => {
    const authorized = await assertPublishAuthorizedOnClient(c, o.tenantId, draftId);
    const draft = authorized.draft;
    const pub = authorized.approval;
    const rev = authorized.revision;
    if (draft.status !== 'approved_for_publish') fail('approval_required');

    const reqRow = await lockPublishRequest(c, o.tenantId, draftId, publishingRequestId);
    if (!reqRow) fail('not_found');

    const snapshotHash = sha256Hex(pub.snapshot_json);
    assertRequestMatchesAuthorized(reqRow, draft, pub, snapshotHash);

    const actor = boundActorId(pub);
    if (Number(o.userId) !== actor) fail('permission_denied');
    if (Number(reqRow.requested_by) !== Number(o.userId)) fail('permission_denied');
    await assertActiveMember(c, o.tenantId, o.userId);

    const contract = rev && rev.contract_json;
    const credErrors = await checkCredentials(o.userId, contract, { tenantId: o.tenantId, client: c });
    if (credErrors.length) fail('validation_failed', { errors: credErrors });

    const intentHash = D.intentHashOf({
      tenant_id: Number(o.tenantId),
      publishing_request_id: String(reqRow.id),
      draft_id: String(draft.id),
      publish_approval_id: String(pub.id),
      workflow_approval_id: Number(pub.workflow_approval_id),
      revision: Number(pub.revision),
      contract_hash: String(pub.contract_hash),
      snapshot_hash: snapshotHash,
      contract_version: D.CONTRACT_VERSION,
      operation: D.OPERATION,
      platform: parsed.platform,
    });

    const ctx = {
      tenantId: o.tenantId,
      userId: o.userId,
      idempotencyKey: parsed.idempotency_key,
      draft,
      pub,
      request: reqRow,
      snapshotHash,
      intentHash,
      platform: parsed.platform,
      credentialRef: null,
      outboxId: null,
      outboxIdempotencyKey: null,
    };

    const byKey = await loadByKey(c, o.tenantId, parsed.idempotency_key);
    if (byKey) {
      if (String(byKey.intent_hash) !== String(intentHash)) {
        fail('idempotency_conflict', { field: 'idempotency_key' });
      }
      return replayOf(byKey, ctx);
    }

    const { platform, credentialRef } = platformAccount(contract, parsed.platform);
    D.safeReference({ platform, credentialRef });
    ctx.platform = platform;
    ctx.credentialRef = credentialRef;
    ctx.outboxId = newId('obx');
    ctx.outboxIdempotencyKey = outboxIdempotencyKeyOf({
      tenantId: o.tenantId,
      publishingRequestId: reqRow.id,
      intentHash,
    });

    return insertOrReplay(c, ctx);
  });
}

module.exports = {
  createDeliveryIntent,
  publicIntent,
};
