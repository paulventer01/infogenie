'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { setTimeout: delay } = require('node:timers/promises');
const dedicatedUrl = process.env.PR10F1_TEST_DATABASE_URL;
const required = process.env.PR10F1_REQUIRE_DATABASE === '1';

test('Client reporting profiles: native PostgreSQL and production session/middleware routes', {
  skip: !dedicatedUrl && !required ? 'no PR10F1_TEST_DATABASE_URL' : false,
  timeout: 120_000,
}, async (t) => {
  assert.ok(dedicatedUrl, 'PR10F1_TEST_DATABASE_URL is required; ambient DATABASE_URL is never used');
  const url = new URL(dedicatedUrl);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol) &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
    url.pathname === '/infogenie_client_reporting' && url.username && url.password && !url.search && !url.hash,
  'Use loopback, explicit credentials, infogenie_client_reporting database, and no URL overrides');
  const environment = { DATABASE_URL: dedicatedUrl, NODE_ENV: 'test',
    PERMISSION_ENFORCEMENT: 'on', MULTITENANT_ENFORCEMENT: 'on', SECURITY_CSRF: 'on' };
  const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  require('../helpers/env');

  let app, db, fx;
  const blocked = [], ports = new Set([Number(url.port || 5432)]);
  const connect = net.Socket.prototype.connect;
  t.mock.method(net.Socket.prototype, 'connect', function (...args) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const options = first && typeof first === 'object' ? first : { port: first, host: args[1] };
    if (options.path || !['localhost', '127.0.0.1', '::1'].includes(options.host || 'localhost') ||
        !ports.has(Number(options.port))) {
      blocked.push('outbound socket');
      throw new Error('Client reporting test blocked outbound socket');
    }
    return connect.apply(this, args);
  });
  t.mock.method(global, 'fetch', async () => {
    blocked.push('fetch');
    throw new Error('Client reporting test must not call external fetch');
  });
  t.after(async () => {
    try {
      if (app) await app.close();
      if (fx) {
        if (fx.created.userIds.length) await db.getPool().query(
          "DELETE FROM user_sessions WHERE sess->>'userId'=ANY($1::text[])", [fx.created.userIds.map(String)]);
        await fx.cleanup();
      }
    } finally {
      if (db) await db.getPool().end();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      assert.deepEqual(blocked, [], 'no provider/network attempt may hide behind a fallback');
    }
  });
  db = require('../../db');
  fx = require('../helpers/fixtures').makeFixtures();
  const pool = db.getPool();
  assert.equal((await pool.query('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()')).rows[0]?.ssl, true);
  await db.ensureSchema();
  await fx.ensureSchemas();
  const { ensureClientReportingSchema } = require('../../services/client_reporting/schema');
  await ensureClientReportingSchema();
  await ensureClientReportingSchema(); // Native DDL must be repeatable, without losing existing rows.
  const { bootApp, request, login } = require('../helpers');
  app = await bootApp();
  ports.add(app.port);
  const prefix = '/api/client-reporting/clients';
  async function call(actor, method, path, body, status = 200) {
    const response = await request(app.baseUrl, method, path, {
      cookie: actor?.cookie, body, headers: { Origin: app.baseUrl },
    });
    assert.equal(response.status, status, `${method} ${path}: ${response.text}`);
    assert.equal(response.json?.ok, status < 400);
    return response.json;
  }
  async function actor(tenant, roleKey = 'tenant_owner', owner = false) {
    const user = await fx.seedUser({ tenantId: tenant?.id, roleKey, owner });
    const session = await login(app.baseUrl, user.email, user.password);
    assert.equal(session.status, 200);
    assert.ok(session.cookie);
    return { cookie: session.cookie, tid: tenant?.id, uid: user.id };
  }
  async function client(tenant, name, status = 'active') {
    return (await pool.query('INSERT INTO clients (tenant_id,name,status) VALUES ($1,$2,$3) RETURNING id',
      [tenant.id, name, status])).rows[0].id;
  }
  async function snapshot() {
    return (await pool.query('SELECT * FROM client_reporting_profiles WHERE tenant_id=ANY($1::int[]) ORDER BY tenant_id,client_id',
      [fx.created.tenantIds])).rows;
  }
  const ta = await fx.seedTenant('Reporting A'), tb = await fx.seedTenant('Reporting B');
  const a = await actor(ta), b = await actor(tb), analyst = await actor(ta, 'analyst');
  const viewer = await actor(ta, 'client_viewer'), unboundOwner = await actor(null, 'tenant_owner', true);
  const ca = await client(ta, 'Client A'), ca2 = await client(ta, 'Client A2');
  const cb = await client(tb, 'Client B'), archived = await client(ta, 'Archived', 'archived');
  const profilePath = (id) => `${prefix}/${id}/profile`;
  const searchMetrics = ['runs', 'successful_runs', 'brand_mentions', 'mapped_queries', 'recent_search_runs'];
  const body = (expected_version = 0, extra = {}) => ({ expected_version, report_source: 'search-intel',
    default_format: 'pdf', report_title: 'Client report', branding_mode: 'workspace', branding_overrides: {},
    selected_metrics: searchMetrics, reporting_period: 'last_30_days', reporting_timezone: 'UTC', ...extra });

  await t.test('client lists and empty profile reads stay tenant scoped and never persist defaults', async () => {
    const before = await snapshot();
    const list = await call(a, 'GET', prefix);
    assert.deepEqual(list.clients.map((row) => row.id).sort((x, y) => x - y), [ca, ca2]);
    assert.deepEqual((await call(b, 'GET', prefix)).clients.map((row) => row.id), [cb]);
    const empty = await call(a, 'GET', profilePath(ca));
    assert.equal(empty.configured, false);
    assert.equal(empty.profile, null);
    assert.equal(empty.client.id, ca);
    assert.deepEqual(await call(a, 'GET', profilePath(ca)), empty);
    for (const id of [cb, archived, 2147483647]) {
      assert.equal((await call(a, 'GET', profilePath(id), undefined, 404)).error, 'client_not_found');
      await call(a, 'PUT', profilePath(id), body(), 404);
    }
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('real schema enforces tenant/client lineage and constrained settings on direct SQL', async () => {
    const insert = `INSERT INTO client_reporting_profiles
      (tenant_id,client_id,report_source,default_format,report_title,branding_mode,branding_overrides)
      VALUES ($1,$2,'search-intel','pdf','Native fixture','custom',$3)`;
    await assert.rejects(pool.query(insert, [ta.id, cb, '{}']), { code: '23503' });
    for (const overrides of [[], null, { agencyName: 42 }, { agencyName: 'x'.repeat(81) },
      { footerText: 'x'.repeat(201) }, { logoUrl: 'https://example.invalid' }, { colors: {} },
      { primaryColor: '#fff' }, { textColor: null }, { accentColor: 'red' }]) {
      await assert.rejects(pool.query(insert, [ta.id, ca2, JSON.stringify(overrides)]),
        (error) => ['23514', '22023'].includes(error.code));
    }
    assert.deepEqual(await snapshot(), []);
  });

  await t.test('saving persists real preferences and attributes the actual session actor', async () => {
    const custom = { agencyName: 'Agency', footerText: 'Prepared for Client A',
      primaryColor: '#112233', accentColor: '#ABCDEF', textColor: '#000000' };
    const saved = await call(a, 'PUT', profilePath(ca), body(0, {
      report_source: 'campaigns', default_format: 'pptx', report_title: 'Campaign review',
      branding_mode: 'custom', branding_overrides: custom,
    }));
    assert.equal(saved.profile.version, 1);
    assert.equal(saved.profile.report_source, 'campaigns');
    assert.equal(saved.profile.default_format, 'pptx');
    assert.deepEqual(saved.profile.branding_overrides, custom);
    const connection = await pool.connect();
    try {
      const row = (await connection.query('SELECT * FROM client_reporting_profiles WHERE tenant_id=$1 AND client_id=$2',
        [ta.id, ca])).rows[0];
      assert.equal(row.updated_by_user_id, a.uid);
      assert.equal(row.report_title, 'Campaign review');
      assert.deepEqual(row.branding_overrides, custom);
    } finally { connection.release(); }
    await ensureClientReportingSchema();
    assert.deepEqual((await call(a, 'GET', profilePath(ca))).profile, saved.profile);
    await assert.rejects(pool.query('UPDATE client_reporting_profiles SET client_id=$1 WHERE tenant_id=$2 AND client_id=$3',
      [cb, ta.id, ca]), { code: '23503' });
  });

  await t.test('invalid, forged and unauthorized writes leave every profile unchanged', async () => {
    const before = await snapshot();
    for (const extra of [{ report_source: 'all-clients' }, { default_format: 'html' }, { report_title: ' ' },
      { branding_mode: 'workspace', branding_overrides: { agencyName: 'Injected' } },
      { branding_mode: 'custom', branding_overrides: { logoUrl: 'https://example.invalid' } },
      { expected_version: -1 }, { tenant_id: tb.id }, { updated_by_user_id: b.uid }]) {
      await call(a, 'PUT', profilePath(ca), body(1, extra), 400);
    }
    await call(null, 'GET', prefix, undefined, 401);
    await call(viewer, 'GET', prefix, undefined, 403);
    await call(viewer, 'PUT', profilePath(ca), body(1), 403);
    await call(unboundOwner, 'GET', prefix, undefined, 400);
    await call(unboundOwner, 'PUT', profilePath(ca), body(1), 400);
    await call(analyst, 'PUT', profilePath(ca), body(1), 403);
    for (const headers of [{}, { Origin: 'https://attacker.invalid' }]) {
      const denied = await request(app.baseUrl, 'PUT', profilePath(ca), { cookie: a.cookie, headers, body: body(1) });
      assert.equal(denied.status, 403);
      assert.equal(denied.json.error, 'csrf_rejected');
    }
    const forged = await request(app.baseUrl, 'GET', `${profilePath(cb)}?tenant_id=${tb.id}`,
      { cookie: a.cookie, headers: { 'X-Tenant-Id': String(tb.id) } });
    assert.equal(forged.status, 404);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('optimistic versions reject stale writes and allow exactly one concurrent winner', async () => {
    await call(a, 'PUT', profilePath(ca), body(0), 409);
    const before = await snapshot();
    const replies = await Promise.all(['First', 'Second'].map((report_title) => request(app.baseUrl, 'PUT', profilePath(ca),
      { cookie: a.cookie, headers: { Origin: app.baseUrl }, body: body(1, { report_title }) })));
    assert.deepEqual(replies.map((reply) => reply.status).sort(), [200, 409]);
    const winner = replies.find((reply) => reply.status === 200).json.profile;
    assert.equal(winner.version, 2);
    assert.equal(replies.find((reply) => reply.status === 409).json.error, 'version_conflict');
    assert.deepEqual((await call(a, 'GET', profilePath(ca))).profile, winner);
    assert.equal((await snapshot()).length, before.length);
    await call(a, 'PUT', profilePath(ca), body(1), 409);
    const cleared = (await call(a, 'PUT', profilePath(ca), body(2, { default_format: 'xlsx' }))).profile;
    assert.equal(cleared.version, 3);
    assert.equal(cleared.branding_mode, 'workspace');
    assert.deepEqual(cleared.branding_overrides, {});
  });

  await t.test('archive transaction wins before a blocked save without creating or incrementing a profile', async () => {
    const before = await snapshot(), connection = await pool.connect();
    let pending;
    try {
      await connection.query('BEGIN');
      await connection.query("UPDATE clients SET status='archived' WHERE tenant_id=$1 AND id=$2", [ta.id, ca]);
      pending = request(app.baseUrl, 'PUT', profilePath(ca),
        { cookie: a.cookie, headers: { Origin: app.baseUrl }, body: body(3) });
      let waiting = false;
      for (let attempt = 0; attempt < 200 && !waiting; attempt += 1) {
        waiting = (await pool.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
          AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%FROM clients%'`)).rowCount > 0;
        if (!waiting) await delay(10);
      }
      assert.equal(waiting, true, 'save must lock/revalidate the canonical client before profile mutation');
      await connection.query('COMMIT');
      const response = await pending;
      assert.equal(response.status, 404);
      assert.equal(response.json.error, 'client_not_found');
      assert.deepEqual(await snapshot(), before);
    } finally {
      await connection.query('ROLLBACK');
      connection.release();
      if (pending) await pending;
    }
  });

  await t.test('membership revocation and client deletion preserve isolation and lifecycle', async () => {
    await call(b, 'PUT', profilePath(cb), body());
    const before = await snapshot();
    await pool.query("UPDATE tenant_users SET status='suspended' WHERE tenant_id=$1 AND user_id=$2", [tb.id, b.uid]);
    await call(b, 'GET', prefix, undefined, 403);
    await call(b, 'PUT', profilePath(cb), body(1), 403);
    assert.deepEqual(await snapshot(), before);
    await pool.query('DELETE FROM clients WHERE tenant_id=$1 AND id=$2', [ta.id, ca]);
    assert.deepEqual((await snapshot()).map((row) => [row.tenant_id, row.client_id]), [[tb.id, cb]]);
    await pool.query('DELETE FROM tenants WHERE id=$1', [tb.id]);
    assert.deepEqual(await snapshot(), []);
  });
});
