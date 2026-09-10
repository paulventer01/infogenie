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

test('mapping inputs reject forged ownership, unsafe source/IDs and extra query parameters before SQL', async (t) => {
  const fx = await fixture(t);
  const mappingPath = '/clients/11/mappings/search-intel/5';
  for (const [method, pathname, body] of [
    ['POST', mappingPath, { tenant_id: 102 }], ['POST', mappingPath, { client_id: 12 }],
    ['POST', mappingPath, { mapping_id: '123' }], ['POST', mappingPath, []],
    ['POST', mappingPath + '?tenant_id=102', {}], ['POST', mappingPath.replace('/5', '/5junk'), {}],
    ['POST', mappingPath.replace('search-intel', 'constructor'), {}], ['POST', mappingPath.replace('/11/', '/0/'), {}],
    ['DELETE', mappingPath, {}], ['DELETE', mappingPath, { mapping_id: 'bad' }],
    ['DELETE', mappingPath, { mapping_id: '11111111-1111-4111-8111-111111111111', client_id: 12 }],
  ]) assert.equal((await fx.request(method, pathname, body)).status, 400);
  assert.equal((await fx.request('POST', mappingPath, ' '.repeat(8192) + '{}')).status, 413);
  for (const pathname of ['/sources/constructor/records', '/sources/search-intel/records?cursor=0',
    '/sources/campaigns/records?limit=101', '/sources/campaigns/records?limit[]=1',
    '/clients/11/data/search-intel?tenant_id=102']) assert.equal((await fx.request('GET', pathname)).status, 400);
  assert.equal(fx.calls.length, 0);
});

test('every mapping and data route inherits membership and direct permission enforcement', async (t) => {
  for (const mode of ['off', 'shadow', 'on']) {
    for (const actor of [principal({ can: () => false }), principal({ tenantMemberships: [] })]) {
      const fx = await fixture(t, { actor, mode });
      for (const [method, pathname, body] of [
        ['GET', '/sources/search-intel/records'], ['HEAD', '/sources/campaigns/records'],
        ['GET', '/clients/11/data/search-intel'], ['HEAD', '/clients/11/data/campaigns'],
        ['POST', '/clients/11/mappings/campaigns/5', {}],
        ['DELETE', '/clients/11/mappings/search-intel/5', { mapping_id: '11111111-1111-4111-8111-111111111111' }],
      ]) assert.equal((await fx.request(method, pathname, body)).status, 403);
      assert.equal(fx.calls.length, 0);
    }
  }
});

test('candidate pagination uses tenant-bound mapping join and minimal source whitelist', async (t) => {
  const fx = await fixture(t, { query: async () => ({ rows: [
    { id: 5, label: 'Prompt', client_id: null, mapping_id: null },
    { id: 6, label: 'Other', client_id: 12, mapping_id: 'token' },
  ] }) });
  for (const source of ['search-intel', 'campaigns']) {
    const response = await fx.request('GET', `/sources/${source}/records?cursor=4&limit=1`);
    assert.equal(response.status, 200); assert.equal(response.body.records.length, 1);
    assert.equal(response.body.next_cursor, 5); assert.equal(response.body.has_more, true);
    const call = fx.calls.at(-1);
    assert.deepEqual(call.params, [101, 4, 2]);
    assert.match(call.sql, /m.tenant_id=\$1/); assert.match(call.sql, /WHERE r.tenant_id=\$1/);
    assert.doesNotMatch(call.sql, /SELECT \*|owner_email|platform_camp_id/);
    assert.equal((await fx.request('HEAD', `/sources/${source}/records`)).status, 200);
  }
});

