'use strict';

// PR10F.9: end-to-end browser acceptance — profile → mappings → preview/download →
// recipient/delivery → schedule/history → portal invite/redeem/read-only report/history.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const dedicatedUrl = process.env.PR10E9_TEST_DATABASE_URL;
const required = process.env.PR10F9_REQUIRE_BROWSER === '1';
const PANEL = '#ig-react-panel', ROUTE = '/manage/client-reporting', API = '/api/client-reporting';
const FORM = `${PANEL} form[aria-label="Reporting profile"]`;
const MAPPINGS = `${PANEL} [aria-label="Client reporting data mappings"]`;
const REPORT = `${PANEL} [aria-label="Client report preview"]`;
const RECIPIENT = `${PANEL} [aria-label="Client report delivery recipient"]`;
const SCHEDULE = `${PANEL} [aria-label="Client report schedule"]`;
const PORTAL = `${PANEL} [aria-label="Client reporting portal access"]`;
const profilePath = (id) => `${API}/clients/${id}/profile`;
const mappingPath = (client, kind, id) => `${API}/clients/${client}/mappings/${kind}/${id}`;
const row = (id) => `${MAPPINGS} [data-record-id="${id}"]`;

async function button(page, name, scope = PANEL) {
  await page.locator(`${scope} ::-p-aria([name="${name}"][role="button"])`).click();
}
async function text(page, wanted, scope = PANEL) {
  await page.waitForFunction((selector, value) => document.querySelector(selector)?.innerText.includes(value), {}, scope, wanted);
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
async function call(page, path, method = 'GET', body) {
  return page.evaluate(async (url, verb, data) => {
    const response = await fetch(url, { method: verb, ...(data === undefined ? {} : {
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }) });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, path, method, body);
}
async function selectClient(page, id) {
  await page.waitForSelector(`${PANEL} select[name="client_id"]:enabled`, { visible: true });
  await responseFor(page, 'GET', profilePath(id), () => page.select(`${PANEL} select[name="client_id"]`, String(id)));
  await page.waitForSelector(`${FORM} [name="report_title"]:enabled`, { visible: true });
}
async function fillProfile(page, values) {
  for (const [name, value] of Object.entries(values)) {
    const selector = `${FORM} [name="${name}"]`;
    await page.waitForSelector(`${selector}:enabled`, { visible: true });
    if (await page.$eval(selector, (el) => el.tagName === 'SELECT')) await page.select(selector, value);
    else await page.locator(selector).fill(value);
  }
}

test('PR10F.9 client reporting end-to-end acceptance (real PostgreSQL/TLS)', {
  skip: !dedicatedUrl && !required ? 'optional local run: no PR10E9_TEST_DATABASE_URL' : false,
  timeout: 600_000,
}, async (t) => {
  assert.ok(dedicatedUrl, 'PR10E9_TEST_DATABASE_URL required; ambient DATABASE_URL is never used');
  const mail = require('../helpers/mail').installMailCapture();
  t.after(() => mail.restore());
  const errors = [], requests = new WeakMap(), expected = new WeakMap();
  let browser, pool, closing = false, clientId, foreignId, queryId, inviteUrl, rawToken;
  let owner, baseUrl, apiBase, actors, db;

  t.after(async () => {
    closing = true;
    if (browser) await browser.close();
    assert.deepEqual(errors, [], 'no browser errors or unexpected reporting failures');
    assert.equal(mail.messages.length, 0, 'zero outbound Resend sends during acceptance');
  });

  const { startAgencyBrowser } = require('../helpers/agency-browser');
  ({ baseUrl, apiBase, db, actors } = await startAgencyBrowser(t));
  await require('../../services/search_intel/schema').ensureSearchIntelSchema();
  await require('../../services/optimizer/schema').ensureOptimizerSchema();
  const schema = require('../../services/client_reporting/schema');
  await schema.ensureClientReportingSchema();
  await schema.ensureClientReportingMappingSchema();
  pool = db.getPool();
  const clients = (await pool.query(`INSERT INTO clients (tenant_id, name, status) VALUES
    ($1, 'PR10F9 E2E Client', 'active'), ($2, 'PR10F9 Foreign', 'active') RETURNING id`,
  [actors.owner.tid, actors.other.tid])).rows;
  clientId = clients[0].id;
  foreignId = clients[1].id;
  queryId = (await pool.query('INSERT INTO search_intel_queries (tenant_id,query,brand) VALUES ($1,$2,$3) RETURNING id',
    [actors.owner.tid, 'PR10F9-E2E', 'Brand'])).rows[0].id;
  await pool.query(`INSERT INTO client_reporting_delivery_history
    (tenant_id, client_id, window_key, status, recipient_email, profile_version, format, error_code)
    VALUES ($1, $2, 'e2e-seed', 'failed', 'e2e@example.com', 1, 'pdf', 'mail_unconfigured')`,
  [actors.owner.tid, clientId]);

  browser = await require('puppeteer').launch({ headless: true, pipe: true,
    args: ['--disable-dev-shm-usage', '--disable-background-networking', '--lang=en-US'] });

  async function session(actor) {
    const context = await browser.createBrowserContext(), page = await context.newPage();
    page.setDefaultTimeout(45_000); page.setDefaultNavigationTimeout(90_000);
    await page.setViewport({ width: 1440, height: 1050 });
    await page.setBypassServiceWorker(true); await page.setCacheEnabled(false);
    await page.setRequestInterception(true);
    requests.set(page, []);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (!['data:', 'blob:'].includes(url.protocol) && url.origin !== baseUrl) {
        void request.abort('blockedbyclient'); return;
      }
      if (url.pathname.startsWith(API)) requests.get(page).push({ method: request.method(), path: url.pathname });
      void request.continue();
    });
    page.on('response', (response) => {
      const path = new URL(response.url()).pathname, failure = expected.get(page);
      if (!path.startsWith(API) || response.status() < 400) return;
      if (failure?.path === path && failure.method === response.request().method() && failure.status === response.status()) return;
      errors.push(`${response.request().method()} ${path} ${response.status()}`);
    });
    page.on('requestfailed', (request) => {
      if (!closing && new URL(request.url()).pathname.startsWith(API)) errors.push(`Reporting request failed: ${request.url()}`);
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${baseUrl}/login?next=${encodeURIComponent(ROUTE)}`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => [...document.querySelectorAll('strong')].some((el) => el.textContent === 'Preview login'));
    await button(page, 'Log In', 'body');
    await page.locator('#email').fill(actor.email);
    await page.locator('#pass').fill(actor.password);
    const [login, navigation] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/auth/login'),
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      button(page, 'Log In →', 'form'),
    ]);
    assert.equal(login.status(), 200);
    assert.equal(navigation?.status(), 200);
    assert.equal(new URL(page.url()).pathname, ROUTE);
    return { page, context };
  }

  await t.test('profile → mappings → preview → recipient → delivery attempt (zero external sends)', async () => {
    owner = (await session(actors.owner)).page;
    await selectClient(owner, clientId);
    await fillProfile(owner, {
      report_source: 'search-intel', default_format: 'pdf', report_title: 'E2E acceptance report',
      branding_mode: 'custom',
    });
    await owner.waitForSelector(`${FORM} [name="agencyName"]:enabled`, { visible: true });
    await fillProfile(owner, {
      agencyName: 'E2E Agency', footerText: 'E2E footer',
      primaryColor: '#112233', accentColor: '#445566', textColor: '#0F172A',
    });
    await responseFor(owner, 'PUT', profilePath(clientId), () => button(owner, 'Save profile'));
    await text(owner, 'Profile saved.');

    await owner.select(`${MAPPINGS} select[name="mapping_source"]`, 'search-intel');
    await owner.waitForSelector(row(queryId), { visible: true });
    await responseFor(owner, 'POST', mappingPath(clientId, 'search-intel', queryId),
      () => button(owner, 'Assign to client', row(queryId)), 201);
    await text(owner, 'Assigned to this client', row(queryId));

    await responseFor(owner, 'GET', `${API}/clients/${clientId}/report-preview`,
      () => button(owner, 'Preview report', REPORT));
    await owner.waitForSelector(`${REPORT} article`, { visible: true });
    await text(owner, 'E2E acceptance report', REPORT);

    await owner.locator(`${RECIPIENT} input[name="recipient_email"]`).fill('e2e-client@example.com');
    await responseFor(owner, 'PUT', `${API}/clients/${clientId}/recipient`,
      () => button(owner, 'Add recipient', RECIPIENT));
    await text(owner, 'Delivery recipient saved.', RECIPIENT);

    await button(owner, 'Email report', REPORT);
    await owner.waitForSelector(`${REPORT} [aria-label="Confirm email delivery"]`, { visible: true });
    const emailPath = `${API}/clients/${clientId}/report-email`;
    expected.set(owner, { path: emailPath, method: 'POST', status: 503 });
    try {
      await responseFor(owner, 'POST', emailPath, () => button(owner, 'Confirm email', REPORT), 503);
    } finally { expected.delete(owner); }
    await text(owner, 'mail_unconfigured', REPORT);
    assert.equal(mail.messages.length, 0, 'delivery attempt must not reach Resend');
  });

  await t.test('schedule opt-in surfaces delivery history metadata', async () => {
    await owner.locator(`${SCHEDULE} input[name="opt_in"]`).click();
    await owner.locator(`${SCHEDULE} input[name="send_time"]`).fill('09:30');
    await responseFor(owner, 'PUT', `${API}/clients/${clientId}/schedule`,
      () => button(owner, 'Enable schedule', SCHEDULE));
    await text(owner, 'Scheduled delivery enabled.', SCHEDULE);
    const history = await owner.evaluate(async (id) => {
      const response = await fetch(`/api/client-reporting/clients/${id}/delivery-history?limit=10`);
      return response.json();
    }, clientId);
    assert.equal(history.ok, true);
    assert.equal(history.client.id, clientId);
    assert.ok(history.deliveries.length >= 1, 'delivery history metadata is readable');
    assert.equal(history.deliveries[0].error_code, 'mail_unconfigured');
    await owner.waitForSelector(`${SCHEDULE} [aria-label="Delivery history"]`, { visible: true });
    await text(owner, 'mail_unconfigured', SCHEDULE);
    await text(owner, 'e2e@example.com', SCHEDULE);
    await responseFor(owner, 'POST', `${API}/clients/${clientId}/schedule/pause`,
      () => button(owner, 'Pause schedule', SCHEDULE));
    await text(owner, 'paused', SCHEDULE);
  });

  await t.test('portal invite, redeem, read-only report and delivery history', async () => {
    await responseFor(owner, 'POST', `${API}/clients/${clientId}/portal/invitations`,
      () => button(owner, 'Create invitation link', PORTAL), 201);
    await text(owner, 'Single-use invitation created', PORTAL);
    inviteUrl = await owner.$eval(`${PORTAL} input[aria-label="Portal invitation link"]`, (el) => el.value);
    assert.match(inviteUrl, /^https?:\/\/.+\/client-report\/invite\/[a-f0-9]{64}$/);
    rawToken = inviteUrl.split('/').pop();

    const portalContext = await browser.createBrowserContext();
    const portal = await portalContext.newPage();
    portal.setDefaultTimeout(45_000);
    portal.setDefaultNavigationTimeout(90_000);
    await portal.goto(inviteUrl, { waitUntil: 'networkidle2' });
    await portal.waitForFunction(() => location.pathname === '/client-report/view');
    await portal.waitForSelector('article h2', { visible: true });
    await text(portal, 'E2E acceptance report', 'main');
    await portal.waitForSelector('section[aria-label="Delivery history"]', { visible: true });
    await text(portal, 'failed', 'main');
    await text(portal, 'e2e@example.com', 'main');

    const readOnly = await portal.evaluate(async (adminPath) => {
      const attempts = await Promise.all([
        fetch(adminPath, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
        fetch(adminPath.replace('/profile', '/portal/invitations'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
        fetch(adminPath.replace('/profile', '/report-email'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true, expected_version: 1 }) }),
      ]);
      return attempts.map((r) => r.status);
    }, `${baseUrl}${profilePath(clientId)}`);
    assert.deepEqual(readOnly, [401, 401, 401], 'portal session cannot mutate admin reporting routes');

    const replay = await portal.evaluate(async (token) => {
      const response = await fetch(`/api/client-reporting/portal/redeem/${token}`, { method: 'POST' });
      return { status: response.status, body: await response.json() };
    }, rawToken);
    assert.equal(replay.status, 403);
    assert.equal(replay.body.error, 'invitation_redeemed');
  });

  await t.test('tenant isolation, membership, permissions and CSRF on writes', async () => {
    expected.set(owner, { path: profilePath(foreignId), method: 'GET', status: 404 });
    try {
      const foreign = await call(owner, profilePath(foreignId));
      assert.equal(foreign.status, 404);
      assert.equal(foreign.body.error, 'client_not_found');
    } finally { expected.delete(owner); }

    const sid = (await owner.cookies()).find((cookie) => cookie.name === 'infogenie.sid');
    assert.ok(sid?.value);
    const csrf = await new Promise((resolve, reject) => {
      const http = require('node:http');
      const target = new URL(`${apiBase}${API}/clients/${clientId}/portal/invitations`);
      const req = http.request({
        hostname: target.hostname, port: target.port, path: target.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `infogenie.sid=${sid.value}` },
      }, (res) => {
        let text = '';
        res.on('data', (chunk) => { text += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
      });
      req.on('error', reject);
      req.end('{}');
    });
    assert.equal(csrf.status, 403);
    assert.equal(csrf.body.error, 'csrf_rejected');

    const viewer = (await session(actors.viewer)).page;
    await text(viewer, 'Access denied.', PANEL);
    assert.equal(await viewer.$(FORM), null);
    assert.deepEqual(requests.get(viewer), [], 'denied role never loads reporting APIs');

    const identity = await owner.evaluate(async () => {
      const active = await (await fetch('/api/tenants/active')).json();
      return active.permissions.includes('tenant.settings.manage');
    });
    assert.equal(identity, true, 'owner membership includes tenant.settings.manage');
  });

  await t.test('invitation expiry and revocation invalidate portal access', async () => {
    const invite2 = await call(owner, `${baseUrl}${API}/clients/${clientId}/portal/invitations`, 'POST', {});
    assert.equal(invite2.status, 201);
    const expiredToken = invite2.body.invite_path.split('/').pop();
    const { hashToken } = require('../../services/client_reporting/portal');
    await pool.query(`UPDATE client_reporting_portal_invitations SET expires_at=now() - interval '1 minute'
      WHERE token_hash=$1`, [hashToken(expiredToken)]);
    const expiredPage = await browser.createBrowserContext().then((ctx) => ctx.newPage());
    await expiredPage.goto(`${baseUrl}/client-report/invite/${expiredToken}`, { waitUntil: 'networkidle2' });
    await text(expiredPage, 'expired', 'main');

    const invite3 = await call(owner, `${baseUrl}${API}/clients/${clientId}/portal/invitations`, 'POST', {});
    assert.equal(invite3.status, 201);
    const freshToken = invite3.body.invite_path.split('/').pop();
    const freshCtx = await browser.createBrowserContext();
    const freshPage = await freshCtx.newPage();
    await freshPage.goto(`${baseUrl}/client-report/invite/${freshToken}`, { waitUntil: 'networkidle2' });
    await freshPage.waitForFunction(() => location.pathname === '/client-report/view');

    await responseFor(owner, 'POST', `${API}/clients/${clientId}/portal/revoke`,
      () => button(owner, 'Revoke portal access', PORTAL));
    await text(owner, 'Portal access revoked', PORTAL);

    const revoked = await freshPage.evaluate(async () => {
      const response = await fetch('/api/client-reporting/portal/report');
      return { status: response.status, body: await response.json() };
    });
    assert.equal(revoked.status, 403);
    assert.equal(revoked.body.error, 'portal_revoked');

    await fs.mkdir('/tmp/client-reporting-artifacts', { recursive: true });
    await owner.screenshot({ path: '/tmp/client-reporting-artifacts/e2e-desktop.png', fullPage: true });
  });
});
