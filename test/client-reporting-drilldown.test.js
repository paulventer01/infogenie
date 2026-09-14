'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const express = require('express');
const metrics = require('../services/client_reporting/metrics');
const drilldown = require('../services/client_reporting/drilldown');
const { buildReport } = require('../services/client_reporting/report');
const period = require('../services/client_reporting/period');

const ROOT = path.join(__dirname, '..');
const PREFIX = '/api/client-reporting';
const PERMISSION = 'tenant.settings.manage';
const client = { id: 11, name: 'Client A', slug: 'client-a', website: null, status: 'active' };

function allTimeContext(version = 1) {
  return `profile_version=${version}&reporting_period=all_time&timezone=UTC`;
}

function load(relative, overrides = {}) {
  const filename = path.join(ROOT, relative), module = { exports: {} }, native = createRequire(filename);
  new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))(
    (name) => Object.hasOwn(overrides, name) ? overrides[name] : native(name), module, module.exports);
  return module.exports;
}

function principal(extra = {}) {
  return { user: { id: 7 }, tenant: { id: 101, status: 'active' },
    tenantMemberships: [{ tenantId: 101 }], can: (key) => key === PERMISSION, ...extra };
}

async function fixture(t, { actor = principal(), query = async () => ({ rows: [] }), resolved, hasDb = true } = {}) {
  const calls = [], resolutions = [];
  let releases = 0;
  const pool = { query: async (sql, params) => { calls.push({ sql, params }); return query(sql, params); },
    connect: async () => ({ query: pool.query, release: () => { releases++; } }) };
  const enforce = load('services/tenants/permission_enforce.js', { '../security/prod_defaults': { permissionMode: () => 'on' } });
  const router = load('services/client_reporting/api.js', {
    '../../db': { hasDb: () => hasDb, getPool: () => pool },
    '../tenants/context': { resolveTenantId: async (req) => { resolutions.push(req.tenant.id); return resolved ?? req.tenant.id; } },
    '../tenants/permission_enforce': enforce,
  });
  const app = express();
  app.use(express.json({ verify: (req, _res, buffer) => { req.rawBody = buffer.toString('utf8'); } }));
  app.use((req, _res, next) => { Object.assign(req, typeof actor === 'function' ? actor(req) : actor); next(); });
  app.use(enforce.enforceMatrix);
  app.use(PREFIX, router);
  const server = await new Promise((resolve) => { const started = app.listen(0, '127.0.0.1', () => resolve(started)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  async function request(method, pathname) {
    const response = await fetch('http://127.0.0.1:' + server.address().port + PREFIX + pathname, {
      method, headers: { Connection: 'close' },
    });
    return { status: response.status, body: await response.json() };
  }
  return { request, calls, resolutions, releases: () => releases };
}

test('metric catalog marks scalar metrics drillable and list metrics unsupported', () => {
  const search = metrics.catalog('search-intel');
  assert.equal(search.find((entry) => entry.key === 'runs').drillable, true);
  assert.equal(search.find((entry) => entry.key === 'mapped_queries').drillable, false);
  assert.equal(search.find((entry) => entry.key === 'mapped_queries').drilldown_unsupported_reason, 'list_metric');
  const campaigns = metrics.catalog('campaigns');
  assert.equal(campaigns.find((entry) => entry.key === 'spend').drillable, true);
  assert.equal(campaigns.find((entry) => entry.key === 'recent_performance').drilldown_unsupported_reason, 'list_metric');
});

test('buildReport attaches drilldown metadata to scalar total rows only', () => {
  const data = { source: 'search-intel', records: [], summary: { mapped_records: 1, runs: 5, successful_runs: 4, brand_mentions: 2 },
    recent: { llm_runs: [] }, summary_scope: 'all_mapped_records' };
  const out = buildReport(client, { version: 1, report_title: 'T', default_format: 'pdf' }, data, null, ['runs'], null);
  const totals = out.report.sections.find((section) => section.title === 'Search totals');
  assert.deepEqual(totals.drilldown_rows, [{ metric_key: 'runs', currency: null, drillable: true }]);
  const campaigns = { source: 'campaigns', records: [], summary: { mapped_records: 1,
    by_currency: [{ currency: 'USD', spend: 1, impressions: 2, clicks: 3, conversions: 0, revenue: 0, performance_rows: 1 }] },
    recent: { performance: [], optimizer_actions: [] }, summary_scope: 'all_mapped_records' };
  const campaignOut = buildReport(client, { version: 1, report_title: 'T', default_format: 'pdf' }, campaigns, null,
    ['spend'], null);
  const currency = campaignOut.report.sections.find((section) => section.title === 'Currency totals');
  assert.deepEqual(currency.drilldown_rows, [{ metric_key: 'spend', currency: 'USD', drillable: true }]);
});

test('parseDrilldownQuery requires pinned report context and accepts dated portal params', () => {
  const allTime = drilldown.parseDrilldownQuery({
    profile_version: '2', reporting_period: 'all_time', timezone: 'UTC', cursor: '0', limit: '25',
  });
  assert.equal(allTime.profileVersion, 2);
  assert.equal(allTime.dateRange.periodKey, 'all_time');
  assert.equal(allTime.dateRange.startDate, null);
  const dated = drilldown.parseDrilldownQuery({
    profile_version: '2', reporting_period: 'custom', timezone: 'America/New_York',
    start_date: '2026-03-01', end_date: '2026-03-10',
  });
  assert.equal(dated.dateRange.startDate, '2026-03-01');
  assert.equal(dated.dateRange.endDate, '2026-03-10');
  assert.throws(() => drilldown.parseDrilldownQuery({ profile_version: '1', reporting_period: 'all_time', timezone: 'UTC',
    start_date: '2026-03-01', end_date: '2026-03-10' }), (error) => error.message === 'invalid_drilldown');
  assert.throws(() => drilldown.parseDrilldownQuery({ reporting_period: 'all_time', timezone: 'UTC' }),
    (error) => error.message === 'invalid_drilldown');
});

test('drilldown route rejects invalid pagination, unknown metrics and list metrics', async (t) => {
  const profile = { version: 1, report_source: 'search-intel', selected_metrics: ['runs', 'mapped_queries'],
    reporting_period: 'all_time', reporting_timezone: 'UTC' };
  const { request } = await fixture(t, {
    query: async (sql) => {
      if (sql.includes('FROM clients')) return { rows: [client] };
      if (sql.includes('FROM client_reporting_profiles')) return { rows: [profile] };
      return { rows: [] };
    },
  });
  const ctx = allTimeContext();
  assert.equal((await request('GET', `/clients/11/metric-drilldown/runs?limit=101&${ctx}`)).status, 400);
  assert.equal((await request('GET', `/clients/11/metric-drilldown/not_real?${ctx}`)).body.error, 'invalid_metric');
  assert.equal((await request('GET', `/clients/11/metric-drilldown/mapped_queries?${ctx}`)).body.error, 'metric_not_drillable');
  assert.equal((await request('GET', '/clients/11/metric-drilldown/runs')).body.error, 'invalid_drilldown');
});

test('drilldown route requires campaign currency, selected metric and rejects stale profile context', async (t) => {
  const profile = { version: 2, report_source: 'campaigns', selected_metrics: ['spend'],
    reporting_period: 'all_time', reporting_timezone: 'UTC' };
  const { request } = await fixture(t, {
    query: async (sql) => {
      if (sql.includes('FROM clients')) return { rows: [client] };
      if (sql.includes('FROM client_reporting_profiles')) return { rows: [profile] };
      return { rows: [] };
    },
  });
  const ctx = allTimeContext(1);
  assert.equal((await request('GET', `/clients/11/metric-drilldown/spend?${ctx}`)).body.error, 'report_context_stale');
  const current = allTimeContext(2);
  assert.equal((await request('GET', `/clients/11/metric-drilldown/spend?${current}`)).body.error, 'invalid_currency');
  assert.equal((await request('GET', `/clients/11/metric-drilldown/clicks?currency=USD&${current}`)).body.error, 'metric_not_selected');
});

test('fetchDrilldown returns stable ordering metadata and live notice', async () => {
  const profile = { version: 1, report_source: 'search-intel', selected_metrics: ['runs'],
    reporting_period: 'all_time', reporting_timezone: 'UTC' };
  const dateRange = drilldown.resolvePinnedDateRange('all_time', 'UTC', null);
  const calls = [];
  const db = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('count(*)::int AS total')) return { rows: [{ total: 2 }] };
    if (sql.includes('ORDER BY c.id ASC')) {
      return { rows: [{ id: 10, query_id: 1, query: 'q', provider: 'fixture', brand_mentioned: true,
        brand_position: 1, failed: false, ran_at: '2026-03-01T00:00:00.000Z' }] };
    }
    if (sql.includes('FROM client_reporting_profiles')) return { rows: [profile] };
    return { rows: [] };
  } };
  const result = await drilldown.fetchDrilldown(db, 101, 11, 'runs', {
    cursor: 0, limit: 1, profileVersion: 1, dateRange,
  });
  assert.equal(result.ok, true);
  assert.equal(result.total_count, 2);
  assert.equal(result.page_count, 1);
  assert.equal(result.records[0].id, 10);
  assert.match(result.live_notice, /live mapped data/i);
  assert.match(calls.find((entry) => entry.sql.includes('ORDER BY c.id ASC')).sql, /ORDER BY c\.id ASC/);
  assert.doesNotMatch(calls.find((entry) => entry.sql.includes('ORDER BY c.id ASC')).sql, /AS runs/);
});

