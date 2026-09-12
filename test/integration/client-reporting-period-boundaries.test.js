'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const dedicatedUrl = process.env.PR10F1_TEST_DATABASE_URL;
const required = process.env.PR10G4_REQUIRE_DATABASE === '1';

test('Client reporting period boundaries: timezone-aware UTC SQL filters', {
  skip: !dedicatedUrl && !required ? 'no PR10F1_TEST_DATABASE_URL' : false,
  timeout: 120_000,
}, async (t) => {
  assert.ok(dedicatedUrl, 'PR10F1_TEST_DATABASE_URL is required');
  const environment = { DATABASE_URL: dedicatedUrl, NODE_ENV: 'test',
    PERMISSION_ENFORCEMENT: 'on', MULTITENANT_ENFORCEMENT: 'on' };
  const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  require('../helpers/env');
  let app, db, fx;
  t.after(async () => {
    try {
      if (app) await app.close();
      if (fx) await fx.cleanup();
    } finally {
      if (db) await db.getPool().end();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
  db = require('../../db');
  fx = require('../helpers/fixtures').makeFixtures();
  await db.ensureSchema();
  await fx.ensureSchemas();
  await require('../../services/search_intel/schema').ensureSearchIntelSchema();
  await require('../../services/optimizer/schema').ensureOptimizerSchema();
  await require('../../services/client_reporting/schema').ensureClientReportingSchema();
  await require('../../services/client_reporting/schema').ensureClientReportingMappingSchema();
  const { bootApp, request, login } = require('../helpers');
  app = await bootApp();
  const pool = db.getPool();
  const tenant = await fx.seedTenant('Period Boundaries');
  const user = await fx.seedUser({ tenantId: tenant.id, roleKey: 'tenant_owner', owner: true });
  const session = await login(app.baseUrl, user.email, user.password);
  const actor = { cookie: session.cookie, uid: user.id };
  const clientId = (await pool.query('INSERT INTO clients (tenant_id,name) VALUES ($1,$2) RETURNING id',
    [tenant.id, 'Boundary Client'])).rows[0].id;
  const queryId = (await pool.query('INSERT INTO search_intel_queries (tenant_id,query,brand) VALUES ($1,$2,$3) RETURNING id',
    [tenant.id, 'BOUNDARY', 'Brand'])).rows[0].id;
  await pool.query(`INSERT INTO client_reporting_query_mappings (tenant_id,query_id,client_id,mapping_id,created_by_user_id)
    VALUES ($1,$2,$3,$4,$5)`, [tenant.id, queryId, clientId, randomUUID(), user.id]);
  const runs = [
    ['2024-03-09T23:30:00.000Z', false],
    ['2024-03-10T04:30:00.000Z', true],
    ['2024-03-10T05:30:00.000Z', true],
    ['2024-03-11T03:30:00.000Z', false],
    ['2024-06-14T21:30:00.000Z', false],
    ['2024-06-14T22:30:00.000Z', true],
    ['2024-06-15T21:30:00.000Z', false],
  ];
  for (const [ran_at, brand_mentioned] of runs) {
    await pool.query(`INSERT INTO search_intel_llm_runs (tenant_id,query_id,provider,response_text,brand_mentioned,ran_at)
      VALUES ($1,$2,'openai','ok',$3,$4::timestamptz)`, [tenant.id, queryId, brand_mentioned, ran_at]);
  }
  const searchMetrics = ['brand_mentions', 'runs', 'successful_runs'];
  async function call(method, path, body, status = 200) {
    const response = await request(app.baseUrl, method, path, { cookie: actor.cookie, body, headers: { Origin: app.baseUrl } });
    assert.equal(response.status, status, `${method} ${path}: ${response.text}`);
    return response.json;
  }
  const profilePath = `/api/client-reporting/clients/${clientId}/profile`;
  const previewPath = `/api/client-reporting/clients/${clientId}/report-preview`;
  await call('PUT', profilePath, { report_source: 'search-intel', default_format: 'pdf', report_title: 'Boundary report',
    branding_mode: 'workspace', branding_overrides: {}, selected_metrics: searchMetrics,
    reporting_period: 'last_30_days', reporting_timezone: 'America/New_York', expected_version: 0 });
  const ny = await call('GET', `${previewPath}?start_date=2024-03-10&end_date=2024-03-10`);
  assert.equal(ny.reporting_dates.start, '2024-03-10');
  assert.equal(ny.reporting_dates.end, '2024-03-10');
  const nyTotals = ny.report.sections.find((section) => section.title === 'Search totals');
  assert.equal(nyTotals.rows.find((row) => row[0] === 'Runs')[1], 2);
  await call('PUT', profilePath, { report_source: 'search-intel', default_format: 'pdf', report_title: 'Boundary report',
    branding_mode: 'workspace', branding_overrides: {}, selected_metrics: searchMetrics,
    reporting_period: 'last_30_days', reporting_timezone: 'Africa/Johannesburg', expected_version: 1 });
  const jhb = await call('GET', `${previewPath}?start_date=2024-06-15&end_date=2024-06-15`);
  assert.equal(jhb.reporting_dates.start, '2024-06-15');
  assert.equal(jhb.reporting_dates.end, '2024-06-15');
  const jhbTotals = jhb.report.sections.find((section) => section.title === 'Search totals');
  assert.equal(jhbTotals.rows.find((row) => row[0] === 'Runs')[1], 1);
  assert.deepEqual(ny.selected_metrics, searchMetrics);
  const ordered = nyTotals.rows.map((row) => row[0]);
  assert.deepEqual(ordered, ['Brand mentions', 'Runs', 'Successful runs']);
  const portalInvite = await call('POST', `/api/client-reporting/clients/${clientId}/portal/invitations`, {});
  const rawToken = portalInvite.invite_path.split('/').pop();
  const redeem = await request(app.baseUrl, 'POST', `/api/client-reporting/portal/redeem/${rawToken}`, { body: {} });
  assert.equal(redeem.status, 200);
  const portalCookie = (redeem.cookies || []).map((c) => c.split(';')[0]).find((c) => c.startsWith('infogenie.crp='));
  assert.ok(portalCookie);
  const portalReport = await request(app.baseUrl, 'GET', '/api/client-reporting/portal/report', { cookie: portalCookie });
  assert.equal(portalReport.status, 200);
  assert.deepEqual(portalReport.json.selected_metrics, searchMetrics);
  assert.ok(portalReport.json.reporting_dates?.start);
  const mail = require('../helpers/mail').installMailCapture();
  try {
    await pool.query(`INSERT INTO client_reporting_recipients (tenant_id, client_id, email, enabled)
      VALUES ($1,$2,$3,true) ON CONFLICT (tenant_id, client_id) DO UPDATE SET email=EXCLUDED.email, enabled=true`,
    [tenant.id, clientId, 'boundary@example.com']);
    const emailed = await call('POST', `/api/client-reporting/clients/${clientId}/report-email`,
      { expected_version: 2, confirm: true, start_date: '2024-03-10', end_date: '2024-03-10' });
    assert.equal(emailed.sent, true);
    assert.equal(mail.messages.length, 1);
    assert.equal(mail.messages[0].to, 'boundary@example.com');
    assert.match(mail.messages[0].subject, /Boundary report/);
  } finally { mail.restore(); }
});
