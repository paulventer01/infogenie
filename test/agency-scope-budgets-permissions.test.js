'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const express = require('express');
const { types: pgTypes } = require('pg');
const { request: httpRequest } = require('./helpers/request');
const matrix = require('../services/tenants/permission_matrix');
const BILLING = 'tenant.billing.manage', VIEW = 'manage.projects.view', EDIT = 'manage.projects.edit';
const SCOPES = '/api/agency-ops/scope-baselines';

// Rate-card test seam: actual router, matrix enforcement and tenant resolver;
// injected DB/principal, strict mode configuration, unrelated capacity and limiter.
// Reuse the HTTP helper without booting server.js. This verifies router/SQL
// contracts, not full server auth, membership loading, CSRF, limiter or live PG.
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
  const calls = [], dbAccess = [];
  const db = {
    hasDb() { dbAccess.push('hasDb'); return hasDb; },
    getPool() {
      dbAccess.push('getPool');
      return { async query(sql, params) { calls.push({ sql, params }); return query(sql, params); } };
    },
  };
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
  const request = async (method, pathname = SCOPES, body) => {
    const response = await httpRequest('http://127.0.0.1:' + server.address().port, method, pathname,
      { body, headers: { Connection: 'close' } });
    return { status: response.status, body: response.json };
  };
  return { request, calls, dbAccess };
}
const payload = { client_ref: 'client-business-ref', project_ref: null, name: 'September scope',
  period_start: '2026-09-01', period_end: '2026-09-30', contracted_hours: 12.5,
  change_budget_hours: 2, contracted_value: 1200, currency: 'USD', active: true };
const range = { from: '2026-09-09', to: '2026-09-10' };
const rangeQuery = '?from=' + range.from + '&to=' + range.to;
const jsonValue = (value) => JSON.parse(JSON.stringify(value));
// Model only the DATE/text projection boundary, not a PostgreSQL execution engine.
// Missing to_char leaves the installed DATE parser's unsafe local-midnight value.
const pgDate = pgTypes.getTypeParser(1082);
function projectedBaseline(sql, row) {
  const previousTZ = process.env.TZ, result = { ...row };
  try {
    process.env.TZ = 'Pacific/Auckland';
    for (const key of ['period_start', 'period_end']) {
      const rawDate = pgDate(row[key]);
      assert.ok(rawDate instanceof Date);
      assert.notEqual(rawDate.toISOString().slice(0, 10), row[key], 'raw DATE shifts the calendar day');
      result[key] = sql.includes(`to_char(${key}, 'YYYY-MM-DD') AS ${key}`) ? row[key] : rawDate;
    }
    return result;
  } finally {
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  }
}

test('scope component requires billing; GET/HEAD/POST matrix retains project view/edit', () => {
  assert.equal(matrix.requiredPermissionForComponent('agency-scope-budgets'), BILLING);
  assert.equal(matrix.requiredPermissionForComponent('agency-rate-cards'), BILLING);
  assert.deepEqual(matrix.validate(), []);
  for (const [method, permission] of [['GET', VIEW], ['HEAD', VIEW], ['POST', EDIT]]) {
    const result = matrix.requiredPermissionForRequest(SCOPES, method);
    assert.equal(result.matched, true);
    assert.equal(result.permission, permission);
  }
});

test('GET needs view+billing and POST edit+billing, denying before any DB access', async (t) => {
  for (const [method, coarse] of [['GET', VIEW], ['POST', EDIT]]) {
    for (const [grants, required] of [[[], coarse], [[BILLING], coarse], [[coarse], BILLING],
      [[VIEW, EDIT], BILLING], [[BILLING, method === 'GET' ? EDIT : VIEW], coarse]]) {
      await t.test(method + ' denies ' + (grants.join(',') || 'no grants'), async (t) => {
        const { request, calls, dbAccess } = await fixture(t, principal(grants));
        const response = await request(method, SCOPES, method === 'POST' ? payload : undefined);
        assert.equal(response.status, 403);
        assert.equal(response.body.ok, false);
        assert.equal(response.body.error, 'forbidden');
        assert.equal(response.body.required, required);
        assert.deepEqual(calls, []);
        assert.deepEqual(dbAccess, []);
      });
    }
  }
});

test('invalid tenant rejects even owners; query/body tenant overrides cannot rescue it', async (t) => {
  for (const tenantId of [null, 0, -1, '101x', '01', ' 101 ', 1.5, true, {}, Number.MAX_SAFE_INTEGER + 1]) {
    for (const isOwner of [false, true]) {
      const { request, dbAccess } = await fixture(t,
        principal([VIEW, EDIT, BILLING], tenantId, { user: { id: 7, isOwner } }));
      for (const method of ['GET', 'POST']) {
        const response = await request(method, SCOPES + '?tenant_id=101&tenantId=101',
          { ...payload, tenant_id: 101, tenantId: 101 });
        assert.deepEqual(response, { status: 400, body: { ok: false, error: 'no_tenant' } });
      }
      assert.deepEqual(dbAccess, []);
    }
  }
});

