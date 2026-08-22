'use strict';

// Tenant-scoped, batch-limited research-evidence retention sweeper.
// No HTTP, no fetch, no live connectors. Logs tenant_id, numeric counts and
// error codes only — never headline/body/excerpt, URLs, PII, credentials,
// payloads or fingerprints.
//
// Expired SELECT/DELETE is a single CTE so SKIP LOCKED and DELETE cannot
// race. After SKIP LOCKED batches go empty, COUNT remaining eligible rows
// and retry this tenant with bounded backoff (no lock_timeout). Boot calls
// skipHolds:true so first-boot leftovers stay operator-owned on every
// retry pass. Interval/default sweep purges valid-expired rows even if held.

const _db = require('../../db');
const _runtimeFlags = require('../runtime_flags');
const { logger } = require('../infra/logger');
const _sentry = require('../infra/sentry');

const SWEEP_MS = 6 * 3600 * 1000;
const SWEEP_BATCH = 100;
// Victim retries for deadlock (40P01) / serialization failure (40001) /
// lock_timeout (55P03). After this many attempts the batch throws; the
// per-tenant catch increments failures and production boot still fails closed.
const DEADLOCK_RETRY_MAX = 5;
const DEADLOCK_RETRY_BASE_MS = 25;
// After SKIP LOCKED batches go empty, COUNT remaining eligible rows (no
// SKIP LOCKED). If locked leftovers remain, retry this tenant only with
// bounded backoff. After max attempts the next interval picks them up.
const LOCKED_RETRY_MAX = 5;
const LOCKED_RETRY_BASE_MS = 25;

const EVIDENCE_TABLE = 'orchestrator_research_evidence';
const ASSET_TABLE = 'orchestrator_research_evidence_assets';
const HOLD_KIND = Object.freeze({
  [EVIDENCE_TABLE]: 'evidence',
  [ASSET_TABLE]: 'asset',
});

const INVALID_EXPIRY_SQL = `
  SELECT
    (
      SELECT COUNT(*)::int
        FROM orchestrator_research_evidence e
       WHERE e.tenant_id=$1
         AND e.retention_class IN ('standard','short')
         AND e.expires_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM orchestrator_research_legacy_holds h
            WHERE h.tenant_id=$1
              AND h.target_kind='evidence'
              AND h.target_id = e.id
         )
    )
    +
    (
      SELECT COUNT(*)::int
        FROM orchestrator_research_evidence_assets a
       WHERE a.tenant_id=$1
         AND a.retention_class IN ('standard','short')
         AND a.expires_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM orchestrator_research_legacy_holds h
            WHERE h.tenant_id=$1
              AND h.target_kind='asset'
              AND h.target_id = a.id
         )
    ) AS invalid_expiry
`;

function expiredEligibleWhere(table, targetKind, { skipHolds } = {}) {
  const holdFilter = skipHolds ? `
     AND NOT EXISTS (
       SELECT 1 FROM orchestrator_research_legacy_holds h
        WHERE h.tenant_id=$1
          AND h.target_kind='${targetKind}'
          AND h.target_id = ${table}.id
     )` : '';
  return `
    tenant_id=$1
    AND retention_class <> 'legal_hold'
    AND expires_at IS NOT NULL
    AND expires_at <= now()
    AND expires_at > created_at
    ${holdFilter}
  `;
}

function expiredPurgeSql(table, targetKind, { skipHolds } = {}) {
  return `
WITH doomed AS (
  SELECT id FROM ${table}
   WHERE ${expiredEligibleWhere(table, targetKind, { skipHolds })}
   ORDER BY expires_at, id
   FOR UPDATE SKIP LOCKED
   LIMIT $2
)
DELETE FROM ${table} t
 USING doomed
 WHERE t.tenant_id=$1 AND t.id = doomed.id
 RETURNING t.id
`;
}

