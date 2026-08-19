'use strict';
// test/permission-matrix.test.js — Role → component/route permission enforcement.
//
// Proves the backend authorization boundary built in services/tenants:
//   • The matrix (permission_matrix.js) is internally consistent — every key it
//     references is a real catalog key, and it resolves read vs write per method.
//   • The enforcer (permission_enforce.js), mounted exactly as server.js mounts
//     it, denies a low-privilege role (Client Viewer) a protected action with a
//     clean 403, ALLOWS a role that holds the required permission (Marketer),
//     and lets a platform owner bypass regardless of permissions.
//   • Shadow mode logs would-be denials but never blocks (safe rollout).
//
// Strategy mirrors portal-auth-gate.test.js: mount the SHIPPED middleware on a
// tiny Express app with a switchable fake principal, and drive it over real HTTP.
//
// Run: node --test   (or: npm test)

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

const matrix = require('../services/tenants/permission_matrix');
const { SYSTEM_ROLES, isValidPermission } = require('../services/tenants/permissions');

// Build a req.can()/req.permissions principal from a system-role key.
function principalFromRole(roleKey, extra = {}) {
  const role = SYSTEM_ROLES.find(r => r.key === roleKey);
  if (!role) throw new Error(`unknown role ${roleKey}`);
  const perms = new Set(role.permissions);
  return {
    user: { id: extra.userId || 1, email: 'u@test.co', isOwner: !!extra.isOwner },
    permissions: perms,
    can: (k) => perms.has(k),
    platformRole: extra.platformRole || null,
  };
}

