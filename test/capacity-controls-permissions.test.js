'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const http = require('node:http');
const express = require('express');
const matrix = require('../services/tenants/permission_matrix');
const ROOT = path.join(__dirname, '..'), BASE = '/api/capacity';
const VIEW = 'manage.projects.view', EDIT = 'manage.projects.edit';
const MEMBER = { member_name: 'Alex', weekly_hours: 0, allocated_hours: 0, active: true };
const ASSIGN = { member_id: 'member-a', work_item: 'Review', hours: 1.25, due_date: '2028-02-29' };
const WRITES = [
  ['POST', '/members', MEMBER], ['DELETE', '/members/member-a'],
  ['POST', '/assignments', ASSIGN], ['PATCH', '/assignments/assignment-a', { status: 'done' }],
  ['POST', '/assign-best', { work_item: 'Review' }], ['POST', '/seed-from-users', {}],
];
// Canonical isolated HTTP seam from agency-time-entries-permissions.test.js.
// Runs the shipped router, matrix, enforcement AND tenant resolver with modes on.
// Query stubs are SQL-contract coverage, not PostgreSQL/concurrency, session auth,
// tenant-context-loader, CSRF or browser integration.
// Real rate limiter: each router gets its own memory store, with Redis disabled by injection.
// No environment, require.cache, provider calls or live database mutation.
function load(relative, overrides) {
  const filename = path.join(ROOT, relative), module = { exports: {} };
  const localRequire = createRequire(filename);
  const injected = (name) => Object.hasOwn(overrides, name) ? overrides[name] : localRequire(name);
  new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))(injected, module, module.exports);
  return module.exports;
}
const enforce = load('services/tenants/permission_enforce.js', {
  '../security/prod_defaults': { permissionMode: () => 'on' },
});
const rateLimit = load('services/security/rate_limit.js', {
  '../infra/redis': { isRedisConfigured: () => false },
});
function loadOwnerGate() {
  const source = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const start = source.indexOf('const _OWNER_GATE_ALLOW = [');
  const end = source.indexOf('\n// ── Per-provider budget caps', start);
  assert.ok(start > source.indexOf('app.use(_permEnforce.enforceMatrix);') && end > start);
  const handlers = [];
  new Function('app', source.slice(start, end))({ use: (handler) => handlers.push(handler) });
  assert.equal(handlers.length, 1);
  return handlers[0]; // Shipped middleware and allowlists; never boot server.js.
}
function principal(grants = [VIEW, EDIT], extra = {}) {
  const permissions = new Set(grants);
  return { user: { id: 7, isOwner: false }, tenant: { id: 101 }, permissions,
    can: (key) => permissions.has(key), ...extra };
}
async function fixture(t, actor = principal(), query = () => { throw new Error('unexpected DB access'); }, hasDb = true) {
  const calls = [], controls = [];
  const pool = { async query(sql, params) {
    if (/^(BEGIN ISOLATION LEVEL READ COMMITTED|COMMIT|ROLLBACK)$/.test(sql)) { controls.push(sql); return { rows: [] }; }
    calls.push({ sql, params }); return query(sql, params);
  } };
  pool.connect = async () => ({ query: pool.query, release: () => controls.push('RELEASE') });
  const db = { hasDb: () => hasDb, getPool: () => pool };
  const context = load('services/tenants/context.js', {
    '../../db': db, '../security/prod_defaults': { multitenantMode: () => 'on' },
  });
  const router = load('services/capacity/api.js', {
    '../../db': db, '../tenants/context': context, '../tenants/permission_enforce': enforce,
    '../security/rate_limit': rateLimit,
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { Object.assign(req, actor); next(); });
  app.use(enforce.enforceMatrix);
  app.use(loadOwnerGate());
  app.use(BASE, router);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  async function request(method, suffix, body) {
    const response = await fetch('http://127.0.0.1:' + server.address().port + (suffix.startsWith('/api/') ? suffix : BASE + suffix), {
      method, headers: { 'Content-Type': 'application/json', Connection: 'close' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, retryAfter: response.headers.get('retry-after'), body: method === 'HEAD' ? null : await response.json() };
  }
  return { request, calls, controls };
}

test('capacity matrix covers reads and every existing mutation without new permissions', () => {
  assert.equal(matrix.requiredPermissionForComponent('capacity'), VIEW);
  assert.deepEqual(matrix.validate(), []);
  for (const [method, suffix, permission] of [
    ...['GET', 'HEAD'].flatMap((method) => ['/members', '/summary'].map((url) => [method, url, VIEW])),
    ...WRITES.map(([method, suffix]) => [method, suffix, EDIT]),
  ]) {
    const result = matrix.requiredPermissionForRequest(BASE + suffix, method);
    assert.equal(result.matched, true);
    assert.equal(result.permission, permission, method + suffix);
  }
});

test('read/edit denials precede queries; supplied authority and tenant roles cannot bypass', async (t) => {
  for (const actor of [principal([]), principal([VIEW]), principal(['tenant.billing.manage']),
    principal([VIEW], { tenantRole: { key: 'tenant_owner' }, user: { id: 7, isOwner: 'true' } })]) {
    const { request, calls } = await fixture(t, actor);
    for (const [method, suffix, body] of WRITES) {
      const response = await request(method, suffix, { ...body, tenant_id: 202, isOwner: true, permissions: [EDIT] });
      assert.equal(response.status, 403, method + suffix);
      assert.equal(response.body.required, EDIT);
    }
    assert.equal(calls.length, 0);
  }
  const { request, calls } = await fixture(t, principal([EDIT]));
  for (const suffix of ['/members', '/summary']) assert.equal((await request('GET', suffix)).status, 403);
  assert.equal(calls.length, 0);
});

test('new capacity owner-gate exemptions reject unsupported methods, lookalikes and unrelated data', async (t) => {
  const { request, calls } = await fixture(t, principal([VIEW, EDIT, 'brand.view']));
  for (const [method, suffix] of [
    ['PUT', '/members'], ['GET', '/assignments'],
    ['GET', '/members/member-a'], ['GET', '/members-extra'], ['POST', '/members/member-a'],
    ['DELETE', '/members/member-a/extra'], ['PATCH', '/assignments/assignment-a/extra'],
    ['POST', '/seed-from-users-extra'], ['GET', '/api/capacity-export/members'], ['GET', '/api/brand'],
  ]) {
    const response = await request(method, suffix);
    assert.equal(response.status, 403, method + suffix);
    assert.equal(response.body.error, 'owner_only');
  }
  assert.equal(calls.length, 0);
});

test('real resolver fails closed without a tenant even for server-authorized admins', async (t) => {
  for (const extra of [{ user: { id: 7, isOwner: true } }, { platformRole: { key: 'platform_admin' } }]) {
    const { request, calls } = await fixture(t, principal([], { ...extra, tenant: null }));
    for (const [method, suffix, body] of [['GET', '/members'], ['GET', '/summary'], ...WRITES]) {
      const response = await request(method, suffix + '?tenant_id=202', method === 'GET' ? undefined : { ...body, tenant_id: 202 });
      assert.equal(response.status, 400);
      assert.equal(response.body.error, 'no_tenant');
    }
    assert.equal(calls.length, 0, 'resolver must not query the default tenant');
  }
});

test('GET/HEAD pin every query to the authenticated tenant, never seed, and preserve zero hours', async (t) => {
  for (const tenantId of [101, 202]) {
    const { request, calls } = await fixture(t, principal([VIEW], { tenant: { id: tenantId } }), (sql, params) => {
      assert.match(sql.trim(), /^SELECT\b/);
      assert.deepEqual(params, [tenantId]);
      assert.match(sql, /tenant_id\s*=\s*\$1/);
      if (/FROM agent_tasks/.test(sql)) {
        assert.match(sql, /g\.tenant_id\s*=\s*\$1/);
        assert.match(sql, /t\.tenant_id\s*=\s*\$1/);
      }
      if (/FROM agent_tasks|FROM capacity_assignments/.test(sql) && !/COUNT\(/.test(sql)) assert.match(sql, /to_char\([^,]*due_date, 'YYYY-MM-DD'\)/);
      return { rows: /FROM team_capacity/.test(sql) ? [{ id: 'member-a', tenant_id: tenantId, ...MEMBER }] : [] };
    });
    for (const suffix of ['/members', '/summary']) {
      const response = await request('GET', suffix + '?tenant_id=999&tenantId=999');
      assert.equal(response.status, 200);
      assert.equal(response.body.members[0].weekly_hours, 0);
      if (suffix === '/summary') assert.equal(response.body.totals.weekly_hours, 0);
      assert.equal((await request('HEAD', suffix)).status, 200);
    }
    assert.ok(calls.length > 0);
  }
});

test('malformed controls reject before queries: types, bounds, precision, real dates and states', async (t) => {
  const { request, calls } = await fixture(t);
  const cases = [
    ...[{ member_name: ' ' }, { member_name: {} }, { member_name: 'x'.repeat(201) },
      { role: {} }, { notes: 'x'.repeat(2001) }, { active: 'false' },
      ...[-1, 168.01, 1.001, '4e1', null, true].map((weekly_hours) => ({ weekly_hours })),
      ...[-1, 10000, 1.001].map((allocated_hours) => ({ allocated_hours })),
    ].map((bad) => ['POST', '/members', { ...MEMBER, ...bad }]),
    ...[{ work_item: ' ' }, { work_item: 'x'.repeat(201) }, { member_id: {} },
      { source: 'provider' }, { status: 'executed' },
      ...[0, -1, 10000, 0.001, '2e0', null, true].map((hours) => ({ hours })),
      ...['2026-02-29', '2026-04-31', '2026-13-01', '2026-09-09T00:00:00Z'].map((due_date) => ({ due_date })),
    ].map((bad) => ['POST', '/assignments', { ...ASSIGN, ...bad }]),
    ...[{}, { status: 'executed' }, { status: {} }].map((body) => ['PATCH', '/assignments/assignment-a', body]),
    ...[{ hours: 0 }, { hours: '2e0' }, { due_date: '2026-02-29' }]
      .map((bad) => ['POST', '/assign-best', { work_item: 'Review', ...bad }]),
  ];
  for (const [method, suffix, body] of cases) {
    const response = await request(method, suffix, body);
    assert.equal(response.status, 400, method + suffix + ' ' + JSON.stringify(body));
    assert.equal(response.body.ok, false);
  }
  assert.equal(calls.length, 0);
});

test('foreign and missing member/update IDs have identical tenant-scoped 404s', async (t) => {
  const { request, calls } = await fixture(t, principal([EDIT]), (sql, params) => {
    assert.match(sql, /tenant_id\s*=\s*\$\d+/);
    assert.ok(params.includes(101));
    assert.ok(!params.includes(999));
    return { rows: [], rowCount: 0 };
  });
  for (const operation of [
    (id) => ['POST', '/members', { ...MEMBER, id }],
    (id) => ['DELETE', '/members/' + id],
    (id) => ['PATCH', '/assignments/' + id, { status: 'cancelled' }],
  ]) {
    const results = [];
    for (const id of ['foreign-id', 'missing-id']) {
      const [method, suffix, body] = operation(id);
      results.push(await request(method, suffix + '?tenant_id=999', body && { ...body, tenant_id: 999 }));
    }
    assert.equal(results[0].status, 404);
    assert.deepEqual(results[0], results[1]);
  }
  assert.ok(calls.length >= 6);
});

test('explicit assignments reject foreign, absent and inactive members before inserting', async (t) => {
  for (const memberId of ['foreign-member', 'missing-member', 'inactive-member']) {
    const { request, calls, controls } = await fixture(t, principal([EDIT]), (sql, params) => {
      assert.match(sql, /FROM team_capacity/);
      assert.match(sql, /tenant_id\s*=\s*\$\d+/);
      assert.match(sql, /FOR UPDATE/);
      assert.ok(params.includes(memberId) && params.includes(101));
      return { rows: memberId === 'inactive-member' ? [{ id: memberId, active: false }] : [] };
    });
    const response = await request('POST', '/assignments', { ...ASSIGN, member_id: memberId });
    assert.equal(response.status, memberId === 'inactive-member' ? 409 : 404);
    assert.equal(response.body.ok, false);
    assert.ok(calls.length > 0);
    for (const { sql } of calls) assert.match(sql.trim(), /^SELECT\b/);
    assert.deepEqual(controls, ['BEGIN ISOLATION LEVEL READ COMMITTED', 'ROLLBACK', 'RELEASE']);
  }
});

test('task references require both task and goal ownership; assign-best cannot forge a fallback link', async (t) => {
  for (const [suffix, body] of [
    ['/assignments', { ...ASSIGN, source: 'agent_tasks', source_ref: 'agent_task:999' }],
    ['/assign-best', { task_id: 999, work_item: 'Fallback must not forge ownership' }],
  ]) {
    const { request, calls } = await fixture(t, principal([EDIT]), (sql, params) => {
      assert.match(sql.trim(), /^SELECT\b/);
      assert.ok(params.includes(101));
      if (/FROM agent_tasks/.test(sql)) {
        assert.match(sql, /JOIN agent_goals/);
        assert.match(sql, /t\.tenant_id\s*=\s*\$\d+/);
        assert.match(sql, /g\.tenant_id\s*=\s*\$\d+/);
        assert.match(sql, /t\.status (?:NOT )?IN/);
      }
      return { rows: /FROM team_capacity/.test(sql) ? [{ id: 'member-a', ...MEMBER, weekly_hours: 40 }] : [] };
    });
    const response = await request('POST', suffix, body);
    assert.ok([400, 404].includes(response.status), suffix);
    assert.equal(response.body.ok, false);
    assert.ok(calls.some(({ sql }) => /FROM agent_tasks/.test(sql)));
  }
});

test('both deactivation paths reject open work without writing', async (t) => {
  const { request, calls } = await fixture(t, principal(), (sql, params) => {
    assert.match(sql.trim(), /^SELECT\b/); assert.ok(params.includes(101));
    if (/FROM team_capacity/.test(sql)) return { rows: [{ id: 'member-a', active: true }] };
    assert.match(sql, /member_id=\$1 AND tenant_id=\$2 AND status='open'/);
    return { rows: [{ id: 'assignment-a' }] };
  });
  for (const args of [['DELETE', '/members/member-a'], ['POST', '/members', { ...MEMBER, id: 'member-a', active: false }]]) {
    assert.equal((await request(...args)).status, 409);
  }
  assert.equal(calls.length, 4);
});

test('editor writes preserve zero and hidden metadata; empty upserts/updates and failed inserts cannot claim success', async (t) => {
  const metadata = [{ notes: '  Preserve this note.\n  ', skills: ['  strategy  ', '\tReporting '] }, { notes: null, skills: null }];
  for (const [hidden, accepted] of metadata.flatMap((hidden) => [true, false].map((accepted) => [hidden, accepted]))) {
    const { request } = await fixture(t, principal([EDIT]), (sql, params) => {
      if (/^SELECT/.test(sql)) return { rows: /FROM team_capacity/.test(sql) ? [{ id: 'member-a', ...MEMBER, ...hidden }] : [] };
      assert.ok(params.includes(101)); assert.ok(!params.includes(999));
      if (/^UPDATE|INSERT INTO team_capacity/.test(sql)) assert.match(sql, /RETURNING/);
      if (/INSERT INTO team_capacity/.test(sql)) assert.deepEqual(params.slice(4, 6), [0, 0]);
      if (/INSERT INTO team_capacity/.test(sql)) assert.deepEqual(params.slice(6, 8), [hidden.skills === null ? null : JSON.stringify(hidden.skills), hidden.notes]);
      if (/INSERT INTO capacity_assignments/.test(sql)) assert.deepEqual(params.slice(6, 9), [1.25, '2028-02-29', 'open']);
      if (/INSERT INTO capacity_assignments/.test(sql) && !accepted) throw new Error('assignment write unavailable');
      if (/^UPDATE/.test(sql)) assert.equal(params[Number(sql.match(/tenant_id\s*=\s*\$(\d+)/)[1]) - 1], 101);
      else assert.equal(params[1], 101);
      return { rows: accepted ? [{ id: params[0] }] : [], rowCount: accepted ? 1 : 0 };
    });
    for (const [method, suffix, body] of [...WRITES.slice(0, 4), ['PATCH', '/assignments/assignment-a', { status: 'cancelled' }],
      ['POST', '/members', { ...MEMBER, id: 'member-a', member_name: 'Alex updated' }]]) {
      const response = await request(method, suffix, body && { ...body, ...(suffix === '/members' ? hidden : {}), tenant_id: 999, user_id: 999 });
      assert.equal(response.status === 200, accepted, method + suffix);
      assert.equal(response.body.ok, accepted);
    }
  }
});

test('task duplicates are checked after locking the owned task and goal, before any insert', async (t) => {
  const { request, calls, controls } = await fixture(t, principal([EDIT]), (sql, params) => {
    assert.match(sql.trim(), /^SELECT\b/); assert.ok(params.includes(101));
    if (/FROM team_capacity/.test(sql)) return { rows: [{ id: 'member-a', active: true }] };
    if (/FROM agent_tasks/.test(sql)) {
      assert.match(sql, /t\.tenant_id=\$2 AND g\.tenant_id=\$2/); assert.match(sql, /FOR UPDATE OF t, g/);
      return { rows: [{ id: 9 }] };
    }
    assert.match(sql, /tenant_id=\$1 AND source_ref=\$2 AND status='open'/);
    assert.deepEqual(params.slice(0, 2), [101, 'agent_task:9']); return { rows: [{ id: 'duplicate' }] };
  });
  const response = await request('POST', '/assignments', { ...ASSIGN, source: 'agent_tasks', source_ref: 'agent_task:9' });
  assert.equal(response.status, 409); assert.equal(calls.length, 3);
  assert.deepEqual(controls, ['BEGIN ISOLATION LEVEL READ COMMITTED', 'ROLLBACK', 'RELEASE']);
});

test('summary and seed read failures are errors, never fabricated emptiness or writes', async (t) => {
  for (const [suffix, maxReads] of [['/summary', 5], ['/seed-from-users', 2]]) {
    for (let failAt = 1; failAt <= maxReads; failAt++) {
      let reads = 0;
      const { request, calls } = await fixture(t, principal(), () => {
        if (++reads === failAt) throw new Error('capacity read unavailable');
        return { rows: [] };
      });
      const response = await request(suffix === '/summary' ? 'GET' : 'POST', suffix, suffix === '/summary' ? undefined : {});
      assert.equal(response.status, 500, suffix + ' query ' + failAt);
      assert.equal(response.body.ok, false);
      for (const { sql } of calls) assert.match(sql.trim(), /^SELECT\b/);
    }
  }
  const { request, calls } = await fixture(t, principal(), undefined, false);
  for (const args of [['GET', '/summary'], ...WRITES]) {
    assert.equal((await request(...args)).status, 503);
  }
  assert.equal(calls.length, 0);
});

test('real limiter shares 60 writes across paths per server tenant; 61st denies before DB', async (t) => {
  const actor = principal();
  const query = (sql, params) => {
    assert.match(sql.trim(), /^INSERT INTO team_capacity/);
    assert.equal(params[1], actor.tenant.id);
    return { rows: [{ id: params[0] }] };
  };
  const { request, calls, controls } = await fixture(t, actor, query);
  const forged = { ...MEMBER, tenant_id: 202, tenantId: 202 };
  for (let i = 0; i < 60; i++) {
    assert.equal((await request('POST', '/members?tenant_id=202', forged)).status, 200, 'write ' + (i + 1));
  }
  assert.equal(calls.length, 60);
  for (const [method, suffix, body] of WRITES) {
    const denied = await request(method, suffix + '?tenant_id=999', { ...body, tenant_id: 999, tenantId: 999 });
    assert.equal(denied.status, 429, method + suffix);
    assert.deepEqual(denied.body, { ok: false, error: 'rate_limited', retryAfterSec: 60 });
    assert.equal(denied.retryAfter, '60');
  }
  assert.equal(calls.length, 60); assert.deepEqual(controls, []);
  actor.tenant = { id: 202 };
  assert.equal((await request('POST', '/members?tenant_id=202', forged)).status, 200);
  assert.equal(calls.length, 61);
  actor.tenant = { id: 101 };
  const isolated = await fixture(t, actor, query);
  assert.equal((await isolated.request('POST', '/members', MEMBER)).status, 200, 'new fixture has its own store');
});
