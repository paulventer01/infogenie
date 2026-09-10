'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const express = require('express');
const { installMailCapture } = require('./helpers/mail');
const client = { id: 11, name: 'ALPINE', status: 'active' };
const profile = { version: 2, report_source: 'search-intel', default_format: 'pdf', report_title: 'Saved report', branding_mode: 'custom', branding_overrides: { agencyName: 'Agency' } };
const data = () => ({ source: 'search-intel', records: [{ id: 1, query: 'ALPINE', brand: 'Brand', locale: 'en' }], summary: { mapped_records: 1, runs: 3, successful_runs: 2, brand_mentions: 1 }, recent: { llm_runs: [] } });
async function fixture(t, options = {}) {
  const mail = installMailCapture();
  t.after(mail.restore);
  const calls = [], streams = [], recipients = [], current = { profile: { ...profile }, data: data(), recipient: 'client@example.com', ...options };
  let released = 0;
  const connection = { query: async (sql, params) => {
    calls.push([sql, params]);
    if (sql.includes('FROM clients')) return { rows: current.absent ? [] : [client] };
    if (sql.includes('FROM client_reporting_profiles')) return { rows: current.profile ? [current.profile] : [] };
    if (sql.includes('FROM weekly_report_subs')) {
      recipients.push(params);
      return { rows: current.recipient ? [{ email: current.recipient }] : [] };
    }
    if (sql.includes('FROM kv_store')) return { rows: [] };
    if (sql === 'SELECT 1 FROM weekly_report_subs LIMIT 0') return { rows: [] };
    return { rows: [] };
  }, release: () => released++ };
  const filename = path.join(__dirname, '../services/client_reporting/api.js'), native = createRequire(filename), module = { exports: {} };
  const overrides = {
    '../../db': { hasDb: () => true, getPool: () => ({ connect: async () => connection, query: (...args) => connection.query(...args) }) },
    '../tenants/context': { resolveTenantId: async () => (current.tenantMismatch ? 999 : 101) },
    '../tenants/permission_enforce': { hasPermission: () => !current.denied },
    './sources': { source: (name) => { assert.equal(name, current.profile.report_source); return {}; }, data: async () => current.data },
    './report': { buildReport: require('../services/client_reporting/report').buildReport,
      streamReport: async (snapshot, res) => { streams.push(snapshot); res.type('application/pdf').end('%PDF-test'); } },
    './delivery': options.realDelivery ? require('../services/client_reporting/delivery') : {
      clientRecipient: async (_pool, tenantId, brand) => { recipients.push([tenantId, brand]); return current.recipient; },
      bufferReport: async (snapshot) => ({ buffer: Buffer.from('%PDF-test'), filename: 'client-11-report.pdf', contentType: 'application/pdf', snapshot }),
      sendReportEmail: async (payload) => {
        if (current.mailFail) throw Object.assign(new Error('mail failed'), { code: 'mail_failed', status: 502 });
        if (current.mailMissing) throw Object.assign(new Error('missing key'), { code: 'mail_unconfigured' });
        current.sent = payload; return { id: 'mail-1' };
      },
    },
  };
  new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))((name) => overrides[name] || native(name), module, module.exports);
  const app = express();
  app.use(express.json({ verify: (req, _res, raw) => { req.rawBody = raw.toString(); } }));
  app.use((req, _res, next) => { Object.assign(req, { user: { id: 7 }, tenant: { id: 101, status: 'active' }, tenantMemberships: [{ tenantId: 101 }] }); next(); });
  app.use('/api/client-reporting', module.exports);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  async function request(method = 'GET', suffix = 'report-recipient', body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/client-reporting/clients/11/${suffix}`, {
      method, headers: { 'Content-Type': 'application/json', Connection: 'close' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
    return { status: response.status, headers: response.headers, body: json };
  }
  return { current, calls, streams, recipients, request, released: () => released, mail };
}
test('recipient lookup and confirmed email reuse saved snapshot and weekly report subscription', async (t) => {
  const fx = await fixture(t);
  const recipient = await fx.request();
  assert.equal(recipient.status, 200);
  assert.equal(recipient.body.recipient.email, 'client@example.com');
  assert.equal(recipient.body.recipient.source, 'weekly_report_sub');
  assert.equal(recipient.body.recipient.brand, 'ALPINE');
  const sent = await fx.request('POST', 'report-email', { expected_version: 2, confirm: true });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.sent, true);
  assert.equal(fx.current.sent.to, 'client@example.com');
  assert.equal(fx.current.sent.filename, 'client-11-report.pdf');
  assert.deepEqual(fx.recipients.at(-1), [101, 'ALPINE']);
});
test('confirmation, stale profile, missing mappings and missing recipient fail closed', async (t) => {
  const fx = await fixture(t);
  for (const body of [{}, { expected_version: 2 }, { confirm: true }, { expected_version: 2, confirm: false }, { expected_version: 2, confirm: true, extra: true }])
    assert.equal((await fx.request('POST', 'report-email', body)).status, 400);
  assert.equal((await fx.request('POST', 'report-email', { expected_version: 1, confirm: true })).body.error, 'version_conflict');
  fx.current.data.summary.mapped_records = 0; fx.current.data.records = [];
  assert.equal((await fx.request('POST', 'report-email', { expected_version: 2, confirm: true })).body.error, 'no_mapped_records');
  fx.current.data = data(); fx.current.recipient = null;
  assert.equal((await fx.request()).body.error, 'no_recipient');
  assert.equal((await fx.request('POST', 'report-email', { expected_version: 2, confirm: true })).body.error, 'no_recipient');
});
test('wrong tenant context is rejected before recipient lookup', async (t) => {
  const fx = await fixture(t);
  fx.current.tenantMismatch = true;
  assert.equal((await fx.request()).status, 403);
  assert.equal((await fx.request('POST', 'report-email', { expected_version: 2, confirm: true })).status, 403);
  assert.equal(fx.recipients.length, 0);
});
test('permission denial and foreign client precede recipient lookup and mail', async (t) => {
  const fx = await fixture(t);
  fx.current.denied = true;
  assert.equal((await fx.request()).status, 403);
  fx.current.denied = false; fx.current.absent = true;
  assert.equal((await fx.request()).status, 404);
  assert.equal(fx.recipients.length, 0);
  assert.equal(fx.streams.length, 0);
});
test('mail failures surface without pretending success', async (t) => {
  const fx = await fixture(t);
  fx.current.mailFail = true;
  assert.equal((await fx.request('POST', 'report-email', { expected_version: 2, confirm: true })).body.error, 'mail_failed');
  fx.current.mailFail = false; fx.current.mailMissing = true;
  assert.equal((await fx.request('POST', 'report-email', { expected_version: 2, confirm: true })).body.error, 'mail_unconfigured');
});