function expiredEligibleCountSql(table, targetKind, { skipHolds } = {}) {
  return `
SELECT COUNT(*)::int AS n FROM ${table}
 WHERE ${expiredEligibleWhere(table, targetKind, { skipHolds })}
`;
}

function _captureSweepError(msg, extra) {
  const err = new Error(msg);
  _sentry.captureException(err, extra && typeof extra === 'object' ? extra : undefined);
}

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

async function _listResearchTenantIds(p) {
  const tenants = await p.query(
    `SELECT tenant_id FROM (
       SELECT DISTINCT tenant_id FROM orchestrator_research_evidence
       UNION
       SELECT DISTINCT tenant_id FROM orchestrator_research_evidence_assets
     ) t
     ORDER BY tenant_id`
  );
  return (tenants.rows || []).map((row) => row.tenant_id);
}

async function _purgeExpiredBatch(client, table, tenantId, { skipHolds } = {}) {
  const targetKind = HOLD_KIND[table];
  await client.query('BEGIN');
  const del = await client.query(
    expiredPurgeSql(table, targetKind, { skipHolds }),
    [tenantId, SWEEP_BATCH]
  );
  const removed = Number(del.rowCount) || 0;
  if (removed === 0) {
    await client.query('COMMIT');
    return { empty: true, removed: 0, selected: 0 };
  }
  const ids = (del.rows || []).map((row) => row.id).filter(Boolean);
  if (ids.length) {
    await client.query(
      `DELETE FROM orchestrator_research_legacy_holds
        WHERE tenant_id=$1 AND target_kind=$2 AND target_id = ANY($3::text[])`,
      [tenantId, targetKind, ids]
    );
  }
  await client.query('COMMIT');
  return { empty: false, removed, selected: removed };
}

