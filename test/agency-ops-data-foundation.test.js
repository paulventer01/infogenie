'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/infogenie';
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

function request(method, pathname, { tid, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const headers = { 'content-type': 'application/json' };
    if (tid != null) headers['x-test-tid'] = String(tid);
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
  assert.doesNotMatch(api, /fetch\s*\(|axios|google|meta|tiktok|publish|activate/i);
  assert.match(api, /e\.tenant_id=\$1/);
  assert.match(api, /WHERE id=\$1 AND tenant_id=\$2/);
});


test('agency operations routes carry the shared tenant limiter and CodeQL disposition', () => {
  const api = fs.readFileSync(path.join(__dirname, '..', 'services', 'agency_ops', 'api.js'), 'utf8');
  const lines = api.split('\\n');
  const registrations = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^router\\.(get|post|put|patch|delete)\\(/.test(line));
  assert.equal(registrations.length, 9);
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
    req.user = { id: 1, isOwner: true };
    req.can = () => true;
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
