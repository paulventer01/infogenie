'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

process.env.PERMISSION_ENFORCEMENT = 'on';
require('./helpers/env');

const db = require('../db');
const tenantCtx = require('../services/tenants/context');
const { ensureAuthSchema } = require('../services/auth/schema');
const { ensureTenantSchema } = require('../services/tenants/schema');
const { ensureCapacitySchema } = require('../services/capacity/schema');
const { ensureAgencyOpsSchema } = require('../services/agency_ops/schema');

const HAS_DB = db.hasDb();
const skip = HAS_DB ? false : 'no DATABASE_URL — agency operations integration skipped';
const SUFFIX = 'agency-ops-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex');

const tenantIds = [];
let server = null;
let port = 0;
const originalResolveTenantId = tenantCtx.resolveTenantId;

function request(method, pathname, { tid, body, permissions } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const headers = { 'content-type': 'application/json' };
    if (tid != null) headers['x-test-tid'] = String(tid);
    if (permissions) headers['x-test-permissions'] = permissions.join(',');
    if (data) headers['content-length'] = Buffer.byteLength(data);
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method, headers }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (_) {}
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

test('agency operations schema is tenant-scoped and has no provider-action surface', () => {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'services', 'agency_ops', 'schema.js'), 'utf8');
  const api = fs.readFileSync(path.join(__dirname, '..', 'services', 'agency_ops', 'api.js'), 'utf8');
  for (const table of ['agency_time_entries', 'agency_rate_cards', 'agency_scope_baselines']) {
    assert.match(schema, new RegExp('CREATE TABLE IF NOT EXISTS ' + table));
  }
  assert.equal((schema.match(/tenant_id INT NOT NULL REFERENCES tenants\(id\) ON DELETE CASCADE/g) || []).length, 3);
  assert.match(schema, /member_role TEXT/);
  assert.doesNotMatch(api, /fetch\s*\(|axios|google|meta|tiktok|publish|activate/i);
  assert.match(api, /e\.tenant_id=\$1/);
  assert.match(api, /WHERE id=\$1 AND tenant_id=\$2/);
});


test('agency operations routes carry the shared tenant limiter and CodeQL disposition', () => {
  const api = fs.readFileSync(path.join(__dirname, '..', 'services', 'agency_ops', 'api.js'), 'utf8');
  const lines = api.split('\n');
  const registrations = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^router\.(get|post|put|patch|delete)\(/.test(line));
  assert.equal(registrations.length, 10);
  for (const { line, index } of registrations) {
    assert.match(line, /agencyOpsSharedLimiter/);
    assert.equal(
      lines[index - 1],
      '// codeql[js/missing-rate-limiting] rate limited by createRateLimiter keyed on req.tenant.id',
      `missing CodeQL disposition for ${line.trim()}`,
    );
  }
  assert.match(api, /keyFn: _agencyOpsRateLimitKey/);
  assert.match(api, /failClosed: true/);
  assert.match(api, /member_role=CASE WHEN member_id IS DISTINCT FROM/);
});

test('agency operations limiter is tenant-scoped and fail-closed', async () => {
  const agencyOpsApi = require('../services/agency_ops/api');
  const limiter = agencyOpsApi._agencyOpsRateLimiter;
  const limits = agencyOpsApi.agencyOpsLimits;
  const hit = (tenantId) => new Promise((resolve, reject) => {
    const req = { tenant: tenantId == null ? null : { id: tenantId }, headers: {}, socket: {}, path: '/agency-ops' };
    const res = {
      setHeader() { return res; },
      status(code) {
        return {
          json(body) { resolve({ status: code, body }); },
        };
      },
    };
    try {
      limiter(req, res, () => resolve({ status: 200 }));
    } catch (error) {
      reject(error);
    }
  });
  limiter.reset();
  try {
    for (let i = 0; i < limits.max; i++) {
      assert.equal((await hit(901)).status, 200);
    }
    assert.equal((await hit(901)).status, 429);
    assert.equal((await hit(902)).status, 200);
    assert.equal((await hit(null)).status, 429);
  } finally {
    limiter.reset();
  }
});

