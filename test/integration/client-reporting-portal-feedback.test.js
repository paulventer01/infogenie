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

function contextQuery(profileVersion, reportingPeriod, timezone, dates) {
  const params = new URLSearchParams({
    profile_version: String(profileVersion),
    reporting_period: reportingPeriod,
    timezone,
  });
  if (dates) {
    params.set('start_date', dates.start);
    params.set('end_date', dates.end);
  }
  return params.toString();
}

test('Client reporting portal feedback: tenant isolation, CSRF, revocation and report context', {
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
  const ta = await fx.seedTenant('Feedback A'), tb = await fx.seedTenant('Feedback B');
  const a = await actor(ta), b = await actor(tb);
  const ca = (await db.getPool().query('INSERT INTO clients (tenant_id,name) VALUES ($1,$2) RETURNING id', [ta.id, 'A'])).rows[0].id;
  const cb = (await db.getPool().query('INSERT INTO clients (tenant_id,name) VALUES ($1,$2) RETURNING id', [tb.id, 'B'])).rows[0].id;
  const profilePath = (id) => `${prefix}/${id}/profile`;
  const invitePath = (id) => `${prefix}/${id}/portal/invitations`;
  const revokePath = (id) => `${prefix}/${id}/portal/revoke`;
  const adminThreads = (id) => `${prefix}/${id}/portal/feedback/threads`;
  const adminReply = (id, threadId) => `${prefix}/${id}/portal/feedback/threads/${threadId}/replies`;
  const adminResolve = (id, threadId) => `${prefix}/${id}/portal/feedback/threads/${threadId}/resolve`;
  for (const [actorRow, clientId] of [[a, ca], [b, cb]]) {
    await call(actorRow, 'PUT', profilePath(clientId), { report_source: 'search-intel', default_format: 'pdf', report_title: 'Report', branding_mode: 'workspace', branding_overrides: {},
      selected_metrics: ['runs', 'successful_runs', 'brand_mentions', 'mapped_queries', 'recent_search_runs'],
      reporting_period: 'last_30_days', reporting_timezone: 'UTC', expected_version: 0 });
  }
  const reportA = await call(a, 'GET', `${prefix}/${ca}/report-preview`);
  const dates = reportA.json.reporting_dates;
  assert.ok(dates);
  const ctx = {
    profile_version: reportA.json.profile_version,
    reporting_period: reportA.json.reporting_period,
    timezone: dates.timezone,
    start_date: dates.start,
    end_date: dates.end,
  };
  const invite = await call(a, 'POST', invitePath(ca), {}, 201);
  const rawToken = invite.json.invite_path.split('/').pop();
  const redeem = await request(app.baseUrl, 'POST', `${portalApi}/redeem/${rawToken}`, { body: {} });
  const portalCookieValue = portalCookie(redeem.cookies);
  assert.ok(portalCookieValue);
  const listPath = `${portalApi}/feedback/threads?${contextQuery(ctx.profile_version, ctx.reporting_period, ctx.timezone, dates)}`;
  const unauth = await request(app.baseUrl, 'GET', listPath);
  assert.equal(unauth.status, 401);
  const csrf = await request(app.baseUrl, 'POST', `${portalApi}/feedback/threads`, {
    cookie: portalCookieValue, body: { kind: 'comment', body: 'hello', ...ctx },
  });
  assert.equal(csrf.status, 403);
  assert.equal(csrf.json.error, 'csrf_rejected');
  const created = await request(app.baseUrl, 'POST', `${portalApi}/feedback/threads`, {
    cookie: portalCookieValue,
    headers: { Origin: app.baseUrl },
    body: { kind: 'change_request', body: 'Please update the chart title.', ...ctx },
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.thread.kind, 'change_request');
  const threadId = created.json.thread.id;
  const crossTenant = await call(b, 'GET', adminThreads(ca), undefined, 404);
  assert.equal(crossTenant.json.error, 'client_not_found');
  const agencyList = await call(a, 'GET', adminThreads(ca));
  assert.equal(agencyList.json.threads.length, 1);
  const agencyReply = await call(a, 'POST', adminReply(ca, threadId), { body: 'We will update this shortly.' });
  assert.equal(agencyReply.json.thread.messages.length, 2);
  const portalList = await request(app.baseUrl, 'GET', listPath, { cookie: portalCookieValue });
  assert.equal(portalList.json.threads[0].messages.length, 2);
  const portalReplyDenied = await request(app.baseUrl, 'POST', adminReply(ca, threadId), {
    cookie: portalCookieValue, headers: { Origin: app.baseUrl }, body: { body: 'nope' },
  });
  assert.equal(portalReplyDenied.status, 401);
  const resolved = await call(a, 'POST', adminResolve(ca, threadId), {});
  assert.equal(resolved.json.thread.status, 'resolved');
  const resolvedReply = await request(app.baseUrl, 'POST', `${portalApi}/feedback/threads/${threadId}/replies`, {
    cookie: portalCookieValue, headers: { Origin: app.baseUrl }, body: { body: 'too late' },
  });
  assert.equal(resolvedReply.status, 409);
  assert.equal(resolvedReply.json.error, 'thread_resolved');
  const doubleResolve = await call(a, 'POST', adminResolve(ca, threadId), {}, 409);
  assert.equal(doubleResolve.json.error, 'thread_resolved');
  const stale = await request(app.baseUrl, 'POST', `${portalApi}/feedback/threads`, {
    cookie: portalCookieValue,
    headers: { Origin: app.baseUrl },
    body: { kind: 'comment', body: 'stale', profile_version: 999, reporting_period: ctx.reporting_period,
      timezone: ctx.timezone, start_date: ctx.start_date, end_date: ctx.end_date },
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.error, 'report_context_stale');
  await call(a, 'POST', revokePath(ca), {});
  const revoked = await request(app.baseUrl, 'GET', listPath, { cookie: portalCookieValue });
  assert.equal(revoked.status, 403);
  assert.equal(revoked.json.error, 'portal_revoked');
  const revokedReply = await request(app.baseUrl, 'POST', `${portalApi}/feedback/threads/${threadId}/replies`, {
    cookie: portalCookieValue, headers: { Origin: app.baseUrl }, body: { body: 'after revoke' },
  });
  assert.equal(revokedReply.status, 403);
  assert.equal(revokedReply.json.error, 'portal_revoked');

  await t.test('all_time timezone: create, list, reply succeed; wrong timezone is stale', async () => {
    const tzTenant = await fx.seedTenant('AllTime TZ');
    const tzUser = await fx.seedUser({ tenantId: tzTenant.id, roleKey: 'tenant_owner' });
    const tzSession = await login(app.baseUrl, tzUser.email, tzUser.password);
    const tzActor = { cookie: tzSession.cookie, tid: tzTenant.id };
    const tzClient = (await db.getPool().query('INSERT INTO clients (tenant_id,name) VALUES ($1,$2) RETURNING id', [tzTenant.id, 'TZ'])).rows[0].id;
    await call(tzActor, 'PUT', profilePath(tzClient), {
      report_source: 'search-intel', default_format: 'pdf', report_title: 'All time', branding_mode: 'workspace', branding_overrides: {},
      selected_metrics: ['runs'], reporting_period: 'all_time', reporting_timezone: 'Africa/Johannesburg', expected_version: 0,
    });
    const preview = await call(tzActor, 'GET', `${prefix}/${tzClient}/report-preview`);
    assert.equal(preview.json.reporting_period, 'all_time');
    assert.equal(preview.json.reporting_timezone, 'Africa/Johannesburg');
    assert.equal(preview.json.reporting_dates, null);
    const tzCtx = {
      profile_version: preview.json.profile_version,
      reporting_period: 'all_time',
      timezone: 'Africa/Johannesburg',
    };
    const tzInvite = await call(tzActor, 'POST', invitePath(tzClient), {}, 201);
    const tzRedeem = await request(app.baseUrl, 'POST', `${portalApi}/redeem/${tzInvite.json.invite_path.split('/').pop()}`, { body: {} });
    const tzPortalCookie = portalCookie(tzRedeem.cookies);
    const tzListPath = `${portalApi}/feedback/threads?${contextQuery(tzCtx.profile_version, tzCtx.reporting_period, tzCtx.timezone)}`;
    const tzCreated = await request(app.baseUrl, 'POST', `${portalApi}/feedback/threads`, {
      cookie: tzPortalCookie, headers: { Origin: app.baseUrl },
      body: { kind: 'comment', body: 'All-time note', ...tzCtx },
    });
    assert.equal(tzCreated.status, 201);
    const tzThreadId = tzCreated.json.thread.id;
    const tzListed = await request(app.baseUrl, 'GET', tzListPath, { cookie: tzPortalCookie });
    assert.equal(tzListed.status, 200);
    assert.equal(tzListed.json.threads.length, 1);
    const tzReplied = await request(app.baseUrl, 'POST', `${portalApi}/feedback/threads/${tzThreadId}/replies`, {
      cookie: tzPortalCookie, headers: { Origin: app.baseUrl }, body: { body: 'Client follow-up' },
    });
    assert.equal(tzReplied.status, 200);
    assert.equal(tzReplied.json.thread.messages.length, 2);
    const tzStale = await request(app.baseUrl, 'POST', `${portalApi}/feedback/threads`, {
      cookie: tzPortalCookie, headers: { Origin: app.baseUrl },
      body: { kind: 'comment', body: 'wrong tz', profile_version: tzCtx.profile_version, reporting_period: 'all_time', timezone: 'UTC' },
    });
    assert.equal(tzStale.status, 409);
    assert.equal(tzStale.json.error, 'report_context_stale');
  });
});
