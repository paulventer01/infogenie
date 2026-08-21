'use strict';

// Operator-approved, tenant-scoped cleanup of research rows identified into
// orchestrator_research_legacy_holds. No HTTP, no fetch, no live connectors.
// Boot must never call approveLegacyCleanup or executeLegacyCleanup.
//
// Logs tenant_id, op id, state, integer counts and error codes only — never
// evidence content, URLs with query data, raw emails/phones, credentials or
// payloads. confirmation_sha256 is a hex digest of the confirmation phrase.

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

async function _purgeHeldBatch(client, tenantId, targetKind) {
  const table = HOLD_KIND[targetKind];
  await client.query('BEGIN');
  await client.query("SET LOCAL infogenie.research_cleanup = 'on'");
  await client.query("SET LOCAL lock_timeout = '2s'");
  // Lock holds first and keep them until after the evidence/asset DELETE so
  // the immutable trigger still sees a matching hold + GUC.
  const held = await client.query(
    `SELECT target_id
       FROM orchestrator_research_legacy_holds
      WHERE tenant_id=$1
        AND target_kind=$2
      ORDER BY target_id
      FOR UPDATE SKIP LOCKED
      LIMIT $3`,
    [tenantId, targetKind, CLEANUP_BATCH]
  );
  const ids = (held.rows || []).map((row) => row.target_id);
  if (!ids.length) {
    await client.query('COMMIT');
    return { empty: true, purged: 0, selected: 0 };
  }
  const del = await client.query(
    `DELETE FROM ${table} WHERE tenant_id=$1 AND id IN (
       SELECT target_id FROM orchestrator_research_legacy_holds
        WHERE tenant_id=$1 AND target_kind=$2 AND target_id = ANY($3::text[])
     )`,
    [tenantId, targetKind, ids]
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

async function _purgeHeldKind(client, tenantId, targetKind) {
  let purged = 0;
  for (;;) {
    let batch = null;
    let lastErr = null;
    for (let attempt = 1; attempt <= DEADLOCK_RETRY_MAX; attempt += 1) {
      try {
        batch = await _purgeHeldBatch(client, tenantId, targetKind);
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
  const counts = await _countTenantHolds(p, tid);
  const id = crypto.randomBytes(16).toString('hex');
  const row = (await p.query(
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
  _logOp('research_evidence_cleanup_preview', {
    tenant_id: tid,
    op_id: row.id,
    state: row.state,
    dry_run_evidence_count: Number(row.dry_run_evidence_count) || 0,
    dry_run_assets_count: Number(row.dry_run_assets_count) || 0,
  });
  return _publicOp(row);
}

async function approveLegacyCleanup({ tenantId, idempotencyKey, opId, actorUserId, confirmation } = {}) {
  const tid = _assertPositiveInt(tenantId, 'tenantId');
  const actor = _assertPositiveInt(actorUserId, 'actorUserId');
  if (!_timingSafeEqualString(confirmation, DELETE_LEGACY_RESEARCH_EVIDENCE)) {
    fail('validation_failed', { field: 'confirmation', reason: 'mismatch' });
  }
  if (!_db.hasDb()) fail('validation_failed', { field: 'db', reason: 'no_db' });
  const p = _db.getPool();
  const existing = await _loadOp(p, tid, { idempotencyKey, opId });
  if (existing.state !== 'previewed') {
    fail('validation_failed', { field: 'state', reason: 'not_previewed' });
  }
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
  if ((row.state === 'running' || row.state === 'failed' || row.state === 'completed')
      && row.confirmation_sha256) {
    return true;
  }
  return false;
}

async function executeLegacyCleanup({ tenantId, idempotencyKey, opId } = {}) {
  const tid = _assertPositiveInt(tenantId, 'tenantId');
  if (!_db.hasDb()) fail('validation_failed', { field: 'db', reason: 'no_db' });
  const p = _db.getPool();
  const existing = await _loadOp(p, tid, { idempotencyKey, opId });

  if (existing.state === 'completed') {
    const leftover = await _countTenantHolds(p, tid);
    if (leftover.evidence === 0 && leftover.assets === 0) {
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
  }

  if (!_canExecute(existing)) {
    fail('validation_failed', { field: 'state', reason: 'not_approved' });
  }

  const started = (await p.query(
    `UPDATE orchestrator_research_cleanup_ops
        SET state = 'running', updated_at = now()
      WHERE tenant_id=$1 AND id=$2 AND state IN ('approved','running','failed','completed')
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
    evidencePurged = await _purgeHeldKind(client, tid, 'evidence');
    if (evidencePurged) {
      await p.query(
        `UPDATE orchestrator_research_cleanup_ops
            SET purged_evidence_count = purged_evidence_count + $3,
                updated_at = now()
          WHERE tenant_id=$1 AND id=$2`,
        [tid, started.id, evidencePurged]
      );
    }
    assetPurged = await _purgeHeldKind(client, tid, 'asset');
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