before(async () => {
  if (!HAS_DB) return;
  await ensureAuthSchema();
  await ensureTenantSchema();
  await ensureCapacitySchema();
  await ensureAgencyOpsSchema();

  const pool = db.getPool();
  for (const label of ['a', 'b']) {
    const tenant = await pool.query(
      'INSERT INTO tenants (name, slug, status) VALUES ($1,$2,\'active\') RETURNING id',
      ['Agency Ops ' + label + ' ' + SUFFIX, 'agency-ops-' + label + '-' + SUFFIX],
    );
    tenantIds.push(tenant.rows[0].id);
  }
  await pool.query(
    'INSERT INTO team_capacity (id, tenant_id, member_name, role, weekly_hours, allocated_hours) VALUES ($1,$2,$3,$4,40,0),($5,$6,$7,$8,40,0)',
    ['member-a-' + SUFFIX, tenantIds[0], 'Agency A', 'designer',
      'member-b-' + SUFFIX, tenantIds[1], 'Agency B', 'designer'],
  );

  tenantCtx.resolveTenantId = async (req) => {
    const value = req && req.headers && req.headers['x-test-tid'];
    const id = Number.parseInt(value, 10);
    return Number.isFinite(id) ? id : null;
  };

  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 1, isOwner: false };
    const permissionHeader = req.headers['x-test-permissions'];
    req.can = permissionHeader === undefined
      ? () => true
      : (permission) => String(permissionHeader).split(',').includes(permission);
    const testTenantId = Number.parseInt(req.headers['x-test-tid'], 10);
    req.tenant = Number.isSafeInteger(testTenantId) && testTenantId > 0
      ? { id: testTenantId }
      : null;
    next();
  });
  app.use('/api/agency-ops', require('../services/agency_ops/api'));
  app.use('/api/capacity', require('../services/capacity/api'));
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      resolve();
    });
  });
});

after(async () => {
  tenantCtx.resolveTenantId = originalResolveTenantId;
  if (server) await new Promise((resolve) => server.close(resolve));
  if (!HAS_DB) return;
  const pool = db.getPool();
  const ids = tenantIds.filter(Boolean);
  if (!ids.length) return;
  await pool.query('DELETE FROM agency_time_entries WHERE tenant_id=ANY($1)', [ids]);
  await pool.query('DELETE FROM agency_rate_cards WHERE tenant_id=ANY($1)', [ids]);
  await pool.query('DELETE FROM agency_scope_baselines WHERE tenant_id=ANY($1)', [ids]);
  await pool.query('DELETE FROM team_capacity WHERE tenant_id=ANY($1)', [ids]);
  await pool.query('DELETE FROM tenants WHERE id=ANY($1)', [ids]);
});

test('financial agency operations endpoints require billing permission', { skip }, async () => {
  const tenantA = tenantIds[0];
  const projectOnly = { tid: tenantA, permissions: ['manage.projects.view'] };

  for (const pathname of ['/api/agency-ops/time-entries', '/api/agency-ops/scope-baselines', '/api/agency-ops/summary']) {
    const denied = await request('GET', pathname, projectOnly);
    assert.equal(denied.status, 403, denied.text);
    assert.equal(denied.json?.error, 'forbidden');
    assert.equal(denied.json?.required, 'tenant.billing.manage');

    const allowed = await request('GET', pathname, {
      tid: tenantA,
      permissions: ['manage.projects.view', 'tenant.billing.manage'],
    });
    assert.equal(allowed.status, 200, allowed.text);
  }

  const projectEditor = { tid: tenantA, permissions: ['manage.projects.edit'] };
  const billingEditor = {
    tid: tenantA,
    permissions: ['manage.projects.edit', 'tenant.billing.manage'],
  };
  let response = await request('POST', '/api/agency-ops/rates', {
    ...billingEditor,
    body: {
      role: 'designer',
      cost_rate: 10,
      bill_rate: 20,
      currency: 'USD',
      effective_from: '2026-01-01',
      effective_to: '2026-12-31',
    },
  });
  assert.equal(response.status, 201, response.text);

  response = await request('POST', '/api/agency-ops/time-entries', {
    ...projectEditor,
    body: {
      member_id: 'member-a-' + SUFFIX,
      client_ref: 'permission-time',
      work_item: 'Permission redaction check',
      work_date: '2026-02-01',
      hours: 1,
    },
  });
  assert.equal(response.status, 201, response.text);
  assert.equal(response.json.entry.rate_status, 'hidden');
  for (const field of ['cost_rate', 'bill_rate', 'currency', 'rate_source', 'cost_value', 'billable_value']) {
    assert.equal(response.json.entry[field], null, field + ' must be hidden without billing permission');
  }

  response = await request('PATCH', '/api/agency-ops/time-entries/' + response.json.entry.id, {
    ...projectEditor,
    body: { notes: 'patched redaction check' },
  });
  assert.equal(response.status, 200, response.text);
  assert.equal(response.json.entry.rate_status, 'hidden');
  assert.equal(response.json.entry.cost_value, null);
  assert.equal(response.json.entry.billable_value, null);

  response = await request(
    'GET',
    '/api/agency-ops/time-entries?from=2026-02-01&to=2026-02-01&client_ref=permission-time',
    { tid: tenantA, permissions: ['manage.projects.view', 'tenant.billing.manage'] },
  );
  assert.equal(response.status, 200, response.text);
  assert.equal(response.json.entries[0].rate_status, 'priced');
  assert.equal(response.json.entries[0].bill_rate, 20);

  const baseline = {
    client_ref: 'permission-check',
    name: 'Permission check baseline',
    period_start: '2026-01-01',
    period_end: '2026-01-31',
    contracted_hours: 10,
    change_budget_hours: 2,
    contracted_value: 1000,
  };
  const denied = await request('POST', '/api/agency-ops/scope-baselines', {
    ...projectOnly,
    body: baseline,
  });
  assert.equal(denied.status, 403, denied.text);
  assert.equal(denied.json?.required, 'tenant.billing.manage');

  const allowed = await request('POST', '/api/agency-ops/scope-baselines', {
    tid: tenantA,
    permissions: ['manage.projects.edit', 'tenant.billing.manage'],
    body: baseline,
  });
  assert.equal(allowed.status, 201, allowed.text);
});

