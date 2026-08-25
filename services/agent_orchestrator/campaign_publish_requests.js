'use strict';

const { fail } = require('./errors');
const { newId } = require('./runner');
const { sha256Hex } = require('./hash');
const C = require('./campaign_contracts');
const { checkCredentials } = require('./campaign_validate');
const { assertPublishAuthorizedOnClient } = require('./campaign_drafts');

const CONFIRM_PHRASE = 'CONFIRM INTERNAL PUBLISHING REQUEST';
const CONFIRMATION_VERSION = 1;
const UNIQUE_VIOLATION = '23505';
const SAVEPOINT = 'sp_campaign_publish_request';

const REQUEST_HASH_KEYS = Object.freeze([
  'tenant_id', 'draft_id', 'approval_id', 'revision',
  'contract_hash', 'snapshot_hash', 'confirmation_version',
]);

const AUDIT_DETAIL_KEYS = Object.freeze([
  'action', 'from', 'to', 'state', 'gate', 'version',
  'request_id', 'draft_id', 'publish_approval_id', 'workflow_approval_id',
  'revision', 'contract_hash', 'snapshot_hash', 'request_hash',
  'requested_by', 'confirmation_version', 'requested_at', 'status',
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

function isPlain(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v) && !Buffer.isBuffer(v);
}

function requireHex64(value, field) {
  if (typeof value !== 'string' || !C.HEX64.test(value)) fail('validation_failed', { field });
  return value;
}

function requirePositiveInt(value, field) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) fail('validation_failed', { field });
  return n;
}

function readConfirmation(body) {
  if (!isPlain(body)) fail('validation_failed', { field: 'confirmation' });
  const present = [];
  for (const field of ['confirmation', 'confirmation_phrase', 'confirm']) {
    if (Object.prototype.hasOwnProperty.call(body, field)) present.push({ field, value: body[field] });
  }
  if (!present.length) fail('validation_failed', { field: 'confirmation' });
  for (const item of present) {
    if (item.value !== CONFIRM_PHRASE) fail('validation_failed', { field: item.field });
  }
}

function parseIdempotencyKey(raw) {
  const key = String(raw || '').trim();
  if (!key || key.length > 256) fail('validation_failed', { field: 'idempotency_key' });
  return key;
}

