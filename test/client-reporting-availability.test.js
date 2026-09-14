'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const express = require('express');
const metrics = require('../services/client_reporting/metrics');
const availability = require('../services/client_reporting/availability');
const { buildReport } = require('../services/client_reporting/report');
const { AVAILABILITY, REASON } = require('../services/canonical_metrics/availability');

const client = { id: 11, name: 'Client A', slug: 'client-a', website: null, status: 'active' };
const profile = { version: 1, report_title: 'T', default_format: 'pdf' };

test('formatDisplayValue covers verified zero, unavailable, partial, proxy and combined labels', () => {
  assert.equal(availability.formatDisplayValue(availability.availableMeta(0)), '0');
  assert.equal(
    availability.formatDisplayValue(availability.unavailableMeta(REASON.SOURCE_QUERY_FAILED)),
    'Unavailable (source query failed)',
  );
  assert.match(
    availability.formatDisplayValue(availability.partialMeta(12, REASON.INPUT_PARTIAL)),
    /^12 · Partial \(input partial\)$/,
  );
  assert.match(
    availability.formatDisplayValue(availability.partialMeta(12, REASON.INPUT_PARTIAL, { is_proxy: true })),
    /^12 · Proxy · Partial \(input partial\)$/,
  );
  assert.equal(availability.formatDisplayValue(availability.missingMeta()), 'Unavailable (not configured)');
});

test('missing metric metadata is treated as unverified unavailable in buildReport output', () => {
  const data = {
    source: 'search-intel',
    records: [],
    summary: { mapped_records: 1, runs: 0, successful_runs: 0, brand_mentions: 0 },
    recent: { llm_runs: [] },
    summary_scope: 'all_mapped_records',
  };
  const out = buildReport(client, profile, data, null, ['runs'], null);
  const totals = out.report.sections.find((section) => section.title === 'Search totals');
  assert.ok(totals);
  assert.match(String(totals.rows[0][1]), /Unavailable \(not configured\)/);
  assert.equal(totals.row_meta[0].value, null);
  assert.equal(totals.row_meta[0].availability, AVAILABILITY.UNAVAILABLE);
});

