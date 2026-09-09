'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const express = require('express');
const matrix = require('../services/tenants/permission_matrix');
const BILLING = 'tenant.billing.manage', VIEW = 'manage.projects.view', EDIT = 'manage.projects.edit';
const RATES = '/api/agency-ops/rates';

// Existing isolated CommonJS seam: actual agency router, matrix enforcement and
// tenant resolver; only DB/context principal and unrelated capacity/limiter are
// injected. This is router/SQL-contract coverage, not full server authentication,
// CSRF, tenant-membership loading, rate-limiter or PostgreSQL integration coverage.
function load(relative, overrides) {
  const filename = path.join(__dirname, '..', relative);
  const module = { exports: {} }, localRequire = createRequire(filename);
  const injected = (name) => Object.hasOwn(overrides, name) ? overrides[name] : localRequire(name);
  new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))(injected, module, module.exports);
  return module.exports;
}
const enforce = load('services/tenants/permission_enforce.js', {
  '../security/prod_defaults': { permissionMode: () => 'on' },
});
function principal(permissions = [], tenantId = 101, extra = {}) {
  const grants = new Set(permissions);
  return { user: { id: 7, isOwner: false }, tenant: { id: tenantId },
    permissions: grants, can: (key) => grants.has(key), ...extra };
}
async function fixture(t, actor, query = () => { throw new Error('unexpected DB access'); }, hasDb = true) {
  const calls = [];
  const db = { hasDb: () => hasDb, getPool: () => ({
    async query(sql, params) { calls.push({ sql, params }); return query(sql, params); },
  }) };
  const context = load('services/tenants/context.js', {
    '../../db': db, '../security/prod_defaults': { multitenantMode: () => 'on' },
  });
  const agency = load('services/agency_ops/api.js', {
    '../../db': db, '../tenants/context': context, '../tenants/permission_enforce': enforce,
    '../capacity/api': {},
    '../security/rate_limit': { createRateLimiter: () => (_req, _res, next) => next() },
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { Object.assign(req, actor); next(); });
  app.use(enforce.enforceMatrix);
  app.use('/api/agency-ops', agency);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const request = async (method, pathname = RATES, body) => {
    const response = await fetch('http://127.0.0.1:' + server.address().port + pathname, {
      method, headers: { 'Content-Type': 'application/json', Connection: 'close' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  return { request, calls };
}
const payload = { role: 'designer', cost_rate: 12.5, bill_rate: 25, currency: 'USD',
  effective_from: '2026-09-09', effective_to: null, active: true };
const rate = { id: 'rate-a', member_id: null, ...payload };

test('rate-card component requires billing; existing GET/POST route keys remain view/edit', () => {
  assert.equal(matrix.requiredPermissionForComponent('agency-rate-cards'), BILLING);
  assert.equal(matrix.requiredPermissionForComponent('agency-time-entries'), BILLING);
  assert.deepEqual(matrix.validate(), []);
  for (const [method, permission] of [['GET', VIEW], ['HEAD', VIEW], ['POST', EDIT]]) {
    const result = matrix.requiredPermissionForRequest(RATES, method);
    assert.equal(result.matched, true);
    assert.equal(result.permission, permission);
  }
});

test('GET requires view plus billing and POST requires edit plus billing before DB access', async (t) => {
  for (const [method, coarse] of [['GET', VIEW], ['POST', EDIT]]) {
    for (const [grants, required] of [
      [[], coarse], [[BILLING], coarse], [[coarse], BILLING], [[VIEW, EDIT], BILLING],
      [[BILLING, method === 'GET' ? EDIT : VIEW], coarse],
    ]) {
      await t.test(method + ' denies ' + (grants.join(',') || 'no grants'), async (t) => {
        const { request, calls } = await fixture(t, principal(grants));
        const response = await request(method, RATES, method === 'POST' ? payload : undefined);
        assert.equal(response.status, 403);
        assert.equal(response.body.ok, false);
        assert.equal(response.body.error, 'forbidden');
        assert.equal(response.body.required, required);
        assert.equal(calls.length, 0);
      });
    }
  }
});

test('rates reject missing/invalid tenant even for a platform owner; request tenant cannot rescue it', async (t) => {
  for (const tenantId of [null, 0, '101x', 1.5]) {
    const { request, calls } = await fixture(t, principal([], tenantId, { user: { id: 7, isOwner: true } }));
    for (const method of ['GET', 'POST']) {
      const response = await request(method, RATES + '?tenant_id=101&tenantId=101',
        method === 'POST' ? { ...payload, tenant_id: 101 } : undefined);
      assert.deepEqual(response, { status: 400, body: { ok: false, error: 'no_tenant' } });
    }
    assert.equal(calls.length, 0);
  }
});

test('GET pins tenant and parameterized member/role/active filters and returns only the rate contract', async (t) => {
  for (const tenantId of [101, 202]) {
    const { request, calls } = await fixture(t, principal([VIEW, BILLING], tenantId), (sql, params) => {
      assert.match(sql, /FROM agency_rate_cards WHERE tenant_id=\$1 AND member_id=\$2 AND role=\$3 AND active=\$4/);
      assert.match(sql, /ORDER BY effective_from DESC, id DESC LIMIT 500$/);
      assert.deepEqual(params, [tenantId, 'member-a', 'designer', false]);
      return { rows: [{ ...rate, tenant_id: tenantId, member_id: 'member-a', cost_rate: '12.5000',
        bill_rate: '25.0000', currency: ' usd ', effective_from: new Date('2026-09-09T00:00:00Z'),
        effective_to: new Date('2026-09-30T00:00:00Z'), active: false, updated_at: 'private' }] };
    });
    const response = await request('GET', RATES + '?member_id=member-a&role=designer&active=0&tenant_id=999&tenantId=999');
    assert.deepEqual(response, { status: 200, body: { ok: true, rates: [
      { ...rate, member_id: 'member-a', effective_to: '2026-09-30', active: false },
    ] } });
    assert.equal(calls.length, 1);
  }
});

test('foreign member filter is an empty tenant-bound GET', async (t) => {
  const { request, calls } = await fixture(t, principal([VIEW, BILLING]), (sql, params) => {
    assert.match(sql, /WHERE tenant_id=\$1 AND member_id=\$2/);
    assert.deepEqual(params, [101, 'member-b']);
    return { rows: [] };
  });
  assert.deepEqual(await request('GET', RATES + '?member_id=member-b&tenant_id=202'),
    { status: 200, body: { ok: true, rates: [] } });
  assert.equal(calls.length, 1);
});

test('POST member and role rates use the authenticated tenant and documented fields without needing view', async (t) => {
  for (const tenantId of [101, 202]) {
    for (const memberId of ['member-a', null]) {
      const role = memberId ? null : 'designer';
      const { request, calls } = await fixture(t, principal([EDIT, BILLING], tenantId), (sql, params) => {
        if (sql.startsWith('SELECT')) {
          assert.match(sql, /FROM team_capacity WHERE id=\$1 AND tenant_id=\$2 LIMIT 1$/);
          assert.deepEqual(params, [memberId, tenantId]);
          return { rows: [{ id: memberId, role: 'designer' }] };
        }
        assert.match(sql, /^INSERT INTO agency_rate_cards /);
        assert.match(sql, /\(id, tenant_id, member_id, role, cost_rate, bill_rate, currency, effective_from, effective_to, active, updated_at\)/);
        assert.match(params[0], /^rate_[a-f0-9]{12}$/);
        assert.deepEqual(params.slice(1), [tenantId, memberId, role, 0, 1000000, 'EUR', '2026-09-09', '2026-09-09', false]);
        return { rows: [{ ...rate, id: params[0], tenant_id: tenantId, member_id: memberId, role,
          cost_rate: '0.0000', bill_rate: '1000000.0000', currency: 'EUR', effective_to: '2026-09-09', active: false }] };
      });
      const response = await request('POST', RATES + '?tenant_id=999', { ...payload,
        id: 'client-chosen', tenant_id: 999, tenantId: 999, user_id: 999,
        member_id: memberId, role: role ? ' designer ' : null,
        cost_rate: '0', bill_rate: 1000000, currency: ' eur ', effective_to: '2026-09-09', active: false });
      assert.equal(response.status, 201);
      assert.deepEqual(response.body, { ok: true, rate: { ...rate, id: calls.at(-1).params[0],
        member_id: memberId, role, cost_rate: 0, bill_rate: 1000000, currency: 'EUR',
        effective_to: '2026-09-09', active: false } });
      assert.equal(calls.length, memberId ? 2 : 1);
    }
  }
});

test('foreign and absent members receive the same rejection before POST writes', async (t) => {
  for (const memberId of ['member-b', 'missing-member']) {
    const { request, calls } = await fixture(t, principal([EDIT, BILLING]), (sql, params) => {
      assert.match(sql, /FROM team_capacity WHERE id=\$1 AND tenant_id=\$2 LIMIT 1$/);
      assert.deepEqual(params, [memberId, 101]);
      return { rows: [] };
    });
    const response = await request('POST', RATES, { ...payload, member_id: memberId, tenant_id: 202 });
    assert.deepEqual(response, { status: 400, body: {
      ok: false, error: 'member_id must belong to this tenant capacity roster',
    } });
    assert.equal(calls.length, 1);
  }
});

test('POST rejects invalid rate fields before INSERT', async (t) => {
  const cases = [
    [{ role: '', member_id: '' }, 'member_id or role required'],
    [{ role: 'x'.repeat(201) }, 'role too long'],
    [{ cost_rate: -0.01 }, 'cost_rate must be between 0 and 1000000'],
    [{ cost_rate: 'NaN' }, 'cost_rate must be between 0 and 1000000'],
    [{ bill_rate: 1000001 }, 'bill_rate must be between 0 and 1000000'],
    [{ bill_rate: 'Infinity' }, 'bill_rate must be between 0 and 1000000'],
    [{ currency: ' ' }, 'currency required'],
    [{ currency: 'x'.repeat(11) }, 'currency too long'],
    [{ effective_from: '2026-02-30' }, 'effective_from must be a real calendar date'],
    [{ effective_from: '2026-9-9' }, 'effective_from must be YYYY-MM-DD'],
    [{ effective_to: '2026-09-31' }, 'effective_to must be a real calendar date'],
    [{ effective_to: '2026-09-08' }, 'effective_to must be on or after effective_from'],
    [{ active: 'yes' }, 'boolean value expected'],
  ];
  const { request, calls } = await fixture(t, principal([EDIT, BILLING]));
  for (const [fields, error] of cases) {
    assert.deepEqual(await request('POST', RATES, { ...payload, ...fields }),
      { status: 400, body: { ok: false, error } }, JSON.stringify(fields));
  }
  assert.equal(calls.length, 0);
});

test('no-database responses remain empty GET and unavailable POST, never fabricated rates', async (t) => {
  const { request, calls } = await fixture(t, principal([VIEW, EDIT, BILLING]), undefined, false);
  assert.deepEqual(await request('GET'), { status: 200, body: { ok: true, rates: [] } });
  assert.deepEqual(await request('POST', RATES, payload),
    { status: 503, body: { ok: false, error: 'database not configured' } });
  assert.equal(calls.length, 0);
});
