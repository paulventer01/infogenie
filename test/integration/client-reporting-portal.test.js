'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const dedicatedUrl = process.env.PR10F1_TEST_DATABASE_URL;
const required = process.env.PR10F1_REQUIRE_DATABASE === '1';

function portalCookie(setCookieArray) {
  for (const c of setCookieArray || []) {
    const m = /^(infogenie\.crp=[^;]+)/.exec(c);
    if (m) return m[1];
  }
  return null;
}

test('Client reporting portal: tenant isolation, token lifecycle and unauthenticated denial', {
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
  const portalApi = '/api/client-reporting/portal';
  async function call(actor, method, path, body, status = 200, extra = {}) {
    const response = await request(app.baseUrl, method, path, {
      cookie: actor?.cookie, body, headers: { Origin: app.baseUrl, ...extra.headers },
    });
    assert.equal(response.status, status, `${method} ${path}: ${response.text}`);
    return response;
  }
  async function actor(tenant) {
    const user = await fx.seedUser({ tenantId: tenant.id, roleKey: 'tenant_owner' });
    const session = await login(app.baseUrl, user.email, user.password);
    return { cookie: session.cookie, tid: tenant.id, uid: user.id };
  }
  const ta = await fx.seedTenant('Portal A'), tb = await fx.seedTenant('Portal B');
  const a = await actor(ta), b = await actor(tb);
  const ca = (await db.getPool().query('INSERT INTO clients (tenant_id,name) VALUES ($1,$2) RETURNING id', [ta.id, 'A'])).rows[0].id;
  const cb = (await db.getPool().query('INSERT INTO clients (tenant_id,name) VALUES ($1,$2) RETURNING id', [tb.id, 'B'])).rows[0].id;
  const profile = (id) => `${prefix}/${id}/profile`;
  const portalPath = (id) => `${prefix}/${id}/portal`;
  const invitePath = (id) => `${prefix}/${id}/portal/invitations`;
  const revokePath = (id) => `${prefix}/${id}/portal/revoke`;
  for (const [actorRow, clientId] of [[a, ca], [b, cb]]) {
    await call(actorRow, 'PUT', profile(clientId), { report_source: 'search-intel', default_format: 'pdf', report_title: 'Report', branding_mode: 'workspace', branding_overrides: {},
      selected_metrics: ['runs', 'successful_runs', 'brand_mentions', 'mapped_queries', 'recent_search_runs'],
      reporting_period: 'last_30_days', reporting_timezone: 'UTC', expected_version: 0 });
  }
  const unauth = await request(app.baseUrl, 'GET', `${portalApi}/report`);
  assert.equal(unauth.status, 401);
  assert.equal(unauth.json.error, 'portal_auth_required');
  assert.equal((await call(a, 'GET', portalPath(cb), undefined, 404)).json.error, 'client_not_found');
  const csrf = await request(app.baseUrl, 'POST', invitePath(ca), { cookie: a.cookie, headers: {}, body: {} });
  assert.equal(csrf.json.error, 'csrf_rejected');
  const invite = await call(a, 'POST', invitePath(ca), {}, 201);
  assert.match(invite.json.invite_path, /^\/client-report\/invite\/[a-f0-9]{64}$/);
  const rawToken = invite.json.invite_path.split('/').pop();
  const redeem = await request(app.baseUrl, 'POST', `${portalApi}/redeem/${rawToken}`, { body: {} });
  assert.equal(redeem.status, 200);
  const portalCookieValue = portalCookie(redeem.cookies);
  assert.ok(portalCookieValue);
  const report = await request(app.baseUrl, 'GET', `${portalApi}/report`, { cookie: portalCookieValue });
  assert.equal(report.status, 200);
  assert.equal(report.json.client.id, ca);
  assert.equal(report.json.report.title, 'Report');
  const replay = await request(app.baseUrl, 'POST', `${portalApi}/redeem/${rawToken}`, { body: {} });
  assert.equal(replay.status, 403);
  assert.equal(replay.json.error, 'invitation_redeemed');
  await db.getPool().query(`UPDATE client_reporting_portal_invitations SET expires_at=now() - interval '1 minute'
    WHERE tenant_id=$1 AND client_id=$2 AND redeemed_at IS NULL`, [ta.id, ca]);
  const invite2 = await call(a, 'POST', invitePath(ca), {}, 201);
  const expiredToken = invite2.json.invite_path.split('/').pop();
  await db.getPool().query(`UPDATE client_reporting_portal_invitations SET expires_at=now() - interval '1 minute' WHERE token_hash=$1`,
    [require('../../services/client_reporting/portal').hashToken(expiredToken)]);
  const expired = await request(app.baseUrl, 'POST', `${portalApi}/redeem/${expiredToken}`, { body: {} });
  assert.equal(expired.status, 403);
  assert.equal(expired.json.error, 'invitation_expired');
  await call(a, 'POST', revokePath(ca), {});
  const revoked = await request(app.baseUrl, 'GET', `${portalApi}/report`, { cookie: portalCookieValue });
  assert.equal(revoked.status, 403);
  assert.equal(revoked.json.error, 'portal_revoked');
  const inviteB = await call(b, 'POST', invitePath(cb), {}, 201);
  const tokenB = inviteB.json.invite_path.split('/').pop();
  const redeemB = await request(app.baseUrl, 'POST', `${portalApi}/redeem/${tokenB}`, { body: {} });
  const cookieB = portalCookie(redeemB.cookies);
  const cross = await request(app.baseUrl, 'GET', `${portalApi}/report`, { cookie: cookieB });
  assert.equal(cross.json.client.id, cb);
  assert.notEqual(cross.json.client.id, ca);
});
