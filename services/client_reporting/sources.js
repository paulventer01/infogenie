'use strict';

const { sqlBounds } = require('./period');

// Identifiers below are fixed server configuration, never request interpolation.
const SOURCES = Object.freeze({
  'search-intel': { table: 'search_intel_queries', mappings: 'client_reporting_query_mappings', key: 'query_id',
    label: 'query', columns: 'r.id,r.query,r.brand,r.locale,r.enabled,r.last_run_at', excluded: ['search_pulses', 'image_scans'] },
  campaigns: { table: 'ad_campaigns', mappings: 'client_reporting_campaign_mappings', key: 'campaign_id',
    label: 'name', columns: 'r.id,r.name,r.platform,r.objective,r.currency,r.status', excluded: ['legacy_kv_launches'] },
});

function source(name) {
  if (!Object.hasOwn(SOURCES, name)) throw Object.assign(new Error('invalid_source'), { status: 400 });
  return SOURCES[name];
}
function page(rows, limit) {
  const records = rows.slice(0, limit), hasMore = rows.length > limit;
  return { records, has_more: hasMore, next_cursor: hasMore ? records.at(-1).id : null };
}
async function candidates(db, spec, tenantId, cursor, limit) {
  const { rows } = await db.query(`SELECT r.id,r.${spec.label} AS label,m.client_id,m.mapping_id
    FROM ${spec.table} r LEFT JOIN ${spec.mappings} m ON m.tenant_id=$1 AND m.${spec.key}=r.id
    WHERE r.tenant_id=$1 AND r.id>$2 ORDER BY r.id ASC LIMIT $3`, [tenantId, cursor, limit + 1]);
  return page(rows, limit);
}

async function data(db, name, spec, tenantId, clientId, cursor, limit, dateRange = null) {
  const bounds = sqlBounds(dateRange);
  const join = `FROM ${spec.table} r JOIN ${spec.mappings} m
    ON m.tenant_id=$1 AND m.${spec.key}=r.id AND m.client_id=$2 WHERE r.tenant_id=$1`;
  const roots = await db.query(`SELECT ${spec.columns} ${join} AND r.id>$3 ORDER BY r.id ASC LIMIT $4`,
    [tenantId, clientId, cursor, limit + 1]);
  const count = await db.query(`SELECT count(*)::int AS mapped_records ${join}`, [tenantId, clientId]);
  const childJoin = (table) => `FROM ${table} c JOIN ${spec.table} r ON r.id=c.${spec.key} AND r.tenant_id=$1
    JOIN ${spec.mappings} m ON m.${spec.key}=r.id AND m.tenant_id=$1 AND m.client_id=$2 WHERE c.tenant_id=$1`;
  const rangeParams = bounds.start ? [tenantId, clientId, bounds.start, bounds.end] : [tenantId, clientId];
  const rangeFilter = (column) => bounds.start ? ` AND c.${column} >= $3::timestamptz AND c.${column} < $4::timestamptz` : '';
  let summary, recent;
  if (name === 'search-intel') {
    const totals = await db.query(`SELECT count(*)::int AS runs,
      count(*) FILTER (WHERE c.error IS NULL)::int AS successful_runs,
      count(*) FILTER (WHERE c.error IS NULL AND c.brand_mentioned)::int AS brand_mentions
      ${childJoin('search_intel_llm_runs')}${rangeFilter('ran_at')}`, rangeParams);
    const runs = await db.query(`SELECT c.id,c.query_id,c.provider,c.brand_mentioned,c.brand_position,c.ran_at,
      (c.error IS NOT NULL) AS failed ${childJoin('search_intel_llm_runs')}${rangeFilter('ran_at')}
      ORDER BY c.ran_at DESC,c.id DESC LIMIT 50`, rangeParams);
    summary = { ...count.rows[0], ...totals.rows[0] };
    recent = { llm_runs: runs.rows };
  } else {
    const perfJoin = `${childJoin('ad_performance_hourly')}${rangeFilter('bucket_hour')}`;
    const totals = await db.query(`SELECT r.currency,count(*)::int AS performance_rows,
      sum(c.spend) AS spend,sum(c.impressions) AS impressions,sum(c.clicks) AS clicks,
      sum(c.conversions) AS conversions,sum(c.revenue) AS revenue ${perfJoin}
      GROUP BY r.currency ORDER BY r.currency`, rangeParams);
    const performance = await db.query(`SELECT c.id,c.campaign_id,r.currency,c.bucket_hour,c.spend,c.impressions,
      c.clicks,c.conversions,c.revenue ${perfJoin}
      ORDER BY c.bucket_hour DESC,c.id DESC LIMIT 50`, rangeParams);
    const actionJoin = `${childJoin('optimizer_actions')}${rangeFilter('created_at')}`;
    const actions = await db.query(`SELECT c.id,c.campaign_id,c.action_type,c.applied,c.created_at ${actionJoin}
      ORDER BY c.created_at DESC,c.id DESC LIMIT 50`, rangeParams);
    summary = { ...count.rows[0], by_currency: totals.rows };
    recent = { performance: performance.rows, optimizer_actions: actions.rows };
  }
  const scope = dateRange?.startDate
    ? `mapped_records_in_period:${dateRange.startDate}:${dateRange.endDate}`
    : 'all_mapped_records';
  return { source: name, ...page(roots.rows, limit), summary, recent, recent_limit: 50,
    summary_scope: scope, excluded_sections: spec.excluded, period: dateRange || null };
}

module.exports = { source, candidates, data };
