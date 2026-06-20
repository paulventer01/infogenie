// test/integration/harness-canary.test.js — Smoke test for the test harness.
//
// Proves the harness itself works end-to-end before any feature wave relies on
// it: boot on an ephemeral port, both auth modes, tenant/user seeding, mail
// capture + token read, and clean teardown. Gates on DATABASE_URL like every
// other real-DB suite — when absent, only the no-DB checks run.

const { test } = require('node:test');
const assert = require('node:assert');

const harness = require('../helpers');
const { bootApp, request, login, makeFixtures, installMailCapture, hasDb } = harness;

test('harness boots on an ephemeral port and serves /api', async (t) => {
  const app = await bootApp();
  t.after(() => app.close());

  assert.match(app.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  // Unauthenticated /api request is rejected by the gate (401), proving the
  // gate is wired.
  const res = await request(app.baseUrl, 'GET', '/api/tenants/active');
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.json.error, 'auth_required');
});

test('request() returns { status, headers, json, text }', async (t) => {
  const app = await bootApp();
  t.after(() => app.close());
  const res = await request(app.baseUrl, 'GET', '/api/auth/providers');
  assert.strictEqual(typeof res.status, 'number');
  assert.ok(res.headers && typeof res.headers === 'object');
  assert.ok('json' in res && 'text' in res);
  assert.strictEqual(res.status, 200);
});

test('api-key auth path injects an owner principal + tenant', { skip: !hasDb() && 'no DATABASE_URL' }, async (t) => {
  const fx = makeFixtures();
  await fx.ensureSchemas();
  t.after(() => fx.cleanup());

  // A probe route mounted AFTER the gate so we can observe req.user/req.tenant
  // exactly as a real feature router would see them.
  const app = await bootApp({
    mount(a) {
      a.get('/api/_canary/whoami', (req, res) =>
        res.json({ ok: true, user: req.user || null, tenant: req.tenant || null }));
    },
  });
  t.after(() => app.close());

  const res = await request(app.baseUrl, 'GET', '/api/_canary/whoami', { apiKey: true });
  assert.strictEqual(res.status, 200);
  assert.ok(res.json.user, 'api-key request should carry a principal');
  assert.strictEqual(res.json.user.isOwner, true);
  assert.strictEqual(res.json.user.viaApiKey, true);
  assert.ok(res.json.tenant && res.json.tenant.id, 'api-key request should carry a default tenant');
});

test('cookie-session auth path: seed user, log in, authenticated call', { skip: !hasDb() && 'no DATABASE_URL' }, async (t) => {
  const fx = makeFixtures();
  await fx.ensureSchemas();
  t.after(() => fx.cleanup());

  const tenant = await fx.seedTenant();
  const owner = await fx.seedUser({ tenantId: tenant.id, owner: true });

  const app = await bootApp();
  t.after(() => app.close());

  const { cookie, status } = await login(app.baseUrl, owner.email, owner.password);
  assert.strictEqual(status, 200);
  assert.ok(cookie, 'login should set the infogenie.sid cookie');

  // /api/auth/me reflects the logged-in user.
  const me = await request(app.baseUrl, 'GET', '/api/auth/me', { cookie });
  assert.strictEqual(me.status, 200);
  assert.strictEqual(me.json.authenticated, true);
  assert.strictEqual(String(me.json.user.email).toLowerCase(), owner.email);

  // /api/tenants/active resolves the seeded tenant for this session.
  const active = await request(app.baseUrl, 'GET', '/api/tenants/active', { cookie });
  assert.strictEqual(active.status, 200);
  assert.strictEqual(active.json.tenant.id, tenant.id);
});

test('two isolated tenants + non-owner user can be seeded', { skip: !hasDb() && 'no DATABASE_URL' }, async (t) => {
  const fx = makeFixtures();
  await fx.ensureSchemas();
  t.after(() => fx.cleanup());

  const tA = await fx.seedTenant();
  const tB = await fx.seedTenant();
  assert.notStrictEqual(tA.id, tB.id);
  assert.notStrictEqual(tA.slug, tB.slug);

  const viewer = await fx.seedUser({ tenantId: tA.id, owner: false });
  assert.strictEqual(viewer.isOwner, false);
  assert.ok(viewer.id > 0);
});

test('mail capture intercepts auth mail and exposes the reset token', { skip: !hasDb() && 'no DATABASE_URL' }, async (t) => {
  const fx = makeFixtures();
  await fx.ensureSchemas();
  t.after(() => fx.cleanup());

  const tenant = await fx.seedTenant();
  const user = await fx.seedUser({ tenantId: tenant.id, owner: true });

  const mail = installMailCapture();
  t.after(() => mail.restore());

  const app = await bootApp();
  t.after(() => app.close());

  // request-reset is best-effort on mail; the token is always written to
  // email_tokens, and our interceptor records the (intercepted) message.
  const res = await request(app.baseUrl, 'POST', '/api/auth/request-reset', { body: { email: user.email } });
  assert.strictEqual(res.status, 200);

  // Token is readable straight from the DB regardless of mail outcome.
  const dbToken = await fx.latestEmailToken(user.id, 'reset');
  assert.ok(dbToken, 'a reset token should be persisted to email_tokens');

  // And no real mail left the process — it was captured.
  const captured = mail.latestTo(user.email);
  assert.ok(captured, 'the reset email should have been intercepted, not sent');
});

test('cleanup removes seeded rows', { skip: !hasDb() && 'no DATABASE_URL' }, async () => {
  const fx = makeFixtures();
  await fx.ensureSchemas();
  const tenant = await fx.seedTenant();
  const user = await fx.seedUser({ tenantId: tenant.id, owner: true });
  await fx.cleanup();

  const db = require('../../db');
  const u = await db.getPool().query('SELECT 1 FROM users WHERE id=$1', [user.id]);
  const tn = await db.getPool().query('SELECT 1 FROM tenants WHERE id=$1', [tenant.id]);
  assert.strictEqual(u.rowCount, 0, 'user should be deleted');
  assert.strictEqual(tn.rowCount, 0, 'tenant should be deleted');
});