async function _purgeExpiredTable(client, table, tenantId, { skipHolds } = {}) {
  let purged = 0;
  for (;;) {
    let batch = null;
    let lastErr = null;
    for (let attempt = 1; attempt <= DEADLOCK_RETRY_MAX; attempt += 1) {
      try {
        batch = await _purgeExpiredBatch(client, table, tenantId, { skipHolds });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        let rolled = false;
        try { await client.query('ROLLBACK'); rolled = true; } catch { /* ignore */ }
        if (rolled && _isRetryableTxConflict(err) && attempt < DEADLOCK_RETRY_MAX) {
          logger.warn('research_evidence_sweep_retry', {
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
    purged += batch.removed;
    if (batch.selected < SWEEP_BATCH) break;
  }
  return purged;
}

async function _countExpiredEligible(client, tenantId, { skipHolds } = {}) {
  const ev = await client.query(
    expiredEligibleCountSql(EVIDENCE_TABLE, HOLD_KIND[EVIDENCE_TABLE], { skipHolds }),
    [tenantId]
  );
  const assets = await client.query(
    expiredEligibleCountSql(ASSET_TABLE, HOLD_KIND[ASSET_TABLE], { skipHolds }),
    [tenantId]
  );
  return (Number(ev.rows[0] && ev.rows[0].n) || 0)
    + (Number(assets.rows[0] && assets.rows[0].n) || 0);
}

async function _sweepTenant(p, tenantId, { skipHolds } = {}) {
  const client = await p.connect();
  let unrolled = null;
  try {
    const invalidRow = await client.query(INVALID_EXPIRY_SQL, [tenantId]);
    const invalid_expiry = Number(invalidRow.rows[0] && invalidRow.rows[0].invalid_expiry) || 0;
    if (invalid_expiry > 0) {
      logger.error('research_evidence_invalid_expiry', { tenant_id: tenantId, invalid_expiry });
      _captureSweepError('research_evidence_invalid_expiry', { tenant_id: tenantId, invalid_expiry });
    }

    let evidencePurged = 0;
    let assetPurged = 0;
    for (let attempt = 1; attempt <= LOCKED_RETRY_MAX; attempt += 1) {
      evidencePurged += await _purgeExpiredTable(client, EVIDENCE_TABLE, tenantId, { skipHolds });
      assetPurged += await _purgeExpiredTable(client, ASSET_TABLE, tenantId, { skipHolds });
      const remaining = await _countExpiredEligible(client, tenantId, { skipHolds });
      if (remaining <= 0) break;
      if (attempt >= LOCKED_RETRY_MAX) break;
      logger.info('research_evidence_sweep_locked_retry', {
        tenant_id: tenantId,
        attempt,
      });
      await _sleep(LOCKED_RETRY_BASE_MS * attempt);
    }
    return { purged: evidencePurged + assetPurged, invalid_expiry };
  } catch (err) {
    unrolled = err;
    // A ROLLBACK with no transaction open is a warning, not an error, so this
    // succeeding is proof the client carries no batch transaction.
    try { await client.query('ROLLBACK'); unrolled = null; } catch { /* stays unrolled */ }
    throw err;
  } finally {
    // release() does not roll back: a client returned mid-transaction hands the
    // next borrower an open transaction and its FOR UPDATE row locks. Destroy
    // it instead whenever the rollback could not be confirmed.
    client.release(unrolled || undefined);
  }
}

async function sweepExpiredResearchEvidence(opts) {
  if (!_db.hasDb()) {
    return { ok: true, skipped: 'no_db', purged: 0, failures: 0, invalid_expiry: 0 };
  }

  const startedAt = new Date().toISOString();
  logger.info('research_evidence_sweep_start', { startedAt });

  const p = _db.getPool();
  let purged = 0;
  let failures = 0;
  let invalid_expiry = 0;

  let tenantIds;
  try {
    if (opts && opts.tenantId != null) {
      tenantIds = [opts.tenantId];
    } else {
      tenantIds = await _listResearchTenantIds(p);
    }
  } catch (err) {
    failures += 1;
    logger.error('research_evidence_sweep_failed', { phase: 'list_tenants', code: _pgCode(err) });
    _captureSweepError('research_evidence_sweep_failed', { phase: 'list_tenants', code: _pgCode(err) });
    logger.info('research_evidence_sweep_complete', {
      purged: 0, failures, invalid_expiry: 0, ok: false,
    });
    return { ok: false, purged: 0, failures, invalid_expiry: 0, startedAt, completedAt: new Date().toISOString() };
  }

  for (const tenantId of tenantIds) {
    try {
      const r = await _sweepTenant(p, tenantId, {
        skipHolds: !!(opts && opts.skipHolds),
      });
      purged += r.purged || 0;
      invalid_expiry += r.invalid_expiry || 0;
    } catch (err) {
      failures += 1;
      logger.error('research_evidence_sweep_failed', {
        tenant_id: tenantId,
        phase: 'sweep',
        code: _pgCode(err),
      });
      _captureSweepError('research_evidence_sweep_failed', {
        tenant_id: tenantId,
        phase: 'sweep',
        code: _pgCode(err),
      });
    }
  }

  const ok = failures === 0 && invalid_expiry === 0;
  logger.info('research_evidence_sweep_complete', { purged, failures, invalid_expiry, ok });
  return {
    ok,
    purged,
    failures,
    invalid_expiry,
    startedAt,
    completedAt: new Date().toISOString(),
  };
}

function startResearchEvidenceSweepInterval() {
  if (!_runtimeFlags.backgroundEnabled()) return null;
  return setInterval(() => {
    sweepExpiredResearchEvidence().catch((_err) => {
      logger.error('research_evidence_sweep_failed', { phase: 'interval' });
      _captureSweepError('research_evidence_sweep_failed', { phase: 'interval' });
    });
  }, SWEEP_MS);
}

startResearchEvidenceSweepInterval();

module.exports = {
  sweepExpiredResearchEvidence,
  startResearchEvidenceSweepInterval,
  SWEEP_MS,
  SWEEP_BATCH,
  DEADLOCK_RETRY_MAX,
  LOCKED_RETRY_MAX,
  LOCKED_RETRY_BASE_MS,
};
