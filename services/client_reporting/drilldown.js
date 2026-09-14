'use strict';

const { sqlBounds } = require('./period');
const metrics = require('./metrics');
const { resolveDateRange } = require('./snapshot');
const sources = require('./sources');

const { SEARCH_SCALAR, CAMPAIGN_SCALAR, LIST_METRICS, isDrillable, unsupportedReason } = metrics;

function fail(status, code) { return Object.assign(new Error(code), { status }); }

function validateCurrency(value) {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) throw fail(400, 'invalid_currency');
  return value;
}

function searchFilter(metricKey) {
  if (metricKey === 'successful_runs') return ' AND c.error IS NULL';
  if (metricKey === 'brand_mentions') return ' AND c.error IS NULL AND c.brand_mentioned';
  return '';
}

function metricValueColumn(metricKey) {
  const map = {
    performance_rows: null,
    spend: 'c.spend',
    impressions: 'c.impressions',
    clicks: 'c.clicks',
    conversions: 'c.conversions',
    revenue: 'c.revenue',
  };
  return map[metricKey] ?? null;
}

function searchColumns() {
  return [
    { key: 'id', label: 'Run ID' },
    { key: 'query_id', label: 'Query ID' },
    { key: 'query', label: 'Query' },
    { key: 'provider', label: 'Provider' },
    { key: 'brand_mentioned', label: 'Brand mentioned' },
    { key: 'brand_position', label: 'Position' },
    { key: 'failed', label: 'Failed' },
    { key: 'ran_at', label: 'Recorded at' },
  ];
}

function campaignColumns(metricKey) {
  const base = [
    { key: 'id', label: 'Row ID' },
    { key: 'campaign_id', label: 'Campaign ID' },
    { key: 'campaign_name', label: 'Campaign' },
    { key: 'currency', label: 'Currency' },
    { key: 'bucket_hour', label: 'Recorded at' },
  ];
  const value = metricValueColumn(metricKey);
  if (metricKey === 'performance_rows') {
    return [...base,
      { key: 'spend', label: 'Spend' },
      { key: 'impressions', label: 'Impressions' },
      { key: 'clicks', label: 'Clicks' },
      { key: 'conversions', label: 'Conversions' },
      { key: 'revenue', label: 'Revenue' },
    ];
  }
  const label = metrics.labelFor('campaigns', metricKey);
  return [...base, { key: metricKey, label }];
}

async function loadProfile(db, tenantId, clientId) {
  const { rows } = await db.query(`SELECT report_source, selected_metrics, reporting_period, reporting_timezone
    FROM client_reporting_profiles WHERE tenant_id=$1 AND client_id=$2`, [tenantId, clientId]);
  if (!rows[0]) throw fail(409, 'profile_required');
  return rows[0];
}

function resolveMetricContext(profile, metricKey, customRange) {
  const source = profile.report_source;
  const reason = unsupportedReason(source, metricKey);
  if (reason) throw fail(400, reason === 'invalid_metric' ? 'invalid_metric' : 'metric_not_drillable');
  const selected = metrics.resolveSelection(source, profile.selected_metrics);
  if (!selected.includes(metricKey)) throw fail(400, 'metric_not_selected');
  const dateRange = resolveDateRange(profile, customRange);
  return { source, dateRange, selected };
}

async function fetchSearchRecords(db, spec, tenantId, clientId, metricKey, dateRange, cursor, limit) {
  const bounds = sqlBounds(dateRange);
  const rangeParams = bounds.start ? [tenantId, clientId, bounds.start, bounds.end] : [tenantId, clientId];
  const rangeFilter = bounds.start ? ' AND c.ran_at >= $3::timestamptz AND c.ran_at < $4::timestamptz' : '';
  const childJoin = `FROM search_intel_llm_runs c
    JOIN ${spec.table} r ON r.id=c.query_id AND r.tenant_id=$1
    JOIN ${spec.mappings} m ON m.${spec.key}=r.id AND m.tenant_id=$1 AND m.client_id=$2
    WHERE c.tenant_id=$1${searchFilter(metricKey)}${rangeFilter}`;
  const count = await db.query(`SELECT count(*)::int AS total ${childJoin}`, rangeParams);
  const rows = await db.query(`SELECT c.id,c.query_id,r.query AS query,c.provider,c.brand_mentioned,c.brand_position,
    (c.error IS NOT NULL) AS failed,c.ran_at ${childJoin} AND c.id>$${rangeParams.length + 1}
    ORDER BY c.id ASC LIMIT $${rangeParams.length + 2}`,
  [...rangeParams, cursor, limit + 1]);
  const records = rows.rows.slice(0, limit).map((row) => ({
    id: row.id,
    query_id: row.query_id,
    query: row.query,
    provider: row.provider,
    brand_mentioned: row.brand_mentioned,
    brand_position: row.brand_position,
    failed: row.failed,
    ran_at: row.ran_at,
  }));
  const hasMore = rows.rows.length > limit;
  return { total_count: count.rows[0].total, records, has_more: hasMore, next_cursor: hasMore ? records.at(-1).id : null,
    columns: searchColumns() };
}

