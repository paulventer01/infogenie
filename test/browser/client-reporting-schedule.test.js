'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const dedicatedUrl = process.env.PR10E9_TEST_DATABASE_URL;
const required = process.env.PR10F7_REQUIRE_BROWSER === '1';
const PANEL = '#ig-react-panel', ROUTE = '/manage/client-reporting';
const SECTION = `${PANEL} [aria-label="Client report schedule"]`, API = '/api/client-reporting';
const profilePath = (id) => `${API}/clients/${id}/profile`;

async function button(page, name, scope = PANEL) {
  await page.locator(`${scope} ::-p-aria([name="${name}"][role="button"])`).click();
}
async function selectClient(page, id) {
  await page.waitForSelector(`${PANEL} select[name="client_id"]:enabled`, { visible: true });
  await responseFor(page, 'GET', profilePath(id), () => page.select(`${PANEL} select[name="client_id"]`, String(id)));
  await page.waitForSelector(`${SECTION} input[name="opt_in"]:enabled`, { visible: true });
}
async function responseFor(page, method, path, action, status = 200) {
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === method && new URL(r.url()).pathname === path),
    action(),
  ]);
  assert.equal(response.status(), status, `${method} ${path}`);
  return response.json();
}

test('PR10F.7 schedule opt-in, pause and history browser acceptance', {
  skip: !dedicatedUrl && !required ? 'optional local run: no PR10E9_TEST_DATABASE_URL' : false,
  timeout: 600_000,
}, async (t) => {
  assert.ok(dedicatedUrl, 'PR10E9_TEST_DATABASE_URL required');
  const errors = [];
  let browser, closing = false;
  t.after(async () => {
    closing = true;
    if (browser) await browser.close();
    assert.deepEqual(errors, [], 'no browser errors');
  });
  const { startAgencyBrowser } = require('../helpers/agency-browser');
  const { baseUrl, db, actors } = await startAgencyBrowser(t);
  await require('../../services/search_intel/schema').ensureSearchIntelSchema();
  await require('../../services/optimizer/schema').ensureOptimizerSchema();
  const schema = require('../../services/client_reporting/schema');
  await schema.ensureClientReportingSchema();
  await schema.ensureClientReportingMappingSchema();
  const pool = db.getPool();
  const clientId = (await pool.query('INSERT INTO clients (tenant_id,name,status) VALUES ($1,$2,$3) RETURNING id',
    [actors.owner.tid, 'PR10F7 Client', 'active'])).rows[0].id;
  await pool.query(`INSERT INTO client_reporting_profiles (tenant_id,client_id,report_source,default_format,report_title,branding_mode,branding_overrides)
    VALUES ($1,$2,'search-intel','pdf','Scheduled report','workspace','{}'::jsonb)`, [actors.owner.tid, clientId]);
  await pool.query('INSERT INTO client_reporting_recipients (tenant_id,client_id,email,enabled) VALUES ($1,$2,$3,true)',
    [actors.owner.tid, clientId, 'schedule@example.com']);
  await pool.query(`INSERT INTO client_reporting_delivery_history
    (tenant_id, client_id, window_key, status, recipient_email, profile_version, format, error_code)
    VALUES ($1, $2, 'weekly:2026-W10', 'failed', 'schedule@example.com', 1, 'pdf', 'mail_unconfigured')`,
  [actors.owner.tid, clientId]);
  browser = await require('puppeteer').launch({ headless: true, pipe: true,
    args: ['--disable-dev-shm-usage', '--disable-background-networking', '--lang=en-US'] });
  const context = await browser.createBrowserContext(), page = await context.newPage();
  page.setDefaultTimeout(45_000); page.setDefaultNavigationTimeout(90_000);
  await page.setViewport({ width: 1440, height: 1050 });
  await page.setBypassServiceWorker(true); await page.setCacheEnabled(false);
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!['data:', 'blob:'].includes(url.protocol) && url.origin !== baseUrl) {
      void request.abort('blockedbyclient'); return;
    }
    void request.continue();
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith(API) && response.status() >= 400) errors.push(`${response.request().method()} ${path} ${response.status()}`);
  });
  page.on('requestfailed', (request) => {
    if (!closing && new URL(request.url()).pathname.startsWith(API)) errors.push(`Reporting request failed: ${request.url()}`);
  });
  await page.goto(`${baseUrl}/login?next=${encodeURIComponent(ROUTE)}`, { waitUntil: 'networkidle2' });
  await button(page, 'Log In', 'body');
  await page.locator('#email').fill(actors.owner.email);
  await page.locator('#pass').fill(actors.owner.password);
  const [login, navigation] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/auth/login'),
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    button(page, 'Log In →', 'form'),
  ]);
  assert.equal(login.status(), 200);
  assert.equal(navigation?.status(), 200);
  assert.equal(new URL(page.url()).pathname, ROUTE);
  await page.waitForSelector(`${PANEL} h1`, { visible: true });
  await selectClient(page, clientId);
  await page.waitForSelector(`${SECTION} [aria-label="Delivery history"]`, { visible: true });
  await page.waitForFunction((selector) => {
    const section = document.querySelector(selector);
    return section?.innerText.includes('mail_unconfigured') && section?.innerText.includes('schedule@example.com');
  }, {}, SECTION);
  await page.locator(`${SECTION} input[name="opt_in"]`).click();
  await page.locator(`${SECTION} input[name="send_time"]`).fill('10:00');
  await responseFor(page, 'PUT', `${API}/clients/${clientId}/schedule`, () =>
    page.locator(`${SECTION} ::-p-aria([name="Enable schedule"][role="button"])`).click());
  await page.waitForFunction((selector) => document.querySelector(selector)?.innerText.includes('Scheduled delivery enabled'), {}, SECTION);
  await responseFor(page, 'POST', `${API}/clients/${clientId}/schedule/pause`, () =>
    page.locator(`${SECTION} ::-p-aria([name="Pause schedule"][role="button"])`).click());
  await page.waitForFunction((selector) => document.querySelector(selector)?.innerText.includes('paused'), {}, SECTION);
  const schedule = await page.evaluate(async (url) => {
    const response = await fetch(url);
    return response.json();
  }, `${baseUrl}${API}/clients/${clientId}/schedule`);
  assert.equal(schedule.schedule.paused, true);
});