test('time, rates, margin, scope signals, and capacity remain tenant-isolated', { skip }, async () => {
  const [tenantA, tenantB] = tenantIds;
  const memberA = 'member-a-' + SUFFIX;
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + '01';

  let response = await request('POST', '/api/agency-ops/rates', {
    tid: tenantA,
    body: {
      member_id: memberA,
      cost_rate: 50,
      bill_rate: 100,
      currency: 'USD',
      effective_from: monthStart,
    },
  });
  assert.equal(response.status, 201, response.text);

  response = await request('POST', '/api/agency-ops/scope-baselines', {
    tid: tenantA,
    body: {
      client_ref: 'client-acme',
      name: 'Acme monthly retainer',
      period_start: monthStart,
      period_end: today,
      contracted_hours: 1,
      change_budget_hours: 0,
      contracted_value: 100,
    },
  });
  assert.equal(response.status, 201, response.text);

  response = await request('POST', '/api/agency-ops/time-entries', {
    tid: tenantA,
    body: {
      member_id: memberA,
      client_ref: 'client-acme',
      work_item: 'Landing page revision',
      work_date: today,
      hours: 2,
      billable: true,
    },
  });
  assert.equal(response.status, 201, response.text);

  response = await request('GET', '/api/agency-ops/summary?from=' + monthStart + '&to=' + today, { tid: tenantA });
  assert.equal(response.status, 200, response.text);
  assert.equal(response.json.totals.hours, 2);
  assert.equal(response.json.totals.cost_value, 100);
  assert.equal(response.json.totals.billable_value, 200);
  assert.equal(response.json.totals.margin_value, 100);
  assert.equal(response.json.totals.margin_pct, 50);
  assert.equal(response.json.scope_signals[0].status, 'over_scope');
  assert.equal(response.json.scope_signals[0].overage_hours, 1);

  response = await request('GET', '/api/agency-ops/time-entries?from=' + monthStart + '&to=' + today, { tid: tenantB });
  assert.equal(response.status, 200, response.text);
  assert.equal(response.json.entries.length, 0);

  response = await request('POST', '/api/agency-ops/time-entries', {
    tid: tenantB,
    body: {
      member_id: memberA,
      client_ref: 'client-acme',
      work_item: 'Cross-tenant attempt',
      work_date: today,
      hours: 1,
    },
  });
  assert.equal(response.status, 400, response.text);

  response = await request('GET', '/api/capacity/summary', { tid: tenantA });
  assert.equal(response.status, 200, response.text);
  const member = (response.json.members || []).find((item) => item.id === memberA);
  assert.ok(member, 'capacity roster member should be present');
  assert.equal(Number(member.logged_hours), 2);
  assert.equal(Number(response.json.totals.logged_hours), 2);
});

