'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const matrix = require('../services/tenants/permission_matrix');
const { SYSTEM_ROLES } = require('../services/tenants/permissions');
const { createNavPerms } = require('../public/js/ig_navperms');

// Execute the real legacy owner-gate middleware and actual strict matrix with
// injected principals. Full session/membership/SQL coverage belongs to the API
// integration suite; no server boot, network or PostgreSQL is claimed here.
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const start = source.indexOf('const _OWNER_GATE_ALLOW = [');
const end = source.indexOf('// ── Per-provider budget caps', start);
assert.ok(start > 0 && end > start, 'owner-gate source must remain identifiable');
let ownerGate;
vm.runInNewContext(source.slice(start, end), { app: { use: (fn) => { ownerGate = fn; } } });
assert.equal(typeof ownerGate, 'function');
const filename = path.join(__dirname, '..', 'services/tenants/permission_enforce.js');
const localRequire = createRequire(filename), loaded = { exports: {} };
new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))(
  (name) => name === '../security/prod_defaults' ? { permissionMode: () => 'on' } : localRequire(name),
  loaded, loaded.exports,
);
const enforce = loaded.exports;
const ROOT = '/api/client-reporting/clients';
const routes = [
  ['GET', ROOT], ['HEAD', ROOT], ['GET', ROOT + '/12'], ['HEAD', ROOT + '/12'],
  ['GET', ROOT + '/12/profile'], ['HEAD', ROOT + '/12/profile'], ['PUT', ROOT + '/12/profile'],
  ['GET', ROOT + '/12/report-preview'], ['HEAD', ROOT + '/12/report-preview'], ['POST', ROOT + '/12/report'],
  ['GET', ROOT + '/12/report-recipient'], ['HEAD', ROOT + '/12/report-recipient'], ['POST', ROOT + '/12/report-email'],
  ['GET', ROOT + '/12/recipient'], ['HEAD', ROOT + '/12/recipient'], ['PUT', ROOT + '/12/recipient'],
];
for (const source of ['search-intel', 'campaigns']) {
  routes.push(
    ['GET', `/api/client-reporting/sources/${source}/records`],
    ['HEAD', `/api/client-reporting/sources/${source}/records`],
    ['POST', `${ROOT}/12/mappings/${source}/34`],
    ['DELETE', `${ROOT}/12/mappings/${source}/34`],
    ['GET', `${ROOT}/12/data/${source}`], ['HEAD', `${ROOT}/12/data/${source}`],
  );
}
function invoke(middleware, method, pathname, roleKey = 'tenant_admin') {
  const role = SYSTEM_ROLES.find((r) => r.key === roleKey);
  const req = { method, path: pathname, user: { id: 17, isOwner: false },
    can: (key) => role.permissions.includes(key) };
  const result = { allowed: false, status: null, body: null };
  const res = { status: (code) => { result.status = code; return res; },
    json: (body) => { result.body = body; return res; } };
  middleware(req, res, () => { result.allowed = true; });
  return result;
}

test('client reporting matrix requires workspace settings for every implemented method', () => {
  assert.deepEqual(matrix.validate(), []);
  for (const [method, pathname] of routes) {
    const requirement = matrix.requiredPermissionForRequest(pathname, method);
    assert.equal(requirement.matched, true);
    assert.equal(requirement.permission, 'tenant.settings.manage');
    for (const role of ['tenant_owner', 'tenant_admin']) {
      assert.equal(invoke(enforce.enforceMatrix, method, pathname, role).allowed, true);
    }
    for (const role of ['analyst', 'client_viewer', 'marketer', 'content_creator']) {
      const result = invoke(enforce.enforceMatrix, method, pathname, role);
      assert.equal(result.allowed, false, role + ' must not access reporting settings');
      assert.equal(result.status, 403);
      assert.equal(result.body.required, 'tenant.settings.manage');
    }
  }
});

