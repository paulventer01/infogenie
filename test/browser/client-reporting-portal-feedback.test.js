'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const dedicatedUrl = process.env.PR10E9_TEST_DATABASE_URL;
const required = process.env.PR10H2_REQUIRE_BROWSER === '1';
const ROUTE = '/manage/client-reporting';
const API = '/api/client-reporting';
const PANEL = '#ig-react-panel';
const FORM = `${PANEL} form[aria-label="Reporting profile"]`;
const PORTAL = `${PANEL} [aria-label="Client reporting portal access"]`;
const FEEDBACK = `${PANEL} [aria-label="Client portal feedback"]`;
const profilePath = (id) => `${API}/clients/${id}/profile`;

async function button(page, name, scope = PANEL) {
  await page.locator(`${scope} ::-p-aria([name="${name}"][role="button"])`).click();
}
async function text(page, wanted, scope = PANEL, timeout = 120_000) {
  await page.waitForFunction(
    (selector, value) => document.querySelector(selector)?.innerText.includes(value),
    { timeout },
    scope,
    wanted,
  );
}
async function responseFor(page, method, path, action, status = 200) {
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === method && new URL(r.url()).pathname === path),
    action(),
  ]);
  assert.equal(response.status(), status, `${method} ${path}`);
  const body = status === 204 ? null : await response.json().catch(() => null);
  if (body && typeof body.ok === 'boolean' && status < 400) assert.equal(body.ok, true);
  return body;
}
async function activate(page) {
  await page.bringToFront();
  await page.waitForFunction(() => document.visibilityState === 'visible');
}
async function selectClient(page, id) {
  await page.waitForSelector(`${PANEL} select[name="client_id"]:enabled`, { visible: true });
  await responseFor(page, 'GET', profilePath(id), () => page.select(`${PANEL} select[name="client_id"]`, String(id)));
  await page.waitForSelector(`${FORM} [name="report_title"]:enabled`, { visible: true });
}

