'use strict';

const { normDomain } = require('../../lib/journeyStatus');

async function recordJourneyEvent(tenantId, domain, tool, meta = {}) {
  const dom = normDomain(domain);
  const t = String(tool || '').trim();
  if (!tenantId || !dom || !t) return;
  const _db = require('../../db');
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool();
  if (!pool) return;
  await pool.query(
    `INSERT INTO domain_journey_events (tenant_id, domain, tool, meta, completed_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (tenant_id, domain, tool)
     DO UPDATE SET meta = EXCLUDED.meta, completed_at = now()`,
    [tenantId, dom, t, JSON.stringify(meta || {})],
  );
}

/**
 * Load per-domain journey completion from persisted tool runs.
 * @returns {Promise<Record<string, boolean>>}
 */
async function queryJourneyStatus(tenantId, domain) {
  const dom = normDomain(domain);
  const empty = {
    rankings: false,
    analytics: false,
    aiSearch: false,
    backlinks: false,
    marketingPlan: false,
    websiteAudit: false,
  };
  if (!tenantId || !dom) return empty;

  const _db = require('../../db');
  if (!_db.hasDb || !_db.hasDb()) return empty;
  const pool = _db.getPool();
  if (!pool) return empty;

  const status = { ...empty };
  const likeDom = `%${dom}%`;

  const queries = await Promise.all([
    pool.query(
      `SELECT 1 FROM seo_audit_runs
       WHERE tenant_id = $1 AND lower(url) LIKE $2
       LIMIT 1`,
      [tenantId, likeDom],
    ).catch(() => ({ rowCount: 0 })),
    pool.query(
      `SELECT 1 FROM geo_audit_runs
       WHERE tenant_id = $1 AND lower(url) LIKE $2
       LIMIT 1
       UNION ALL
       SELECT 1 FROM aeo_runs
       WHERE tenant_id = $1 AND lower(url) LIKE $2
       LIMIT 1`,
      [tenantId, likeDom],
    ).catch(() => ({ rowCount: 0 })),
    pool.query(
      `SELECT 1
       FROM serp_tracker_keywords k
       INNER JOIN serp_tracker_runs r
         ON r.keyword_id = k.id AND r.tenant_id = k.tenant_id
       WHERE k.tenant_id = $1 AND lower(k.target_domain) = $2
       LIMIT 1`,
      [tenantId, dom],
    ).catch(() => ({ rowCount: 0 })),
    pool.query(
      `SELECT tool FROM domain_journey_events
       WHERE tenant_id = $1 AND domain = $2`,
      [tenantId, dom],
    ).catch(() => ({ rows: [] })),
    pool.query(
      `SELECT 1 FROM battle_cards WHERE tenant_id = $1 LIMIT 1`,
      [tenantId],
    ).catch(() => ({ rowCount: 0 })),
    pool.query(
      `SELECT 1 FROM ad_insights WHERE tenant_id = $1 LIMIT 1`,
      [tenantId],
    ).catch(() => ({ rowCount: 0 })),
  ]);

  status.websiteAudit = queries[0].rowCount > 0;
  status.aiSearch = queries[1].rowCount > 0;
  status.rankings = queries[2].rowCount > 0;

  for (const row of queries[3].rows || []) {
    if (row.tool === 'backlinks') status.backlinks = true;
    if (row.tool === 'analytics') status.analytics = true;
  }

  if (queries[4].rowCount > 0) status.marketingPlan = true;
  if (queries[5].rowCount > 0) status.analytics = true;

  return status;
}

module.exports = {
  normDomain,
  recordJourneyEvent,
  queryJourneyStatus,
};
