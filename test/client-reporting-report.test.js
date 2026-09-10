'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const express = require('express');
const { buildReport } = require('../services/client_reporting/report');
const client = { id: 11, name: 'ALPINE', status: 'active' };
const profile = { version: 2, report_source: 'search-intel', default_format: 'pdf', report_title: 'Saved report', branding_mode: 'custom', branding_overrides: { agencyName: 'Agency' } };
const data = () => ({ source: 'search-intel', records: [{ id: 1, query: 'ALPINE', brand: 'Brand', locale: 'en' }], summary: { mapped_records: 1, runs: 3, successful_runs: 2, brand_mentions: 1 }, recent: { llm_runs: [] } });
async function fixture(t, options = {}) {
  const calls = [], streams = [], mappings = [], current = { profile: { ...profile }, data: data(), ...options };
  let released = 0;
  const connection = { query: async (sql, params) => {
    calls.push([sql, params]);
    if (sql.includes('FROM clients')) return { rows: current.absent ? [] : [client] };
    if (sql.includes('FROM client_reporting_profiles')) return { rows: current.profile ? [current.profile] : [] };
    if (sql.includes('FROM kv_store')) return { rows: [{ value: { enabled: true, agencyName: 'Workspace', logoDataUrl: 'secret' } }] };
    return { rows: [] };
  }, release: () => released++ };
  const filename = path.join(__dirname, '../services/client_reporting/api.js'), native = createRequire(filename), module = { exports: {} };
  const overrides = {
    '../../db': { hasDb: () => true, getPool: () => ({ connect: async () => connection }) },
    '../tenants/context': { resolveTenantId: async () => 101 },
    '../tenants/permission_enforce': { hasPermission: () => !current.denied },
    './sources': { source: (name) => { assert.equal(name, current.profile.report_source); return {}; }, data: async (...args) => { mappings.push(args); return current.data; } },
    './report': options.realRenderer ? require('../services/client_reporting/report') : { buildReport, streamReport: async (snapshot, res) => { streams.push(snapshot); res.type('application/pdf').send('binary'); } },
  };
  new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))((name) => overrides[name] || native(name), module, module.exports);
  const app = express();
  app.use(express.json({ verify: (req, _res, raw) => { req.rawBody = raw.toString(); } }));
  app.use((req, _res, next) => { Object.assign(req, { user: { id: 7 }, tenant: { id: 101, status: 'active' }, tenantMemberships: [{ tenantId: 101 }] }); next(); });
  app.use('/api/client-reporting', module.exports);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  async function request(method = 'GET', suffix = 'report-preview', body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/client-reporting/clients/11/${suffix}`, {
      method, headers: { 'Content-Type': 'application/json', Connection: 'close' }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    return { status: response.status, headers: response.headers, body: response.headers.get('content-type').includes('application/json') ? await response.json() : options.realRenderer ? Buffer.from(await response.arrayBuffer()) : await response.text() };
  }
  return { current, calls, streams, mappings, request, released: () => released };
}
test('preview and generation use saved profile and fresh scoped snapshot with connection release', async (t) => {
  const fx = await fixture(t);
  const preview = await fx.request();
  assert.equal(preview.status, 200); assert.equal(preview.headers.get('cache-control'), 'no-store');
  assert.equal(preview.body.profile_version, 2); assert.equal(preview.body.can_generate, true);
  assert.equal(preview.body.report.title, 'Saved report'); assert.equal(fx.streams.length, 0);
  assert.equal(fx.calls[0][0], 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.deepEqual(fx.calls[1][1], [101, 11]); assert.deepEqual(fx.calls[2][1], [101, 11]);
  assert.deepEqual(fx.mappings[0].slice(3), [101, 11, 0, 100]);
  fx.current.data.records[0].query = 'FRESH';
  assert.equal((await fx.request('POST', 'report', { expected_version: 2 })).status, 200);
  assert.match(JSON.stringify(fx.streams[0]), /FRESH/); assert.equal(fx.released(), 2);
  assert.equal(fx.calls.filter(([sql]) => sql === 'COMMIT').length, 2);
});
test('missing profile, stale version, missing mappings and foreign client fail closed without rendering', async (t) => {
  const fx = await fixture(t);
  assert.equal((await fx.request('POST', 'report', { expected_version: 1 })).body.error, 'version_conflict');
  fx.current.profile = null;
  assert.equal((await fx.request()).body.error, 'profile_required');
  fx.current.profile = profile; fx.current.data.summary.mapped_records = 0; fx.current.data.records = [];
  assert.equal((await fx.request()).body.can_generate, false);
  assert.equal((await fx.request('POST', 'report', { expected_version: 2 })).body.error, 'no_mapped_records');
  fx.current.absent = true;
  assert.equal((await fx.request()).status, 404);
  assert.equal(fx.streams.length, 0); assert.equal(fx.released(), 5);
  assert.equal(fx.calls.filter(([sql]) => sql === 'ROLLBACK').length, 4);
});
test('strict request shape, byte cap and permission denial precede data access', async (t) => {
  const fx = await fixture(t);
  for (const body of [null, [], {}, { expected_version: '2' }, { expected_version: 0 }, { expected_version: 2, format: 'xlsx' }, { expected_version: 2, source: 'campaigns' }])
    assert.equal((await fx.request('POST', 'report', body)).status, 400);
  assert.equal((await fx.request('POST', 'report', ' '.repeat(8192) + '{"expected_version":2}')).status, 413);
  assert.equal((await fx.request('GET', 'report-preview?source=campaigns')).status, 400);
  assert.equal((await fx.request('POST', 'report?format=pdf', { expected_version: 2 })).status, 400);
  fx.current.denied = true; assert.equal((await fx.request()).status, 403);
  assert.equal(fx.calls.length, 0);
});
test('workspace brand loads only scoped singleton inside snapshot and omits assets', async (t) => {
  const fx = await fixture(t, { profile: { ...profile, branding_mode: 'workspace' } });
  const result = await fx.request();
  assert.deepEqual(result.body.brand, { agencyName: 'Workspace' });
  assert.deepEqual(fx.calls.find(([sql]) => sql.includes('kv_store'))[1], ['white_label.brand_profile:t101']);
});
test('report bounds tables and primitive cells, keeps scope notices and currencies separate', () => {
  const d = { source: 'campaigns', records: Array.from({ length: 110 }, (_, id) => ({ id, name: '=SUM(A1)\u0000', currency: 'USD' })),
    summary: { mapped_records: 110, by_currency: [{ currency: 'USD', spend: '12.50' }, { currency: 'ZAR', spend: '20.00' }] },
    recent: { performance: [{ spend: { formula: '1+1' }, bucket_hour: new Date('2026-01-01') }], optimizer_actions: [] } };
  const out = buildReport(client, { ...profile, branding_overrides: { agencyName: { formula: '1+1' }, primaryColor: 'red', logoDataUrl: 'secret', footerText: 'Footer' } }, d);
  assert.deepEqual(out.brand, { footerText: 'Footer' });
  assert.ok(out.report.sections.every((s) => s.kind === 'table' && s.rows.length <= 20 && s.rows.every((r) => r.every((v) => ['string', 'number'].includes(typeof v)))));
  const text = JSON.stringify(out.report);
  assert.match(text, /All-time recorded data/); assert.match(text, /Unmapped records/); assert.match(text, /maximum 100/);
  assert.match(text, /USD.*spend.*12.50/); assert.match(text, /ZAR.*spend.*20.00/); assert.doesNotMatch(text, /formula|secret|\\u0000/);
  assert.equal(out.report.sections.filter((s) => s.title.startsWith('Mapped campaigns')).flatMap((s) => s.rows).length, 100);
});

test('real renderers produce binary documents through the report route', async (t) => {
  const fx = await fixture(t, { realRenderer: true });
  for (const [format, mime, signature] of [['pdf', 'application/pdf', '%PDF-'], ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'PK'], ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'PK']]) {
    fx.current.profile.default_format = format;
    const response = await fx.request('POST', 'report', { expected_version: 2 });
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), mime);
    assert.ok(response.body.length > 500, `${format}: ${response.body.length} bytes`);
    assert.equal(response.body.subarray(0, signature.length).toString(), signature);
  }
});