// Spin up a tiny server that mounts enforceMatrix under a chosen PERMISSION_
// ENFORCEMENT mode and a chosen principal, exposing a couple of protected routes.
async function makeServer({ mode, principal }) {
  // The mode is read at module-load, so load a FRESH copy per mode.
  const prevMode = process.env.PERMISSION_ENFORCEMENT;
  process.env.PERMISSION_ENFORCEMENT = mode;
  delete require.cache[require.resolve('../services/tenants/permission_enforce')];
  const enforce = require('../services/tenants/permission_enforce');
  process.env.PERMISSION_ENFORCEMENT = prevMode; // restore for other tests

  const app = express();
  app.use((req, _res, next) => {
    if (principal) {
      req.user = principal.user;
      req.permissions = principal.permissions;
      req.can = principal.can;
      req.platformRole = principal.platformRole;
    }
    next();
  });
  app.use(enforce.enforceMatrix);
  // Stand-in protected handlers — reached only if the gate allows.
  app.get('/api/optimizer/status', (_req, res) => res.json({ ok: true, hit: 'optimizer-read' }));
  app.post('/api/optimizer/dry-run', (_req, res) => res.json({ ok: true, hit: 'optimizer-write' }));
  app.post('/api/landing-pages', (_req, res) => res.json({ ok: true, hit: 'landing-write' }));

  const server = await new Promise((resolve) => {
    const s = http.createServer(app).listen(0, () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { server, baseUrl, enforce };
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

// ── Matrix integrity ────────────────────────────────────────────────────────
test('matrix: every referenced permission is a real catalog key', () => {
  assert.deepEqual(matrix.validate(), [], 'matrix references only catalog keys');
});

test('matrix: resolves read vs write permission by HTTP method', () => {
  const read = matrix.requiredPermissionForRequest('/api/optimizer/status', 'GET');
  assert.equal(read.matched, true);
  assert.equal(read.permission, 'grow.optimizer.view');

  const write = matrix.requiredPermissionForRequest('/api/optimizer/dry-run', 'POST');
  assert.equal(write.matched, true);
  assert.equal(write.permission, 'grow.optimizer.control');

  // Longest-prefix wins and write falls back to view when no write key is set.
  const fallback = matrix.requiredPermissionForRequest('/api/web-analytics/foo', 'POST');
  assert.equal(fallback.permission, 'analytics.view');

  // Unmapped path is reported as a gap (matched=false), not a crash.
  const gap = matrix.requiredPermissionForRequest('/api/totally-made-up', 'GET');
  assert.equal(gap.matched, false);
});

test('matrix: component→permission half is exported and valid for the menu task', () => {
  assert.ok(Object.keys(matrix.COMPONENT_MATRIX).length > 50, 'component matrix is populated');
  assert.equal(matrix.requiredPermissionForComponent('optimizer'), 'grow.optimizer.view');
  assert.equal(matrix.requiredPermissionForComponent('dashboard'), 'dashboard.view');
  assert.equal(matrix.requiredPermissionForComponent('nope-not-real'), null);
  for (const k of Object.values(matrix.COMPONENT_MATRIX)) {
    assert.ok(isValidPermission(k), `component perm ${k} must be a catalog key`);
  }
});

test('matrix: analyse spy/SEO nav views match their API route-group permissions', () => {
  const views = {
    'yt-comment-miner': 'compete.intel.view',
    'biz-scanner': 'compete.intel.view',
    'web-extractor': 'compete.intel.view',
    'google-trends': 'compete.intel.view',
    spyfu: 'seo.view',
    majestic: 'seo.view',
    serpstat: 'seo.view',
    contentking: 'seo.view',
    'bing-webmaster': 'seo.view',
  };
  const apis = {
    'yt-comment-miner': '/api/yt-comment-miner',
    'biz-scanner': '/api/biz-scanner',
    'web-extractor': '/api/web-extractor',
    'google-trends': '/api/google-trends',
    spyfu: '/api/spyfu',
    majestic: '/api/majestic',
    serpstat: '/api/serpstat',
    contentking: '/api/contentking',
    'bing-webmaster': '/api/bing-webmaster',
  };
  for (const [view, perm] of Object.entries(views)) {
    assert.equal(matrix.requiredPermissionForComponent(view), perm, `${view} component perm`);
    const route = matrix.requiredPermissionForRequest(apis[view], 'GET');
    assert.equal(route.matched, true, `${apis[view]} is mapped`);
    assert.equal(route.permission, perm, `${view} nav and ${apis[view]} share the same view permission`);
  }
});

test('enforcement-on would 403 marketers on owner-gate-allowlisted credential routes', () => {
  // Non-owners currently reach /api/credentials/* via the legacy owner-gate
  // allowlist (server.js _OWNER_GATE_ALLOW). The matrix still requires
  // tenant.credentials.manage, which Marketer does not hold. Flipping
  // PERMISSION_ENFORCEMENT=on would 403 those requests before the allowlist
  // runs — do not enable strict mode until that seam is resolved.
  const cred = matrix.requiredPermissionForRequest('/api/credentials/status', 'GET');
  assert.equal(cred.matched, true);
  assert.equal(cred.permission, 'tenant.credentials.manage');
  const ads = matrix.requiredPermissionForRequest('/api/integrations/google-ads/status', 'GET');
  assert.equal(ads.matched, true);
  assert.equal(ads.permission, 'tenant.integrations.manage');
  const marketer = SYSTEM_ROLES.find((r) => r.key === 'marketer');
  assert.ok(marketer, 'marketer role exists');
  assert.ok(
    !marketer.permissions.includes('tenant.credentials.manage'),
    'marketer is not granted credential-vault access',
  );
  assert.ok(
    !marketer.permissions.includes('tenant.integrations.manage'),
    'marketer is not granted integration-connect access',
  );
});

// ── Enforcement: deny / allow / owner-bypass (mode 'on') ────────────────────
test("on: Client Viewer is denied a protected action with 403", async () => {
  const { server, baseUrl } = await makeServer({
    mode: 'on', principal: principalFromRole('client_viewer'),
  });
  try {
    // Client Viewer holds none of grow.optimizer.* → both read & write denied.
    const read = await req(baseUrl, 'GET', '/api/optimizer/status');
    assert.equal(read.status, 403, 'viewer read denied');
    assert.equal(read.json.error, 'forbidden');
    assert.equal(read.json.required, 'grow.optimizer.view');

    const write = await req(baseUrl, 'POST', '/api/optimizer/dry-run');
    assert.equal(write.status, 403, 'viewer write denied');
    assert.equal(write.json.required, 'grow.optimizer.control');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("on: the appropriate role is allowed", async () => {
  const { server, baseUrl } = await makeServer({
    mode: 'on', principal: principalFromRole('marketer'),
  });
  try {
    // Marketer holds grow.optimizer.view (read allowed) but NOT
    // grow.optimizer.control (write still denied) — proves method granularity.
    const read = await req(baseUrl, 'GET', '/api/optimizer/status');
    assert.equal(read.status, 200, 'marketer read allowed');
    assert.equal(read.json.hit, 'optimizer-read');

    const write = await req(baseUrl, 'POST', '/api/optimizer/dry-run');
    assert.equal(write.status, 403, 'marketer lacks optimizer control → write denied');

    // Marketer DOES hold grow.landing_pages.edit → landing-page write allowed.
    const landing = await req(baseUrl, 'POST', '/api/landing-pages');
    assert.equal(landing.status, 200, 'marketer landing-page write allowed');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("on: platform owner bypasses regardless of permissions", async () => {
  // Owner principal carries an EMPTY permission set but isOwner=true.
  const owner = {
    user: { id: 9, email: 'owner@test.co', isOwner: true },
    permissions: new Set(),
    can: () => false,
    platformRole: null,
  };
  const { server, baseUrl } = await makeServer({ mode: 'on', principal: owner });
  try {
    const read = await req(baseUrl, 'GET', '/api/optimizer/status');
    assert.equal(read.status, 200, 'owner bypass read');
    const write = await req(baseUrl, 'POST', '/api/optimizer/dry-run');
    assert.equal(write.status, 200, 'owner bypass write');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("on: platform_admin role bypasses via platformRole", async () => {
  const admin = principalFromRole('client_viewer', {
    platformRole: { key: 'platform_admin', name: 'Platform Admin' },
  });
  const { server, baseUrl } = await makeServer({ mode: 'on', principal: admin });
  try {
    const write = await req(baseUrl, 'POST', '/api/optimizer/dry-run');
    assert.equal(write.status, 200, 'platform_admin bypasses despite client_viewer perms');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

// ── Rollout safety: shadow never blocks ─────────────────────────────────────
test("shadow: would-be denials are allowed (logged, not blocked)", async () => {
  const { server, baseUrl, enforce } = await makeServer({
    mode: 'shadow', principal: principalFromRole('client_viewer'),
  });
  try {
    const read = await req(baseUrl, 'GET', '/api/optimizer/status');
    assert.equal(read.status, 200, 'shadow lets the request through');
    assert.equal(read.json.hit, 'optimizer-read');
    const snap = enforce.snapshot();
    assert.equal(snap.mode, 'shadow');
    assert.ok(snap.stats.shadowWould >= 1, 'shadow counted a would-be denial');
    assert.equal(snap.stats.denied, 0, 'shadow blocks nothing');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

// ── Anonymous & non-API traffic is not gated here ───────────────────────────
test("anonymous /api requests are not gated by the matrix (auth gate handles them)", async () => {
  const { server, baseUrl } = await makeServer({ mode: 'on', principal: null });
  try {
    const read = await req(baseUrl, 'GET', '/api/optimizer/status');
    assert.equal(read.status, 200, 'no req.user → enforcer is a no-op');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
