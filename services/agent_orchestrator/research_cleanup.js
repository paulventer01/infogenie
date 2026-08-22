'use strict';

// Operator-approved, tenant-scoped cleanup of research rows identified into
// orchestrator_research_legacy_holds. No HTTP, no fetch, no live connectors.
// Boot must never call approveLegacyCleanup or executeLegacyCleanup.
//
// Logs tenant_id, op id, state, integer counts and error codes only — never
// evidence content, URLs with query data, raw emails/phones, credentials,
// payloads or raw target ids. confirmation_sha256 is a hex digest of the
// confirmation phrase. snapshot_sha256 is a hex digest of the preview
// target set. Approve reads actor from req.user.id, never a caller id.

const crypto = require('crypto');
const _db = require('../../db');
const { fail } = require('./errors');
const { logger } = require('../infra/logger');

const DELETE_LEGACY_RESEARCH_EVIDENCE = 'DELETE_LEGACY_RESEARCH_EVIDENCE';
const CLEANUP_BATCH = 100;
const DEADLOCK_RETRY_MAX = 5;
const DEADLOCK_RETRY_BASE_MS = 25;

const EVIDENCE_TABLE = 'orchestrator_research_evidence';
const ASSET_TABLE = 'orchestrator_research_evidence_assets';
const HOLD_KIND = Object.freeze({
  evidence: EVIDENCE_TABLE,
  asset: ASSET_TABLE,
});

function _pgCode(err) {
  if (!err || typeof err !== 'object') return undefined;
  const code = err.code;
  if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
  return undefined;
}

function _isRetryableTxConflict(err) {
  const code = _pgCode(err);
  return code === '40P01' || code === '40001' || code === '55P03';
}

