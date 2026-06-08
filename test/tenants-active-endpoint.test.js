'use strict';
// test/tenants-active-endpoint.test.js — GET /api/tenants/active payload contract.
//
// The navigation menu is built ENTIRELY from the JSON this one endpoint returns
// (see test/nav-menu-permissions.test.js for the client-side consumer). If this
// route ever stops shipping `componentMatrix` or `isPlatformAdmin`, or returns
// them for the wrong role, the menu silently falls back to showing everything —
// and the client-side test, which feeds the matrix in directly, would NOT catch
// it. This test pins the actual HTTP response.
//
// Strategy mirrors permission-matrix.test.js: mount the SHIPPED router on a tiny
// Express app behind a switchable fake principal, and drive it over real HTTP.
//
// Run: node --test   (or: npm test)

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

const tenantsRouter = require('../services/tenants/api');
const matrix = require('../services/tenants/permission_matrix');
const { SYSTEM_ROLES } = require('../services/tenants/permissions');

// Build a principal (the shape loadTenantContext / _injectApiKeyAuth set on req)
// from a system-role key, plus an optional tenant + platform role.
function principalFromRole(roleKey, opts = {}) {
  const role = SYSTEM_ROLES.find(r => r.key === roleKey);
  if (!role) throw new Error(`unknown role ${roleKey}`);
  const perms = new Set(role.permissions);
  return {
    user: { id: opts.userId || 1, email: 'u@test.co', name: 'U', isOwner: !!opts.isOwner },
    tenant: opts.tenant === null ? null : (opts.tenant || { id: 7, name: 'Acme', slug: 'acme' }),
    tenantRole: { key: role.key, name: role.name },
    platformRole: opts.platformRole || null,
    permissions: perms,
    can: (k) => perms.has(k),
  };
}

// Mount the real router behind a middleware that injects `principal` onto req.
// Passing principal=null exercises the unauthenticated 401 guard.
async function makeServer(principal) {
  const app = express();
  app.use((req, _res, next) => {
    if (principal) {
      req.user = principal.user;
      req.tenant = principal.tenant;
      req.tenantRole = principal.tenantRole;
      req.platformRole = principal.platformRole;
      req.permissions = principal.permissions;
      req.can = principal.can;
    }
    next();
  });
  app.use('/api/tenants', tenantsRouter);

  const server = await new Promise((resolve) => {
    const s = http.createServer(app).listen(0, () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { server, baseUrl };
}

function getJson(baseUrl, pathname) {
  return new Promise((resolve, reject) => {
    const r = http.request(baseUrl + pathname, { method: 'GET' }, (res) => {
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

async function fetchActive(principal) {
  const { server, baseUrl } = await makeServer(principal);
  try {
    return await getJson(baseUrl, '/api/tenants/active');
  } finally {
    await new Promise((r) => server.close(r));
  }
}

// The menu is unusable without these two fields, regardless of role.
function assertMenuContract(json) {
  assert.deepEqual(json.componentMatrix, matrix.COMPONENT_MATRIX,
    'componentMatrix deep-equals the shipped COMPONENT_MATRIX');
  assert.equal(typeof json.isPlatformAdmin, 'boolean', 'isPlatformAdmin is a boolean');
}

// ── Low-privilege role: Client Viewer ───────────────────────────────────────
test('active: a Client Viewer gets the matrix, its own perms, and isPlatformAdmin=false', async () => {
  const viewer = principalFromRole('client_viewer');
  const { status, json } = await fetchActive(viewer);

  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assertMenuContract(json);
  assert.equal(json.isPlatformAdmin, false, 'viewer is not a platform admin');

  // permissions deep-equal the role's set (order-independent).
  const role = SYSTEM_ROLES.find(r => r.key === 'client_viewer');
  assert.deepEqual([...json.permissions].sort(), [...role.permissions].sort(),
    'permissions mirror the Client Viewer role');
  // Sanity: the role carries read-only keys, none of the compete/grow keys.
  assert.ok(json.permissions.includes('dashboard.view'), 'has dashboard.view');
  assert.ok(!json.permissions.includes('grow.optimizer.view'), 'lacks grow.optimizer.view');
});

// ── Higher-privilege role: Marketer ─────────────────────────────────────────
test('active: a higher-privilege role (Marketer) gets a richer perm set, still not admin', async () => {
  const marketer = principalFromRole('marketer');
  const { status, json } = await fetchActive(marketer);

  assert.equal(status, 200);
  assertMenuContract(json);
  assert.equal(json.isPlatformAdmin, false, 'a marketer is not a platform admin');

  const role = SYSTEM_ROLES.find(r => r.key === 'marketer');
  assert.deepEqual([...json.permissions].sort(), [...role.permissions].sort(),
    'permissions mirror the Marketer role');
  // Marketer holds grow keys the viewer does not — proves role differentiation.
  assert.ok(json.permissions.includes('grow.optimizer.view'), 'marketer sees the optimizer');
});

// ── Platform owner: isPlatformAdmin must be TRUE ────────────────────────────
test('active: a platform owner reports isPlatformAdmin=true', async () => {
  const owner = principalFromRole('client_viewer', { isOwner: true, userId: 9 });
  const { status, json } = await fetchActive(owner);

  assert.equal(status, 200);
  assertMenuContract(json);
  assert.equal(json.isPlatformAdmin, true, 'owner flag flips isPlatformAdmin true');
});

// ── Platform admin (via platformRole, not isOwner) ──────────────────────────
test('active: a platform_admin role reports isPlatformAdmin=true', async () => {
  const admin = principalFromRole('client_viewer', {
    platformRole: { key: 'platform_admin', name: 'Platform Admin' },
  });
  const { status, json } = await fetchActive(admin);

  assert.equal(status, 200);
  assertMenuContract(json);
  assert.equal(json.isPlatformAdmin, true, 'platform_admin role flips isPlatformAdmin true');
});

// ── No-tenant early-return branch still ships the menu contract ──────────────
test('active: the no-tenant branch still includes componentMatrix + isPlatformAdmin', async () => {
  const noTenant = principalFromRole('client_viewer', { tenant: null });
  const { status, json } = await fetchActive(noTenant);

  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.tenant, null, 'no active tenant');
  assert.deepEqual(json.permissions, [], 'no-tenant branch ships an empty perm set');
  assertMenuContract(json);
  assert.equal(json.isPlatformAdmin, false, 'non-admin without a tenant');
});

test('active: the no-tenant branch for an owner still flags isPlatformAdmin=true', async () => {
  const owner = principalFromRole('client_viewer', { tenant: null, isOwner: true });
  const { status, json } = await fetchActive(owner);

  assert.equal(status, 200);
  assert.equal(json.tenant, null);
  assertMenuContract(json);
  assert.equal(json.isPlatformAdmin, true, 'owner is admin even with no active tenant');
});

// ── Unauthenticated callers are rejected by the local guard ─────────────────
test('active: an unauthenticated request is rejected with 401', async () => {
  const { status, json } = await fetchActive(null);
  assert.equal(status, 401);
  assert.equal(json.error, 'auth_required');
});