test('time corrections validate input and cannot cross tenant boundaries', { skip }, async () => {
  const [tenantA, tenantB] = tenantIds;
  const memberA = 'member-a-' + SUFFIX;
  const base = {
    member_id: memberA,
    client_ref: 'correction-client',
    work_item: 'Original work',
    work_date: '2025-07-10',
    hours: 1,
  };

  let response = await request('POST', '/api/agency-ops/time-entries', { tid: tenantA, body: base });
  assert.equal(response.status, 201, response.text);
  const entryId = response.json.entry.id;

  response = await request('PATCH', '/api/agency-ops/time-entries/' + entryId, {
    tid: tenantA,
    body: { work_item: 'Corrected work', work_date: '2025-07-11', hours: 2.5, billable: false },
  });
  assert.equal(response.status, 200, response.text);
  assert.equal(response.json.entry.work_item, 'Corrected work');
  assert.equal(response.json.entry.work_date, '2025-07-11');
  assert.equal(response.json.entry.hours, 2.5);
  assert.equal(response.json.entry.billable, false);

  response = await request('PATCH', '/api/agency-ops/time-entries/' + entryId, {
    tid: tenantB,
    body: { hours: 9 },
  });
  assert.equal(response.status, 404, response.text);

  response = await request(
    'GET',
    '/api/agency-ops/time-entries?from=2025-07-11&to=2025-07-11&client_ref=correction-client',
    { tid: tenantA },
  );
  assert.equal(response.status, 200, response.text);
  assert.equal(response.json.entries.length, 1);
  assert.equal(response.json.entries[0].hours, 2.5, 'cross-tenant PATCH must not alter the entry');

  for (const body of [
    { ...base, hours: 0 },
    { ...base, hours: 25 },
    { ...base, work_date: '2025-02-29' },
    { ...base, work_date: 'not-a-date' },
  ]) {
    response = await request('POST', '/api/agency-ops/time-entries', { tid: tenantA, body });
    assert.equal(response.status, 400, response.text);
  }

  for (const body of [{}, { unsupported: true }]) {
    response = await request('PATCH', '/api/agency-ops/time-entries/' + entryId, { tid: tenantA, body });
    assert.equal(response.status, 400, response.text);
  }
});

test('effective rates honor date boundaries and prefer member pricing while missing pricing is signaled', { skip }, async () => {
  const tenantA = tenantIds[0];
  const memberA = 'member-a-' + SUFFIX;

  for (const body of [
    { role: 'designer', cost_rate: 10, bill_rate: 20, effective_from: '2025-01-01', effective_to: '2025-06-01' },
    { member_id: memberA, cost_rate: 30, bill_rate: 60, effective_from: '2025-06-01', effective_to: '2025-12-31' },
  ]) {
    const response = await request('POST', '/api/agency-ops/rates', { tid: tenantA, body });
    assert.equal(response.status, 201, response.text);
  }

  let pricedEntryId = null;
  for (const [workDate, workItem] of [
    ['2025-05-31', 'Role-priced work'],
    ['2025-06-01', 'Boundary member-priced work'],
  ]) {
    const response = await request('POST', '/api/agency-ops/time-entries', {
      tid: tenantA,
      body: { member_id: memberA, client_ref: 'rate-client', work_item: workItem, work_date: workDate, hours: 1 },
    });
    assert.equal(response.status, 201, response.text);
    assert.equal(response.json.entry.rate_status, 'priced');
    assert.equal(response.json.entry.currency, 'USD');
    if (workDate === '2025-05-31') pricedEntryId = response.json.entry.id;
  }

  assert.ok(pricedEntryId);
  let response = await request('PATCH', '/api/agency-ops/time-entries/' + pricedEntryId, {
    tid: tenantA,
    body: { work_item: 'Corrected priced work' },
  });
  assert.equal(response.status, 200, response.text);
  assert.equal(response.json.entry.rate_status, 'priced');
  assert.equal(response.json.entry.rate_source, 'role');
  assert.equal(response.json.entry.bill_rate, 20);

  response = await request(
    'GET',
    '/api/agency-ops/time-entries?from=2025-05-31&to=2025-06-01&client_ref=rate-client',
    { tid: tenantA },
  );
  assert.equal(response.status, 200, response.text);
  const byDate = Object.fromEntries(response.json.entries.map((entry) => [entry.work_date, entry]));
  assert.equal(byDate['2025-05-31'].rate_source, 'role');
  assert.equal(byDate['2025-05-31'].bill_rate, 20);
  assert.equal(byDate['2025-06-01'].rate_source, 'member');
  assert.equal(byDate['2025-06-01'].bill_rate, 60);

  response = await request('POST', '/api/agency-ops/time-entries', {
    tid: tenantA,
    body: {
      member_id: memberA,
      client_ref: 'unpriced-client',
      work_item: 'Work before any effective rate',
      work_date: '2024-12-31',
      hours: 3,
    },
  });
  assert.equal(response.status, 201, response.text);
  assert.equal(response.json.entry.rate_status, 'missing');
  assert.equal(response.json.entry.cost_rate, 0);
  assert.equal(response.json.entry.bill_rate, 0);

  response = await request(
    'GET',
    '/api/agency-ops/time-entries?from=2024-12-31&to=2024-12-31&client_ref=unpriced-client',
    { tid: tenantA },
  );
  assert.equal(response.status, 200, response.text);
  assert.equal(response.json.entries[0].rate_status, 'missing');
  assert.equal(response.json.entries[0].cost_rate, 0);
  assert.equal(response.json.entries[0].bill_rate, 0);

  response = await request(
    'GET',
    '/api/agency-ops/summary?from=2024-12-31&to=2024-12-31&client_ref=unpriced-client',
    { tid: tenantA },
  );
  assert.equal(response.status, 200, response.text);
  assert.equal(response.json.totals.unpriced_hours, 3);
  assert.equal(response.json.clients[0].unpriced_hours, 3);
});