function approvalIdMatches(echoed, pub) {
  if (echoed == null || pub == null || pub.id == null) return false;
  if (typeof echoed === 'number') return false;
  return String(echoed) === String(pub.id);
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

function requestHashOf(envelope) {
  const out = {};
  for (const k of REQUEST_HASH_KEYS) {
    let v = envelope[k];
    if (typeof v === 'string' && (k === 'contract_hash' || k === 'snapshot_hash')) {
      v = v.toLowerCase();
    }
    out[k] = v;
  }
  return sha256Hex(out);
}

function echoedRequestHash(tenantId, draftId, body) {
  return requestHashOf({
    tenant_id: Number(tenantId),
    draft_id: String(draftId),
    approval_id: String(body.approval_id),
    revision: Number(body.revision),
    contract_hash: String(body.contract_hash),
    snapshot_hash: String(body.snapshot_hash),
    confirmation_version: CONFIRMATION_VERSION,
  });
}

function publicRequest(row) {
  return {
    object_kind: 'campaign_publish_request',
    id: row.id,
    tenant_id: row.tenant_id,
    draft_id: row.draft_id,
    publish_approval_id: row.publish_approval_id,
    workflow_approval_id: row.workflow_approval_id,
    revision: Number(row.revision),
    contract_hash: row.contract_hash,
    snapshot_hash: row.snapshot_hash,
    requested_by: row.requested_by,
    status: row.status,
    confirmation_version: Number(row.confirmation_version),
    requested_at: row.requested_at,
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

async function insertPublishRequestAudit(c, { tenantId, workflowId, actorUserId, row }) {
  const detail = sanitizeAuditDetail({
    action: 'request',
    from: 'none',
    to: 'requested',
    state: row.status,
    gate: 'campaign_publishing',
    version: Number(row.revision),
    request_id: row.id,
    draft_id: row.draft_id,
    publish_approval_id: row.publish_approval_id,
    workflow_approval_id: Number(row.workflow_approval_id),
    revision: Number(row.revision),
    contract_hash: row.contract_hash,
    snapshot_hash: row.snapshot_hash,
    request_hash: row.request_hash,
    requested_by: Number(row.requested_by),
    confirmation_version: Number(row.confirmation_version),
    requested_at: row.requested_at instanceof Date ? row.requested_at.toISOString() : String(row.requested_at),
    status: row.status,
  });
  await c.query(
    `INSERT INTO orchestrator_audit_events
       (tenant_id, workflow_id, event, actor_user_id, detail)
     VALUES ($1,$2,'campaign_publishing_requested',$3,$4::jsonb)`,
    [tenantId, workflowId, actorUserId || null, JSON.stringify(detail)]
  );
}

function lockPublishRequest(c, tenantId, draftId, requestId) {
  if (!draftId || !requestId) return Promise.resolve(null);
  return one(c,
    `SELECT * FROM orchestrator_campaign_publish_requests
      WHERE tenant_id=$1 AND draft_id=$2 AND id=$3
      FOR UPDATE`,
    [tenantId, draftId, requestId]);
}

async function loadByKey(c, tenantId, key) {
  return one(c,
    `SELECT * FROM orchestrator_campaign_publish_requests WHERE tenant_id=$1 AND idempotency_key=$2`,
    [tenantId, key]);
}

async function loadBySnapshot(c, tenantId, draftId, revision, contractHash, snapshotHash) {
  return one(c,
    `SELECT * FROM orchestrator_campaign_publish_requests
      WHERE tenant_id=$1 AND draft_id=$2 AND revision=$3 AND contract_hash=$4 AND snapshot_hash=$5`,
    [tenantId, draftId, revision, contractHash, snapshotHash]);
}

function assertExistingSafe(existing, ctx) {
  if (!existing) return;
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
  if (existing.status !== 'requested') fail('invalid_transition');
  if (Number(existing.confirmation_version) !== CONFIRMATION_VERSION) fail('validation_failed');
}

function replayOf(existing, ctx) {
  assertExistingSafe(existing, ctx);
  if (String(existing.request_hash) !== String(ctx.requestHash)) {
    fail('idempotency_conflict', { field: 'idempotency_key' });
  }
  return { row: existing, replay: true };
}

async function resolveExisting(c, ctx) {
  const byKey = await loadByKey(c, ctx.tenantId, ctx.idempotencyKey);
  if (byKey) {
    if (String(byKey.request_hash) !== String(ctx.requestHash)) {
      fail('idempotency_conflict', { field: 'idempotency_key' });
    }
    return replayOf(byKey, ctx);
  }
  const bySnap = await loadBySnapshot(
    c, ctx.tenantId, ctx.draft.id, ctx.pub.revision, ctx.pub.contract_hash, ctx.snapshotHash
  );
  if (bySnap) return replayOf(bySnap, ctx);
  return null;
}

async function insertRequestRow(c, ctx) {
  const id = newId('cpr');
  return (await c.query(
    `INSERT INTO orchestrator_campaign_publish_requests
       (id, tenant_id, draft_id, publish_approval_id, workflow_approval_id, revision,
        contract_hash, snapshot_hash, requested_by, status, confirmation_version,
        idempotency_key, request_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'requested',$10,$11,$12)
     RETURNING *`,
    [
      id, ctx.tenantId, ctx.draft.id, ctx.pub.id, ctx.pub.workflow_approval_id,
      Number(ctx.pub.revision), ctx.pub.contract_hash, ctx.snapshotHash, ctx.userId,
      CONFIRMATION_VERSION, ctx.idempotencyKey, ctx.requestHash,
    ]
  )).rows[0];
}

async function insertOrReplay(c, ctx) {
  const existing = await resolveExisting(c, ctx);
  if (existing) return existing;
  let row;
  try {
    await c.query(`SAVEPOINT ${SAVEPOINT}`);
    row = await insertRequestRow(c, ctx);
    await c.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
  } catch (err) {
    try { await c.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`); } catch (_) { /* ignore */ }
    if (!err || err.code !== UNIQUE_VIOLATION) throw err;
    const raced = await resolveExisting(c, ctx);
    if (raced) return raced;
    fail('idempotency_conflict', { field: 'idempotency_key' });
  }
  await insertPublishRequestAudit(c, {
    tenantId: ctx.tenantId, workflowId: ctx.draft.workflow_id, actorUserId: ctx.userId, row,
  });
  return { row, replay: false };
}

async function createPublishRequest(pool, o) {
  if (o.bodyTenantId != null && Number(o.bodyTenantId) !== Number(o.tenantId)) fail('validation_failed');
  const body = o.body && typeof o.body === 'object' ? o.body : {};
  readConfirmation(body);
  if (body.confirmation_version != null && Number(body.confirmation_version) !== CONFIRMATION_VERSION) {
    fail('validation_failed', { field: 'confirmation_version' });
  }
  const idempotencyKey = parseIdempotencyKey(o.idempotencyKey || body.idempotency_key);
  const revision = requirePositiveInt(body.revision, 'revision');
  const contractHash = requireHex64(body.contract_hash, 'contract_hash');
  const snapshotHash = requireHex64(body.snapshot_hash, 'snapshot_hash');
  if (body.approval_id == null || body.approval_id === '') fail('validation_failed', { field: 'approval_id' });

  return withTx(pool, async (c) => {
    const authorized = await assertPublishAuthorizedOnClient(c, o.tenantId, o.draftId);
    const draft = authorized.draft;
    const pub = authorized.approval;
    const rev = authorized.revision;
    if (draft.status !== 'approved_for_publish') fail('approval_required');

    const actor = boundActorId(pub);
    if (Number(o.userId) !== actor) fail('permission_denied');
    await assertActiveMember(c, o.tenantId, o.userId);

    const contract = rev && rev.contract_json;
    const credErrors = await checkCredentials(o.userId, contract, { tenantId: o.tenantId, client: c });
    if (credErrors.length) fail('validation_failed', { errors: credErrors });

    const authoritativeSnapshotHash = sha256Hex(pub.snapshot_json);
    const requestHash = echoedRequestHash(o.tenantId, o.draftId, body);
    const ctx = {
      tenantId: o.tenantId,
      userId: o.userId,
      idempotencyKey,
      draft,
      pub,
      snapshotHash: authoritativeSnapshotHash,
      requestHash,
    };

    const byKey = await loadByKey(c, o.tenantId, idempotencyKey);
    if (byKey) {
      if (String(byKey.request_hash) !== String(requestHash)) {
        fail('idempotency_conflict', { field: 'idempotency_key' });
      }
      return replayOf(byKey, ctx);
    }

    if (!approvalIdMatches(body.approval_id, pub)) fail('approval_stale');
    if (Number(revision) !== Number(pub.revision) || Number(revision) !== Number(draft.current_revision)) {
      fail('approval_stale');
    }
    if (String(contractHash) !== String(pub.contract_hash) || String(contractHash) !== String(draft.contract_hash)) {
      fail('approval_stale');
    }
    if (String(snapshotHash) !== String(authoritativeSnapshotHash)) fail('approval_stale');

    return insertOrReplay(c, ctx);
  });
}

module.exports = {
  CONFIRM_PHRASE,
  createPublishRequest,
  publicRequest,
  requestHashOf,
  lockPublishRequest,
};
