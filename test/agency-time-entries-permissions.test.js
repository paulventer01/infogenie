'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const http = require('node:http');
const express = require('express');
const matrix = require('../services/tenants/permission_matrix');
const BILLING = 'tenant.billing.manage', VIEW = 'manage.projects.view', EDIT = 'manage.projects.edit';
const ROOT = path.join(__dirname, '..');
const ENTRIES = '/api/agency-ops/time-entries';
const WRITES = [['POST', ENTRIES], ['PATCH', ENTRIES + '/entry-a']];
// Same isolated CommonJS-loading seam as agency-ops-dashboard.test.js. Exercise
// shipped routers/enforcement, with no DB, environment or require.cache mutation.
// These are router/SQL-contract tests, NOT full auth, owner-gate, CSRF, limiter,
// tenant-context-loader or PostgreSQL integration coverage.
function load(relative, overrides) {
  const filename = path.join(ROOT, relative);
  const module = { exports: {} };
  const localRequire = createRequire(filename);
  const injectedRequire = (name) => Object.hasOwn(overrides, name) ? overrides[name] : localRequire(name);
  new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))(injectedRequire, module, module.exports);
  return module.exports;
}

const enforce = load('services/tenants/permission_enforce.js', {
  '../security/prod_defaults': { permissionMode: () => 'on' },
});
function principal(permissions = [], extra = {}) {
  const grants = new Set(permissions);
  return {
    user: { id: 7, isOwner: false }, tenant: { id: 101 },
    permissions: grants, can: (key) => grants.has(key), ...extra,
  };
}

