'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const express = require('express');
const ROOT = path.join(__dirname, '..');
const PREFIX = '/api/client-reporting';
const PERMISSION = 'tenant.settings.manage';
const client = { id: 11, name: 'Client A', slug: 'client-a', website: null, status: 'active' };
const input = { report_source: 'campaigns', default_format: 'pdf', report_title: 'Monthly report',
  branding_mode: 'workspace', branding_overrides: {}, expected_version: 0 };

// Isolated router/SQL-contract tests. Native PostgreSQL + full session middleware
// are covered separately by integration/client-reporting-profiles.test.js.
function load(relative, overrides = {}) {
  const filename = path.join(ROOT, relative), module = { exports: {} }, native = createRequire(filename);
  new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))(
    (name) => Object.hasOwn(overrides, name) ? overrides[name] : native(name), module, module.exports);
  return module.exports;
}
function principal(extra = {}) {
  return { user: { id: 7 }, tenant: { id: 101, status: 'active' },
    tenantMemberships: [{ tenantId: 101 }], can: (key) => key === PERMISSION, ...extra };
}
async function fixture(t, { actor = principal(), query = async () => ({ rows: [] }), mode = 'on', resolved, hasDb = true } = {}) {
  const calls = [], resolutions = [];
  let releases = 0;
  const pool = { query: async (sql, params) => { calls.push({ sql, params }); return query(sql, params); },
    connect: async () => ({ query: pool.query, release: () => { releases++; } }) };
  const enforce = load('services/tenants/permission_enforce.js', { '../security/prod_defaults': { permissionMode: () => mode } });
  const router = load('services/client_reporting/api.js', {
    '../../db': { hasDb: () => hasDb, getPool: () => pool },
    '../tenants/context': { resolveTenantId: async (req) => { resolutions.push(req.tenant.id); return resolved ?? req.tenant.id; } },
    '../tenants/permission_enforce': enforce,
  });
  const app = express();
  app.use(express.json({ verify: (req, _res, buffer) => { req.rawBody = buffer.toString('utf8'); } }));
  app.use((req, _res, next) => { Object.assign(req, typeof actor === 'function' ? actor(req) : actor); next(); });
  app.use(enforce.enforceMatrix);
  app.use(PREFIX, router);
  const server = await new Promise((resolve) => { const started = app.listen(0, '127.0.0.1', () => resolve(started)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  async function request(method, pathname, body, headers = {}) {
    const response = await fetch('http://127.0.0.1:' + server.address().port + PREFIX + pathname, {
      method, headers: { 'Content-Type': 'application/json', Connection: 'close', ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const bodyValue = method === 'HEAD' ? null : response.headers.get('content-type')?.includes('application/json')
      ? await response.json() : await response.text();
    return { status: response.status, body: bodyValue, headers: response.headers };
  }
  return { request, calls, resolutions, releases: () => releases };
}

test('strict membership/auth and permission guard rejects without fallback in every enforcement mode', async (t) => {
  for (const mode of ['off', 'shadow', 'on']) {
    for (const [extra, status] of [
      [{ user: null }, 401], [{ user: { id: 0 } }, 401], [{ tenant: null }, 400],
      [{ tenant: { id: '1e2', status: 'active' } }, 400], [{ tenant: { id: 101, status: 'suspended' } }, 400],
      [{ tenantMemberships: [] }, 403], [{ tenantMemberships: [{ tenantId: 102 }] }, 403],
      [{ user: { id: 7, isOwner: true }, tenantMemberships: [] }, 403], [{ can: () => false }, 403],
    ]) {
      const fx = await fixture(t, { actor: principal(extra), mode });
      assert.equal((await fx.request('GET', '/clients')).status, status);
      assert.equal(fx.calls.length, 0);
      assert.equal(fx.resolutions.length, 0);
    }
  }
  const fx = await fixture(t, { resolved: 102 });
  assert.equal((await fx.request('PUT', '/clients/11/profile', input)).status, 403);
  assert.equal(fx.calls.length, 0);
});

test('list is whitelisted, scoped and paginated; client reads never persist defaults', async (t) => {
  const fx = await fixture(t, { query: async (sql, params) => {
    assert.match(sql, /tenant_id=\$1/); assert.equal(params[0], 101);
    if (sql.includes('client_reporting_profiles')) return { rows: [] };
    assert.match(sql, /SELECT id, name, slug, website, status FROM clients/);
    return { rows: sql.includes('ORDER BY') ? [client, { ...client, id: 12 }] : [client] };
  } });
  const first = await fx.request('GET', '/clients?limit=1');
  assert.deepEqual(first.body, { ok: true, clients: [client], has_more: true, next_cursor: 11 });
  assert.equal(first.headers.get('cache-control'), 'no-store');
  const last = await fx.request('GET', '/clients?cursor=11&limit=100');
  assert.equal(last.body.next_cursor, null); assert.equal(last.body.has_more, false);
  assert.deepEqual(fx.calls[1].params, [101, 11, 101]);
  assert.deepEqual((await fx.request('GET', '/clients/11')).body, { ok: true, client });
  assert.deepEqual((await fx.request('GET', '/clients/11/profile')).body, { ok: true, client, configured: false, profile: null });
  assert.ok(fx.calls.every(({ sql }) => sql.trim().startsWith('SELECT')));
  for (const query of ['limit=101', 'limit=-1', 'limit=1.5', 'cursor=0', 'cursor=bad', 'cursor[]=1']) {
    assert.equal((await fx.request('GET', '/clients?' + query)).status, 400);
  }
});

test('foreign, archived and nonexistent client IDs have identical read/write 404 responses', async (t) => {
  const fx = await fixture(t);
  for (const id of [11, 12, 9999]) {
    for (const [method, suffix, body] of [['GET', '', undefined], ['GET', '/profile', undefined], ['PUT', '/profile', input]]) {
      const response = await fx.request(method, '/clients/' + id + suffix, body);
      assert.equal(response.status, 404);
      assert.deepEqual(response.body, { ok: false, error: 'client_not_found' });
    }
  }
  assert.ok(fx.calls.filter(({ sql }) => sql.includes('FROM clients')).every(({ sql, params }) =>
    sql.includes("tenant_id=$1 AND id=$2 AND status='active'") && params[0] === 101));
});

test('profile validation rejects managed fields, unsafe branding, invalid enum/version and oversized raw JSON', async (t) => {
  const fx = await fixture(t);
  const variants = [null, [], {}, { ...input, tenant_id: 202 }, { ...input, client_id: 12 },
    { ...input, updated_by_user_id: 88 }, { ...input, version: 1 }, { ...input, report_source: 'all' },
    { ...input, default_format: 'html' }, { ...input, report_title: ' ' }, { ...input, report_title: 'a'.repeat(161) },
    { ...input, expected_version: '0' }, { ...input, expected_version: -1 }, { ...input, expected_version: 0.5 },
    { ...input, branding_overrides: [] }, { ...input, branding_mode: 'inherit' },
    ...[{ primaryColor: '#000000' }, { logoUrl: 'https://example.com' }, { font: 'Arial' }, { primaryColor: 'red' },
      { footerText: 'a'.repeat(201) }, { agencyName: { html: 'x' } }, { accentColor: '#123' }]
      .map((branding_overrides, index) => ({ ...input, branding_mode: index === 0 ? 'workspace' : 'custom', branding_overrides })),
  ];
  for (const body of variants) assert.equal((await fx.request('PUT', '/clients/11/profile', body)).status, 400);
  assert.equal((await fx.request('PUT', '/clients/11/profile', ' '.repeat(8192) + JSON.stringify(input))).status, 413);
  assert.equal((await fx.request('PUT', '/clients/11junk/profile', input)).status, 400);
  assert.equal(fx.calls.length, 0);
});

test('PUT locks active client and performs scoped full-replacement CAS using actual user; stale writes rollback', async (t) => {
  let stale = false;
  const profile = { client_id: 11, ...input, version: 1 };
  const fx = await fixture(t, { query: async (sql) => ({ rows: sql.includes('FROM clients') ? [client]
    : sql.includes('RETURNING') && !stale ? [profile] : [] }) });
  const body = { ...input, report_title: '  Branded monthly report  ', branding_mode: 'custom',
    branding_overrides: { agencyName: ' Agency ', primaryColor: '#AAbbCC', footerText: ' Footer ' } };
  assert.equal((await fx.request('PUT', '/clients/11/profile', body)).status, 200);
  const insert = fx.calls.find(({ sql }) => sql.includes('INSERT INTO'));
  assert.match(fx.calls[1].sql, /FOR UPDATE$/);
  assert.match(insert.sql, /ON CONFLICT \(tenant_id,client_id\) DO NOTHING/);
  assert.deepEqual(insert.params, [101, 11, 'campaigns', 'pdf', 'Branded monthly report', 'custom',
    JSON.stringify({ agencyName: 'Agency', primaryColor: '#AAbbCC', footerText: 'Footer' }), 7]);
  assert.equal(fx.calls.at(-1).sql, 'COMMIT');
  assert.equal((await fx.request('PUT', '/clients/11/profile', { ...input, expected_version: 1 })).status, 200);
  const update = fx.calls.find(({ sql }) => sql.startsWith('UPDATE'));
  assert.match(update.sql, /WHERE tenant_id=\$1 AND client_id=\$2 AND version=\$9/);
  assert.match(update.sql, /version=version\+1/); assert.equal(update.params[8], 1);
  for (const expected_version of [0, 1]) {
    stale = true;
    const response = await fx.request('PUT', '/clients/11/profile', { ...input, expected_version });
    assert.equal(response.status, 409); assert.equal(response.body.error, 'version_conflict');
    assert.equal(fx.calls.at(-1).sql, 'ROLLBACK');
  }
  assert.equal(fx.releases(), 4);
});

test('write limiter is per resolved tenant; reads remain available and storage failures never claim success', async (t) => {
  const fx = await fixture(t, { actor: (req) => principal(req.headers['x-test-tenant'] ?
    { tenant: { id: 102, status: 'active' }, tenantMemberships: [{ tenantId: 102 }] } : {}) });
  for (let n = 0; n < 60; n++) assert.equal((await fx.request('PUT', '/clients/11/profile', {})).status, 400);
  assert.equal((await fx.request('PUT', '/clients/12/profile', {})).status, 429);
  assert.equal((await fx.request('PUT', '/clients/12/profile', {}, { 'x-test-tenant': '102' })).status, 400);
  assert.equal((await fx.request('GET', '/clients')).status, 200);
  const unavailable = await fixture(t, { hasDb: false });
  assert.equal((await unavailable.request('GET', '/clients')).status, 503);
  const broken = await fixture(t, { query: async () => { throw new Error('secret db detail'); } });
  const response = await broken.request('GET', '/clients');
  assert.equal(response.status, 500); assert.deepEqual(response.body, { ok: false, error: 'internal_error' });
});

test('GET and inherited HEAD share a 300-read tenant budget, with no DB access after exhaustion or write-budget impact', async (t) => {
  const fx = await fixture(t, {
    actor: (req) => principal(req.headers['x-test-tenant'] ?
      { tenant: { id: 102, status: 'active' }, tenantMemberships: [{ tenantId: 102 }] } : {}),
    query: async (sql) => ({ rows: sql.includes('FROM clients') ? [client]
      : sql.includes('RETURNING') ? [{ client_id: 11, version: 1 }] : [] }),
  });
  const paths = ['/clients', '/clients/11', '/clients/11/profile'];
  for (let n = 0; n < 300; n++) {
    assert.equal((await fx.request(n % 2 ? 'HEAD' : 'GET', paths[n % paths.length])).status, 200);
  }
  const callsBeforeExhaustion = fx.calls.length;
  for (const pathname of paths) {
    for (const method of ['GET', 'HEAD']) {
      const response = await fx.request(method, pathname);
      assert.equal(response.status, 429);
      assert.equal(response.headers.get('retry-after'), '60');
      if (method === 'GET') assert.equal(response.body.error, 'rate_limited');
    }
  }
  assert.equal(fx.calls.length, callsBeforeExhaustion);
  assert.equal((await fx.request('GET', '/clients', undefined, { 'x-test-tenant': '102' })).status, 200);
  assert.equal(fx.calls.length, callsBeforeExhaustion + 1);
  assert.equal((await fx.request('PUT', '/clients/11/profile', input)).status, 200);
  assert.equal(fx.calls.at(-1).sql, 'COMMIT');
});