async function fetchCampaignRecords(db, spec, tenantId, clientId, metricKey, currency, dateRange, cursor, limit) {
  const bounds = sqlBounds(dateRange);
  const rangeParams = bounds.start ? [tenantId, clientId, currency, bounds.start, bounds.end] : [tenantId, clientId, currency];
  const rangeFilter = bounds.start ? ' AND c.bucket_hour >= $4::timestamptz AND c.bucket_hour < $5::timestamptz' : '';
  const childJoin = `FROM ad_performance_hourly c
    JOIN ${spec.table} r ON r.id=c.campaign_id AND r.tenant_id=$1
    JOIN ${spec.mappings} m ON m.${spec.key}=r.id AND m.tenant_id=$1 AND m.client_id=$2
    WHERE c.tenant_id=$1 AND r.currency=$3${rangeFilter}`;
  const count = await db.query(`SELECT count(*)::int AS total ${childJoin}`, rangeParams);
  const valueSql = metricKey === 'performance_rows'
    ? 'c.spend,c.impressions,c.clicks,c.conversions,c.revenue'
    : `${metricValueColumn(metricKey)} AS ${metricKey}`;
  const rows = await db.query(`SELECT c.id,c.campaign_id,r.name AS campaign_name,r.currency,c.bucket_hour,${valueSql}
    ${childJoin} AND c.id>$${rangeParams.length + 1} ORDER BY c.id ASC LIMIT $${rangeParams.length + 2}`,
  [...rangeParams, cursor, limit + 1]);
  const records = rows.rows.slice(0, limit).map((row) => {
    const out = {
      id: row.id,
      campaign_id: row.campaign_id,
      campaign_name: row.campaign_name,
      currency: row.currency,
      bucket_hour: row.bucket_hour,
    };
    if (metricKey === 'performance_rows') {
      out.spend = row.spend;
      out.impressions = row.impressions;
      out.clicks = row.clicks;
      out.conversions = row.conversions;
      out.revenue = row.revenue;
    } else out[metricKey] = row[metricKey];
    return out;
  });
  const hasMore = rows.rows.length > limit;
  return { total_count: count.rows[0].total, records, has_more: hasMore, next_cursor: hasMore ? records.at(-1).id : null,
    columns: campaignColumns(metricKey) };
}

async function fetchDrilldown(db, tenantId, clientId, metricKey, { cursor = 0, limit = 50, currency = null, customRange = null } = {}) {
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > 2147483647) throw fail(400, 'invalid_pagination');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw fail(400, 'invalid_pagination');
  const profile = await loadProfile(db, tenantId, clientId);
  const { source, dateRange } = resolveMetricContext(profile, metricKey, customRange);
  const spec = sources.source(source);
  let payload;
  if (source === 'search-intel') {
    if (currency) throw fail(400, 'invalid_currency');
    payload = await fetchSearchRecords(db, spec, tenantId, clientId, metricKey, dateRange, cursor, limit);
  } else {
    payload = await fetchCampaignRecords(db, spec, tenantId, clientId, metricKey, validateCurrency(currency),
      dateRange, cursor, limit);
  }
  return {
    ok: true,
    metric: metricKey,
    metric_label: metrics.labelFor(source, metricKey),
    source,
    currency: source === 'campaigns' ? validateCurrency(currency) : null,
    period: {
      key: dateRange.periodKey || profile.reporting_period || 'all_time',
      label: dateRange.label || 'All-time recorded data',
      start_date: dateRange.startDate,
      end_date: dateRange.endDate,
      timezone: dateRange.timezone || profile.reporting_timezone || 'UTC',
    },
    live_notice: 'Contributing records are read from live mapped data and may differ from the preview snapshot.',
    total_count: payload.total_count,
    page_count: payload.records.length,
    records: payload.records,
    columns: payload.columns,
    has_more: payload.has_more,
    next_cursor: payload.next_cursor,
  };
}

module.exports = {
  SEARCH_SCALAR, CAMPAIGN_SCALAR, LIST_METRICS, isDrillable, unsupportedReason,
  fetchDrilldown, resolveMetricContext, loadProfile,
};