test('GET binds tenant/overlap/exact client; projected dates survive non-UTC pg parsing, numerics stay raw', async (t) => {
  const clientRef = "Client %_' OR 1=1 --";
  for (const tenantId of [101, 202]) {
    const stored = { id: 'scope-' + tenantId, ...payload, client_ref: clientRef,
      contracted_hours: '12.50', change_budget_hours: '2.00', contracted_value: '1200.00' };
    const { request, calls } = await fixture(t, principal([VIEW, BILLING], tenantId), (sql, params) => {
      assert.ok(sql.startsWith('SELECT id, client_ref, project_ref, name, ' +
        "to_char(period_start, 'YYYY-MM-DD') AS period_start, to_char(period_end, 'YYYY-MM-DD') AS period_end, "));
      assert.match(sql, /contracted_hours, change_budget_hours, contracted_value, currency, active FROM agency_scope_baselines/);
      assert.match(sql, /WHERE tenant_id=\$1 AND active=true AND period_end >= \$2::date AND period_start <= \$3::date AND client_ref=\$4 /);
      assert.match(sql, /ORDER BY period_start ASC, client_ref ASC$/);
      assert.ok(!sql.includes(clientRef));
      assert.deepEqual(params, [tenantId, range.from, range.to, clientRef]);
      return { rows: [projectedBaseline(sql, stored)] };
    });
    const other = tenantId === 101 ? 202 : 101;
    const response = await request('GET', SCOPES + rangeQuery + '&client_ref=' + encodeURIComponent(' ' + clientRef + ' ')
      + '&active=false&tenant_id=' + other + '&tenantId=' + other, { tenant_id: other, tenantId: other });
    assert.deepEqual(response, { status: 200, body: { ok: true, period: range, baselines: [jsonValue(stored)] } });
    assert.equal(calls.length, 1);
  }
});

test('GET without client keeps active-only overlap and defaults to UTC month-to-date', async (t) => {
  const periods = [];
  const { request, calls } = await fixture(t, principal([VIEW, BILLING]), (sql, params) => {
    assert.match(sql, /WHERE tenant_id=\$1 AND active=true AND period_end >= \$2::date AND period_start <= \$3::date ORDER BY/);
    assert.equal(params.length, 3);
    assert.equal(params[0], 101);
    periods.push({ from: params[1], to: params[2] });
    return { rows: [] };
  });
  const before = new Date().toISOString().slice(0, 10);
  const response = await request('GET', SCOPES + '?active=false&tenant_id=202');
  const after = new Date().toISOString().slice(0, 10);
  assert.ok([before, after].some((day) => periods[0].to === day && periods[0].from === day.slice(0, 8) + '01'));
  assert.deepEqual(response, { status: 200, body: { ok: true, period: periods[0], baselines: [] } });
  assert.equal(calls.length, 1);
});

test('POST binds allowlisted tenant/business refs without entity lookup; projected dates survive non-UTC pg parsing', async (t) => {
  for (const tenantId of [101, 202]) {
    for (const active of [true, false]) {
      const clientRef = "unknown-client '); --", projectRef = active ? 'arbitrary-project-202' : null;
      let stored;
      const { request, calls } = await fixture(t, principal([EDIT, BILLING], tenantId), (sql, params) => {
        assert.equal(sql, 'INSERT INTO agency_scope_baselines ' +
          '(id, tenant_id, client_ref, project_ref, name, period_start, period_end, contracted_hours, change_budget_hours, contracted_value, currency, active, updated_at) ' +
          'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW()) ' +
          'RETURNING id, tenant_id, client_ref, project_ref, name, ' +
          "to_char(period_start, 'YYYY-MM-DD') AS period_start, to_char(period_end, 'YYYY-MM-DD') AS period_end, " +
          'contracted_hours, change_budget_hours, contracted_value, currency, active, created_at, updated_at');
        assert.match(params[0], /^scope_[a-f0-9]{12}$/);
        assert.deepEqual(params.slice(1), [tenantId, clientRef, projectRef, payload.name, range.from, range.from,
          active ? 1000000 : 0, active ? 0 : 1000000, active ? 1000000000 : 0, 'EUR', active]);
        stored = { ...payload, id: params[0], tenant_id: tenantId, client_ref: clientRef, project_ref: projectRef,
          period_start: range.from, period_end: range.from,
          contracted_hours: params[7].toFixed(2), change_budget_hours: params[8].toFixed(2),
          contracted_value: params[9].toFixed(2), currency: 'EUR', active,
          created_at: 'server-created', updated_at: 'server-updated' };
        return { rows: [projectedBaseline(sql, stored)] };
      });
      const other = tenantId === 101 ? 202 : 101;
      const response = await request('POST', SCOPES + '?tenant_id=' + other + '&tenantId=' + other, { ...payload,
        id: 'caller-chosen', tenant_id: other, tenantId: other, user_id: 999, member_id: 'foreign-member',
        created_at: 'caller-time', updated_at: 'caller-time', extra: 'ignored',
        client_ref: ' ' + clientRef + ' ', project_ref: projectRef, name: ' ' + payload.name + ' ',
        period_start: range.from, period_end: range.from, contracted_hours: active ? '1000000' : 0,
        change_budget_hours: active ? 0 : 1000000, contracted_value: active ? 1000000000 : 0, currency: ' eur ', active });
      assert.deepEqual(response, { status: 201, body: { ok: true, baseline: jsonValue(stored) } });
      assert.equal(calls.length, 1);
    }
  }
});

