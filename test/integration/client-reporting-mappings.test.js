'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const net = require('node:net');
const { setTimeout: delay } = require('node:timers/promises');
const dedicatedUrl = process.env.PR10F1_TEST_DATABASE_URL;
const required = process.env.PR10F3_REQUIRE_DATABASE === '1';

test('Client reporting mappings: native PostgreSQL isolation and authenticated routes', {
  skip: !dedicatedUrl && !required ? 'no PR10F1_TEST_DATABASE_URL' : false,
  timeout: 120_000,
}, async (t) => {
  assert.ok(dedicatedUrl, 'PR10F1_TEST_DATABASE_URL required; ambient DATABASE_URL is never used');
  const url = new URL(dedicatedUrl);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol) &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
    url.pathname === '/infogenie_client_reporting' && url.username && url.password && !url.search && !url.hash,
  'Use explicit loopback credentials and infogenie_client_reporting, without URL overrides');
  const environment = { DATABASE_URL: dedicatedUrl, NODE_ENV: 'test', SECURITY_CSRF: 'on',
    PERMISSION_ENFORCEMENT: 'on', MULTITENANT_ENFORCEMENT: 'on' };
  const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  require('../helpers/env');
  let app, db, fx;
  const blocked = [], ports = new Set([Number(url.port || 5432)]);
  const connect = net.Socket.prototype.connect;
  t.mock.method(net.Socket.prototype, 'connect', function (...args) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const options = first && typeof first === 'object' ? first : { port: first, host: args[1] };
    if (options.path || !['localhost', '127.0.0.1', '::1'].includes(options.host || 'localhost') ||
        !ports.has(Number(options.port))) {
      blocked.push('outbound socket');
      throw new Error('Reporting mapping test blocked outbound socket');
    }
    return connect.apply(this, args);
  });
  t.mock.method(global, 'fetch', async () => {
    blocked.push('fetch');
    throw new Error('Reporting mapping test must not call external fetch');
  });
  t.after(async () => {
    try {
      if (app) await app.close();
      if (fx) {
        if (fx.created.userIds.length) await db.getPool().query(
          "DELETE FROM user_sessions WHERE sess->>'userId'=ANY($1::text[])", [fx.created.userIds.map(String)]);
        for (const table of ['search_intel_queries', 'ad_campaigns']) {
          await db.getPool().query(`DELETE FROM ${table} WHERE tenant_id=ANY($1::int[])`, [fx.created.tenantIds]);
        }
        await fx.cleanup();
      }
    } finally {
      if (db) await db.getPool().end();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      assert.deepEqual(blocked, [], 'no network attempt may hide behind a fallback');
    }
  });
  db = require('../../db');
  fx = require('../helpers/fixtures').makeFixtures();
  const pool = db.getPool();
  assert.equal((await pool.query('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()')).rows[0]?.ssl, true);
  await db.ensureSchema();
  await fx.ensureSchemas();
  await require('../../services/search_intel/schema').ensureSearchIntelSchema();
  await require('../../services/optimizer/schema').ensureOptimizerSchema();
  await require('../../services/client_reporting/schema').ensureClientReportingSchema();
  const { ensureClientReportingMappingSchema } = require('../../services/client_reporting/schema');
  await ensureClientReportingMappingSchema();
  await ensureClientReportingMappingSchema();
  const { bootApp, request, login } = require('../helpers');
  app = await bootApp();
  ports.add(app.port);
  const prefix = '/api/client-reporting';
  async function call(actor, method, path, body, status = 200) {
    const response = await request(app.baseUrl, method, `${prefix}${path}`, {
      cookie: actor?.cookie, body, headers: { Origin: app.baseUrl },
    });
    assert.equal(response.status, status, `${method} ${path}: ${response.text}`);
    assert.equal(response.json?.ok, status < 400);
    return response.json;
  }
  async function actor(tenant, roleKey = 'tenant_owner') {
    const user = await fx.seedUser({ tenantId: tenant.id, roleKey });
    const session = await login(app.baseUrl, user.email, user.password);
    assert.equal(session.status, 200);
    return { cookie: session.cookie, uid: user.id };
  }
  async function client(tenant, name) {
    return (await pool.query('INSERT INTO clients (tenant_id,name) VALUES ($1,$2) RETURNING id',
      [tenant.id, name])).rows[0].id;
  }
  async function source(tenant, kind, label) {
    const sql = kind === 'search-intel'
      ? 'INSERT INTO search_intel_queries (tenant_id,query,brand) VALUES ($1,$2,$3) RETURNING id'
      : "INSERT INTO ad_campaigns (tenant_id,name,platform_camp_id,platform) VALUES ($1,$2,$3,'google') RETURNING id";
    return (await pool.query(sql, [tenant.id, label, randomUUID()])).rows[0].id;
  }
  const ta = await fx.seedTenant('Mapping A'), tb = await fx.seedTenant('Mapping B');
  const a = await actor(ta), b = await actor(tb), analyst = await actor(ta, 'analyst');
  const ca = await client(ta, 'Client A'), ca2 = await client(ta, 'Client A2'), cb = await client(tb, 'Client B');
  const mappingPath = (id, kind, record) => `/clients/${id}/mappings/${kind}/${record}`;
  const dataPath = (id, kind) => `/clients/${id}/data/${kind}`;
  const fixtures = {};
  for (const kind of ['search-intel', 'campaigns']) {
    fixtures[kind] = { own: await source(ta, kind, 'Owned first'), second: await source(ta, kind, 'Owned second'),
      other: await source(ta, kind, 'Other client'), unmapped: await source(ta, kind, 'Unmapped'),
      foreign: await source(tb, kind, 'Foreign tenant') };
  }

  await t.test('unmapped sources stay empty and candidate pagination never crosses tenants', async () => {
    for (const [kind, f] of Object.entries(fixtures)) {
      const empty = await call(a, 'GET', dataPath(ca, kind));
      assert.deepEqual(empty.records, []);
      assert.equal(empty.summary.mapped_records, 0);
      assert.equal(empty.has_more, false);
      assert.equal(empty.next_cursor, null);
      assert.deepEqual(empty.summary, kind === 'search-intel'
        ? { mapped_records: 0, runs: 0, successful_runs: 0, brand_mentions: 0 }
        : { mapped_records: 0, by_currency: [] });
      assert.ok(Object.values(empty.recent).every((rows) => rows.length === 0));
      const first = await call(a, 'GET', `/sources/${kind}/records?limit=2`);
      assert.deepEqual(first.records.map((r) => r.id), [f.own, f.second]);
      assert.ok(first.records.every((r) => r.client_id === null && r.mapping_id === null));
      assert.equal(first.has_more, true);
      const last = await call(a, 'GET', `/sources/${kind}/records?limit=2&cursor=${first.next_cursor}`);
      assert.deepEqual(last.records.map((r) => r.id), [f.other, f.unmapped]);
      assert.equal(last.has_more, false);
      assert.deepEqual((await call(b, 'GET', `/sources/${kind}/records`)).records.map((r) => r.id), [f.foreign]);
    }
  });

  await t.test('native foreign keys reject cross-tenant roots and clients; one record has one client', async () => {
    for (const [kind, f] of Object.entries(fixtures)) {
      const table = kind === 'search-intel' ? 'client_reporting_query_mappings' : 'client_reporting_campaign_mappings';
      const key = kind === 'search-intel' ? 'query_id' : 'campaign_id';
      const insert = `INSERT INTO ${table} (tenant_id,${key},client_id,mapping_id) VALUES ($1,$2,$3,$4)`;
      await assert.rejects(pool.query(insert, [ta.id, f.foreign, ca, randomUUID()]), { code: '23503' });
      await assert.rejects(pool.query(insert, [ta.id, f.own, cb, randomUUID()]), { code: '23503' });
      const saved = (await call(a, 'POST', mappingPath(ca, kind, f.own), {}, 201)).mapping;
      assert.equal(saved.record_id, f.own);
      assert.equal(saved.client_id, ca);
      await assert.rejects(pool.query(insert, [ta.id, f.own, ca2, randomUUID()]), { code: '23505' });
      const row = (await pool.query(`SELECT * FROM ${table} WHERE tenant_id=$1 AND ${key}=$2`, [ta.id, f.own])).rows[0];
      assert.equal(row.created_by_user_id, a.uid);
      assert.equal(row.mapping_id, saved.mapping_id);
      await call(a, 'POST', mappingPath(ca2, kind, f.own), {}, 409);
      await call(a, 'POST', mappingPath(ca, kind, f.second), {}, 201);
      await call(a, 'POST', mappingPath(ca2, kind, f.other), {}, 201);
      await call(b, 'POST', mappingPath(cb, kind, f.foreign), {}, 201);
    }
    await ensureClientReportingMappingSchema();
  });

  await t.test('mapped search totals and recent runs exclude foreign children before aggregation and limits', async () => {
    const f = fixtures['search-intel'];
    async function runs(tid, query, count, mentioned, error, future = false) {
      await pool.query(`INSERT INTO search_intel_llm_runs
        (tenant_id,query_id,provider,response_text,brand_mentioned,error,ran_at)
        SELECT $1,$2,'fixture','PRIVATE RESPONSE',$4,$5,
          now() + (g * CASE WHEN $6 THEN 1 ELSE -1 END) * interval '1 hour' FROM generate_series(1,$3::int) g`,
      [tid, query, count, mentioned, error, future]);
    }
    await runs(ta.id, f.own, 1, true, null);
    await runs(ta.id, f.own, 1, true, 'PRIVATE ERROR');
    await runs(ta.id, f.second, 1, false, null);
    for (const [tid, record] of [[ta.id, f.other], [ta.id, f.unmapped], [tb.id, f.foreign],
      [tb.id, f.own], [ta.id, f.foreign]]) await runs(tid, record, 55, true, null, true);
    const data = await call(a, 'GET', `${dataPath(ca, 'search-intel')}?limit=1`);
    assert.deepEqual(data.records.map((r) => r.id), [f.own]);
    assert.equal(data.has_more, true);
    assert.deepEqual(data.summary, { mapped_records: 2, runs: 3, successful_runs: 2, brand_mentions: 1 });
    assert.equal(data.summary_scope, 'all_mapped_records');
    assert.equal(data.recent_limit, 50);
    assert.equal(data.recent.llm_runs.length, 3);
    assert.ok(data.recent.llm_runs.every((r) => [f.own, f.second].includes(r.query_id)));
    assert.equal(data.recent.llm_runs.filter((r) => r.failed).length, 1);
    assert.deepEqual(data.excluded_sections, ['search_pulses', 'image_scans']);
    assert.doesNotMatch(JSON.stringify(data), /PRIVATE RESPONSE|PRIVATE ERROR|response_text|competitor_hits|citations/);
    const next = await call(a, 'GET', `${dataPath(ca, 'search-intel')}?limit=1&cursor=${data.next_cursor}`);
    assert.deepEqual(next.records.map((r) => r.id), [f.second]);
    assert.deepEqual(next.summary, data.summary);
    assert.equal(next.has_more, false);
  });

  await t.test('campaign currencies, performance and actions use only mapped roots with matching child tenants', async () => {
    const f = fixtures.campaigns;
    await pool.query("UPDATE ad_campaigns SET currency='ZAR' WHERE id=$1", [f.second]);
    async function children(tid, record, count, future = false) {
      await pool.query(`INSERT INTO ad_performance_hourly
        (tenant_id,campaign_id,bucket_hour,spend,impressions,clicks,conversions,revenue,raw)
        SELECT $1,$2,now()+($3::int+g)*interval '1 hour',2,20,3,1,6,'{"secret":"PRIVATE RAW"}'
        FROM generate_series(1,$4::int) g`, [tid, record, future ? 1000 + tid : -1000, count]);
      await pool.query(`INSERT INTO optimizer_actions (tenant_id,campaign_id,action_type,reason,before_value,created_at)
        SELECT $1,$2,'fixture','PRIVATE REASON','{"secret":"PRIVATE BEFORE"}',
          now()+($3::int+g)*interval '1 hour' FROM generate_series(1,$4::int) g`,
      [tid, record, future ? 1000 : -1000, count]);
    }
    await children(ta.id, f.own, 2);
    await children(ta.id, f.second, 1);
    for (const [tid, record] of [[ta.id, f.other], [ta.id, f.unmapped], [tb.id, f.foreign],
      [tb.id, f.own], [ta.id, f.foreign]]) await children(tid, record, 55, true);
    const data = await call(a, 'GET', `${dataPath(ca, 'campaigns')}?limit=1`);
    assert.deepEqual(data.records.map((r) => r.id), [f.own]);
    assert.equal(data.summary.mapped_records, 2);
    assert.deepEqual(data.summary.by_currency.map((r) => ({ ...r, spend: Number(r.spend), impressions: Number(r.impressions),
      clicks: Number(r.clicks), conversions: Number(r.conversions), revenue: Number(r.revenue) })), [
      { currency: 'USD', performance_rows: 2, spend: 4, impressions: 40, clicks: 6, conversions: 2, revenue: 12 },
      { currency: 'ZAR', performance_rows: 1, spend: 2, impressions: 20, clicks: 3, conversions: 1, revenue: 6 },
    ]);
    for (const rows of Object.values(data.recent)) {
      assert.equal(rows.length, 3);
      assert.ok(rows.every((r) => [f.own, f.second].includes(r.campaign_id)));
    }
    assert.deepEqual(data.excluded_sections, ['legacy_kv_launches']);
    assert.doesNotMatch(JSON.stringify(data), /PRIVATE|owner_email|platform_camp_id|before_value/);
    const next = await call(a, 'GET', `${dataPath(ca, 'campaigns')}?limit=1&cursor=${data.next_cursor}`);
    assert.deepEqual(next.records.map((r) => r.id), [f.second]);
    assert.deepEqual(next.summary, data.summary);
  });

  await t.test('settings authority, tenant ownership and CSRF prevent reads or mapping mutations', async () => {
    for (const [kind, f] of Object.entries(fixtures)) {
      await call(analyst, 'GET', `/sources/${kind}/records`, undefined, 403);
      await call(analyst, 'GET', dataPath(ca, kind), undefined, 403);
      await call(analyst, 'POST', mappingPath(ca, kind, f.unmapped), {}, 403);
      await call(a, 'POST', mappingPath(ca, kind, f.foreign), {}, 404);
      await call(a, 'POST', mappingPath(cb, kind, f.unmapped), {}, 404);
      await call(a, 'GET', dataPath(cb, kind), undefined, 404);
      await call(a, 'POST', mappingPath(ca, kind, f.unmapped), { tenant_id: tb.id }, 400);
      for (const headers of [{}, { Origin: 'https://attacker.invalid' }]) {
        const denied = await request(app.baseUrl, 'POST', `${prefix}${mappingPath(ca, kind, f.unmapped)}`,
          { cookie: a.cookie, headers, body: {} });
        assert.equal(denied.status, 403);
        assert.equal(denied.json.error, 'csrf_rejected');
      }
      const remaining = await call(a, 'GET', `/sources/${kind}/records`);
      assert.equal(remaining.records.find((r) => r.id === f.unmapped).mapping_id, null);
    }
  });

  await t.test('concurrent assignment has one winner and a stale UUID cannot delete its replacement', async () => {
    for (const [kind, f] of Object.entries(fixtures)) {
      const responses = await Promise.all([ca, ca2].map((id) => request(app.baseUrl, 'POST',
        `${prefix}${mappingPath(id, kind, f.unmapped)}`, { cookie: a.cookie, headers: { Origin: app.baseUrl }, body: {} })));
      assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
      const original = responses.find((r) => r.status === 201).json.mapping;
      const path = mappingPath(original.client_id, kind, f.unmapped);
      await call(a, 'DELETE', path, { mapping_id: original.mapping_id });
      const replacement = (await call(a, 'POST', path, {}, 201)).mapping;
      assert.notEqual(replacement.mapping_id, original.mapping_id);
      await call(a, 'DELETE', path, { mapping_id: original.mapping_id }, 409);
      const current = (await call(a, 'GET', `/sources/${kind}/records`)).records.find((r) => r.id === f.unmapped);
      assert.equal(current.mapping_id, replacement.mapping_id);
      await call(a, 'DELETE', path, { mapping_id: replacement.mapping_id });
    }
  });

  await t.test('archive wins against a waiting assignment and hides existing client data', async () => {
    const connection = await pool.connect(), f = fixtures['search-intel'];
    let pending;
    try {
      await connection.query('BEGIN');
      await connection.query("UPDATE clients SET status='archived' WHERE tenant_id=$1 AND id=$2", [ta.id, ca]);
      pending = request(app.baseUrl, 'POST', `${prefix}${mappingPath(ca, 'search-intel', f.unmapped)}`,
        { cookie: a.cookie, headers: { Origin: app.baseUrl }, body: {} });
      let waiting = false;
      for (let attempt = 0; attempt < 200 && !waiting; attempt += 1) {
        waiting = (await pool.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
          AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%FROM clients%'`)).rowCount > 0;
        if (!waiting) await delay(10);
      }
      assert.equal(waiting, true, 'assignment must lock and revalidate the canonical client');
      await connection.query('COMMIT');
      assert.equal((await pending).status, 404);
    } finally {
      await connection.query('ROLLBACK');
      connection.release();
      if (pending) await pending;
    }
    for (const kind of Object.keys(fixtures)) await call(a, 'GET', dataPath(ca, kind), undefined, 404);
    const records = (await call(a, 'GET', '/sources/search-intel/records')).records;
    assert.equal(records.find((r) => r.id === f.unmapped).mapping_id, null);
  });

  await t.test('source and client deletion cascade mappings while another tenant stays intact', async () => {
    for (const [kind, f] of Object.entries(fixtures)) {
      const table = kind === 'search-intel' ? 'search_intel_queries' : 'ad_campaigns';
      await pool.query(`DELETE FROM ${table} WHERE tenant_id=$1 AND id=$2`, [ta.id, f.other]);
      const empty = await call(a, 'GET', dataPath(ca2, kind));
      assert.equal(empty.summary.mapped_records, 0);
    }
    await pool.query('DELETE FROM clients WHERE tenant_id=$1 AND id=$2', [ta.id, ca]);
    for (const [kind, f] of Object.entries(fixtures)) {
      const candidates = (await call(a, 'GET', `/sources/${kind}/records`)).records;
      assert.ok(candidates.every((r) => r.client_id === null));
      const foreign = await call(b, 'GET', dataPath(cb, kind));
      assert.deepEqual(foreign.records.map((r) => r.id), [f.foreign]);
      assert.equal(foreign.summary.mapped_records, 1);
    }
  });
});