test('source failure cannot produce verified-zero scalar rows', () => {
  const summary = { mapped_records: 2, runs: 0, successful_runs: 0, brand_mentions: 0 };
  const metric_meta = availability.buildMetricMeta('search-intel', summary, {
    mapped_count: { ok: true, rows: [{ mapped_records: 2 }] },
    search_totals: { ok: false, reason: `${REASON.SOURCE_QUERY_FAILED}:search_totals` },
  });
  const data = {
    source: 'search-intel',
    records: [],
    summary,
    metric_meta,
    recent: { llm_runs: [] },
    summary_scope: 'all_mapped_records',
  };
  const out = buildReport(client, profile, data, null, ['runs'], null);
  const totals = out.report.sections.find((section) => section.title === 'Search totals');
  assert.match(String(totals.rows[0][1]), /Unavailable \(source query failed/);
  assert.notEqual(totals.rows[0][1], '0');
  assert.equal(totals.row_meta[0].value, null);
});

test('buildReport preserves numeric row_meta and formatted labels for campaigns', () => {
  const metric_meta = availability.buildMetricMeta('campaigns', {
    mapped_records: 1,
    by_currency: [{ currency: 'USD', performance_rows: 1, spend: 10, impressions: 2, clicks: 1, conversions: 0, revenue: 0 }],
  }, {
    mapped_count: { ok: true },
    campaign_totals: { ok: true, partial: true, partialReason: REASON.INPUT_PARTIAL, is_proxy: true, proxyMetrics: new Set(['revenue']) },
  });
  metric_meta['USD:revenue'] = availability.partialMeta(4.5, REASON.INPUT_PARTIAL, { is_proxy: true });
  const data = {
    source: 'campaigns',
    records: [],
    summary: { mapped_records: 1, by_currency: [{ currency: 'USD', performance_rows: 1, spend: 10, impressions: 2, clicks: 1, conversions: 0, revenue: 4.5 }] },
    metric_meta,
    recent: { performance: [], optimizer_actions: [] },
    summary_scope: 'all_mapped_records',
  };
  const out = buildReport(client, profile, data, null, ['spend', 'revenue'], null);
  const totals = out.report.sections.find((section) => section.title === 'Currency totals');
  assert.deepEqual(totals.rows.map((row) => row[1]), ['Spend', 'Revenue']);
  assert.equal(totals.row_meta[0].value, 10);
  assert.equal(totals.row_meta[0].availability, AVAILABILITY.PARTIAL);
  assert.equal(totals.row_meta[1].is_proxy, true);
  assert.match(String(totals.rows[1][2]), /Proxy · Partial/);
});

test('buildReportEmailBody includes metric labels without external send', () => {
  const snapshot = buildReport(client, profile, {
    source: 'search-intel',
    records: [],
    summary: { mapped_records: 1, runs: 0, successful_runs: 0, brand_mentions: 0 },
    metric_meta: availability.buildMetricMeta('search-intel', { mapped_records: 1, runs: 0, successful_runs: 0, brand_mentions: 0 }, {
      mapped_count: { ok: true },
      search_totals: { ok: true },
    }),
    recent: { llm_runs: [] },
    summary_scope: 'all_mapped_records',
  }, null, ['runs'], null);
  snapshot.profile_version = 3;
  snapshot.format = 'pdf';
  const { text, html } = availability.buildReportEmailBody(snapshot);
  assert.match(text, /Runs: 0/);
  assert.match(html, /Runs: 0/);
  assert.match(text, /profile \(version 3\)/);
});

test('report email route captures payload with metric summary lines', async (t) => {
  const searchMetrics = metrics.defaultKeys('search-intel');
  const current = {
    profile: { version: 2, report_source: 'search-intel', default_format: 'pdf', report_title: 'Saved report',
      branding_mode: 'custom', branding_overrides: {}, selected_metrics: searchMetrics,
      reporting_period: 'last_30_days', reporting_timezone: 'UTC' },
    recipient: 'client@example.com',
    data: {
      source: 'search-intel',
      records: [{ id: 1, query: 'ALPINE', brand: 'Brand', locale: 'en' }],
      summary: { mapped_records: 1, runs: 0, successful_runs: 0, brand_mentions: 0 },
      metric_meta: availability.buildMetricMeta('search-intel', { mapped_records: 1, runs: 0, successful_runs: 0, brand_mentions: 0 }, {
        mapped_count: { ok: true },
        search_totals: { ok: true },
      }),
      recent: { llm_runs: [] },
    },
  };
  let sent = null;
  const connection = { query: async (sql) => {
    if (sql.includes('FROM clients')) return { rows: [client] };
    if (sql.includes('FROM client_reporting_profiles')) return { rows: [current.profile] };
    if (sql.includes('FROM client_reporting_recipients')) return { rows: [{ email: current.recipient }] };
    return { rows: [] };
  }, release: () => {} };
  const filename = path.join(__dirname, '../services/client_reporting/api.js');
  const native = createRequire(filename);
  const module = { exports: {} };
  new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))((name) => ({
    '../../db': { hasDb: () => true, getPool: () => ({ connect: async () => connection, query: (...args) => connection.query(...args) }) },
    '../tenants/context': { resolveTenantId: async () => 101 },
    '../tenants/permission_enforce': { hasPermission: () => true },
    '../admin/audit': { recordAudit: async () => ({ ok: true, id: 1 }) },
    './sources': { source: () => ({}), data: async () => current.data },
    './report': require('../services/client_reporting/report'),
    './snapshot': {
      buildReportSnapshot: async () => {
        const built = buildReport(client, current.profile, current.data, null,
          metrics.resolveSelection(current.profile.report_source, current.profile.selected_metrics), null);
        return { snapshot: built, profile: current.profile, client };
      },
    },
    './delivery': {
      clientRecipient: async () => current.recipient,
      bufferReport: async () => ({ buffer: Buffer.from('%PDF-test'), filename: 'client-11-report.pdf', contentType: 'application/pdf' }),
      sendReportEmail: async (payload) => { sent = payload; return { id: 'mail-1' }; },
    },
  }[name] || native(name)), module, module.exports);
  const app = express();
  app.use(express.json({ verify: (req, _res, raw) => { req.rawBody = raw.toString(); } }));
  app.use((req, _res, next) => { Object.assign(req, { user: { id: 7, email: 'owner@example.com' }, tenant: { id: 101, status: 'active' }, tenantMemberships: [{ tenantId: 101 }] }); next(); });
  app.use('/api/client-reporting', module.exports);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/client-reporting/clients/11/report-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expected_version: 2, confirm: true }),
  });
  assert.equal(response.status, 200);
  assert.ok(sent);
  assert.match(sent.text, /Runs: 0/);
  assert.match(sent.html, /Runs: 0/);
  assert.equal(sent.to, 'client@example.com');
});

test('clientReportingAvailability TS helpers stay aligned with server labels', () => {
  const libPath = path.join(__dirname, '../lib/clientReportingAvailability.ts');
  const source = fs.readFileSync(libPath, 'utf8');
  assert.match(source, /formatClientReportValue/);
  assert.match(source, /Unavailable/);
  assert.match(source, /Partial/);
});
