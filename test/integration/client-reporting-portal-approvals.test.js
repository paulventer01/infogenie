'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { randomUUID } = require('node:crypto');
const dedicatedUrl = process.env.PR10F1_TEST_DATABASE_URL;
const required = process.env.PR10F1_REQUIRE_DATABASE === '1';

function portalCookie(setCookieArray) {
  for (const c of setCookieArray || []) {
    const m = /^(infogenie\.crp=[^;]+)/.exec(c);
    if (m) return m[1];
  }
  return null;
}

test('Client reporting portal approvals: snapshot immutability, lifecycle, isolation and CSRF', {
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
  await require('../../services/client_reporting/schema').ensureClientReportingMappingSchema();
  await require('../../services/search_intel/schema').ensureSearchIntelSchema();
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
  const ta = await fx.seedTenant('Approval A'), tb = await fx.seedTenant('Approval B');
  const a = await actor(ta), b = await actor(tb);
  const ca = (await db.getPool().query('INSERT INTO clients (tenant_id,name) VALUES ($1,$2) RETURNING id', [ta.id, 'A'])).rows[0].id;
  const cb = (await db.getPool().query('INSERT INTO clients (tenant_id,name) VALUES ($1,$2) RETURNING id', [tb.id, 'B'])).rows[0].id;
  const profilePath = (id) => `${prefix}/${id}/profile`;
  const invitePath = (id) => `${prefix}/${id}/portal/invitations`;
  const revokePath = (id) => `${prefix}/${id}/portal/revoke`;
  const approvalsPath = (id) => `${prefix}/${id}/approval-requests`;
  const withdrawPath = (id, requestId) => `${prefix}/${id}/approval-requests/${requestId}/withdraw`;
  for (const [actorRow, clientId] of [[a, ca], [b, cb]]) {
    await call(actorRow, 'PUT', profilePath(clientId), { report_source: 'search-intel', default_format: 'pdf', report_title: 'Report', branding_mode: 'workspace', branding_overrides: {},
      selected_metrics: ['runs', 'successful_runs', 'brand_mentions', 'mapped_queries', 'recent_search_runs'],
      reporting_period: 'last_30_days', reporting_timezone: 'UTC', expected_version: 0 });
    const queryId = (await db.getPool().query('INSERT INTO search_intel_queries (tenant_id,query,brand) VALUES ($1,$2,$3) RETURNING id',
      [actorRow.tid, `approval-${clientId}`, 'Brand'])).rows[0].id;
    await db.getPool().query(`INSERT INTO client_reporting_query_mappings (tenant_id,query_id,client_id,mapping_id,created_by_user_id)
      VALUES ($1,$2,$3,$4,$5)`, [actorRow.tid, queryId, clientId, randomUUID(), actorRow.uid]);
  }
  const previewA = await call(a, 'GET', `${prefix}/${ca}/report-preview`);
  const version = previewA.json.profile_version;
  const invite = await call(a, 'POST', invitePath(ca), {}, 201);
  const rawToken = invite.json.invite_path.split('/').pop();
  const redeem = await request(app.baseUrl, 'POST', `${portalApi}/redeem/${rawToken}`, { body: {} });
  const portalCookieValue = portalCookie(redeem.cookies);
  assert.ok(portalCookieValue);
  const submitted = await call(a, 'POST', approvalsPath(ca), { expected_version: version }, 201);
  const requestId = submitted.json.request.id;
  const snapshotHash = submitted.json.request.snapshot.content_hash;
  const snapshotPayload = submitted.json.request.snapshot_payload;
  assert.ok(snapshotPayload);
  assert.equal(submitted.json.request.status, 'pending');
  const duplicate = await call(a, 'POST', approvalsPath(ca), { expected_version: version }, 409);
  assert.equal(duplicate.json.error, 'approval_pending');
  const portalPending = await request(app.baseUrl, 'GET', `${portalApi}/approval-requests/pending`, { cookie: portalCookieValue });
  assert.equal(portalPending.status, 200, portalPending.text);
  assert.ok(portalPending.json?.pending, `expected pending approval: ${portalPending.text}`);
  assert.equal(portalPending.json.pending.id, requestId);
  const portalReport = await request(app.baseUrl, 'GET', `${portalApi}/report`, { cookie: portalCookieValue });
  assert.equal(portalReport.json.report.title, snapshotPayload.report.title);
  assert.equal(portalReport.json.profile_version, snapshotPayload.profile_version);
  const csrfApprove = await request(app.baseUrl, 'POST', `${portalApi}/approval-requests/${requestId}/approve`, {
    cookie: portalCookieValue, body: { confirm: true },
  });
  assert.equal(csrfApprove.status, 403);
  assert.equal(csrfApprove.json.error, 'csrf_rejected');
  const crossTenant = await call(b, 'GET', `${prefix}/${ca}/approval-requests`, undefined, 404);
  assert.equal(crossTenant.json.error, 'client_not_found');
  const changes = await request(app.baseUrl, 'POST', `${portalApi}/approval-requests/${requestId}/request-changes`, {
    cookie: portalCookieValue, headers: { Origin: app.baseUrl }, body: { comment: 'Please revise the summary.' },
  });
  assert.equal(changes.status, 200);
  assert.equal(changes.json.request.status, 'changes_requested');
  assert.equal(changes.json.request.decision_actor_type, 'portal_client');
  const staleApprove = await request(app.baseUrl, 'POST', `${portalApi}/approval-requests/${requestId}/approve`, {
    cookie: portalCookieValue, headers: { Origin: app.baseUrl }, body: { confirm: true },
  });
  assert.equal(staleApprove.status, 409);
  assert.equal(staleApprove.json.error, 'approval_not_pending');
  const resubmit = await call(a, 'POST', approvalsPath(ca), { expected_version: version }, 201);
  const requestId2 = resubmit.json.request.id;
  assert.notEqual(requestId2, requestId);
  assert.equal(resubmit.json.request.snapshot.submission_number, 2);
  const history = await call(a, 'GET', approvalsPath(ca));
  assert.equal(history.json.requests.length, 2);
  assert.equal(history.json.requests.find((row) => row.id === requestId).status, 'changes_requested');
  await call(a, 'POST', withdrawPath(ca, requestId2), {});
  const withdrawn = await call(a, 'GET', approvalsPath(ca));
  assert.equal(withdrawn.json.requests.find((row) => row.id === requestId2).status, 'withdrawn');
  const third = await call(a, 'POST', approvalsPath(ca), { expected_version: version }, 201);
  const requestId3 = third.json.request.id;
  const approved = await request(app.baseUrl, 'POST', `${portalApi}/approval-requests/${requestId3}/approve`, {
    cookie: portalCookieValue, headers: { Origin: app.baseUrl }, body: { confirm: true },
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.json.request.status, 'approved');
  await db.getPool().query(`UPDATE client_reporting_profiles SET report_title='Changed title', version=version+1
    WHERE tenant_id=$1 AND client_id=$2`, [ta.id, ca]);
  const portalAfterChange = await request(app.baseUrl, 'GET', `${portalApi}/report`, { cookie: portalCookieValue });
  assert.equal(portalReport.json.report.title, snapshotPayload.report.title);
  assert.equal(portalAfterChange.json.report.title, 'Changed title');
  const stored = await db.getPool().query(`SELECT snapshot_json, content_hash FROM client_reporting_approval_snapshots
    WHERE tenant_id=$1 AND client_id=$2 AND submission_number=1`, [ta.id, ca]);
  assert.equal(stored.rows[0].content_hash, snapshotHash);
  assert.equal(stored.rows[0].snapshot_json.report.title, snapshotPayload.report.title);
  await call(a, 'POST', revokePath(ca), {});
  const revoked = await request(app.baseUrl, 'GET', `${portalApi}/approval-requests/pending`, { cookie: portalCookieValue });
  assert.equal(revoked.status, 403);
  assert.equal(revoked.json.error, 'portal_revoked');
});
