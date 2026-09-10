'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const express = require('express');
const schedule = require('../services/client_reporting/schedule');

const client = { id: 11, name: 'ALPINE', status: 'active' };
const scheduleRow = {
  client_id: 11, cadence: 'weekly', timezone: 'UTC', send_time: '09:00', format: 'pdf',
  opted_in: true, paused: false, next_due_at: '2026-01-01T09:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
};

async function fixture(t, options = {}) {
  const audits = [], current = { schedule: { ...scheduleRow }, absent: false, denied: false, tenantMismatch: false, profile: true, recipient: true, ...options };
  const connection = { query: async (sql, params) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('FROM clients')) return { rows: current.absent ? [] : [client] };
    if (sql.includes('client_reporting_profiles')) return { rows: current.profile ? [{ version: 2 }] : [] };
    if (sql.includes('client_reporting_recipients') && sql.includes('enabled')) return { rows: current.recipient ? [{ enabled: true }] : [] };
    if (sql.includes('client_reporting_schedules') && sql.includes('INSERT')) {
      return { rows: [{ ...current.schedule, cadence: params[2], timezone: params[3], send_time: params[4], format: params[5], updated_at: '2026-01-02T00:00:00.000Z' }] };
    }
    if (sql.includes('client_reporting_schedules') && sql.includes('UPDATE')) {
      if (!current.schedule) return { rows: [] };
      return { rows: [{ ...current.schedule, paused: sql.includes('paused=true') }] };
    }
    if (sql.includes('client_reporting_schedules')) return { rows: current.schedule ? [current.schedule] : [] };
    if (sql.includes('client_reporting_delivery_history')) return { rows: current.history || [] };
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
    './snapshot': require('../services/client_reporting/snapshot'),
    './schedule': require('../services/client_reporting/schedule'),
  };
  new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))((name) => overrides[name] || native(name), module, module.exports);
  const app = express();
  app.use(express.json({ verify: (req, _res, raw) => { req.rawBody = raw.toString(); } }));
  app.use((req, _res, next) => { Object.assign(req, { user: { id: 7, email: 'owner@example.com' }, tenant: { id: 101, status: 'active' }, tenantMemberships: [{ tenantId: 101 }] }); next(); });
  app.use('/api/client-reporting', module.exports);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  async function request(method = 'GET', suffix = 'schedule', body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/client-reporting/clients/11/${suffix}`, {
      method, headers: { 'Content-Type': 'application/json', Connection: 'close' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }
  return { current, audits, request };
}

test('schedule helpers validate timezone and compute window keys', () => {
  assert.equal(schedule.validTimezone('UTC'), true);
  assert.equal(schedule.validTimezone('Not/AZone'), false);
  assert.match(schedule.windowKey('weekly', new Date('2026-03-10T12:00:00Z'), 'UTC'), /^weekly:/);
  assert.match(schedule.windowKey('monthly', new Date('2026-03-10T12:00:00Z'), 'UTC'), /^monthly:2026-03$/);
  const next = schedule.computeNextDueAt('weekly', 'UTC', '09:00', new Date('2026-01-01T10:00:00Z'));
  assert.ok(next instanceof Date && next > new Date('2026-01-01T10:00:00Z'));
});

test('schedule read/write requires explicit opt-in and audits changes', async (t) => {
  const fx = await fixture(t);
  const read = await fx.request();
  assert.equal(read.status, 200);
  assert.equal(read.body.schedule.cadence, 'weekly');
  const saved = await fx.request('PUT', 'schedule', { cadence: 'monthly', timezone: 'UTC', send_time: '10:30', format: 'pdf', opt_in: true });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.schedule.cadence, 'monthly');
  assert.equal(fx.audits.at(-1).action, 'client_reporting.schedule_update');
});

test('invalid schedule payloads and missing prerequisites fail closed', async (t) => {
  const fx = await fixture(t);
  for (const body of [{}, { cadence: 'weekly' }, { cadence: 'daily', timezone: 'UTC', send_time: '09:00', format: 'pdf', opt_in: true },
    { cadence: 'weekly', timezone: 'UTC', send_time: '09:00', format: 'pdf', opt_in: false }])
    assert.equal((await fx.request('PUT', 'schedule', body)).status, 400);
  fx.current.profile = false;
  assert.equal((await fx.request('PUT', 'schedule', { cadence: 'weekly', timezone: 'UTC', send_time: '09:00', format: 'pdf', opt_in: true })).body.error, 'profile_required');
  fx.current.profile = true; fx.current.recipient = false;
  assert.equal((await fx.request('PUT', 'schedule', { cadence: 'weekly', timezone: 'UTC', send_time: '09:00', format: 'pdf', opt_in: true })).body.error, 'no_recipient');
});

test('pause and resume are audited and require configured schedule', async (t) => {
  const fx = await fixture(t);
  const paused = await fx.request('POST', 'schedule/pause', {});
  assert.equal(paused.status, 200);
  assert.equal(fx.audits.at(-1).action, 'client_reporting.schedule_pause');
  const resumed = await fx.request('POST', 'schedule/resume', {});
  assert.equal(resumed.status, 200);
  assert.equal(fx.audits.at(-1).action, 'client_reporting.schedule_resume');
  fx.current.schedule = null;
  assert.equal((await fx.request('POST', 'schedule/pause', {})).status, 404);
});

test('delivery history returns safe fields only', async (t) => {
  const fx = await fixture(t);
  fx.current.history = [{ id: 9, window_key: 'weekly:2026-W10', status: 'sent', attempted_at: '2026-03-10T09:00:00Z',
    recipient_email: 'client@example.com', profile_version: 2, format: 'pdf', error_code: null }];
  const history = await fx.request('GET', 'delivery-history');
  assert.equal(history.status, 200);
  assert.equal(history.body.deliveries[0].status, 'sent');
  assert.equal(history.body.deliveries[0].error_code, null);
});

test('tenant mismatch and permission denial reject schedule routes', async (t) => {
  const fx = await fixture(t);
  fx.current.denied = true;
  assert.equal((await fx.request()).status, 403);
  fx.current.denied = false; fx.current.tenantMismatch = true;
  assert.equal((await fx.request()).status, 403);
});
