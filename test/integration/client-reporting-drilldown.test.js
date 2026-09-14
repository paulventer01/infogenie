'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const net = require('node:net');
const dedicatedUrl = process.env.PR10F1_TEST_DATABASE_URL;
const required = process.env.PR10G5_REQUIRE_DATABASE === '1';

function portalCookie(setCookieArray) {
  for (const c of setCookieArray || []) {
    const m = /^(infogenie\.crp=[^;]+)/.exec(c);
    if (m) return m[1];
  }
  return null;
}

test('Client reporting drilldown: totals reconcile, isolation, pagination and portal auth', {
  skip: !dedicatedUrl && !required ? 'no PR10F1_TEST_DATABASE_URL' : false,
  timeout: 120_000,
}, async (t) => {
  assert.ok(dedicatedUrl);
  const environment = { DATABASE_URL: dedicatedUrl, NODE_ENV: 'test',
    PERMISSION_ENFORCEMENT: 'on', MULTITENANT_ENFORCEMENT: 'on', SECURITY_CSRF: 'on' };
  const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  require('../helpers/env');
  let app, db, fx;
  const ports = new Set([Number(new URL(dedicatedUrl).port || 5432)]);
  const connect = net.Socket.prototype.connect;
  t.mock.method(net.Socket.prototype, 'connect', function (...args) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const options = first && typeof first === 'object' ? first : { port: first, host: args[1] };
    if (options.path || !['localhost', '127.0.0.1', '::1'].includes(options.host || 'localhost') || !ports.has(Number(options.port)))
      throw new Error('blocked outbound socket');
    return connect.apply(this, args);
  });
  t.after(async () => {
    if (app) await app.close();
    if (fx) {
      if (fx.created.userIds.length) await db.getPool().query(
        "DELETE FROM user_sessions WHERE sess->>'userId'=ANY($1::text[])", [fx.created.userIds.map(String)]);
      for (const table of ['search_intel_queries', 'ad_campaigns']) {
        await db.getPool().query(`DELETE FROM ${table} WHERE tenant_id=ANY($1::int[])`, [fx.created.tenantIds]);
      }
      await fx.cleanup();
    }
    if (db) await db.getPool().end();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  db = require('../../db');
  fx = require('../helpers/fixtures').makeFixtures();
  await db.ensureSchema();
  await fx.ensureSchemas();
  await require('../../services/search_intel/schema').ensureSearchIntelSchema();
  await require('../../services/optimizer/schema').ensureOptimizerSchema();
  const reportingSchema = require('../../services/client_reporting/schema');
  await reportingSchema.ensureClientReportingSchema();
  await reportingSchema.ensureClientReportingMappingSchema();
  const { bootApp, request, login } = require('../helpers');
  app = await bootApp();
  ports.add(app.port);
  const prefix = '/api/client-reporting';
  const portalApi = `${prefix}/portal`;
  async function call(actor, method, path, body, status = 200) {
    const response = await request(app.baseUrl, method, path, {
      cookie: actor?.cookie, body, headers: { Origin: app.baseUrl },
    });
    assert.equal(response.status, status, `${method} ${path}: ${response.text}`);
    return response.json;
  }
  async function actor(tenant) {
    const user = await fx.seedUser({ tenantId: tenant.id, roleKey: 'tenant_owner' });
    const session = await login(app.baseUrl, user.email, user.password);
    return { cookie: session.cookie, tid: tenant.id, uid: user.id };
  }
  const ta = await fx.seedTenant('Drilldown A'), tb = await fx.seedTenant('Drilldown B');
  const a = await actor(ta), b = await actor(tb);
  const pool = db.getPool();
  const ca = (await pool.query('INSERT INTO clients (tenant_id,name) VALUES ($1,$2) RETURNING id', [ta.id, 'A'])).rows[0].id;
  const ca2 = (await pool.query('INSERT INTO clients (tenant_id,name) VALUES ($1,$2) RETURNING id', [ta.id, 'A2'])).rows[0].id;
  const cb = (await pool.query('INSERT INTO clients (tenant_id,name) VALUES ($1,$2) RETURNING id', [tb.id, 'B'])).rows[0].id;
  const profileBody = { report_source: 'search-intel', default_format: 'pdf', report_title: 'Report', branding_mode: 'workspace',
    branding_overrides: {}, selected_metrics: ['runs', 'successful_runs', 'brand_mentions'],
    reporting_period: 'all_time', reporting_timezone: 'UTC', expected_version: 0 };
  await call(a, 'PUT', `${prefix}/clients/${ca}/profile`, profileBody);
  await call(b, 'PUT', `${prefix}/clients/${cb}/profile`, profileBody);
  const qOwn = (await pool.query('INSERT INTO search_intel_queries (tenant_id,query,brand) VALUES ($1,$2,$3) RETURNING id',
    [ta.id, 'own', 'brand'])).rows[0].id;
  const qOther = (await pool.query('INSERT INTO search_intel_queries (tenant_id,query,brand) VALUES ($1,$2,$3) RETURNING id',
    [ta.id, 'other-client', 'brand'])).rows[0].id;
  const qForeign = (await pool.query('INSERT INTO search_intel_queries (tenant_id,query,brand) VALUES ($1,$2,$3) RETURNING id',
    [tb.id, 'foreign', 'brand'])).rows[0].id;
  await pool.query('INSERT INTO client_reporting_query_mappings (tenant_id,query_id,client_id,mapping_id,created_by_user_id) VALUES ($1,$2,$3,$4,$5)',
    [ta.id, qOwn, ca, randomUUID(), a.uid]);
  await pool.query('INSERT INTO client_reporting_query_mappings (tenant_id,query_id,client_id,mapping_id,created_by_user_id) VALUES ($1,$2,$3,$4,$5)',
    [ta.id, qOther, ca2, randomUUID(), a.uid]);
  async function seedRuns(tenantId, queryId, count, mentioned, error) {
    await pool.query(`INSERT INTO search_intel_llm_runs (tenant_id,query_id,provider,response_text,brand_mentioned,error,ran_at)
      SELECT $1,$2,'fixture','PRIVATE',$4,$5,now() - (g * interval '1 hour') FROM generate_series(1,$3::int) g`,
    [tenantId, queryId, count, mentioned, error]);
  }
  await seedRuns(ta.id, qOwn, 3, true, null);
  await seedRuns(ta.id, qOwn, 1, true, 'fail');
  await seedRuns(ta.id, qOther, 5, true, null);
  await seedRuns(tb.id, qForeign, 4, true, null);
  const preview = await call(a, 'GET', `${prefix}/clients/${ca}/report-preview`);
  assert.equal(preview.report.sections.find((section) => section.title === 'Search totals').rows.find((row) => row[0] === 'Runs')[1], 4);
  const page1 = await call(a, 'GET', `${prefix}/clients/${ca}/metric-drilldown/runs?limit=2`);
  assert.equal(page1.total_count, 4);
  assert.equal(page1.records.length, 2);
  assert.ok(page1.has_more);
  const ids1 = page1.records.map((row) => row.id);
  const page2 = await call(a, 'GET', `${prefix}/clients/${ca}/metric-drilldown/runs?limit=2&cursor=${page1.next_cursor}`);
  assert.equal(page2.records.length, 2);
  const ids2 = page2.records.map((row) => row.id);
  assert.deepEqual([...new Set([...ids1, ...ids2])].sort((x, y) => x - y), [...ids1, ...ids2].sort((x, y) => x - y));
  assert.equal([...new Set([...ids1, ...ids2])].length, 4);
  const mentions = await call(a, 'GET', `${prefix}/clients/${ca}/metric-drilldown/brand_mentions?limit=50`);
  assert.equal(mentions.total_count, 3);
  assert.equal((await call(a, 'GET', `${prefix}/clients/${cb}/metric-drilldown/runs`, undefined, 404)).error, 'client_not_found');
  assert.equal((await call(b, 'GET', `${prefix}/clients/${ca}/metric-drilldown/runs`, undefined, 404)).error, 'client_not_found');
  const invite = await call(a, 'POST', `${prefix}/clients/${ca}/portal/invitations`, {}, 201);
  const token = invite.invite_path.split('/').pop();
  const redeem = await request(app.baseUrl, 'POST', `${portalApi}/redeem/${token}`, { body: {} });
  const portal = portalCookie(redeem.cookies);
  const portalRuns = await request(app.baseUrl, 'GET', `${portalApi}/metric-drilldown/runs?limit=50`, { cookie: portal });
  assert.equal(portalRuns.status, 200);
  assert.equal(portalRuns.json.total_count, 4);
  const unauth = await request(app.baseUrl, 'GET', `${portalApi}/metric-drilldown/runs`);
  assert.equal(unauth.status, 401);
  await call(a, 'PUT', `${prefix}/clients/${ca}/profile`, { ...profileBody, report_source: 'campaigns',
    selected_metrics: ['spend', 'impressions'], expected_version: 1 });
  const camp = (await pool.query("INSERT INTO ad_campaigns (tenant_id,name,platform_camp_id,platform,currency) VALUES ($1,'C','x','google','USD') RETURNING id",
    [ta.id])).rows[0].id;
  await pool.query('INSERT INTO client_reporting_campaign_mappings (tenant_id,campaign_id,client_id,mapping_id,created_by_user_id) VALUES ($1,$2,$3,$4,$5)',
    [ta.id, camp, ca, randomUUID(), a.uid]);
  await pool.query(`INSERT INTO ad_performance_hourly (tenant_id,campaign_id,bucket_hour,spend,impressions,clicks,conversions,revenue,raw)
    VALUES ($1,$2,now()-interval '2 hours',10,100,5,1,20,'{}'),($1,$2,now()-interval '1 hour',5,50,2,0,0,'{}')`,
  [ta.id, camp]);
  const spend = await call(a, 'GET', `${prefix}/clients/${ca}/metric-drilldown/spend?currency=USD`);
  assert.equal(spend.total_count, 2);
  assert.equal(spend.records.reduce((sum, row) => sum + Number(row.spend), 0), 15);
  const eur = await call(a, 'GET', `${prefix}/clients/${ca}/metric-drilldown/spend?currency=EUR`);
  assert.equal(eur.total_count, 0);
});
