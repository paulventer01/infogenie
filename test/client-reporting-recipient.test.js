'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const express = require('express');
const client = { id: 11, name: 'ALPINE', status: 'active' };
const recipient = { client_id: 11, email: 'client@example.com', enabled: true, updated_at: '2026-01-01T00:00:00.000Z' };
async function fixture(t, options = {}) {
  const audits = [], current = { recipient: { ...recipient }, absent: false, denied: false, tenantMismatch: false, ...options };
  const connection = { query: async (sql, params) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('FROM clients')) return { rows: current.absent ? [] : [client] };
    if (sql.includes('client_reporting_recipients')) {
      if (sql.includes('INSERT INTO client_reporting_recipients')) {
        return { rows: [{ client_id: 11, email: params[2], enabled: params[3], updated_at: '2026-01-02T00:00:00.000Z' }] };
      }
      return { rows: current.recipient ? [current.recipient] : [] };
    }
    return { rows: [] };
  }, release: () => {} };
  const filename = path.join(__dirname, '../services/client_reporting/api.js'), native = createRequire(filename), module = { exports: {} };
  const overrides = {
    '../../db': { hasDb: () => true, getPool: () => ({ connect: async () => connection, query: (...args) => connection.query(...args) }) },
    '../tenants/context': { resolveTenantId: async () => (current.tenantMismatch ? 999 : 101) },
    '../tenants/permission_enforce': { hasPermission: () => !current.denied },
    '../admin/audit': { recordAudit: async (entry) => { audits.push(entry); return { ok: true, id: 1 }; } },
    './sources': require('../services/client_reporting/sources'),
    './report': require('../services/client_reporting/report'),
    './delivery': require('../services/client_reporting/delivery'),
  };
  new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))((name) => overrides[name] || native(name), module, module.exports);
  const app = express();
  app.use(express.json({ verify: (req, _res, raw) => { req.rawBody = raw.toString(); } }));
  app.use((req, _res, next) => { Object.assign(req, { user: { id: 7, email: 'owner@example.com' }, tenant: { id: 101, status: 'active' }, tenantMemberships: [{ tenantId: 101 }] }); next(); });
  app.use('/api/client-reporting', module.exports);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  async function request(method = 'GET', suffix = 'recipient', body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/client-reporting/clients/11/${suffix}`, {
      method, headers: { 'Content-Type': 'application/json', Connection: 'close' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }
  return { current, audits, request };
}
test('recipient read and write are tenant-scoped and audited', async (t) => {
  const fx = await fixture(t);
  const read = await fx.request();
  assert.equal(read.status, 200);
  assert.equal(read.body.recipient.email, 'client@example.com');
  const saved = await fx.request('PUT', 'recipient', { email: 'new@example.com', enabled: false });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.recipient.enabled, false);
  assert.equal(fx.audits.length, 1);
  assert.equal(fx.audits[0].action, 'client_reporting.recipient_update');
});
test('invalid recipient payloads and access failures reject before writes', async (t) => {
  const fx = await fixture(t);
  for (const body of [{}, { email: 'bad' }, { email: 'a@b.com' }, { enabled: true }, { email: 'a@b.com', enabled: 'yes' }])
    assert.equal((await fx.request('PUT', 'recipient', body)).status, 400);
  fx.current.denied = true;
  assert.equal((await fx.request()).status, 403);
  fx.current.denied = false; fx.current.tenantMismatch = true;
  assert.equal((await fx.request()).status, 403);
  fx.current.tenantMismatch = false; fx.current.absent = true;
  assert.equal((await fx.request()).status, 404);
});
test('foreign tenant cannot read another client recipient row', async (t) => {
  const fx = await fixture(t);
  fx.current.recipient = null;
  assert.equal((await fx.request()).body.configured, false);
  fx.current.tenantMismatch = true;
  assert.equal((await fx.request()).status, 403);
});
