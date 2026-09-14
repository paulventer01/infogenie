'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const dedicatedUrl = process.env.PR10F1_TEST_DATABASE_URL;
const required = process.env.PR10F1_REQUIRE_DATABASE === '1';

test('Client reporting schedules: tenant isolation, CSRF and idempotent claims', {
  skip: !dedicatedUrl && !required ? 'no PR10F1_TEST_DATABASE_URL' : false,
  timeout: 120_000,
}, async (t) => {
  assert.ok(dedicatedUrl);
  const environment = { DATABASE_URL: dedicatedUrl, NODE_ENV: 'test',
    PERMISSION_ENFORCEMENT: 'on', MULTITENANT_ENFORCEMENT: 'on', SECURITY_CSRF: 'on' };
  const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  require('../helpers/env');
  let app, db, fx;
  const ports = new Set([Number(new URL(dedicatedUrl).port || 5432)]);
  const connect = net.Socket.prototype.connect;
  t.mock.method(net.Socket.prototype, 'connect', function (...args) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const options = first && typeof first === 'object' ? first : { port: first, host: args[1] };
    if (options.path || !['localhost', '127.0.0.1', '::1'].includes(options.host || 'localhost') || !ports.has(Number(options.port)))
      throw new Error('blocked outbound socket');
    return connect.apply(this, args);
  });
  t.after(async () => {
    if (app) await app.close();
    if (fx) {
      if (fx.created.userIds.length) await db.getPool().query(
        "DELETE FROM user_sessions WHERE sess->>'userId'=ANY($1::text[])", [fx.created.userIds.map(String)]);
      await fx.cleanup();
    }
    if (db) await db.getPool().end();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  db = require('../../db');
  fx = require('../helpers/fixtures').makeFixtures();
  await db.ensureSchema();
  await fx.ensureSchemas();
  await require('../../services/client_reporting/schema').ensureClientReportingSchema();
  const { bootApp, request, login } = require('../helpers');
  app = await bootApp();
  ports.add(app.port);
  const prefix = '/api/client-reporting/clients';
  async function call(actor, method, path, body, status = 200) {
    const response = await request(app.baseUrl, method, path, { cookie: actor?.cookie, body, headers: { Origin: app.baseUrl } });
    assert.equal(response.status, status, `${method} ${path}: ${response.text}`);
    return response.json;
  }
  async function actor(tenant) {
    const user = await fx.seedUser({ tenantId: tenant.id, roleKey: 'tenant_owner' });
    const session = await login(app.baseUrl, user.email, user.password);
    return { cookie: session.cookie, tid: tenant.id, uid: user.id };
  }
  const ta = await fx.seedTenant('Schedule A'), tb = await fx.seedTenant('Schedule B');
  const a = await actor(ta), b = await actor(tb);
  const ca = (await db.getPool().query('INSERT INTO clients (tenant_id,name) VALUES ($1,$2) RETURNING id', [ta.id, 'A'])).rows[0].id;
  const cb = (await db.getPool().query('INSERT INTO clients (tenant_id,name) VALUES ($1,$2) RETURNING id', [tb.id, 'B'])).rows[0].id;
  const profile = (id) => `${prefix}/${id}/profile`;
  const recipient = (id) => `${prefix}/${id}/recipient`;
  const schedulePath = (id) => `${prefix}/${id}/schedule`;
  const historyPath = (id) => `${prefix}/${id}/delivery-history`;
  for (const [actorRow, clientId] of [[a, ca], [b, cb]]) {
    await call(actorRow, 'PUT', profile(clientId), { report_source: 'search-intel', default_format: 'pdf', report_title: 'Report', branding_mode: 'workspace', branding_overrides: {},
      selected_metrics: ['runs', 'successful_runs', 'brand_mentions', 'mapped_queries', 'recent_search_runs'],
      reporting_period: 'last_30_days', reporting_timezone: 'UTC', expected_version: 0 });
    await call(actorRow, 'PUT', recipient(clientId), { email: `${clientId}@example.com`, enabled: true });
    await call(actorRow, 'PUT', schedulePath(clientId), { cadence: 'weekly', timezone: 'UTC', send_time: '09:00', format: 'pdf', opt_in: true });
  }
  assert.equal((await call(a, 'GET', schedulePath(ca))).schedule.cadence, 'weekly');
  assert.equal((await call(b, 'GET', schedulePath(cb))).schedule.cadence, 'weekly');
  assert.equal((await call(a, 'GET', schedulePath(cb), undefined, 404)).error, 'client_not_found');
  const csrf = await request(app.baseUrl, 'PUT', schedulePath(ca), { cookie: a.cookie, headers: {}, body: { cadence: 'weekly', timezone: 'UTC', send_time: '09:00', format: 'pdf', opt_in: true } });
  assert.equal(csrf.json.error, 'csrf_rejected');
  await call(a, 'POST', `${schedulePath(ca)}/pause`, {});
  assert.equal((await call(a, 'GET', schedulePath(ca))).schedule.paused, true);
  await call(a, 'POST', `${schedulePath(ca)}/resume`, {});
  assert.equal((await call(a, 'GET', schedulePath(ca))).schedule.paused, false);
  await db.getPool().query(`INSERT INTO client_reporting_schedule_claims (tenant_id, client_id, window_key) VALUES ($1,$2,$3)`,
    [ta.id, ca, 'weekly:2026-W10']);
  const dup = await db.getPool().query(`INSERT INTO client_reporting_schedule_claims (tenant_id, client_id, window_key) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING window_key`,
    [ta.id, ca, 'weekly:2026-W10']);
  assert.equal(dup.rows.length, 0);
  await db.getPool().query(`INSERT INTO client_reporting_delivery_history (tenant_id, client_id, window_key, status, recipient_email, profile_version, format)
    VALUES ($1,$2,$3,'sent',$4,1,'pdf')`, [ta.id, ca, 'weekly:2026-W09', 'a@example.com']);
  const history = await call(a, 'GET', historyPath(ca));
  assert.equal(history.deliveries.length, 1);
  assert.equal(history.deliveries[0].status, 'sent');
});