test('time-entry pricing preserves the captured member role', { skip }, async () => {
  const tenantA = tenantIds[0];
  const memberA = 'member-a-' + SUFFIX;
  const pool = db.getPool();
  await pool.query(
    'UPDATE team_capacity SET role=$1 WHERE id=$2 AND tenant_id=$3',
    ['designer', memberA, tenantA],
  );

  try {
    for (const body of [
      {
        role: 'designer',
        cost_rate: 11,
        bill_rate: 22,
        effective_from: '2027-01-01',
        effective_to: '2027-12-31',
      },
      {
        role: 'strategist',
        cost_rate: 17,
        bill_rate: 34,
        effective_from: '2027-01-01',
        effective_to: '2027-12-31',
      },
    ]) {
      const response = await request('POST', '/api/agency-ops/rates', {
        tid: tenantA,
        permissions: ['manage.projects.edit', 'tenant.billing.manage'],
        body,
      });
      assert.equal(response.status, 201, response.text);
    }

    let response = await request('POST', '/api/agency-ops/time-entries', {
      tid: tenantA,
      permissions: ['manage.projects.edit', 'tenant.billing.manage'],
      body: {
        member_id: memberA,
        client_ref: 'role-snapshot-client',
        work_item: 'Role snapshot before promotion',
        work_date: '2027-02-01',
        hours: 1,
      },
    });
    assert.equal(response.status, 201, response.text);
    assert.equal(response.json.entry.member_role, 'designer');
    assert.equal(response.json.entry.bill_rate, 22);
    const historicalEntryId = response.json.entry.id;

    await pool.query(
      'UPDATE team_capacity SET role=$1 WHERE id=$2 AND tenant_id=$3',
      ['strategist', memberA, tenantA],
    );

    response = await request('PATCH', '/api/agency-ops/time-entries/' + historicalEntryId, {
      tid: tenantA,
      permissions: ['manage.projects.edit', 'tenant.billing.manage'],
      body: { member_id: memberA, hours: 1.5 },
    });
    assert.equal(response.status, 200, response.text);
    assert.equal(response.json.entry.hours, 1.5);
    assert.equal(response.json.entry.member_role, 'designer');
    assert.equal(response.json.entry.bill_rate, 22);

    response = await request(
      'GET',
      '/api/agency-ops/time-entries?from=2027-02-01&to=2027-02-01&client_ref=role-snapshot-client',
      { tid: tenantA, permissions: ['manage.projects.view', 'tenant.billing.manage'] },
    );
    assert.equal(response.status, 200, response.text);
    assert.equal(response.json.entries[0].id, historicalEntryId);
    assert.equal(response.json.entries[0].member_role, 'designer');
    assert.equal(response.json.entries[0].bill_rate, 22);

    response = await request('POST', '/api/agency-ops/time-entries', {
      tid: tenantA,
      permissions: ['manage.projects.edit', 'tenant.billing.manage'],
      body: {
        member_id: memberA,
        client_ref: 'role-snapshot-client',
        work_item: 'Role snapshot after promotion',
        work_date: '2027-02-02',
        hours: 1,
      },
    });
    assert.equal(response.status, 201, response.text);
    assert.equal(response.json.entry.member_role, 'strategist');
    assert.equal(response.json.entry.bill_rate, 34);
  } finally {
    await pool.query(
      'UPDATE team_capacity SET role=$1 WHERE id=$2 AND tenant_id=$3',
      ['designer', memberA, tenantA],
    );
  }
});

