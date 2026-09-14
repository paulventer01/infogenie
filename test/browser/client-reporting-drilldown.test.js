'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const dedicatedUrl = process.env.PR10E9_TEST_DATABASE_URL;
const required = process.env.PR10G5_REQUIRE_BROWSER === '1';
const PANEL = '#ig-react-panel', ROUTE = '/manage/client-reporting';
const SECTION = `${PANEL} [aria-label="Client report preview"]`, API = '/api/client-reporting';
const profilePath = (id) => `${API}/clients/${id}/profile`;
async function button(page, name, scope = PANEL) {
  await page.locator(`${scope} ::-p-aria([name="${name}"][role="button"])`).click();
}
async function text(page, wanted, scope = SECTION) {
  await page.waitForFunction((selector, value) => document.querySelector(selector)?.innerText.includes(value), {}, scope, wanted);
}
async function selectClient(page, id) {
  await page.waitForSelector(`${PANEL} select[name="client_id"]:enabled`, { visible: true });
  await responseFor(page, 'GET', profilePath(id), () => page.select(`${PANEL} select[name="client_id"]`, String(id)));
  await page.waitForSelector(`${SECTION} ::-p-aria([name="Preview report"][role="button"]):not([disabled])`, { visible: true });
}
async function responseFor(page, method, path, action, status = 200) {
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === method && new URL(r.url()).pathname === path), action(),
  ]);
  assert.equal(response.status(), status, `${method} ${path}`); return response;
}
test('PR10G.5 metric drilldown browser acceptance (real PostgreSQL/TLS)', {
  skip: !dedicatedUrl && !required ? 'optional local run: no PR10E9_TEST_DATABASE_URL' : false,
  timeout: 600_000,
}, async (t) => {
  assert.ok(dedicatedUrl);
  const errors = [];
  let browser, pool, tenantIds, closing = false;
  t.after(async () => {
    closing = true; if (browser) await browser.close();
    if (pool && tenantIds) for (const table of ['search_intel_queries', 'ad_campaigns']) {
      await pool.query(`DELETE FROM ${table} WHERE tenant_id=ANY($1::int[])`, [tenantIds]);
    }
    assert.deepEqual(errors, []);
  });
  const { startAgencyBrowser } = require('../helpers/agency-browser');
  const { baseUrl, db, actors } = await startAgencyBrowser(t);
  await require('../../services/search_intel/schema').ensureSearchIntelSchema();
  const schema = require('../../services/client_reporting/schema');
  await schema.ensureClientReportingSchema(); await schema.ensureClientReportingMappingSchema();
  pool = db.getPool(); tenantIds = [actors.owner.tid];
  const client = (await pool.query('INSERT INTO clients (tenant_id,name) VALUES ($1,$2) RETURNING id', [actors.owner.tid, 'PR10G5 Drilldown'])).rows[0];
  const queryId = (await pool.query('INSERT INTO search_intel_queries (tenant_id,query,brand) VALUES ($1,$2,$3) RETURNING id',
    [actors.owner.tid, 'drill', 'brand'])).rows[0].id;
  await pool.query('INSERT INTO client_reporting_query_mappings (tenant_id,query_id,client_id,mapping_id,created_by_user_id) VALUES ($1,$2,$3,$4,$5)',
    [actors.owner.tid, queryId, client.id, randomUUID(), actors.owner.uid]);
  await pool.query(`INSERT INTO search_intel_llm_runs (tenant_id,query_id,provider,response_text,brand_mentioned,error,ran_at)
    SELECT $1,$2,'fixture','x',true,NULL,now()-g*interval '1 hour' FROM generate_series(1,3) g`, [actors.owner.tid, queryId]);
  browser = await require('puppeteer').launch({ headless: true, pipe: true,
    args: ['--disable-dev-shm-usage', '--disable-background-networking', '--lang=en-US'] });
  const context = await browser.createBrowserContext(), page = await context.newPage();
  page.setDefaultTimeout(45_000); page.setDefaultNavigationTimeout(90_000);
  await page.setViewport({ width: 1440, height: 1050 });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/login?next=${encodeURIComponent(ROUTE)}`, { waitUntil: 'networkidle2' });
  await button(page, 'Log In', 'body');
  await page.locator('#email').fill(actors.owner.email);
  await page.locator('#pass').fill(actors.owner.password);
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/auth/login'),
    button(page, 'Sign In', 'body'),
  ]);
  await page.waitForSelector(PANEL, { visible: true });
  await selectClient(page, client.id);
  await page.evaluate(async (api, id) => {
    await fetch(`${api}/clients/${id}/profile`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ report_source: 'search-intel', default_format: 'pdf', report_title: 'Drilldown report',
        branding_mode: 'workspace', branding_overrides: {}, selected_metrics: ['runs'],
        reporting_period: 'all_time', reporting_timezone: 'UTC', expected_version: 0 }) });
  }, API, client.id);
  await page.reload({ waitUntil: 'networkidle2' });
  await selectClient(page, client.id);
  await responseFor(page, 'GET', `${API}/clients/${client.id}/report-preview`, () => button(page, 'Preview report', SECTION));
  await text(page, 'Runs', SECTION);
  await responseFor(page, 'GET', `${API}/clients/${client.id}/metric-drilldown/runs`, () => button(page, 'View contributing records for row 1', SECTION));
  await text(page, '3 contributing records total', SECTION);
  await button(page, 'Close contributing records', SECTION);
  await page.waitForFunction((selector) => !document.querySelector(selector), {}, `${SECTION} [aria-label="Contributing records drilldown"]`);
  await selectClient(page, client.id);
  await page.waitForFunction((selector) => !document.querySelector(selector)?.innerText.includes('contributing records total'), {}, SECTION);
});
