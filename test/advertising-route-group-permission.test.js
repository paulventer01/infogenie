'use strict';
// test/advertising-route-group-permission.test.js — Fail-closed gating for the
// whole `/api/advertising` namespace.
//
// WHY: `enforceMatrix` treats an `/api/...` path that matches no ROUTE_GROUPS
// prefix as "allow + log". Both live advertising routers are mounted under
// longer child prefixes, so before the parent row existed every other path in
// the namespace (`/api/advertising`, `/api/advertising/<anything-else>`) fell
// through that gap and was allowed for every authenticated principal even with
// PERMISSION_ENFORCEMENT=on.
//
// This file locks the fix from both ends:
//   • the matrix resolves the parent prefix to a permission that no system role
//     inherits, and longest-prefix-wins still hands the two child prefixes their
//     dedicated execute / execute-approved keys;
//   • the SHIPPED enforcer (mounted the way server.js mounts it) denies with a
//     clean 403 in strict mode, allows a principal that actually holds the key,
//     scopes that grant to the active tenant via the SHIPPED tenant-context
//     loader, and still honours the off/shadow kill-switch.
//
// Run: node --test test/advertising-route-group-permission.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

const matrix = require('../services/tenants/permission_matrix');
const { PERMISSIONS, SYSTEM_ROLES, isValidPermission } = require('../services/tenants/permissions');
const { loadTenantContext } = require('../services/tenants/middleware');
const db = require('../db');

const PARENT   = 'advertising.campaign.optimization.review';
const EXECUTE  = 'advertising.campaign.optimization.execute';
const APPROVED = 'advertising.campaign.optimization.execute.approved';

// A path in the namespace that no router owns today — exactly the shape that
// used to fall through the unmapped-path gap.
const UNCLAIMED = '/api/advertising/unclaimed-surface';

// ── Matrix: the parent row exists, is narrow, and shadows nothing ───────────
test('matrix: the parent /api/advertising row covers the bare prefix and any unclaimed child', () => {
  for (const path of ['/api/advertising', UNCLAIMED, '/api/advertising/a/b/c']) {
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      const m = matrix.requiredPermissionForRequest(path, method);
      assert.equal(m.matched, true, `${method} ${path} must match a group`);
      assert.equal(m.permission, PARENT, `${method} ${path} must require ${PARENT}`);
      assert.equal(m.group.prefix, '/api/advertising');
    }
  }
  // A look-alike sibling segment must NOT be captured by the parent row.
  assert.notEqual(
    matrix.requiredPermissionForRequest('/api/advertising-extra', 'GET').permission,
    PARENT,
  );
});

test('matrix: longest-prefix precedence keeps the dedicated execute keys authoritative', () => {
  const cases = [
    ['/api/advertising/optimization-executions',            EXECUTE],
    ['/api/advertising/optimization-executions/req-1',      EXECUTE],
    ['/api/advertising/optimization-executions/req-1/plan', EXECUTE],
    ['/api/advertising/optimization-execution-runs',        APPROVED],
    ['/api/advertising/optimization-execution-runs/run-1',  APPROVED],
  ];
  for (const [path, expected] of cases) {
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
      assert.equal(
        matrix.requiredPermissionForRequest(path, method).permission, expected,
        `${method} ${path} must keep requiring ${expected}`,
      );
    }
  }
});

test('matrix: the parent key is a real tenant-scope key that no system role inherits', () => {
  const byKey = Object.fromEntries(PERMISSIONS.map(p => [p.key, p]));
  assert.equal(isValidPermission(PARENT), true);
  assert.equal(byKey[PARENT].scope, 'tenant', 'namespace gates are tenant-scoped, never platform');
  for (const role of SYSTEM_ROLES) {
    assert.equal(
      role.permissions.includes(PARENT), false,
      `${role.key} must not inherit ${PARENT} — the namespace default stays fail-closed`,
    );
  }
  assert.deepEqual(matrix.validate(), [], 'matrix references only catalog keys');
});

test('matrix: the coverage matcher now resolves the /api/advertising first segment', () => {
  // Mirrors test/permission-matrix-coverage.test.js, which reduces every mount
  // in server.js to its first path segment before matching.
  assert.equal(matrix.requiredPermissionForRequest('/api/advertising', 'GET').matched, true);
});

// ── Enforcement harness (the shipped middleware, over real HTTP) ────────────
// The enforcement mode is read once at module load, so load a fresh copy of the
// enforcer per mode.
function freshEnforcer(mode) {
  const prev = process.env.PERMISSION_ENFORCEMENT;
  process.env.PERMISSION_ENFORCEMENT = mode;
  delete require.cache[require.resolve('../services/tenants/permission_enforce')];
  const enforce = require('../services/tenants/permission_enforce');
  if (prev === undefined) delete process.env.PERMISSION_ENFORCEMENT;
  else process.env.PERMISSION_ENFORCEMENT = prev;
  return enforce;
}

