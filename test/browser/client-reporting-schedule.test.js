'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const dedicatedUrl = process.env.PR10E9_TEST_DATABASE_URL;
const required = process.env.PR10F7_REQUIRE_BROWSER === '1';
const PANEL = '#ig-react-panel', ROUTE = '/manage/client-reporting';
const SECTION = `${PANEL} [aria-label="Client report schedule"]`, API = '/api/client-reporting';

test('PR10F.7 schedule opt-in, pause and history browser acceptance', {
  skip: !dedicatedUrl && !required ? 'optional local run: no PR10E9_TEST_DATABASE_URL' : false,
  timeout: 600_000,
}, async (t) => {
  assert.ok(dedicatedUrl, 'PR10E9_TEST_DATABASE_URL required');
  const errors = [];
  let browser;
  t.after(async () => {
    if (browser) await browser.close();
    assert.deepEqual(errors, [], 'no browser errors');
  });
  const { startAgencyBrowser } = require('../helpers/agency-browser');
  const { baseUrl, db, actors } = await startAgencyBrowser(t);
  await require('../../services/client_reporting/schema').ensureClientReportingSchema();
  const pool = db.getPool();
  const clientId = (await pool.query('INSERT INTO clients (tenant_id,name) VALUES ($1,$2) RETURNING id', [actors.owner.tid, 'PR10F7 Client'])).rows[0].id;
  await pool.query(`INSERT INTO client_reporting_profiles (tenant_id,client_id,report_source,default_format,report_title,branding_mode,branding_overrides)
    VALUES ($1,$2,'search-intel','pdf','Scheduled report','workspace','{}'::jsonb)`, [actors.owner.tid, clientId]);
  await pool.query('INSERT INTO client_reporting_recipients (tenant_id,client_id,email,enabled) VALUES ($1,$2,$3,true)',
    [actors.owner.tid, clientId, 'schedule@example.com']);
  browser = await require('puppeteer').launch({ headless: true, pipe: true, args: ['--disable-dev-shm-usage', '--lang=en-US'] });
  const page = await browser.newPage();
  page.setDefaultTimeout(45_000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith(API) && response.status() >= 400) errors.push(`${response.request().method()} ${path} ${response.status()}`);
  });
  await page.goto(`${baseUrl}${ROUTE}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector(`${PANEL} select[name="client_id"]:enabled`);
  await page.select(`${PANEL} select[name="client_id"]`, String(clientId));
  await page.waitForSelector(SECTION, { visible: true });
  await page.evaluate(() => {
    const box = document.querySelector('input[name="opt_in"]');
    if (box) { box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await page.locator(`${SECTION} ::-p-aria([name="Enable schedule"][role="button"])`).click();
  await page.waitForFunction((selector) => document.querySelector(selector)?.innerText.includes('Scheduled delivery enabled'), {}, SECTION);
  await page.locator(`${SECTION} ::-p-aria([name="Pause schedule"][role="button"])`).click();
  await page.waitForFunction((selector) => document.querySelector(selector)?.innerText.includes('paused'), {}, SECTION);
  const schedule = await page.evaluate(async (url) => {
    const response = await fetch(url);
    return response.json();
  }, `${baseUrl}${API}/clients/${clientId}/schedule`);
  assert.equal(schedule.schedule.paused, true);
});
