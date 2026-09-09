'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');

const dedicatedUrl = process.env.PR10E8_TEST_DATABASE_URL;
const required = process.env.PR10E8_REQUIRE_DATABASE === '1';
const GRANTS = ['manage.projects.view', 'manage.projects.edit', 'tenant.billing.manage'];
const TABLES = ['capacity_assignments', 'agency_time_entries', 'agency_rate_cards',
  'agency_scope_baselines', 'agent_tasks', 'agent_goals', 'team_capacity'];

function testDatabaseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid PR10E8_TEST_DATABASE_URL'); }
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol) &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
    url.pathname === '/infogenie_agency_acceptance' && url.username && url.password &&
    !url.search && !url.hash,
  'PR10E8_TEST_DATABASE_URL must use loopback, explicit credentials, database infogenie_agency_acceptance, and no URL overrides');
  return url;
}

test('Agency Operations acceptance through real sessions, tenant membership and production HTTP routes', {
  skip: !dedicatedUrl && !required ? 'no PR10E8_TEST_DATABASE_URL' : false,
  timeout: 120_000,
}, async (t) => {
  assert.ok(dedicatedUrl, 'PR10E8_TEST_DATABASE_URL is required; ambient DATABASE_URL is never used');
  const url = testDatabaseUrl(dedicatedUrl);
  // Validate before importing db, the harness or any app module. TLS remains
  // enabled by db.js and the real PostgreSQL session store.
  const environment = { DATABASE_URL: dedicatedUrl, NODE_ENV: 'test',
    PERMISSION_ENFORCEMENT: 'on', MULTITENANT_ENFORCEMENT: 'on', SECURITY_CSRF: 'on' };
  const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  require('../helpers/env'); // Must precede vault/session imports.

  let app, db, fx;
  const blocked = [], ports = new Set([Number(url.port || 5432)]);
  // Block provider egress before loading the app. HTTP requests use the real
  // harness, while socket admission permits only our DB and ephemeral server.
  const connect = net.Socket.prototype.connect;
  t.mock.method(net.Socket.prototype, 'connect', function (...args) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const options = first && typeof first === 'object' ? first : { port: first, host: args[1] };
    const host = options.host || 'localhost';
    if (options.path || !['localhost', '127.0.0.1', '::1'].includes(host) || !ports.has(Number(options.port))) {
      blocked.push('outbound socket');
      throw new Error('Acceptance suite blocked outbound socket');
    }
    return connect.apply(this, args);
  });
  t.mock.method(global, 'fetch', async () => {
    blocked.push('fetch');
    throw new Error('Acceptance suite must not call external fetch');
  });
  t.after(async () => {
    try {
      if (app) await app.close();
      if (fx) {
        const ids = fx.created.tenantIds;
        if (ids.length) {
          for (const table of TABLES) await db.getPool().query(`DELETE FROM ${table} WHERE tenant_id=ANY($1::int[])`, [ids]);
        }
        if (fx.created.userIds.length) {
          await db.getPool().query("DELETE FROM user_sessions WHERE sess->>'userId'=ANY($1::text[])",
            [fx.created.userIds.map(String)]);
        }
        await fx.cleanup(); // Users/memberships before tenant-owned custom roles.
      }
    } finally {
      if (db) await db.getPool().end();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      assert.deepEqual(blocked, [], 'no provider/network attempt may be hidden by a fallback');
    }
  });

  db = require('../../db');
  const { makeFixtures } = require('../helpers/fixtures');
  fx = makeFixtures();
  const tls = await db.getPool().query('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()');
  assert.equal(tls.rows[0]?.ssl, true, 'application pool must use TLS before schema setup');
  await db.ensureSchema();
  await fx.ensureSchemas();
  await require('../../services/capacity/schema').ensureCapacitySchema();
  await require('../../services/agency_ops/schema').ensureAgencyOpsSchema();
  await require('../../services/agent_goals/schema').ensureAgentGoalsSchema();
  const { bootApp, request, login } = require('../helpers');
  app = await bootApp(); // No mounts, authority headers, resolver stubs or hooks.
  ports.add(app.port);

  async function call(actor, method, pathname, body, status = 200) {
    const response = await request(app.baseUrl, method, pathname, {
      cookie: actor?.cookie, body, headers: { Origin: app.baseUrl },
    });
    assert.equal(response.status, status, `${method} ${pathname}: ${response.text}`);
    assert.equal(response.json?.ok, status < 400, `${method} ${pathname}`);
    return response.json;
  }
  async function actor(tenant, roleKey = 'tenant_owner') {
    const user = await fx.seedUser({ tenantId: tenant.id, owner: false, roleKey });
    const session = await login(app.baseUrl, user.email, user.password);
    assert.equal(session.status, 200, 'fixture user must log in through the real auth endpoint');
    assert.equal(session.json.user.isOwner, false);
    assert.ok(session.cookie, 'login must issue a signed session cookie');
    const result = { cookie: session.cookie, tid: tenant.id, uid: user.id };
    const identity = await call(result, 'GET', '/api/auth/me');
    assert.equal(identity.authenticated, true);
    assert.equal(identity.user.id, user.id);
    assert.equal(identity.user.isOwner, false);
    const active = await call(result, 'GET', '/api/tenants/active');
    assert.equal(active.tenant.id, tenant.id);
    assert.equal(active.isPlatformAdmin, false);
    assert.equal(active.platformRole, null);
    assert.equal(active.role.key, roleKey);
    if (roleKey === 'tenant_owner') for (const grant of GRANTS) assert.ok(active.permissions.includes(grant));
    return result;
  }
  const tenantA = await fx.seedTenant('Acceptance A'), tenantB = await fx.seedTenant('Acceptance B');
  const tenantP = await fx.seedTenant('Acceptance Permissions');
  const a = await actor(tenantA), b = await actor(tenantB), p = await actor(tenantP);
  const analyst = await actor(tenantP, 'analyst'), admin = await actor(tenantP, 'tenant_admin');
  const viewer = await actor(tenantP, 'client_viewer');
  const dates = (await db.getPool().query(`SELECT
    to_char(date_trunc('week', CURRENT_DATE), 'YYYY-MM-DD') AS monday,
    to_char(date_trunc('week', CURRENT_DATE) + INTERVAL '1 day', 'YYYY-MM-DD') AS tuesday,
    to_char(date_trunc('week', CURRENT_DATE) + INTERVAL '6 days', 'YYYY-MM-DD') AS sunday`)).rows[0];
  const range = `from=${dates.monday}&to=${dates.sunday}`;
  const client = 'client-main', project = 'project-main';
  const timeBody = (member, hours, extra = {}) => ({ member_id: member, client_ref: client,
    project_ref: project, work_item: 'Delivery work', work_date: dates.tuesday, hours, billable: true, ...extra });
  const rateBody = (member, extra = {}) => ({ member_id: member, cost_rate: 50, bill_rate: 100,
    currency: 'USD', effective_from: dates.tuesday, ...extra });
  const scopeBody = (extra = {}) => ({ client_ref: client, project_ref: project, name: 'Weekly delivery',
    period_start: dates.monday, period_end: dates.sunday, contracted_hours: 4, change_budget_hours: 2,
    contracted_value: 600, currency: 'USD', ...extra });
  const memberBody = { member_name: 'Ada', role: 'designer', weekly_hours: 40, allocated_hours: 4 };
  async function snapshot(ids = fx.created.tenantIds) {
    const result = {};
    for (const table of TABLES) {
      result[table] = (await db.getPool().query(`SELECT * FROM ${table} WHERE tenant_id=ANY($1::int[]) ORDER BY id`, [ids])).rows;
    }
    return result;
  }
  const summary = (who = a, suffix = '') => call(who, 'GET', `/api/agency-ops/summary?${range}${suffix}`);
  let memberA, memberB, entryA, entryB, assignment, finalSummary, foreignSnapshot;

  await t.test('team, rates, scope, time correction and capacity reconcile to exact values', async () => {
    memberA = (await call(a, 'POST', '/api/capacity/members', memberBody)).id;
    memberB = (await call(b, 'POST', '/api/capacity/members', { ...memberBody, member_name: 'Ben', allocated_hours: 30 })).id;
    assert.deepEqual((await call(a, 'GET', '/api/capacity/members')).members.map((m) => m.id), [memberA]);
    assignment = (await call(a, 'POST', '/api/capacity/assignments', {
      member_id: memberA, work_item: 'Independent capacity reservation', hours: 6, due_date: dates.sunday,
    })).id;
    // Conflicting foreign role pricing/client identifiers expose dropped tenant
    // filters, including the unpriced Monday before A's rates become effective.
    await call(b, 'POST', '/api/agency-ops/rates', rateBody(null, {
      role: 'designer', cost_rate: 900, bill_rate: 1000, currency: 'EUR', effective_from: dates.monday,
    }), 201);
    await call(b, 'POST', '/api/agency-ops/scope-baselines', scopeBody({
      contracted_hours: 100, contracted_value: 9999, currency: 'EUR',
    }), 201);
    entryB = (await call(b, 'POST', '/api/agency-ops/time-entries', timeBody(memberB, 3), 201)).entry.id;
    foreignSnapshot = await snapshot([b.tid]);

    await call(a, 'POST', '/api/agency-ops/rates', rateBody(null, { role: 'designer', cost_rate: 40, bill_rate: 80 }), 201);
    const memberRate = (await call(a, 'POST', '/api/agency-ops/rates', rateBody(memberA), 201)).rate;
    assert.equal(memberRate.cost_rate, 50);
    assert.equal(memberRate.bill_rate, 100);
    const budget = (await call(a, 'POST', '/api/agency-ops/scope-baselines', scopeBody(), 201)).baseline;
    const created = (await call(a, 'POST', '/api/agency-ops/time-entries',
      timeBody(memberA, 4, { tenant_id: b.tid }), 201)).entry;
    entryA = created.id;
    assert.deepEqual([created.rate_source, created.rate_status, created.cost_value, created.billable_value],
      ['member', 'priced', 200, 400]);
    await call(a, 'POST', '/api/agency-ops/time-entries', timeBody(memberA, 2, { billable: false }), 201);
    const before = await summary();
    assert.deepEqual(before.totals, { time_entries: 2, hours: 6, billable_hours: 4, non_billable_hours: 2,
      cost_value: 300, billable_value: 400, margin_value: 100, margin_pct: 25, unpriced_hours: 0,
      contracted_value: 600, scope_overage_hours: 0, currency: 'USD' });
    assert.equal(before.scope_signals[0].id, budget.id);
    assert.deepEqual([before.scope_signals[0].status, before.scope_signals[0].actual_hours,
      before.scope_signals[0].allowed_hours], ['change_budget_used', 6, 6]);
    assert.deepEqual((await call(a, 'GET', '/api/agency-ops/capacity-summary')).totals,
      { members: 1, weekly_hours: 40, allocated_hours: 10, logged_hours: 6, utilization_pct: 25, open_agent_tasks: 0 });

    const corrected = (await call(a, 'PATCH', `/api/agency-ops/time-entries/${entryA}`, { hours: 7 })).entry;
    assert.equal(corrected.id, entryA);
    assert.deepEqual([corrected.hours, corrected.cost_value, corrected.billable_value], [7, 350, 700]);
    const after = await summary();
    assert.deepEqual(after.totals, { ...before.totals, hours: 9, billable_hours: 7, cost_value: 450,
      billable_value: 700, margin_value: 250, margin_pct: 35.71, scope_overage_hours: 3 });
    assert.deepEqual([after.scope_signals[0].status, after.scope_signals[0].actual_hours,
      after.scope_signals[0].overage_hours, after.scope_signals[0].severity], ['over_scope', 9, 3, 'high']);
    const missing = (await call(a, 'POST', '/api/agency-ops/time-entries',
      timeBody(memberA, 1, { work_date: dates.monday }), 201)).entry;
    assert.deepEqual([missing.rate_status, missing.rate_source, missing.currency, missing.cost_value, missing.billable_value],
      ['missing', null, null, 0, 0]);
    finalSummary = await summary();
    assert.deepEqual(finalSummary.totals, { ...after.totals, time_entries: 3, hours: 10, billable_hours: 8,
      unpriced_hours: 1, scope_overage_hours: 4 });
    assert.deepEqual(finalSummary.clients, [{ client_ref: client, ...finalSummary.totals }]);
    const narrow = await call(a, 'GET', `/api/agency-ops/summary?from=${dates.tuesday}&to=${dates.tuesday}`);
    assert.equal(narrow.totals.hours, 9);
    assert.equal(narrow.totals.unpriced_hours, 0);
    assert.equal(narrow.scope_signals[0].actual_hours, 10, 'scope uses its entire baseline period');
    const capacity = await call(a, 'GET', '/api/capacity/summary');
    assert.deepEqual([capacity.totals.allocated_hours, capacity.totals.logged_hours,
      capacity.totals.remaining_hours, capacity.members[0].open_assignments], [10, 10, 30, 1]);
    assert.equal(capacity.members[0].assignments[0].id, assignment);
    assert.equal(capacity.members[0].assignments[0].status, 'open');
    assert.equal(capacity.members[0].assignments[0].due_date, dates.sunday);
    assert.deepEqual((await call(a, 'GET', '/api/agency-ops/capacity-summary')).totals,
      { members: 1, weekly_hours: 40, allocated_hours: 10, logged_hours: 10, utilization_pct: 25, open_agent_tasks: 0 });
    assert.deepEqual(await snapshot([b.tid]), foreignSnapshot);
  });

  await t.test('real membership rejects foreign IDs and ignores forged tenant ownership', async () => {
    const before = await snapshot();
    assert.deepEqual((await summary(a, `&tenant_id=${b.tid}&tenantId=${b.tid}`)).totals, finalSummary.totals);
    const other = await summary(b, `&tenant_id=${a.tid}`);
    assert.deepEqual([other.totals.hours, other.totals.cost_value, other.totals.billable_value,
      other.totals.currency], [3, 2700, 3000, 'EUR']);
    for (const [who, foreignMember] of [[a, memberB], [b, memberA]]) {
      const entries = await call(who, 'GET', `/api/agency-ops/time-entries?${range}&member_id=${foreignMember}`);
      assert.deepEqual(entries.entries, []);
      const denied = await call(who, 'POST', '/api/agency-ops/time-entries', timeBody(foreignMember, 1), 400);
      assert.equal(denied.error, 'member_id must belong to this tenant capacity roster');
      await call(who, 'POST', '/api/agency-ops/rates', rateBody(foreignMember), 400);
    }
    for (const id of [entryB, 'missing-entry']) {
      const denied = await call(a, 'PATCH', `/api/agency-ops/time-entries/${id}?tenant_id=${b.tid}`,
        { hours: 12, tenant_id: b.tid }, 404);
      assert.equal(denied.error, 'time entry not found');
    }
    assert.equal((await call(a, 'POST', '/api/tenants/switch', { tenantId: b.tid }, 403)).error, 'not_a_member');
    assert.equal((await call(a, 'DELETE', `/api/capacity/members/${memberB}`, undefined, 404)).error, 'member_not_found');
    assert.equal((await call(b, 'PATCH', `/api/capacity/assignments/${assignment}`, { status: 'done' }, 404)).error, 'assignment_not_found');
    await call(a, 'POST', '/api/agency-ops/time-entries', timeBody(memberA, 25), 400);
    await call(a, 'POST', '/api/agency-ops/scope-baselines', scopeBody({ period_end: '2000-01-01' }), 400);
    assert.deepEqual(await snapshot(), before, 'all rejected writes must leave feature rows untouched');
    const persisted = (await db.getPool().query('SELECT tenant_id FROM agency_time_entries WHERE id=$1', [entryA])).rows[0];
    assert.equal(persisted.tenant_id, a.tid, 'forged body tenant cannot redirect an accepted write');
  });

  await t.test('sessions, built-in roles, CSRF and revoked membership enforce actual authority', async () => {
    const memberP = (await call(admin, 'POST', '/api/capacity/members', memberBody)).id;
    await call(p, 'POST', '/api/agency-ops/rates', rateBody(memberP), 201);
    const financial = ['rates', 'time-entries', 'scope-baselines', 'summary', 'capacity-summary'];
    const before = await snapshot([p.tid]);
    for (const endpoint of financial) {
      const pathname = `/api/agency-ops/${endpoint}?${range}`;
      assert.equal((await call(null, 'GET', pathname, undefined, 401)).error, 'auth_required');
      for (const who of [analyst, admin]) {
        const denied = await call(who, 'GET', pathname, undefined, 403);
        assert.equal(denied.error, 'forbidden');
        assert.equal(denied.required, 'tenant.billing.manage');
      }
      await call(viewer, 'GET', pathname, undefined, 403);
    }
    await call(viewer, 'GET', '/api/capacity/summary', undefined, 403);
    await call(viewer, 'POST', '/api/capacity/members', memberBody, 403);
    await call({ cookie: 'infogenie.sid=invalid-signature' }, 'GET', '/api/capacity/summary', undefined, 401);
    await call(null, 'POST', '/api/capacity/members', memberBody, 401);
    await call(null, 'POST', '/api/agency-ops/time-entries', timeBody(memberP, 1), 401);
    for (const [method, pathname, body] of [
      ['POST', '/api/capacity/members', memberBody],
      ['POST', '/api/agency-ops/time-entries', timeBody(memberP, 1)],
      ['PATCH', `/api/agency-ops/time-entries/${entryA}`, { hours: 2, tenant_id: a.tid, isOwner: true }],
    ]) {
      const denied = await call(analyst, method, pathname, body, 403);
      assert.equal(denied.required, 'manage.projects.edit');
    }
    await call(admin, 'POST', '/api/agency-ops/rates', rateBody(memberP), 403);
    await call(admin, 'POST', '/api/agency-ops/scope-baselines', scopeBody(), 403);
    for (const headers of [{}, { Origin: 'https://attacker.invalid' }]) {
      const denied = await request(app.baseUrl, 'POST', '/api/capacity/members', { cookie: p.cookie, headers, body: memberBody });
      assert.equal(denied.status, 403);
      assert.equal(denied.json.error, 'csrf_rejected');
    }
    assert.deepEqual(await snapshot([p.tid]), before);
    assert.equal((await call(analyst, 'GET', '/api/capacity/summary')).totals.members, 1);
    assert.deepEqual((await call(admin, 'GET', `/api/agency-ops/scope-signals?${range}`)).signals, []);
    const hidden = (await call(admin, 'POST', '/api/agency-ops/time-entries', timeBody(memberP, 1), 201)).entry;
    const corrected = (await call(admin, 'PATCH', `/api/agency-ops/time-entries/${hidden.id}`, { hours: 2 })).entry;
    for (const row of [hidden, corrected]) {
      assert.equal(row.rate_status, 'hidden');
      for (const key of ['cost_rate', 'bill_rate', 'currency', 'rate_source', 'cost_value', 'billable_value']) assert.equal(row[key], null, key);
    }
    const visible = (await call(p, 'GET', `/api/agency-ops/time-entries?${range}`)).entries;
    assert.deepEqual(visible.map((row) => [row.id, row.hours, row.cost_value, row.billable_value]), [[hidden.id, 2, 100, 200]]);
    const unchanged = await snapshot([p.tid]);
    await db.getPool().query("UPDATE tenant_users SET status='suspended' WHERE tenant_id=$1 AND user_id=$2", [analyst.tid, analyst.uid]);
    assert.equal((await call(analyst, 'GET', '/api/tenants/active')).tenant, null);
    await call(analyst, 'GET', '/api/capacity/summary', undefined, 403);
    assert.deepEqual(await snapshot([p.tid]), unchanged);
  });

  await t.test('repeated GETs are read-only and mixed currencies never produce a fabricated total', async () => {
    const before = await snapshot();
    const paths = ['/api/capacity/members', '/api/capacity/summary', '/api/agency-ops/capacity-summary',
      ...['rates', 'scope-baselines', 'time-entries', 'scope-signals', 'summary'].map((endpoint) => `/api/agency-ops/${endpoint}?${range}`)];
    for (const pathname of paths) {
      const first = await call(a, 'GET', pathname);
      assert.deepEqual(await call(a, 'GET', pathname), first, pathname);
    }
    assert.deepEqual(await snapshot(), before);
    const mixed = scopeBody({ client_ref: 'client-eur', project_ref: null, currency: 'EUR', contracted_value: 100 });
    await call(a, 'POST', '/api/agency-ops/scope-baselines', mixed, 201);
    const rejected = await call(a, 'GET', `/api/agency-ops/summary?${range}`, undefined, 409);
    assert.deepEqual(rejected, { ok: false, error: 'mixed_currencies', currencies: ['EUR', 'USD'] });
    assert.deepEqual((await summary(a, `&client_ref=${client}`)).totals, finalSummary.totals);
    assert.deepEqual(await snapshot([b.tid]), foreignSnapshot);
  });
});