function _sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function _sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function _timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  if (left.length !== right.length) {
    crypto.timingSafeEqual(right, right);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

// Numeric session user id, never an email. Zero/negative is the synthetic
// api-key principal used when no owner row exists — not attributable, so it is
// rejected rather than written into an approval or audit row.
function _actorId(req) {
  const n = Number(req && req.user && req.user.id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function _hashSnapshotTargets(rows) {
  const lines = (rows || [])
    .map((row) => `${String(row.target_kind)}\0${String(row.target_id)}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return crypto.createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');
}

async function _loadSnapshotTargets(p, tenantId, opId) {
  const rows = (await p.query(
    `SELECT target_kind, target_id
       FROM orchestrator_research_cleanup_targets
      WHERE tenant_id=$1 AND op_id=$2`,
    [tenantId, opId]
  )).rows;
  return rows || [];
}

async function _storePreviewSnapshotHash(client, tenantId, opId) {
  const rows = await _loadSnapshotTargets(client, tenantId, opId);
  const digest = _hashSnapshotTargets(rows);
  await client.query(
    `UPDATE orchestrator_research_cleanup_ops
        SET snapshot_sha256 = $3, updated_at = now()
      WHERE tenant_id=$1 AND id=$2 AND state='previewed'`,
    [tenantId, opId, digest]
  );
  return digest;
}

async function _assertSnapshotUntampered(p, tenantId, op) {
  const stored = op && op.snapshot_sha256 != null ? String(op.snapshot_sha256) : '';
  const rows = await _loadSnapshotTargets(p, tenantId, op.id);
  const computed = _hashSnapshotTargets(rows);
  if (!_timingSafeEqualString(computed, stored)) {
    fail('validation_failed', { field: 'snapshot_sha256', reason: 'mismatch' });
  }
}

function _assertPositiveInt(v, field) {
  let n;
  if (typeof v === 'bigint') n = Number(v);
  else if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) n = Number(v.trim());
  else fail('validation_failed', { field, reason: 'not_integer' });
  if (!Number.isInteger(n) || n < 1) fail('validation_failed', { field, reason: 'not_positive_integer' });
  return n;
}

function _assertText(v, field, min, max) {
  if (v == null || v === '') fail('validation_failed', { field, reason: 'required' });
  const s = String(v).trim();
  if (s.length < min || s.length > max) fail('validation_failed', { field, reason: 'length' });
  return s;
}

function _publicOp(row) {
  return {
    ok: true,
    id: row.id,
    tenant_id: Number(row.tenant_id),
    idempotency_key: row.idempotency_key,
    state: row.state,
    dry_run_evidence_count: Number(row.dry_run_evidence_count) || 0,
    dry_run_assets_count: Number(row.dry_run_assets_count) || 0,
    purged_evidence_count: Number(row.purged_evidence_count) || 0,
    purged_assets_count: Number(row.purged_assets_count) || 0,
    approved_at: row.approved_at || null,
    actor_user_id: row.actor_user_id == null ? null : Number(row.actor_user_id),
  };
}

function _logOp(msg, fields) {
  logger.info(msg, fields);
}

function _logOpError(msg, fields) {
  logger.error(msg, fields);
}

async function countLegacyHolds(poolOrClient) {
  if (!_db.hasDb() && !poolOrClient) {
    return { evidence: 0, assets: 0 };
  }
  const p = poolOrClient || _db.getPool();
  const row = (await p.query(
    `SELECT
       COUNT(*) FILTER (WHERE target_kind = 'evidence')::int AS evidence,
       COUNT(*) FILTER (WHERE target_kind = 'asset')::int AS assets
       FROM orchestrator_research_legacy_holds`
  )).rows[0];
  return {
    evidence: Number(row && row.evidence) || 0,
    assets: Number(row && row.assets) || 0,
  };
}

async function _countTenantHolds(p, tenantId) {
  const row = (await p.query(
    `SELECT
       COUNT(*) FILTER (WHERE target_kind = 'evidence')::int AS evidence,
       COUNT(*) FILTER (WHERE target_kind = 'asset')::int AS assets
       FROM orchestrator_research_legacy_holds
      WHERE tenant_id=$1`,
    [tenantId]
  )).rows[0];
  return {
    evidence: Number(row && row.evidence) || 0,
    assets: Number(row && row.assets) || 0,
  };
}

async function _loadOp(p, tenantId, { idempotencyKey, opId }) {
  if (opId) {
    const id = _assertText(opId, 'opId', 1, 128);
    const row = (await p.query(
      `SELECT * FROM orchestrator_research_cleanup_ops WHERE tenant_id=$1 AND id=$2`,
      [tenantId, id]
    )).rows[0];
    if (!row) fail('not_found', { field: 'opId' });
    return row;
  }
  const key = _assertText(idempotencyKey, 'idempotencyKey', 1, 256);
  const row = (await p.query(
    `SELECT * FROM orchestrator_research_cleanup_ops WHERE tenant_id=$1 AND idempotency_key=$2`,
    [tenantId, key]
  )).rows[0];
  if (!row) fail('not_found', { field: 'idempotencyKey' });
  return row;
}

async function _replacePreviewTargets(client, tenantId, opId) {
  await client.query(
    `DELETE FROM orchestrator_research_cleanup_targets
      WHERE tenant_id=$1 AND op_id=$2`,
    [tenantId, opId]
  );
  await client.query(
    `INSERT INTO orchestrator_research_cleanup_targets
       (tenant_id, op_id, target_kind, target_id)
     SELECT tenant_id, $2, target_kind, target_id
       FROM orchestrator_research_legacy_holds
      WHERE tenant_id=$1`,
    [tenantId, opId]
  );
}

async function _purgeSnapshotBatch(client, tenantId, opId, targetKind) {
  const table = HOLD_KIND[targetKind];
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout = '2s'");
  // Delete only this op's frozen snapshot IDs. The immutability trigger
  // joins cleanup_ops (approved/running) to cleanup_targets — no GUC.
  const selected = await client.query(
    `SELECT t.target_id
       FROM orchestrator_research_cleanup_targets t
      WHERE t.tenant_id=$1
        AND t.op_id=$2
        AND t.target_kind=$3
        AND EXISTS (
          SELECT 1 FROM ${table} r
           WHERE r.tenant_id = t.tenant_id AND r.id = t.target_id
        )
      ORDER BY t.target_id
      FOR UPDATE OF t SKIP LOCKED
      LIMIT $4`,
    [tenantId, opId, targetKind, CLEANUP_BATCH]
  );
  const ids = (selected.rows || []).map((row) => row.target_id);
  if (!ids.length) {
    await client.query(
      `DELETE FROM orchestrator_research_legacy_holds h
        WHERE h.tenant_id=$1
          AND h.target_kind=$2
          AND EXISTS (
            SELECT 1 FROM orchestrator_research_cleanup_targets t
             WHERE t.tenant_id=h.tenant_id
               AND t.op_id=$3
               AND t.target_kind=h.target_kind
               AND t.target_id=h.target_id
          )
          AND NOT EXISTS (
            SELECT 1 FROM ${table} r
             WHERE r.tenant_id=h.tenant_id AND r.id=h.target_id
          )`,
      [tenantId, targetKind, opId]
    );
    await client.query('COMMIT');
    return { empty: true, purged: 0, selected: 0 };
  }
  const del = await client.query(
    `DELETE FROM ${table} WHERE tenant_id=$1 AND id = ANY($2::text[])`,
    [tenantId, ids]
  );
  await client.query(
    `DELETE FROM orchestrator_research_legacy_holds
      WHERE tenant_id=$1 AND target_kind=$2 AND target_id = ANY($3::text[])`,
    [tenantId, targetKind, ids]
  );
  await client.query('COMMIT');
  return {
    empty: false,
    purged: Number(del.rowCount) || 0,
    selected: ids.length,
  };
}

async function _purgeHeldKind(client, tenantId, opId, targetKind) {
  let purged = 0;
  for (;;) {
    let batch = null;
    let lastErr = null;
    for (let attempt = 1; attempt <= DEADLOCK_RETRY_MAX; attempt += 1) {
      try {
        batch = await _purgeSnapshotBatch(client, tenantId, opId, targetKind);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        let rolled = false;
        try { await client.query('ROLLBACK'); rolled = true; } catch { /* ignore */ }
        if (rolled && _isRetryableTxConflict(err) && attempt < DEADLOCK_RETRY_MAX) {
          logger.warn('research_evidence_cleanup_retry', {
            tenant_id: tenantId,
            attempt,
            code: _pgCode(err),
          });
          await _sleep(DEADLOCK_RETRY_BASE_MS * attempt);
          continue;
        }
        throw err;
      }
    }
    if (lastErr) throw lastErr;
    if (!batch || batch.empty) break;
    purged += batch.purged;
    if (batch.selected < CLEANUP_BATCH) break;
  }
  return purged;
}

async function previewLegacyCleanup({ tenantId, idempotencyKey } = {}) {
  const tid = _assertPositiveInt(tenantId, 'tenantId');
  const key = _assertText(idempotencyKey, 'idempotencyKey', 1, 256);
  if (!_db.hasDb()) fail('validation_failed', { field: 'db', reason: 'no_db' });
  const p = _db.getPool();
  const client = await p.connect();
  let unrolled = null;
  try {
    await client.query('BEGIN');
    const counts = await _countTenantHolds(client, tid);
    const id = crypto.randomBytes(16).toString('hex');
    const row = (await client.query(
      `INSERT INTO orchestrator_research_cleanup_ops
         (id, tenant_id, idempotency_key, state, dry_run_evidence_count, dry_run_assets_count)
       VALUES ($1,$2,$3,'previewed',$4,$5)
       ON CONFLICT (tenant_id, idempotency_key) DO UPDATE SET
         dry_run_evidence_count = CASE
           WHEN orchestrator_research_cleanup_ops.state = 'previewed'
           THEN EXCLUDED.dry_run_evidence_count
           ELSE orchestrator_research_cleanup_ops.dry_run_evidence_count
         END,
         dry_run_assets_count = CASE
           WHEN orchestrator_research_cleanup_ops.state = 'previewed'
           THEN EXCLUDED.dry_run_assets_count
           ELSE orchestrator_research_cleanup_ops.dry_run_assets_count
         END,
         updated_at = CASE
           WHEN orchestrator_research_cleanup_ops.state = 'previewed'
           THEN now()
           ELSE orchestrator_research_cleanup_ops.updated_at
         END
       RETURNING *`,
      [id, tid, key, counts.evidence, counts.assets]
    )).rows[0];
    // Snapshot is writable only while previewed. Approve freezes it.
    // Hash is derived from stored targets, never from a caller-supplied list.
    if (row.state === 'previewed') {
      await _replacePreviewTargets(client, tid, row.id);
      await _storePreviewSnapshotHash(client, tid, row.id);
    }
    await client.query('COMMIT');
    _logOp('research_evidence_cleanup_preview', {
      tenant_id: tid,
      op_id: row.id,
      state: row.state,
      dry_run_evidence_count: Number(row.dry_run_evidence_count) || 0,
      dry_run_assets_count: Number(row.dry_run_assets_count) || 0,
    });
    return _publicOp(row);
  } catch (err) {
    unrolled = err;
    try { await client.query('ROLLBACK'); unrolled = null; } catch { /* stays unrolled */ }
    throw err;
  } finally {
    client.release(unrolled || undefined);
  }
}

async function approveLegacyCleanup(opts = {}) {
  if (Object.prototype.hasOwnProperty.call(opts, 'actorUserId')) {
    fail('validation_failed', { field: 'actorUserId', reason: 'caller_supplied' });
  }
  const { tenantId, idempotencyKey, opId, confirmation, req } = opts;
  const tid = _assertPositiveInt(tenantId, 'tenantId');
  if (req == null) fail('validation_failed', { field: 'req', reason: 'required' });
  const actor = _actorId(req);
  if (actor == null) fail('auth_required');
  if (!_timingSafeEqualString(confirmation, DELETE_LEGACY_RESEARCH_EVIDENCE)) {
    fail('validation_failed', { field: 'confirmation', reason: 'mismatch' });
  }
  if (!_db.hasDb()) fail('validation_failed', { field: 'db', reason: 'no_db' });
  const p = _db.getPool();
  const existing = await _loadOp(p, tid, { idempotencyKey, opId });
  if (existing.state !== 'previewed') {
    fail('validation_failed', { field: 'state', reason: 'not_previewed' });
  }
  await _assertSnapshotUntampered(p, tid, existing);
  const digest = _sha256Hex(DELETE_LEGACY_RESEARCH_EVIDENCE);
  const row = (await p.query(
    `UPDATE orchestrator_research_cleanup_ops
        SET state = 'approved',
            approved_at = now(),
            actor_user_id = $3,
            confirmation_sha256 = $4,
            updated_at = now()
      WHERE tenant_id=$1 AND id=$2 AND state='previewed'
      RETURNING *`,
    [tid, existing.id, actor, digest]
  )).rows[0];
  if (!row) fail('validation_failed', { field: 'state', reason: 'not_previewed' });
  _logOp('research_evidence_cleanup_approved', {
    tenant_id: tid,
    op_id: row.id,
    state: row.state,
    actor_user_id: actor,
  });
  return _publicOp(row);
}

function _canExecute(row) {
  if (!row) return false;
  if (row.state === 'approved') return true;
  if ((row.state === 'running' || row.state === 'failed') && row.confirmation_sha256) {
    return true;
  }
  return false;
}

async function executeLegacyCleanup({ tenantId, idempotencyKey, opId } = {}) {
  const tid = _assertPositiveInt(tenantId, 'tenantId');
  if (!_db.hasDb()) fail('validation_failed', { field: 'db', reason: 'no_db' });
  const p = _db.getPool();
  const existing = await _loadOp(p, tid, { idempotencyKey, opId });

  // Completed is frozen: leftover holds that are not in this snapshot (or
  // newly identified after preview) must not be deleted by a re-run.
  if (existing.state === 'completed') {
    _logOp('research_evidence_cleanup_complete', {
      tenant_id: tid,
      op_id: existing.id,
      state: 'completed',
      purged_evidence_count: 0,
      purged_assets_count: 0,
      idempotent: true,
    });
    return { ..._publicOp(existing), purged_evidence_count: 0, purged_assets_count: 0, idempotent: true };
  }

  if (!_canExecute(existing)) {
    fail('validation_failed', { field: 'state', reason: 'not_approved' });
  }

  await _assertSnapshotUntampered(p, tid, existing);

  const started = (await p.query(
    `UPDATE orchestrator_research_cleanup_ops
        SET state = 'running', updated_at = now()
      WHERE tenant_id=$1 AND id=$2 AND state IN ('approved','running','failed')
      RETURNING *`,
    [tid, existing.id]
  )).rows[0];
  if (!started) fail('validation_failed', { field: 'state', reason: 'not_approved' });

  _logOp('research_evidence_cleanup_running', {
    tenant_id: tid,
    op_id: started.id,
    state: 'running',
  });

  const client = await p.connect();
  let unrolled = null;
  let evidencePurged = 0;
  let assetPurged = 0;
  try {
    evidencePurged = await _purgeHeldKind(client, tid, started.id, 'evidence');
    if (evidencePurged) {
      await p.query(
        `UPDATE orchestrator_research_cleanup_ops
            SET purged_evidence_count = purged_evidence_count + $3,
                updated_at = now()
          WHERE tenant_id=$1 AND id=$2`,
        [tid, started.id, evidencePurged]
      );
    }
    assetPurged = await _purgeHeldKind(client, tid, started.id, 'asset');
    if (assetPurged) {
      await p.query(
        `UPDATE orchestrator_research_cleanup_ops
            SET purged_assets_count = purged_assets_count + $3,
                updated_at = now()
          WHERE tenant_id=$1 AND id=$2`,
        [tid, started.id, assetPurged]
      );
    }

    const row = (await p.query(
      `UPDATE orchestrator_research_cleanup_ops
          SET state = 'completed', updated_at = now()
        WHERE tenant_id=$1 AND id=$2
        RETURNING *`,
      [tid, started.id]
    )).rows[0];
    _logOp('research_evidence_cleanup_complete', {
      tenant_id: tid,
      op_id: row.id,
      state: 'completed',
      purged_evidence_count: Number(row.purged_evidence_count) || 0,
      purged_assets_count: Number(row.purged_assets_count) || 0,
    });
    return _publicOp(row);
  } catch (err) {
    unrolled = err;
    try { await client.query('ROLLBACK'); unrolled = null; } catch { /* stays unrolled */ }
    await p.query(
      `UPDATE orchestrator_research_cleanup_ops
          SET state = 'failed', updated_at = now()
        WHERE tenant_id=$1 AND id=$2`,
      [tid, started.id]
    ).catch(() => {});
    _logOpError('research_evidence_cleanup_failed', {
      tenant_id: tid,
      op_id: started.id,
      state: 'failed',
      code: _pgCode(err),
    });
    throw err;
  } finally {
    client.release(unrolled || undefined);
  }
}

module.exports = {
  DELETE_LEGACY_RESEARCH_EVIDENCE,
  CLEANUP_BATCH,
  countLegacyHolds,
  previewLegacyCleanup,
  approveLegacyCleanup,
  executeLegacyCleanup,
};
