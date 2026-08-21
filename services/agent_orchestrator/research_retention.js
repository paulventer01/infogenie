'use strict';

// Tenant-scoped, batch-limited research-evidence retention sweeper.
// No HTTP, no fetch, no live connectors. Logs tenant_id, numeric counts and
// error codes only — never headline/body/excerpt, URLs, PII, credentials,
// payloads or fingerprints.

const _db = require('../../db');
const _runtimeFlags = require('../runtime_flags');
const { logger } = require('../infra/logger');
const _sentry = require('../infra/sentry');

const SWEEP_MS = 6 * 3600 * 1000;
const SWEEP_BATCH = 100;

const EVIDENCE_TABLE = 'orchestrator_research_evidence';
const ASSET_TABLE = 'orchestrator_research_evidence_assets';

const INVALID_EXPIRY_SQL = `
  SELECT
    (
      SELECT COUNT(*)::int
        FROM orchestrator_research_evidence
       WHERE tenant_id=$1
         AND retention_class IN ('standard','short')
         AND (expires_at IS NULL)
    )
    +
    (
      SELECT COUNT(*)::int
        FROM orchestrator_research_evidence_assets
       WHERE tenant_id=$1
         AND retention_class IN ('standard','short')
         AND (expires_at IS NULL)
    ) AS invalid_expiry
`;

function expiredLockSql(table) {
  return `SELECT tenant_id, id FROM ${table}
           WHERE tenant_id=$1
             AND retention_class <> 'legal_hold'
             AND expires_at IS NOT NULL
             AND expires_at <= now()
           ORDER BY expires_at, id
           FOR UPDATE SKIP LOCKED
           LIMIT $2`;
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

async function _purgeExpiredTable(client, table, tenantId) {
  let purged = 0;
  for (;;) {
    await client.query('BEGIN');
    try {
      const sel = await client.query(expiredLockSql(table), [tenantId, SWEEP_BATCH]);
      const ids = (sel.rows || []).map((row) => row.id);
      if (!ids.length) {
        await client.query('COMMIT');
        break;
      }
      const del = await client.query(
        `DELETE FROM ${table} WHERE tenant_id=$1 AND id = ANY($2)`,
        [tenantId, ids]
      );
      const removed = Number(del.rowCount) || 0;
      if (removed === 0) {
        throw Object.assign(new Error('research_evidence_sweep_delete_noop'), { code: 'XX000' });
      }
      await client.query('COMMIT');
      purged += removed;
      if (ids.length < SWEEP_BATCH) break;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    }
  }
  return purged;
}

async function _sweepTenant(p, tenantId) {
  const invalidRow = await p.query(INVALID_EXPIRY_SQL, [tenantId]);
  const invalid_expiry = Number(invalidRow.rows[0] && invalidRow.rows[0].invalid_expiry) || 0;
  if (invalid_expiry > 0) {
    logger.error('research_evidence_invalid_expiry', { tenant_id: tenantId, invalid_expiry });
    _captureSweepError('research_evidence_invalid_expiry', { tenant_id: tenantId, invalid_expiry });
  }

  const client = await p.connect();
  let unrolled = null;
  try {
    const evidencePurged = await _purgeExpiredTable(client, EVIDENCE_TABLE, tenantId);
    const assetPurged = await _purgeExpiredTable(client, ASSET_TABLE, tenantId);
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

async function sweepExpiredResearchEvidence() {
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
    tenantIds = await _listResearchTenantIds(p);
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
      const r = await _sweepTenant(p, tenantId);
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
};