async function fixture(t, actor, query = () => { throw new Error('unexpected DB access'); }) {
  const calls = [];
  const db = { hasDb: () => true, getPool: () => ({
    async query(sql, params) { calls.push({ sql, params }); return query(sql, params); },
  }) };
  const dependencies = {
    '../../db': db,
    '../tenants/context': { resolveTenantId: async (req) => req.tenant?.id || null },
    '../tenants/permission_enforce': enforce,
  };
  const capacity = load('services/capacity/api.js', dependencies);
  const agency = load('services/agency_ops/api.js', {
    ...dependencies, '../capacity/api': capacity,
    '../security/rate_limit': { createRateLimiter: () => (_req, _res, next) => next() },
  });
  const tenants = load('services/tenants/api.js', {
    '../../db': db, './permission_enforce': enforce, './schema': {},
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { Object.assign(req, actor); next(); });
  // Tenant bootstrap is mounted before enforceMatrix in server.js.
  app.use('/api/tenants', tenants);
  app.use(enforce.enforceMatrix);
  app.use('/api/agency-ops', agency);
  app.use('/api/capacity', capacity);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const request = async (method, pathname, body) => {
    const response = await fetch('http://127.0.0.1:' + server.address().port + pathname, {
      method, headers: { 'Content-Type': 'application/json', Connection: 'close' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  return { request, calls };
}
const payload = {
  member_id: 'member-a', client_ref: 'client-a', work_item: 'Review',
  work_date: '2026-09-08', hours: 2, billable: true, notes: 'Correction',
};
const row = {
  id: 'entry-a', tenant_id: 101, ...payload, member_role: 'designer',
  rate_id: 'rate-a', cost_rate: 10, bill_rate: 20, currency: 'USD', rate_source: 'member',
};

test('time-entry component maps to billing; existing route contracts stay unchanged', () => {
  assert.equal(matrix.requiredPermissionForComponent('agency-time-entries'), BILLING);
  assert.deepEqual(matrix.validate(), []);
  for (const [pathname, method, permission] of [
    [ENTRIES, 'GET', VIEW], [ENTRIES, 'HEAD', VIEW],
    [ENTRIES, 'POST', EDIT], [ENTRIES + '/entry-a', 'PATCH', EDIT],
    ['/api/capacity/members', 'GET', VIEW],
    ['/api/capacity/summary', 'GET', VIEW],
    ['/api/tenants/me', 'GET', 'dashboard.view'], ['/api/tenants/active', 'GET', 'dashboard.view'],
  ]) {
    const result = matrix.requiredPermissionForRequest(pathname, method);
    assert.equal(result.matched, true);
    assert.equal(result.permission, permission, method + ' ' + pathname);
  }
});

test('time-entry GET needs billing AND view; POST/PATCH need edit before data access', async (t) => {
  const cases = [
    ...[[[], VIEW], [[BILLING], VIEW], [[VIEW], BILLING], [[EDIT], VIEW]]
      .map(([grants, required]) => [grants, 'GET', ENTRIES, required]),
    ...[[], [VIEW], [BILLING], [VIEW, BILLING]]
      .flatMap((grants) => WRITES.map(([method, pathname]) => [grants, method, pathname, EDIT])),
  ];
  for (const [grants, method, pathname, required] of cases) {
    const { request, calls } = await fixture(t, principal(grants));
    const response = await request(method, pathname, method === 'GET' ? undefined : payload);
    assert.equal(response.status, 403);
    assert.equal(response.body.error, 'forbidden');
    assert.equal(response.body.required, required);
    assert.equal(calls.length, 0);
  }
});

test('admin bypass is the exact server model, not a tenant role or a truthy flag', () => {
  for (const extra of [
    { user: { id: 7, isOwner: true } },
    { platformRole: { key: 'platform_owner' } }, { platformRole: { key: 'platform_admin' } },
  ]) {
    const actor = principal([], extra);
    for (const key of [VIEW, BILLING, EDIT]) assert.equal(enforce.hasPermission(actor, key), true);
  }
  for (const extra of [
    { tenantRole: { key: 'tenant_owner' } }, { tenantRole: { key: 'tenant_admin' } },
    { user: { id: 7, isOwner: 'true' } }, { user: null, platformRole: { key: 'platform_admin' } },
  ]) assert.equal(enforce.isPlatformAdmin(principal([], extra)), false);
});

test('missing/invalid agency tenant fails closed even for a platform owner', async (t) => {
  for (const id of [null, 0, -1, '101x', 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const { request, calls } = await fixture(t, principal([], { user: { id: 7, isOwner: true }, tenant: { id } }));
    for (const [method, pathname] of [['GET', ENTRIES], ...WRITES]) {
      const response = await request(method, pathname, method === 'GET' ? undefined : payload);
      assert.equal(response.status, 400);
      assert.equal(response.body.error, 'no_tenant');
    }
    assert.equal(calls.length, 0);
  }
});

test('list query pins entries and joined rates to the authenticated tenant', async (t) => {
  for (const tenantId of [101, 202]) {
    const { request, calls } = await fixture(t, principal([VIEW, BILLING], { tenant: { id: tenantId } }), (sql, params) => {
      assert.match(sql, /e\.tenant_id=\$1/);
      assert.match(sql, /r\.tenant_id=e\.tenant_id/);
      assert.match(sql, /e\.client_ref=\$4 AND e\.member_id=\$5/);
      assert.match(sql, /LIMIT 500\s*$/);
      assert.deepEqual(params, [tenantId, '2026-09-01', '2026-09-09', 'client-a', 'member-a']);
      return { rows: [{ ...row, id: 'entry-' + tenantId }] };
    });
    const response = await request('GET', '/api/agency-ops/time-entries?from=2026-09-01&to=2026-09-09&client_ref=client-a&member_id=member-a&tenant_id=999&tenantId=999');
    assert.equal(response.status, 200);
    assert.equal(response.body.entries[0].id, 'entry-' + tenantId);
    assert.equal(calls.length, 1);
  }
});

test('foreign capacity member rejects create/correction without writing', async (t) => {
  const { request, calls } = await fixture(t, principal([VIEW, BILLING, EDIT]), (sql, params) => {
    assert.match(sql, /FROM team_capacity WHERE id=\$1 AND tenant_id=\$2/);
    assert.deepEqual(params, ['member-b', 101]);
    return { rows: [] };
  });
  for (const [method, pathname] of WRITES) {
    const response = await request(method, pathname, { ...payload, member_id: 'member-b', tenant_id: 202 });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, 'member_id must belong to this tenant capacity roster');
  }
  assert.equal(calls.length, 2);
});

test('foreign and absent correction IDs return the same tenant-scoped 404', async (t) => {
  const { request, calls } = await fixture(t, principal([EDIT]), (sql, params) => {
    assert.match(sql, /WHERE id=\$1 AND tenant_id=\$2 RETURNING \*/);
    assert.deepEqual(params.slice(1), [101, 3]);
    return { rows: [] };
  });
  const responses = await Promise.all(['entry-b', 'absent-entry'].map((id) =>
    request('PATCH', ENTRIES + '/' + id, { hours: 3, tenant_id: 202 })));
  assert.deepEqual(responses[0], responses[1]);
  assert.equal(responses[0].status, 404);
  assert.equal(responses[0].body.error, 'time entry not found');
  assert.deepEqual(calls.map((call) => call.params[0]).sort(), ['absent-entry', 'entry-b']);
});

test('baseline editor-only writes succeed but redact financials and ignore supplied authority', async (t) => {
  const { request, calls } = await fixture(t, principal([EDIT]), (sql, params) => {
    if (sql.startsWith('SELECT id, role')) {
      assert.deepEqual(params, ['member-a', 101]);
      return { rows: [{ id: 'member-a', role: 'designer' }] };
    }
    if (sql.startsWith('INSERT')) {
      assert.deepEqual(params.slice(1, 4), [101, 'member-a', 'designer']);
      assert.doesNotMatch(sql, /cost_rate|bill_rate|currency|user_id/);
      return { rows: [{ ...row, id: params[0] }] };
    }
    if (sql.startsWith('UPDATE')) {
      assert.deepEqual(params, ['entry-a', 101, 3]);
      assert.match(sql, /SET hours=\$3, updated_at=NOW\(\) WHERE id=\$1 AND tenant_id=\$2/);
      return { rows: [{ ...row, hours: 3 }] };
    }
    assert.match(sql, /e\.tenant_id=\$1/);
    assert.match(sql, /r\.tenant_id=e\.tenant_id/);
    assert.match(sql, /e\.id=\$4/);
    assert.equal(params[0], 101);
    return { rows: [{ ...row, id: params[3] }] };
  });
  const untrusted = { tenant_id: 202, user_id: 999, member_role: 'admin', cost_rate: 999, bill_rate: 999, currency: 'EUR' };
  const created = await request('POST', '/api/agency-ops/time-entries', { ...payload, ...untrusted });
  const patched = await request('PATCH', '/api/agency-ops/time-entries/entry-a', { hours: 3, ...untrusted });
  assert.deepEqual([created.status, patched.status], [201, 200]);
  for (const response of [created, patched]) {
    assert.equal(response.body.entry.member_role, 'designer');
    assert.equal(response.body.entry.rate_status, 'hidden');
    for (const key of ['cost_rate', 'bill_rate', 'currency', 'rate_source', 'cost_value', 'billable_value']) {
      assert.equal(response.body.entry[key], null, key);
    }
  }
  assert.equal(calls.length, 5);
});

test('capacity members router requires project view and queries only its tenant without writes', async (t) => {
  const denied = await fixture(t, principal([BILLING]));
  assert.equal((await denied.request('GET', '/api/capacity/members')).status, 403);
  assert.equal(denied.calls.length, 0);
  const allowed = await fixture(t, principal([VIEW]), (sql, params) => {
    assert.match(sql, /^SELECT \* FROM team_capacity WHERE tenant_id=\$1/);
    assert.deepEqual(params, [101]);
    return { rows: [{ id: 'member-a', tenant_id: 101 }] };
  });
  const response = await allowed.request('GET', '/api/capacity/members?tenant_id=202');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.members.map((member) => member.id), ['member-a']);
  assert.equal(allowed.calls.length, 1);
});

test('tenant me is identity-only; active supplies authoritative permission/admin context', async (t) => {
  const { request, calls } = await fixture(t, principal([VIEW, BILLING], { tenantRole: { key: 'custom_manager', name: 'Manager' } }));
  const me = await request('GET', '/api/tenants/me?tenant_id=202');
  assert.deepEqual([me.status, me.body.activeTenantId], [200, 101]);
  for (const key of ['permissions', 'isPlatformAdmin']) assert.equal(Object.hasOwn(me.body, key), false);
  const active = await request('GET', '/api/tenants/active');
  assert.deepEqual(active.body.permissions, [VIEW, BILLING]);
  assert.equal(active.body.isPlatformAdmin, false);
  assert.equal(active.body.componentMatrix['agency-time-entries'], BILLING);
  assert.equal(calls.length, 0);
});
