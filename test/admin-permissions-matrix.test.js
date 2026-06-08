'use strict';
// test/admin-permissions-matrix.test.js — Read-only Roles & Permissions matrix.
//
// Proves the Admin Portal's GET /api/admin/permissions-matrix endpoint:
//   • 403s for a non-admin principal (it's behind the platform owner/admin gate).
//   • For an owner, returns the live permission model assembled straight from the
//     source of truth (SYSTEM_ROLES + permission catalog + COMPONENT_MATRIX), with
//     no hardcoded duplicate — so the screen can never drift from enforcement.
//
// Mirrors permission-matrix.test.js: mount the SHIPPED admin router on a tiny
// Express app with a switchable fake principal and drive it over real HTTP.
//
// Run: node --test   (or: npm test)

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

const _db = require('../db');
const { SYSTEM_ROLES } = require('../services/tenants/permissions');
const { COMPONENT_MATRIX } = require('../services/tenants/permission_matrix');

// The router gate requires a live DB (returns 503 otherwise). The matrix handler
// itself never touches the DB, so stub hasDb()=true for the owner path; restore
// after. Tests run with no DATABASE_URL, so this is a clean, isolated override.
function withDb(fn) {
  const orig = _db.hasDb;
  _db.hasDb = () => true;
  try { return fn(); } finally { _db.hasDb = orig; }
}

function makeServer(principal) {
  const app = express();
  app.use((req, _res, next) => { Object.assign(req, principal); next(); });
  app.use('/api/admin', require('../services/admin/api'));
  return app;
}

function get(server, path) {
  return new Promise((resolve, reject) => {
    const s = server.listen(0, () => {
      const port = s.address().port;
      http.get({ host: '127.0.0.1', port, path }, (res) => {
        let body = '';
        res.on('data', d => (body += d));
        res.on('end', () => { s.close(); let j = {}; try { j = JSON.parse(body); } catch (_) {} resolve({ status: res.statusCode, json: j }); });
      }).on('error', (e) => { s.close(); reject(e); });
    });
  });
}

test('permissions-matrix: non-admin is denied 403', async () => {
  const app = makeServer({ user: { id: 9, email: 'nobody@test.co', isOwner: false }, platformRole: null });
  const r = await withDb(() => get(app, '/api/admin/permissions-matrix'));
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.json.error, 'admin_only');
});

test('permissions-matrix: unauthenticated is denied 401', async () => {
  const app = makeServer({});
  const r = await get(app, '/api/admin/permissions-matrix');
  assert.strictEqual(r.status, 401);
});

test('permissions-matrix: owner gets the live model from source of truth', async () => {
  const app = makeServer({ user: { id: 1, email: 'owner@test.co', isOwner: true }, platformRole: { key: 'platform_owner' } });
  const r = await withDb(() => get(app, '/api/admin/permissions-matrix'));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.ok, true);

  // Roles match the catalog 1:1 (no hardcoded duplicate in the frontend or here).
  assert.strictEqual(r.json.roles.length, SYSTEM_ROLES.length);
  const ownerRole = r.json.roles.find(x => x.key === 'platform_owner');
  const everyKey = new Set(r.json.areas.flatMap(a => a.permissions.map(p => p.key)));
  // platform_owner holds every catalog permission.
  for (const k of everyKey) assert.ok(ownerRole.permissions.includes(k), `owner missing ${k}`);

  // Areas carry human labels, not just raw keys.
  const sample = r.json.areas.flatMap(a => a.permissions)[0];
  assert.ok(sample.label && sample.key && sample.area, 'permission row needs key+label+area');

  // A restrictive role is correctly NOT granted an intel permission.
  const viewer = r.json.roles.find(x => x.key === 'client_viewer');
  assert.ok(!viewer.permissions.includes('compete.intel.view'));

  // Feature → permission map mirrors COMPONENT_MATRIX exactly.
  assert.strictEqual(r.json.components.length, Object.keys(COMPONENT_MATRIX).length);
  const adminComp = r.json.components.find(c => c.view === 'admin');
  assert.strictEqual(adminComp.permission, COMPONENT_MATRIX['admin']);
  assert.ok(adminComp.permissionLabel, 'component should resolve a human label');
});