test('same-date rate corrections use the latest rate-card revision', { skip }, async () => {
  const tenantA = tenantIds[0];
  const memberA = 'member-a-' + SUFFIX;
  const effectiveFrom = '2028-01-01';

  for (const [costRate, billRate] of [[40, 80], [45, 90]]) {
    const response = await request('POST', '/api/agency-ops/rates', {
      tid: tenantA,
      body: {
        member_id: memberA,
        cost_rate: costRate,
        bill_rate: billRate,
        currency: 'USD',
        effective_from: effectiveFrom,
      },
    });
    assert.equal(response.status, 201, response.text);
  }

  const response = await request('POST', '/api/agency-ops/time-entries', {
    tid: tenantA,
    body: {
      member_id: memberA,
      client_ref: 'same-date-rate-correction',
      work_item: 'Latest rate revision',
      work_date: '2028-01-15',
      hours: 1,
    },
  });
  assert.equal(response.status, 201, response.text);
  assert.equal(response.json.entry.cost_rate, 45);
  assert.equal(response.json.entry.bill_rate, 90);
});

test('agency summary reports one currency and rejects mixed financial totals', () => {
  const agencyOpsApi = require('../services/agency_ops/api');
  const range = { from: '2026-01-01', to: '2026-01-31' };
  const usdEntry = {
    client_ref: 'currency-client',
    hours: 1,
    billable: true,
    cost_value: 10,
    billable_value: 20,
    rate_status: 'priced',
    currency: 'usd',
  };

  const single = agencyOpsApi._buildSummary(range, {}, [usdEntry], []);
  assert.equal(single.totals.currency, 'USD');
  assert.equal(single.clients[0].currency, 'USD');

  assert.throws(
    () => agencyOpsApi._buildSummary(range, {}, [usdEntry, { ...usdEntry, currency: 'EUR' }], []),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.publicCode, 'mixed_currencies');
      assert.deepEqual(error.currencies, ['EUR', 'USD']);
      return true;
    },
  );
});

test('agency aggregate reads are uncapped while listing reads retain the 500-row cap', async () => {
  const agencyOpsApi = require('../services/agency_ops/api');
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(sql);
      return { rows: [] };
    },
  };
  const range = { from: '2026-01-01', to: '2026-01-31' };

  await agencyOpsApi._fetchEntries(pool, 1, range, {});
  assert.doesNotMatch(queries[0], /LIMIT 500/);
  await agencyOpsApi._fetchEntries(pool, 1, range, {}, { limit: 500 });
  assert.match(queries[1], /LIMIT 500/);
});

test('scope signal reads expand to the complete range of overlapping baselines', () => {
  const agencyOpsApi = require('../services/agency_ops/api');
  assert.deepEqual(
    agencyOpsApi._baselineRange([
      { period_start: '2026-02-01', period_end: '2026-03-31' },
      { period_start: '2026-01-15', period_end: '2026-02-20' },
    ]),
    { from: '2026-01-15', to: '2026-03-31' },
  );
  assert.equal(agencyOpsApi._baselineRange([]), null);
});

test('summary keeps financial totals narrow while scope signals use full baseline periods', () => {
  const agencyOpsApi = require('../services/agency_ops/api');
  const range = { from: '2026-03-01', to: '2026-03-31' };
  const marchEntry = {
    client_ref: 'scope-client',
    project_ref: null,
    work_date: '2026-03-15',
    hours: 1,
    billable: true,
    cost_value: 10,
    billable_value: 20,
    rate_status: 'priced',
    currency: 'USD',
  };
  const historicalEntry = {
    ...marchEntry,
    work_date: '2026-01-15',
    hours: 11,
    cost_value: 110,
    billable_value: 220,
  };
  const summary = agencyOpsApi._buildSummary(
    range,
    {},
    [marchEntry],
    [{
      id: 'scope-1',
      client_ref: 'scope-client',
      project_ref: null,
      name: 'Quarterly scope',
      period_start: '2026-01-01',
      period_end: '2026-03-31',
      contracted_hours: 10,
      change_budget_hours: 0,
      contracted_value: 100,
      currency: 'USD',
    }],
    [marchEntry, historicalEntry],
  );

  assert.equal(summary.totals.hours, 1);
  assert.equal(summary.scope_signals[0].actual_hours, 12);
  assert.equal(summary.scope_signals[0].status, 'over_scope');
  assert.equal(summary.totals.scope_overage_hours, 2);
});