// `attach` stands in for the auth + tenant-context stack ahead of the enforcer.
async function makeServer({ mode, attach }) {
  const enforce = freshEnforcer(mode);
  const app = express();
  app.use(attach);
  app.use(enforce.enforceMatrix);
  app.use('/api/advertising', (req, res) => res.json({ ok: true, hit: req.originalUrl }));
  const server = await new Promise((resolve) => {
    const s = http.createServer(app).listen(0, '127.0.0.1', () => resolve(s));
  });
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}`, enforce };
}

function req(baseUrl, method, pathname) {
  return new Promise((resolve, reject) => {
    const r = http.request(baseUrl + pathname, { method }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        let json = null; try { json = JSON.parse(body); } catch (_) {}
        resolve({ status: res.statusCode, json });
      });
    });
    r.on('error', reject);
    r.end();
  });
}

// Principal shaped like the one loadTenantContext attaches.
function attachGrants(keys, extra = {}) {
  const perms = new Set(keys);
  return (rq, _res, next) => {
    rq.user = { id: 11, email: 'member@test.co', isOwner: false, ...(extra.user || {}) };
    rq.permissions = perms;
    rq.can = (k) => perms.has(k);
    rq.platformRole = extra.platformRole || null;
    next();
  };
}

function roleGrants(roleKey) {
  const role = SYSTEM_ROLES.find(r => r.key === roleKey);
  if (!role) throw new Error(`unknown role ${roleKey}`);
  return role.permissions;
}

// ── Strict mode: authorized, missing permission, no execution spillover ─────
test('on: a principal holding the namespace key reaches an unclaimed advertising path', async () => {
  const { server, baseUrl } = await makeServer({ mode: 'on', attach: attachGrants([PARENT]) });
  try {
    const read = await req(baseUrl, 'GET', UNCLAIMED);
    assert.equal(read.status, 200, 'holder read allowed');
    assert.equal(read.json.ok, true);

    const write = await req(baseUrl, 'POST', UNCLAIMED);
    assert.equal(write.status, 200, 'holder write allowed');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('on: a principal without the namespace key is denied with a clean 403', async () => {
  for (const roleKey of ['marketer', 'analyst', 'client_viewer', 'content_creator', 'tenant_admin']) {
    const { server, baseUrl } = await makeServer({
      mode: 'on', attach: attachGrants(roleGrants(roleKey)),
    });
    try {
      for (const method of ['GET', 'POST', 'DELETE']) {
        const r = await req(baseUrl, method, UNCLAIMED);
        assert.equal(r.status, 403, `${roleKey} ${method} must be denied`);
        assert.equal(r.json.ok, false);
        assert.equal(r.json.error, 'forbidden');
        assert.equal(r.json.required, PARENT);
      }
      const bare = await req(baseUrl, 'GET', '/api/advertising');
      assert.equal(bare.status, 403, `${roleKey} must be denied at the bare prefix too`);
    } finally {
      await new Promise((r) => server.close(r));
    }
  }
});

test('on: the namespace key grants no authority over the execute child prefixes', async () => {
  const { server, baseUrl } = await makeServer({ mode: 'on', attach: attachGrants([PARENT]) });
  try {
    const plan = await req(baseUrl, 'POST', '/api/advertising/optimization-executions/req-1');
    assert.equal(plan.status, 403, 'review must not approve an execution plan');
    assert.equal(plan.json.required, EXECUTE);

    const run = await req(baseUrl, 'POST', '/api/advertising/optimization-execution-runs/run-1');
    assert.equal(run.status, 403, 'review must not execute an approved action');
    assert.equal(run.json.required, APPROVED);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

// ── Tenant scoping through the shipped context loader ───────────────────────
// loadTenantContext builds req.permissions from the ACTIVE tenant's role only,
// and its membership query selects `tu.status = 'active'` rows. Driving it with
// a stub pool exercises that resolution without needing Postgres.
function withStubPool(membershipRows, onSql) {
  const realHasDb = db.hasDb;
  const realGetPool = db.getPool;
  db.hasDb = () => true;
  db.getPool = () => ({
    query: async (sql) => {
      if (onSql) onSql(sql);
      if (/FROM\s+tenant_users/i.test(sql)) return { rows: membershipRows };
      if (/FROM\s+platform_users/i.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  });
  return () => { db.hasDb = realHasDb; db.getPool = realGetPool; };
}

function membership({ tenantId, roleKey, permissions }) {
  return {
    tenant_id: tenantId,
    tenant_name: `Tenant ${tenantId}`,
    tenant_slug: `tenant-${tenantId}`,
    tenant_status: 'active',
    role_id: tenantId * 10,
    role_key: roleKey,
    role_name: roleKey,
    role_permissions: permissions,
    member_status: 'active',
  };
}

// Attach real auth-ish user + session, then the SHIPPED context loader.
function attachLoadedContext(activeTenantId) {
  return (rq, res, next) => {
    rq.user = { id: 11, email: 'member@test.co', isOwner: false, principalType: 'human' };
    rq.session = { userId: 11, activeTenantId };
    rq.sessionID = 'session-11';
    loadTenantContext(rq, res, next);
  };
}

test('on: an inactive membership holds nothing and is denied the advertising namespace', async () => {
  let membershipSql = '';
  // A suspended member (or a suspended tenant) returns zero rows from the
  // context loader's membership query — assert that filter is really there, so
  // the zero-row premise is the product's behaviour and not the stub's.
  const restore = withStubPool([], (sql) => {
    if (/FROM\s+tenant_users/i.test(sql)) membershipSql = sql;
  });
  const { server, baseUrl } = await makeServer({ mode: 'on', attach: attachLoadedContext(41) });
  try {
    const read = await req(baseUrl, 'GET', UNCLAIMED);
    assert.equal(read.status, 403, 'inactive membership must not reach the namespace');
    assert.equal(read.json.required, PARENT);
    const write = await req(baseUrl, 'POST', '/api/advertising/optimization-executions/req-1');
    assert.equal(write.status, 403);
    assert.equal(write.json.required, EXECUTE);
    assert.match(membershipSql, /tu\.status\s*=\s*'active'/, 'membership query filters active members');
    assert.match(membershipSql, /t\.status\s*=\s*'active'/, 'membership query filters active tenants');
  } finally {
    await new Promise((r) => server.close(r));
    restore();
  }
});

test('on: the namespace grant is scoped to the active tenant, not carried across tenants', async () => {
  const rows = [
    membership({ tenantId: 7,  roleKey: 'marketer',    permissions: roleGrants('marketer') }),
    membership({ tenantId: 41, roleKey: 'ads_reviewer', permissions: [PARENT] }),
  ];

  // Active tenant 7 — the grant lives in tenant 41, so it must not apply here.
  let restore = withStubPool(rows);
  let s = await makeServer({ mode: 'on', attach: attachLoadedContext(7) });
  try {
    const denied = await req(s.baseUrl, 'GET', UNCLAIMED);
    assert.equal(denied.status, 403, 'a grant in another tenant must not authorize this one');
    assert.equal(denied.json.required, PARENT);
  } finally {
    await new Promise((r) => s.server.close(r));
    restore();
  }

  // Same user, active tenant 41 — the grant applies.
  restore = withStubPool(rows);
  s = await makeServer({ mode: 'on', attach: attachLoadedContext(41) });
  try {
    const allowed = await req(s.baseUrl, 'GET', UNCLAIMED);
    assert.equal(allowed.status, 200, 'the granting tenant is authorized');
    assert.equal(allowed.json.ok, true);
  } finally {
    await new Promise((r) => s.server.close(r));
    restore();
  }
});

// ── Kill-switch compatibility (already supported by permission_enforce) ─────
test('off: the kill-switch still allows the namespace without blocking', async () => {
  const { server, baseUrl, enforce } = await makeServer({
    mode: 'off', attach: attachGrants(roleGrants('client_viewer')),
  });
  try {
    assert.equal(enforce.isOff(), true);
    const read = await req(baseUrl, 'GET', UNCLAIMED);
    assert.equal(read.status, 200, 'off never blocks');
    assert.equal(enforce.snapshot().stats.denied, 0);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('shadow: a would-be advertising denial is counted but allowed', async () => {
  const { server, baseUrl, enforce } = await makeServer({
    mode: 'shadow', attach: attachGrants(roleGrants('client_viewer')),
  });
  try {
    const read = await req(baseUrl, 'GET', UNCLAIMED);
    assert.equal(read.status, 200, 'shadow lets the request through');
    const snap = enforce.snapshot();
    assert.equal(snap.mode, 'shadow');
    assert.ok(snap.stats.shadowWould >= 1, 'shadow counted a would-be denial');
    assert.equal(snap.stats.denied, 0, 'shadow blocks nothing');
    assert.equal(snap.byPermission[PARENT] >= 1, true, 'the required key is recorded for review');
    assert.equal(snap.stats.unmapped, 0, 'the namespace is no longer an unmapped gap');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

// ── Anonymous traffic stays with the auth gate ──────────────────────────────
test('on: anonymous advertising traffic is not gated by the matrix', async () => {
  const { server, baseUrl } = await makeServer({ mode: 'on', attach: (_rq, _res, next) => next() });
  try {
    const read = await req(baseUrl, 'GET', UNCLAIMED);
    assert.equal(read.status, 200, 'no req.user → the enforcer is a no-op here');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
