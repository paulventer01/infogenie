'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const dedicatedUrl = process.env.PR10F1_TEST_DATABASE_URL;
const required = process.env.PR10F1_REQUIRE_DATABASE === '1';

test('Client reporting recipients: tenant isolation and CSRF', {
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
    return { cookie: session.cookie, tid: tenant.id };
  }
  const ta = await fx.seedTenant('Recipient A'), tb = await fx.seedTenant('Recipient B');
  const a = await actor(ta), b = await actor(tb);
  const ca = (await db.getPool().query('INSERT INTO clients (tenant_id,name) VALUES ($1,$2) RETURNING id', [ta.id, 'A'])).rows[0].id;
  const cb = (await db.getPool().query('INSERT INTO clients (tenant_id,name) VALUES ($1,$2) RETURNING id', [tb.id, 'B'])).rows[0].id;
  const recipientPath = (id) => `${prefix}/${id}/recipient`;
  await call(a, 'PUT', recipientPath(ca), { email: 'a@example.com', enabled: true });
  await call(b, 'PUT', recipientPath(cb), { email: 'b@example.com', enabled: true });
  assert.equal((await call(a, 'GET', recipientPath(ca))).recipient.email, 'a@example.com');
  assert.equal((await call(b, 'GET', recipientPath(cb))).recipient.email, 'b@example.com');
  assert.equal((await call(a, 'GET', recipientPath(cb), undefined, 404)).error, 'client_not_found');
  const denied = await request(app.baseUrl, 'PUT', recipientPath(ca), { cookie: b.cookie, headers: { Origin: app.baseUrl }, body: { email: 'evil@example.com', enabled: true } });
  assert.equal(denied.status, 404);
  const csrf = await request(app.baseUrl, 'PUT', recipientPath(ca), { cookie: a.cookie, headers: {}, body: { email: 'a@example.com', enabled: true } });
  assert.equal(csrf.json.error, 'csrf_rejected');
});
