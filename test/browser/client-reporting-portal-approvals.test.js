'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const dedicatedUrl = process.env.PR10E9_TEST_DATABASE_URL;
const required = process.env.PR10H3_REQUIRE_BROWSER === '1';
const ROUTE = '/manage/client-reporting';
const API = '/api/client-reporting';
const PANEL = '#ig-react-panel';
const FORM = `${PANEL} form[aria-label="Reporting profile"]`;
const PORTAL = `${PANEL} [aria-label="Client reporting portal access"]`;
const APPROVALS = `${PANEL} [aria-label="Client report approvals"]`;
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
async function selectClient(page, id) {
  await page.waitForSelector(`${PANEL} select[name="client_id"]:enabled`, { visible: true });
  await responseFor(page, 'GET', profilePath(id), () => page.select(`${PANEL} select[name="client_id"]`, String(id)));
  await page.waitForSelector(`${FORM} [name="report_title"]:enabled`, { visible: true });
}
async function submitApproval(page, clientId) {
  const result = await page.evaluate(async ({ api, id }) => {
    const profile = await fetch(`${api}/clients/${id}/profile`).then((r) => r.json());
    if (!profile.ok || !profile.profile?.version) throw new Error('profile unavailable');
    const response = await fetch(`${api}/clients/${id}/approval-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected_version: profile.profile.version }),
    });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body.error || 'submit failed');
    return body;
  }, { api: API, id: clientId });
  assert.equal(result.request.status, 'pending');
}

test('PR10H.3 portal approval browser journey', {
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
    [actors.owner.tid, 'PR10H3 Approval', 'active'])).rows[0].id;
  const queryId = (await pool.query('INSERT INTO search_intel_queries (tenant_id,query,brand) VALUES ($1,$2,$3) RETURNING id',
    [actors.owner.tid, 'approval-browser', 'Brand'])).rows[0].id;
  const { randomUUID } = require('node:crypto');
  await pool.query(`INSERT INTO client_reporting_query_mappings (tenant_id,query_id,client_id,mapping_id,created_by_user_id)
    VALUES ($1,$2,$3,$4,$5)`, [actors.owner.tid, queryId, clientId, randomUUID(), actors.owner.uid]);
  const browser = await require('puppeteer').launch({ headless: true, pipe: true,
    args: ['--disable-dev-shm-usage', '--disable-background-networking', '--lang=en-US'] });
  t.after(async () => { await browser.close(); });

  const owner = await browser.newPage();
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
        report_source: 'search-intel', default_format: 'pdf', report_title: 'Approval Report',
        branding_mode: 'workspace', branding_overrides: {},
        selected_metrics: ['runs', 'successful_runs', 'brand_mentions', 'mapped_queries', 'recent_search_runs'],
        reporting_period: 'last_30_days', reporting_timezone: 'UTC', expected_version: 0,
      }),
    });
    if (!response.ok) throw new Error(await response.text());
  }, `${baseUrl}${profilePath(clientId)}`);
  await owner.goto(`${baseUrl}${ROUTE}`, { waitUntil: 'networkidle2' });
  await selectClient(owner, clientId);
  await button(owner, 'Preview report');
  await owner.waitForSelector('[aria-label="Client report preview"] article', { visible: true });
  await owner.waitForSelector(APPROVALS, { visible: true });
  await waitSubmitReady(owner);
  const invite = await responseFor(owner, 'POST', `${API}/clients/${clientId}/portal/invitations`,
    () => button(owner, 'Create invitation link', PORTAL), 201);
  const inviteUrl = `${baseUrl}${invite.invite_path}`;

  const portalContext = await browser.createBrowserContext();
  const portal = await portalContext.newPage();
  portal.setDefaultTimeout(120_000);
  portal.setDefaultNavigationTimeout(120_000);
  await portal.goto(inviteUrl, { waitUntil: 'networkidle2' });
  await portal.waitForFunction(() => location.pathname === '/client-report/view');
  await portal.waitForSelector('[aria-label="Report approval"]', { visible: true, timeout: 5000 }).catch(() => null);

  await responseFor(owner, 'POST', `${API}/clients/${clientId}/approval-requests`,
    () => button(owner, 'Submit displayed report for approval', APPROVALS), 201);
  await text(owner, 'Pending client approval', APPROVALS);

  await portal.reload({ waitUntil: 'networkidle2' });
  await portal.waitForSelector('[aria-label="Report approval"]', { visible: true });
  await text(portal, 'Pending client approval', '[aria-label="Report approval"]');
  const changeComment = '[aria-label="Report approval"] textarea';
  await portal.waitForSelector(changeComment, { visible: true });
  await portal.locator(changeComment).fill('Please update the totals section.');
  await Promise.all([
    portal.waitForResponse((r) => r.request().method() === 'POST'
      && /\/approval-requests\/\d+\/request-changes$/.test(new URL(r.url()).pathname)),
    button(portal, 'Submit change request', '[aria-label="Report approval"]'),
  ]);
  await text(portal, 'Change request submitted', 'main');

  await owner.reload({ waitUntil: 'networkidle2' });
  await selectClient(owner, clientId);
  await owner.waitForSelector(APPROVALS, { visible: true });
  await text(owner, 'Changes requested', APPROVALS);
  await text(owner, 'Please update the totals section.', APPROVALS);

  await button(owner, 'Preview report');
  await owner.waitForSelector('[aria-label="Client report preview"] article', { visible: true });
  await waitSubmitReady(owner);
  await responseFor(owner, 'POST', `${API}/clients/${clientId}/approval-requests`,
    () => button(owner, 'Submit displayed report for approval', APPROVALS), 201);
  await text(owner, 'Pending client approval', APPROVALS);

  await portal.reload({ waitUntil: 'networkidle2' });
  await portal.waitForSelector('[aria-label="Report approval"]', { visible: true });
  await button(portal, 'Approve report', '[aria-label="Report approval"]');
  await button(portal, 'Confirm approval', '[aria-label="Report approval"]');
  await text(portal, 'Report approved', 'main');

  await owner.reload({ waitUntil: 'networkidle2' });
  await selectClient(owner, clientId);
  await text(owner, 'Approved', APPROVALS);

  const fs = require('node:fs/promises');
  await fs.mkdir('/opt/cursor/artifacts/screenshots', { recursive: true });
  await portal.screenshot({ path: '/opt/cursor/artifacts/screenshots/portal-approval-approved.png', fullPage: true });
  await owner.screenshot({ path: '/opt/cursor/artifacts/screenshots/agency-approval-approved.png', fullPage: true });
});
