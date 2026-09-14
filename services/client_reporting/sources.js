'use strict';

const { sqlBounds } = require('./period');
const { safeQuery, buildMetricMeta } = require('./availability');

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
  const rootsResult = await safeQuery('roots', () => db.query(`SELECT ${spec.columns} ${join} AND r.id>$3 ORDER BY r.id ASC LIMIT $4`,
    [tenantId, clientId, cursor, limit + 1]));
  const countResult = await safeQuery('mapped_count', () => db.query(`SELECT count(*)::int AS mapped_records ${join}`, [tenantId, clientId]));
  const childJoin = (table) => `FROM ${table} c JOIN ${spec.table} r ON r.id=c.${spec.key} AND r.tenant_id=$1
    JOIN ${spec.mappings} m ON m.${spec.key}=r.id AND m.tenant_id=$1 AND m.client_id=$2 WHERE c.tenant_id=$1`;
  const rangeParams = bounds.start ? [tenantId, clientId, bounds.start, bounds.end] : [tenantId, clientId];
  const rangeFilter = (column) => bounds.start ? ` AND c.${column} >= $3::timestamptz AND c.${column} < $4::timestamptz` : '';
  const queryStatus = {
    roots: rootsResult,
    mapped_count: countResult,
  };
  let summary, recent;
  if (name === 'search-intel') {
    const totalsResult = await safeQuery('search_totals', () => db.query(`SELECT count(*)::int AS runs,
      count(*) FILTER (WHERE c.error IS NULL)::int AS successful_runs,
      count(*) FILTER (WHERE c.error IS NULL AND c.brand_mentioned)::int AS brand_mentions
      ${childJoin('search_intel_llm_runs')}${rangeFilter('ran_at')}`, rangeParams));
    queryStatus.search_totals = totalsResult;
    const runsResult = await safeQuery('recent_runs', () => db.query(`SELECT c.id,c.query_id,c.provider,c.brand_mentioned,c.brand_position,c.ran_at,
      (c.error IS NOT NULL) AS failed ${childJoin('search_intel_llm_runs')}${rangeFilter('ran_at')}
      ORDER BY c.ran_at DESC,c.id DESC LIMIT 50`, rangeParams));
    queryStatus.recent_runs = runsResult;
    const mappedRecords = countResult.ok ? countResult.rows[0]?.mapped_records ?? 0 : 0;
    const totals = totalsResult.ok ? totalsResult.rows[0] : { runs: null, successful_runs: null, brand_mentions: null };
    summary = { mapped_records: mappedRecords, ...totals };
    recent = { llm_runs: runsResult.ok ? runsResult.rows : [] };
  } else {
    const perfJoin = `${childJoin('ad_performance_hourly')}${rangeFilter('bucket_hour')}`;
    const totalsResult = await safeQuery('campaign_totals', () => db.query(`SELECT r.currency,count(*)::int AS performance_rows,
      sum(c.spend) AS spend,sum(c.impressions) AS impressions,sum(c.clicks) AS clicks,
      sum(c.conversions) AS conversions,sum(c.revenue) AS revenue ${perfJoin}
      GROUP BY r.currency ORDER BY r.currency`, rangeParams));
    queryStatus.campaign_totals = totalsResult;
    const performanceResult = await safeQuery('recent_performance', () => db.query(`SELECT c.id,c.campaign_id,r.currency,c.bucket_hour,c.spend,c.impressions,
      c.clicks,c.conversions,c.revenue ${perfJoin}
      ORDER BY c.bucket_hour DESC,c.id DESC LIMIT 50`, rangeParams));
    queryStatus.recent_performance = performanceResult;
    const actionJoin = `${childJoin('optimizer_actions')}${rangeFilter('created_at')}`;
    const actionsResult = await safeQuery('recent_actions', () => db.query(`SELECT c.id,c.campaign_id,c.action_type,c.applied,c.created_at ${actionJoin}
      ORDER BY c.created_at DESC,c.id DESC LIMIT 50`, rangeParams));
    queryStatus.recent_actions = actionsResult;
    const mappedRecords = countResult.ok ? countResult.rows[0]?.mapped_records ?? 0 : 0;
    summary = {
      mapped_records: mappedRecords,
      by_currency: totalsResult.ok ? totalsResult.rows : [],
    };
    recent = {
      performance: performanceResult.ok ? performanceResult.rows : [],
      optimizer_actions: actionsResult.ok ? actionsResult.rows : [],
    };
  }
  const metric_meta = buildMetricMeta(name, summary, queryStatus);
  if (!rootsResult.ok || !countResult.ok) {
    throw Object.assign(new Error('source_query_failed'), { status: 500 });
  }
  const totalsKey = name === 'search-intel' ? 'search_totals' : 'campaign_totals';
  if (!queryStatus[totalsKey]?.ok) {
    throw Object.assign(new Error('source_query_failed'), { status: 500 });
  }
  const scope = dateRange?.startDate
    ? `mapped_records_in_period:${dateRange.startDate}:${dateRange.endDate}`
    : 'all_mapped_records';
  return { source: name, ...page(rootsResult.rows, limit), summary, metric_meta, recent, recent_limit: 50,
    summary_scope: scope, excluded_sections: spec.excluded, period: dateRange || null, query_status: queryStatus };
}

module.exports = { source, candidates, data };