test('fetchDrilldown enforces selected metric and pinned date range without live recalculation', async () => {
  const profile = { version: 3, report_source: 'search-intel', selected_metrics: ['runs'],
    reporting_period: 'last_7_days', reporting_timezone: 'UTC' };
  const pinnedDates = { startDate: '2026-03-01', endDate: '2026-03-10' };
  const dateRange = drilldown.resolvePinnedDateRange('custom', 'UTC', pinnedDates);
  const db = { query: async (sql) => {
    if (sql.includes('count(*)::int AS total')) return { rows: [{ total: 0 }] };
    if (sql.includes('FROM client_reporting_profiles')) return { rows: [profile] };
    return { rows: [] };
  } };
  const result = await drilldown.fetchDrilldown(db, 101, 11, 'runs', {
    cursor: 0, limit: 50, profileVersion: 3, dateRange,
  });
  assert.equal(result.period.start_date, '2026-03-01');
  assert.equal(result.period.end_date, '2026-03-10');
  const rolled = period.resolveRelative('last_7_days', 'UTC', new Date('2026-06-01T12:00:00.000Z'));
  assert.notEqual(rolled.startDate, '2026-03-01');
  await assert.rejects(() => drilldown.fetchDrilldown(db, 101, 11, 'brand_mentions', {
    cursor: 0, limit: 50, profileVersion: 3, dateRange,
  }), (error) => error.message === 'metric_not_selected');
  await assert.rejects(() => drilldown.fetchDrilldown(db, 101, 11, 'runs', {
    cursor: 0, limit: 50, profileVersion: 2, dateRange,
  }), (error) => error.message === 'report_context_stale');
});