test('client reporting setup uses the settings grant, including for report exporters', () => {
  assert.equal(matrix.requiredPermissionForComponent('client-reporting'), 'tenant.settings.manage');
  for (const roleKey of ['tenant_owner', 'tenant_admin', 'analyst', 'client_viewer', 'marketer', 'content_creator']) {
    const role = SYSTEM_ROLES.find((row) => row.key === roleKey);
    const allowed = ['tenant_owner', 'tenant_admin'].includes(roleKey);
    const nav = createNavPerms().configure({ permissions: role.permissions,
      componentMatrix: matrix.COMPONENT_MATRIX, isPlatformAdmin: false });
    assert.equal(nav.can('client-reporting'), allowed, roleKey);
    assert.equal(nav.guard('client-reporting', ['dashboard']).allowed, allowed, roleKey);
    if (['analyst', 'client_viewer'].includes(roleKey)) {
      assert.ok(role.permissions.includes('reports.export'), 'export permission alone must not grant settings access');
    }
  }
  const admin = createNavPerms().configure({ permissions: [],
    componentMatrix: matrix.COMPONENT_MATRIX, isPlatformAdmin: true });
  assert.equal(admin.can('client-reporting'), true, 'existing platform permission semantics remain unchanged');
});

test('authorized non-owner settings routes pass the real owner gate, including normal HEAD behavior', () => {
  for (const [method, pathname] of routes) {
    assert.equal(invoke(ownerGate, method, pathname).allowed, true, method + ' ' + pathname);
    assert.equal(invoke(ownerGate, method, pathname + '/').allowed, true);
  }
});

test('owner-gate exemption cannot expose unimplemented methods, client creation or lookalike paths', () => {
  const blocked = [
    ['POST', ROOT + '/12/report-preview'], ['PUT', ROOT + '/12/report-preview'],
    ['GET', ROOT + '/12/report'], ['HEAD', ROOT + '/12/report'], ['DELETE', ROOT + '/12/report'],
    ['POST', ROOT + '/12/report-recipient'], ['PUT', ROOT + '/12/report-recipient'],
    ['POST', ROOT + '/12/recipient'], ['DELETE', ROOT + '/12/recipient'],
    ['GET', ROOT + '/12/report-email'], ['DELETE', ROOT + '/12/report-email'],
    ['POST', ROOT + '/12/report-recipient-extra'], ['GET', ROOT + '/12/report-email/send'],
    ['GET', ROOT + '/12/report-preview/export'], ['POST', ROOT + '/12/report/export'],
    ['GET', ROOT + '/12/report-preview-extra'], ['POST', ROOT + '/12/report-extra'],
    ['GET', ROOT + '/0/report-preview'], ['POST', ROOT + '/12extra/report'],
    ['POST', '/api/client-reporting/sources/search-intel/records'],
    ['GET', '/api/client-reporting/sources/unknown/records'],
    ['GET', '/api/client-reporting/sources/campaigns/records/export'],
    ['GET', ROOT + '/12/mappings/campaigns/34'],
    ['PUT', ROOT + '/12/mappings/campaigns/34'],
    ['PATCH', ROOT + '/12/mappings/campaigns/34'],
    ['POST', ROOT + '/12/mappings/unknown/34'],
    ['DELETE', ROOT + '/12/mappings/campaigns/0'],
    ['POST', ROOT + '/12/mappings/campaigns/34extra'],
    ['DELETE', ROOT + '/12/mappings/campaigns/34/export'],
    ['POST', ROOT + '/12/data/campaigns'],
    ['GET', ROOT + '/12/data/unknown'],
    ['GET', ROOT + '/12/data/campaigns/export'],
    ['GET', '/api/client-reporting'], ['POST', ROOT], ['DELETE', ROOT + '/12'],
    ['PATCH', ROOT + '/12/profile'], ['POST', ROOT + '/12/profile'], ['DELETE', ROOT + '/12/profile'],
    ['GET', ROOT + '/12/profile/export'], ['POST', ROOT + '/12/generate'],
    ['GET', ROOT + '-export'], ['GET', ROOT + '/12/profile-export'], ['GET', ROOT + '/12extra'],
    ['GET', ROOT + '/0'], ['GET', ROOT + '/-12'], ['GET', ROOT + '/12.5/profile'],
    ['GET', '/api/client-reporting-export/clients'], ['GET', '/api/other' + ROOT],
    ['GET', '/api/exports/campaigns/pdf'], ['GET', '/api/agency-report'],
  ];
  for (const [method, pathname] of blocked) {
    const result = invoke(ownerGate, method, pathname);
    assert.equal(result.allowed, false, method + ' ' + pathname);
    assert.equal(result.status, 403);
    assert.equal(result.body.error, 'owner_only');
  }
});