test('POST preserves existing zero/USD/active defaults when optional values are omitted', async (t) => {
  const { request, calls } = await fixture(t, principal([EDIT, BILLING]), (_sql, params) => {
    assert.deepEqual(params.slice(7), [0, 0, 0, 'USD', true]);
    return { rows: [{ id: params[0] }] };
  });
  const { client_ref, name, period_start, period_end } = payload;
  assert.equal((await request('POST', SCOPES, { client_ref, name, period_start, period_end })).status, 201);
  assert.equal(calls.length, 1);
});

test('invalid POST contract fails before DB queries or writes', async (t) => {
  const cases = [
    [{ client_ref: '' }, 'client_ref required'], [{ name: ' ' }, 'name required'],
    ...['client_ref', 'project_ref', 'name'].map((key) => [{ [key]: 'x'.repeat(201) }, key + ' too long']),
    [{ currency: ' ' }, 'currency required'], [{ currency: 'x'.repeat(11) }, 'currency too long'],
    [{ period_start: '2026-9-1' }, 'period_start must be YYYY-MM-DD'],
    [{ period_start: '2026-02-30' }, 'period_start must be a real calendar date'],
    [{ period_end: null }, 'period_end must be YYYY-MM-DD'],
    [{ period_end: '2026-09-31' }, 'period_end must be a real calendar date'],
    [{ period_end: '2026-08-31' }, 'period_end must be on or after period_start'],
    [{ active: 'yes' }, 'boolean value expected'], [{ active: 1 }, 'boolean value expected'],
  ];
  for (const [key, max] of [['contracted_hours', 1000000], ['change_budget_hours', 1000000], ['contracted_value', 1000000000]]) {
    for (const value of [-0.01, max + 1, 'NaN', 'Infinity']) cases.push([{ [key]: value }, key + ' must be between 0 and ' + max]);
  }
  const { request, calls } = await fixture(t, principal([EDIT, BILLING]));
  for (const [fields, error] of cases) {
    assert.deepEqual(await request('POST', SCOPES, { ...payload, ...fields }),
      { status: 400, body: { ok: false, error } }, JSON.stringify(fields));
  }
  assert.deepEqual(calls, []);
});

test('invalid GET dates/order/client length fail before DB queries', async (t) => {
  const { request, calls } = await fixture(t, principal([VIEW, BILLING]));
  for (const [query, error] of [
    ['from=2026-9-9&to=2026-09-10', 'from must be YYYY-MM-DD'],
    ['from=2026-02-30&to=2026-09-10', 'from must be a real calendar date'],
    ['from=2026-09-09&to=2026-09-31', 'to must be a real calendar date'],
    ['from=2026-09-10&to=2026-09-09', 'from must be on or before to'],
    ['client_ref=' + 'x'.repeat(201), 'client_ref too long'],
  ]) assert.deepEqual(await request('GET', SCOPES + '?' + query), { status: 400, body: { ok: false, error } });
  assert.deepEqual(calls, []);
});

test('missing DB returns empty GET without period and 503 POST, never fabricated data', async (t) => {
  const { request, calls, dbAccess } = await fixture(t, principal([VIEW, EDIT, BILLING]), undefined, false);
  assert.deepEqual(await request('GET'), { status: 200, body: { ok: true, baselines: [] } });
  assert.deepEqual(await request('POST', SCOPES, payload),
    { status: 503, body: { ok: false, error: 'database not configured' } });
  assert.deepEqual(calls, []);
  assert.deepEqual(dbAccess, ['hasDb', 'hasDb']);
});