test('PR10H.2 portal feedback browser journey', {
  skip: !dedicatedUrl && !required ? 'optional local run: no PR10E9_TEST_DATABASE_URL' : false,
  timeout: 300_000,
}, async (t) => {
  assert.ok(dedicatedUrl);
  const { startAgencyBrowser } = require('../helpers/agency-browser');
  const { baseUrl, db, actors } = await startAgencyBrowser(t);
  await require('../../services/search_intel/schema').ensureSearchIntelSchema();
  await require('../../services/optimizer/schema').ensureOptimizerSchema();
  const schema = require('../../services/client_reporting/schema');
  await schema.ensureClientReportingSchema();
  await schema.ensureClientReportingMappingSchema();
  const pool = db.getPool();
  const clientId = (await pool.query('INSERT INTO clients (tenant_id,name,status) VALUES ($1,$2,$3) RETURNING id',
    [actors.owner.tid, 'PR10H2 Feedback', 'active'])).rows[0].id;
  const browser = await require('puppeteer').launch({ headless: true, pipe: true,
    args: ['--disable-dev-shm-usage', '--disable-background-networking', '--lang=en-US'] });
  t.after(async () => { await browser.close(); });

  const owner = await browser.newPage();
  let stage = 'owner login';
  // Keep diagnostics to stage names: portal URLs contain invitation tokens.
  const step = (name) => { stage = name; t.diagnostic(`Portal feedback stage: ${stage}`); };
  owner.setDefaultTimeout(120_000);
  owner.setDefaultNavigationTimeout(120_000);
  await owner.goto(`${baseUrl}/login?next=${encodeURIComponent(ROUTE)}`, { waitUntil: 'networkidle2' });
  await owner.waitForFunction(() => [...document.querySelectorAll('strong')].some((el) => el.textContent === 'Preview login'));
  await button(owner, 'Log In', 'body');
  await owner.locator('#email').fill(actors.owner.email);
  await owner.locator('#pass').fill(actors.owner.password);
  await Promise.all([
    owner.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/auth/login'),
    owner.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    button(owner, 'Log In →', 'form'),
  ]);
  await owner.evaluate(async (path) => {
    const response = await fetch(path, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        report_source: 'search-intel', default_format: 'pdf', report_title: 'Feedback Report',
        branding_mode: 'workspace', branding_overrides: {},
        selected_metrics: ['runs', 'successful_runs', 'brand_mentions', 'mapped_queries', 'recent_search_runs'],
        reporting_period: 'last_30_days', reporting_timezone: 'UTC', expected_version: 0,
      }),
    });
    if (!response.ok) throw new Error(await response.text());
  }, `${baseUrl}${profilePath(clientId)}`);
  await owner.goto(`${baseUrl}${ROUTE}`, { waitUntil: 'networkidle2' });
  step('select client and create invitation');
  await selectClient(owner, clientId);
  await owner.waitForSelector(PORTAL, { visible: true });
  const invite = await responseFor(owner, 'POST', `${API}/clients/${clientId}/portal/invitations`,
    () => button(owner, 'Create invitation link', PORTAL), 201);
  const inviteUrl = `${baseUrl}${invite.invite_path}`;

  const portalContext = await browser.createBrowserContext();
  const portal = await portalContext.newPage();
  step('client opens invitation and submits feedback');
  portal.setDefaultTimeout(120_000);
  portal.setDefaultNavigationTimeout(120_000);
  await portal.goto(inviteUrl, { waitUntil: 'networkidle2' });
  await portal.waitForFunction(() => location.pathname === '/client-report/view');
  await portal.waitForSelector('[aria-label="Report feedback"]');
  await portal.click('[aria-label="Report feedback"] input[value="change_request"]');
  const portalMessage = '[aria-label="Report feedback"] textarea';
  await portal.waitForSelector(portalMessage, { visible: true });
  await portal.locator(portalMessage).fill('Please adjust the executive summary.');
  await Promise.all([
    portal.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/client-reporting/portal/feedback/threads'),
    button(portal, 'Submit', '[aria-label="Report feedback"]'),
  ]);
  await text(portal, 'Please adjust the executive summary.', 'main');

  step('return to agency and load feedback');
  await activate(owner);
  await owner.reload({ waitUntil: 'networkidle2' });
  await selectClient(owner, clientId);
  await owner.waitForSelector(FEEDBACK, { visible: true });
  await text(owner, 'Please adjust the executive summary.', FEEDBACK);
  const agencyReply = `${FEEDBACK} textarea`;
  await owner.waitForSelector(agencyReply, { visible: true });
  await owner.evaluate((selector) => {
    document.querySelector(selector)?.scrollIntoView({ block: 'center', inline: 'nearest' });
  }, agencyReply);
  step('agency replies');
  await owner.locator(agencyReply).fill('Thanks — we will revise the summary.');
  await owner.waitForFunction((scope) => {
    const submit = document.querySelector(`${scope} button[type="submit"]`);
    return submit instanceof HTMLButtonElement && !submit.disabled;
  }, {}, FEEDBACK);
  await Promise.all([
    owner.waitForResponse((r) => r.request().method() === 'POST'
      && /\/portal\/feedback\/threads\/\d+\/replies$/.test(new URL(r.url()).pathname)),
    owner.click(`${FEEDBACK} button[type="submit"]`),
  ]);
  await text(owner, 'Thanks — we will revise the summary.', FEEDBACK);
  step('agency resolves feedback');
  await button(owner, 'Mark resolved', FEEDBACK);
  await text(owner, 'resolved', FEEDBACK);

  step('client verifies persisted reply and resolution');
  await activate(portal);
  await portal.reload({ waitUntil: 'networkidle2' });
  await text(portal, 'Thanks — we will revise the summary.', 'main');
  await text(portal, 'resolved', 'main');
  const fs = require('node:fs/promises');
  await fs.mkdir('/opt/cursor/artifacts/screenshots', { recursive: true });
  await portal.screenshot({ path: '/opt/cursor/artifacts/screenshots/portal-feedback-resolved.png', fullPage: true });
  await owner.screenshot({ path: '/opt/cursor/artifacts/screenshots/agency-feedback-resolved.png', fullPage: true });
});