test('mapping mutations lock active client and source; duplicates and stale tokens rollback', async (t) => {
  let conflict = false;
  const token = '11111111-1111-4111-8111-111111111111';
  const fx = await fixture(t, { query: async (sql) => ({ rows: sql.includes('FROM clients') ? [client]
    : sql.includes('FOR KEY SHARE') ? [{ id: 5 }] : sql.includes('RETURNING') && !conflict
      ? [{ record_id: 5, client_id: 11, mapping_id: token }] : [] }) });
  for (const source of ['search-intel', 'campaigns']) {
    const pathname = `/clients/11/mappings/${source}/5`;
    assert.equal((await fx.request('POST', pathname, {})).status, 201);
    const insert = fx.calls.at(-2);
    assert.match(insert.sql, /ON CONFLICT \(tenant_id,(query|campaign)_id\) DO NOTHING/);
    assert.deepEqual(insert.params.slice(0, 3), [101, 5, 11]);
    assert.match(insert.params[3], /^[0-9a-f-]{36}$/); assert.equal(insert.params[4], 7);
    assert.match(fx.calls.at(-3).sql, /WHERE tenant_id=\$1 AND id=\$2 FOR KEY SHARE/);
    assert.match(fx.calls.at(-4).sql, /status='active' FOR UPDATE/);
    assert.equal((await fx.request('DELETE', pathname, { mapping_id: token })).status, 200);
    assert.deepEqual(fx.calls.at(-2).params, [101, 5, 11, token]);
    assert.match(fx.calls.at(-2).sql, /client_id=\$3 AND mapping_id=\$4/);
    conflict = true;
    for (const method of ['POST', 'DELETE']) {
      const response = await fx.request(method, pathname, method === 'POST' ? {} : { mapping_id: token });
      assert.deepEqual(response.body, { ok: false, error: 'mapping_conflict' });
      assert.equal(response.status, 409); assert.equal(fx.calls.at(-1).sql, 'ROLLBACK');
    }
    conflict = false;
  }
  assert.equal(fx.releases(), 8);
});

test('missing clients and source records do not disclose foreign mappings', async (t) => {
  const missingClient = await fixture(t);
  const missingRecord = await fixture(t, { query: async (sql) => ({ rows: sql.includes('FROM clients') ? [client] : [] }) });
  for (const method of ['POST', 'DELETE']) {
    const body = method === 'POST' ? {} : { mapping_id: '11111111-1111-4111-8111-111111111111' };
    const path = '/clients/11/mappings/campaigns/5';
    assert.equal((await missingClient.request(method, path, body)).body.error, 'client_not_found');
    assert.equal((await missingRecord.request(method, path, body)).body.error, 'record_not_found');
  }
  assert.ok(missingRecord.calls.every(({ sql }) => !/INSERT|DELETE/.test(sql)));
});

test('client data has a stable snapshot; every root, aggregate and child is explicitly tenant/client joined', async (t) => {
  const fx = await fixture(t, { query: async (sql) => ({ rows: sql.includes('FROM clients') ? [client]
    : sql.includes('AS mapped_records') ? [{ mapped_records: 0 }]
      : sql.includes('AS successful_runs') ? [{ runs: 0, successful_runs: 0, brand_mentions: 0 }] : [] }) });
  for (const source of ['search-intel', 'campaigns']) {
    fx.calls.length = 0;
    const response = await fx.request('GET', `/clients/11/data/${source}?limit=1`);
    assert.equal(response.status, 200); assert.deepEqual(response.body.records, []);
    assert.equal(response.body.next_cursor, null); assert.equal(response.body.summary.mapped_records, 0);
    assert.equal(response.body.summary_scope, 'all_mapped_records'); assert.equal(response.body.recent_limit, 50);
    assert.deepEqual(response.body.excluded_sections, source === 'search-intel' ? ['search_pulses', 'image_scans'] : ['legacy_kv_launches']);
    assert.equal(fx.calls[0].sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    assert.equal(fx.calls.at(-1).sql, 'COMMIT');
    for (const { sql, params } of fx.calls.slice(2, -1)) {
      assert.match(sql, /m.tenant_id=\$1/); assert.match(sql, /m.client_id=\$2/);
      assert.match(sql, /r.tenant_id=\$1/); assert.deepEqual(params.slice(0, 2), [101, 11]);
      if (sql.includes('FROM search_intel_llm_runs') || sql.includes('FROM ad_performance_hourly') || sql.includes('FROM optimizer_actions')) {
        assert.match(sql, /WHERE c.tenant_id=\$1/);
        if (!sql.includes('count(*)')) assert.match(sql, /LIMIT 50/);
      }
      assert.doesNotMatch(sql, /SELECT \*|response_text|platform_camp_id|owner_email|before_value|after_value|apply_error|kv_store/);
    }
    if (source === 'campaigns') assert.ok(fx.calls.some(({ sql }) => /GROUP BY r.currency/.test(sql)));
  }
  assert.equal(fx.releases(), 2);
});

test('source data storage failures rollback and return no partial success or database details', async (t) => {
  const fx = await fixture(t, { query: async (sql) => {
    if (sql.includes('FROM clients')) return { rows: [client] };
    if (sql.includes('client_reporting_query_mappings')) throw new Error('sensitive detail');
    return { rows: [] };
  } });
  const response = await fx.request('GET', '/clients/11/data/search-intel');
  assert.equal(response.status, 500); assert.deepEqual(response.body, { ok: false, error: 'internal_error' });
  assert.equal(fx.calls.at(-1).sql, 'ROLLBACK'); assert.equal(fx.releases(), 1);
});
