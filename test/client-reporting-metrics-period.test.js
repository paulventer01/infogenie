'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const express = require('express');
const metrics = require('../services/client_reporting/metrics');
const period = require('../services/client_reporting/period');
const { buildReport } = require('../services/client_reporting/report');
const ROOT = path.join(__dirname, '..');
const PREFIX = '/api/client-reporting';
const PERMISSION = 'tenant.settings.manage';
const client = { id: 11, name: 'Client A', slug: 'client-a', website: null, status: 'active' };
const campaignMetrics = metrics.defaultKeys('campaigns');
const input = { report_source: 'campaigns', default_format: 'pdf', report_title: 'Monthly report',
  branding_mode: 'workspace', branding_overrides: {}, selected_metrics: campaignMetrics,
  reporting_period: 'last_30_days', reporting_timezone: 'UTC', expected_version: 0 };

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
  async function request(method, pathname, body, headers = {}) {
    const response = await fetch('http://127.0.0.1:' + server.address().port + PREFIX + pathname, {
      method, headers: { 'Content-Type': 'application/json', Connection: 'close', ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const bodyValue = method === 'HEAD' ? null : response.headers.get('content-type')?.includes('application/json')
      ? await response.json() : await response.text();
    return { status: response.status, body: bodyValue, headers: response.headers };
  }
  return { request, calls, resolutions, releases: () => releases };
}

test('metric allowlist rejects unknown keys, duplicates and empty selections', () => {
  assert.throws(() => metrics.validateSelection('search-intel', []), /invalid_profile/);
  assert.throws(() => metrics.validateSelection('search-intel', ['runs', 'runs']), /invalid_profile/);
  assert.throws(() => metrics.validateSelection('search-intel', ['runs', 'spend']), /invalid_profile/);
  assert.deepEqual(metrics.validateSelection('search-intel', ['brand_mentions', 'runs']), ['brand_mentions', 'runs']);
  assert.deepEqual(metrics.resolveSelection('search-intel', []), metrics.defaultKeys('search-intel'));
});

test('relative periods resolve completed days and previous calendar month boundaries', () => {
  const asOf = new Date('2026-03-15T15:00:00.000Z');
  const last7 = period.resolveRelative('last_7_days', 'UTC', asOf);
  assert.equal(last7.startDate, '2026-03-08');
  assert.equal(last7.endDate, '2026-03-14');
  const last30 = period.resolveRelative('last_30_days', 'UTC', asOf);
  assert.equal(last30.startDate, '2026-02-13');
  assert.equal(last30.endDate, '2026-03-14');
  const prevMonth = period.resolveRelative('previous_calendar_month', 'UTC', asOf);
  assert.equal(prevMonth.startDate, '2026-02-01');
  assert.equal(prevMonth.endDate, '2026-02-28');
  const allTime = period.resolveRelative('all_time', 'UTC', asOf);
  assert.equal(allTime.startDate, null);
});

test('custom date validation enforces order, future end and supported lookback', () => {
  const asOf = new Date('2026-03-15T12:00:00.000Z');
  const ok = period.validateCustomRange('2026-03-01', '2026-03-10', 'UTC', asOf);
  assert.equal(ok.startDate, '2026-03-01');
  assert.equal(ok.endDate, '2026-03-10');
  assert.throws(() => period.validateCustomRange('2026-03-10', '2026-03-01', 'UTC', asOf), /invalid_report/);
  assert.throws(() => period.validateCustomRange('2026-03-01', '2026-03-16', 'UTC', asOf), /invalid_report/);
  assert.throws(() => period.validateCustomRange('2024-01-01', '2026-03-10', 'UTC', asOf), /invalid_report/);
});

test('buildReport honors selected metrics and queried period labels', () => {
  const data = { source: 'search-intel', records: [], summary: { mapped_records: 1, runs: 5, successful_runs: 4, brand_mentions: 2 },
    recent: { llm_runs: [] }, summary_scope: 'mapped_records_in_period:2026-03-01:2026-03-10' };
  const range = period.validateCustomRange('2026-03-01', '2026-03-10', 'UTC', new Date('2026-03-15T12:00:00.000Z'));
  const out = buildReport(client, { version: 1, report_title: 'T', default_format: 'pdf' }, data, null, ['runs'], range);
  const text = JSON.stringify(out.report);
  assert.match(text, /2026-03-01 to 2026-03-10/);
  assert.match(text, /"Runs"/);
  assert.doesNotMatch(text, /Successful runs/);
});

test('profile PUT persists metrics and period with version conflict on stale writes', async (t) => {
  let stale = false;
  const profile = { client_id: 11, ...input, version: 1, selected_metrics: campaignMetrics,
    reporting_period: 'last_7_days', reporting_timezone: 'Europe/London' };
  const fx = await fixture(t, { query: async (sql) => ({ rows: sql.includes('FROM clients') ? [client]
    : sql.includes('RETURNING') && !stale ? [profile] : [] }) });
  const body = { ...input, report_title: 'Metrics report', selected_metrics: ['spend', 'clicks', 'mapped_campaigns'],
    reporting_period: 'last_7_days', reporting_timezone: 'Europe/London' };
  assert.equal((await fx.request('PUT', '/clients/11/profile', body)).status, 200);
  const insert = fx.calls.find(({ sql }) => sql.includes('INSERT INTO'));
  assert.match(insert.sql, /selected_metrics/);
  assert.deepEqual(insert.params[7], JSON.stringify(body.selected_metrics));
  assert.equal(insert.params[8], 'last_7_days');
  assert.equal(insert.params[9], 'Europe/London');
  stale = true;
  assert.equal((await fx.request('PUT', '/clients/11/profile', { ...body, expected_version: 1 })).status, 409);
});

test('report preview accepts custom date query and rejects invalid ranges', async (t) => {
  const profileRow = { client_id: 11, ...input, version: 2, selected_metrics: campaignMetrics,
    reporting_period: 'last_30_days', reporting_timezone: 'UTC' };
  const data = { source: 'campaigns', records: [{ id: 1, name: 'A', platform: 'google', currency: 'USD', status: 'active' }],
    summary: { mapped_records: 1, by_currency: [{ currency: 'USD', performance_rows: 1, spend: 1, impressions: 1, clicks: 1, conversions: 0, revenue: 0 }] },
    recent: { performance: [], optimizer_actions: [] } };
  const filename = path.join(ROOT, 'services/client_reporting/api.js'), native = createRequire(filename), module = { exports: {} };
  const overrides = {
    '../../db': { hasDb: () => true, getPool: () => ({ connect: async () => ({ query: async () => ({ rows: [] }), release: () => {} }) }) },
    '../tenants/context': { resolveTenantId: async () => 101 },
    '../tenants/permission_enforce': { hasPermission: () => true },
    './snapshot': {
      buildReportSnapshot: async (_db, tenantId, clientId, expectedVersion, customRange) => {
        const range = customRange
          ? period.validateCustomRange(customRange.startDate, customRange.endDate, 'UTC', new Date('2026-03-15T12:00:00.000Z'))
          : period.resolveRelative('last_30_days', 'UTC', new Date('2026-03-15T12:00:00.000Z'));
        const snapshot = buildReport(client, profileRow, data, null, campaignMetrics, range);
        return { snapshot, profile: profileRow, client };
      },
    },
  };
  new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))((name) => overrides[name] || native(name), module, module.exports);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { Object.assign(req, principal()); next(); });
  app.use(PREFIX, module.exports);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  async function request(pathname) {
    const response = await fetch('http://127.0.0.1:' + server.address().port + PREFIX + pathname);
    return { status: response.status, body: await response.json() };
  }
  const preview = await request('/clients/11/report-preview?start_date=2026-03-01&end_date=2026-03-10');
  assert.equal(preview.status, 200);
  assert.equal(preview.body.profile_version, 2);
  assert.equal(preview.body.reporting_dates.start, '2026-03-01');
  assert.equal((await request('/clients/11/report-preview?start_date=bad&end_date=2026-03-10')).status, 400);
  assert.equal((await request('/clients/11/report-preview?start_date=2026-03-10&end_date=2026-03-01')).status, 400);
});

test('metrics catalog endpoint is read-only and source scoped', async (t) => {
  const fx = await fixture(t);
  const response = await fx.request('GET', '/sources/search-intel/metrics');
  assert.equal(response.status, 200);
  assert.equal(response.body.metrics.length, metrics.defaultKeys('search-intel').length);
  assert.equal((await fx.request('GET', '/sources/bad/metrics')).status, 400);
  assert.equal(fx.calls.length, 0);
});
