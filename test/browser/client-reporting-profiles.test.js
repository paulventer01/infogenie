'use strict';

// Test implementation, not the independent QA stage. Real browser -> Next -> Express -> PostgreSQL/TLS.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const dedicatedUrl = process.env.PR10E9_TEST_DATABASE_URL;
const required = process.env.PR10F2_REQUIRE_BROWSER === '1';
const PANEL = '#ig-react-panel', ROUTE = '/manage/client-reporting';
const FORM = `${PANEL} form[aria-label="Reporting profile"]`;
const API = '/api/client-reporting/clients';
const profilePath = (id) => `${API}/${id}/profile`;
async function text(page, wanted) {
  await page.waitForFunction((root, value) => document.querySelector(root)?.innerText.includes(value), {}, PANEL, wanted);
}
async function button(page, name, scope = PANEL) {
  await page.locator(`${scope} ::-p-aria([name="${name}"][role="button"])`).click();
}
async function fill(page, values) {
  for (const [name, value] of Object.entries(values)) {
    const selector = `${FORM} [name="${name}"]`;
    await page.waitForSelector(`${selector}:enabled`, { visible: true });
    if (await page.$eval(selector, (el) => el.tagName === 'SELECT')) await page.select(selector, value);
    else await page.locator(selector).fill(value);
  }
}
async function values(page, names) {
  return page.$eval(FORM, (form, fields) => Object.fromEntries(fields.map((name) =>
    [name, form.querySelector(`[name="${name}"]`)?.value])), names);
}
async function responseFor(page, method, path, action, status = 200) {
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === method && new URL(r.url()).pathname === path), action(),
  ]);
  assert.equal(response.status(), status, `${method} ${path}`);
  const body = await response.json();
  assert.equal(body.ok, status < 400);
  return body;
}
async function selectClient(page, id) {
  await page.waitForSelector(`${PANEL} select[name="client_id"]:enabled`, { visible: true });
  await responseFor(page, 'GET', profilePath(id), () => page.select(`${PANEL} select[name="client_id"]`, String(id)));
  await page.waitForSelector(`${FORM} [name="report_title"]:enabled`, { visible: true });
}

test('PR10F.2 client reporting setup browser acceptance (real PostgreSQL/TLS)', {
  skip: !dedicatedUrl && !required ? 'optional local run: no PR10E9_TEST_DATABASE_URL' : false,
  timeout: 600_000,
}, async (t) => {
  assert.ok(dedicatedUrl, 'PR10E9_TEST_DATABASE_URL is required; ambient DATABASE_URL is never used');
  const errors = [], writes = [], requests = new WeakMap(), expected = new WeakMap();
  let browser, closing = false;
  // Register before the shared fixture so Chromium closes before its real servers.
  t.after(async () => {
    closing = true;
    if (browser) await browser.close();
    assert.deepEqual(errors, [], 'browser errors and unexpected reporting API failures');
  });
  const { startAgencyBrowser } = require('../helpers/agency-browser');
  const { baseUrl, db, actors } = await startAgencyBrowser(t);
  await require('../../services/client_reporting/schema').ensureClientReportingSchema();
  const pool = db.getPool();
  const seeded = (await pool.query(`INSERT INTO clients (tenant_id, name, status) VALUES
    ($1, 'PR10F2 Alpine', 'active'), ($1, 'PR10F2 Birch', 'active'),
    ($2, 'PR10F2 Foreign', 'active'), ($1, 'PR10F2 Archived', 'archived') RETURNING id, name`,
  [actors.owner.tid, actors.other.tid])).rows;
  const [first, second] = seeded;
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
      // Block optional analytics/font resources; never replace an application response.
      if (!['data:', 'blob:'].includes(url.protocol) && url.origin !== baseUrl) {
        void request.abort('blockedbyclient'); return;
      }
      if (url.pathname.startsWith(API)) {
        requests.get(page).push({ method: request.method(), path: url.pathname });
        if (request.method() === 'PUT') writes.push(url.pathname);
      }
      if (request.method() === 'POST' && url.pathname === '/api/studio/ai-suggest') {
        errors.push('Unexpected AI generation request from manual profile setup');
      }
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
    await button(page, 'Log In', 'body');
    await page.locator('#email').fill(actor.email); await page.locator('#pass').fill(actor.password);
    const [login, navigation] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/auth/login'),
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }), button(page, 'Log In →', 'form'),
    ]);
    assert.equal(login.status(), 200); assert.equal(navigation?.status(), 200);
    assert.equal(new URL(page.url()).pathname, ROUTE);
    await page.waitForSelector(`${PANEL} h1`, { visible: true });
    const sid = (await context.cookies()).find((cookie) => cookie.name === 'infogenie.sid');
    assert.ok(sid?.httpOnly && decodeURIComponent(sid.value).startsWith('s:'), 'real signed session from login form');
    const identity = await page.evaluate(async () => {
      const [auth, active] = await Promise.all(['/api/auth/me', '/api/tenants/active'].map(async (url) => (await fetch(url)).json()));
      return { auth, active };
    });
    assert.equal(identity.auth.user.id, actor.uid); assert.equal(identity.auth.user.isOwner, false);
    assert.equal(identity.active.tenant.id, actor.tid); assert.equal(identity.active.isPlatformAdmin, false);
    assert.equal(identity.active.permissions.includes('tenant.settings.manage'), actor !== actors.viewer);
    return page;
  }
  const stored = async (id) => (await pool.query(`SELECT client_id, report_source, default_format, report_title,
    branding_mode, branding_overrides, version, updated_by_user_id FROM client_reporting_profiles
    WHERE tenant_id=$1 AND client_id=$2`, [actors.owner.tid, id])).rows[0];
  let owner;
  const custom = { report_source: 'campaigns', default_format: 'pptx', report_title: 'Alpine quarterly review',
    branding_mode: 'custom', agencyName: 'Alpine agency', footerText: 'Prepared for Alpine',
    primaryColor: '#234567', accentColor: '#C86432', textColor: '#123456' };

  await t.test('real client list, unsaved defaults, custom save and document reload persistence', async () => {
    owner = await session(actors.owner);
    await pageClientNames(owner);
    await selectClient(owner, first.id); await text(owner, 'Not configured. These defaults are unsaved.');
    assert.equal(await stored(first.id), undefined, 'reading defaults must not create a profile');
    await fill(owner, custom);
    const saved = await responseFor(owner, 'PUT', profilePath(first.id), () => button(owner, 'Save profile'));
    assert.equal(saved.profile.version, 1); await text(owner, 'Profile saved.');
    assert.deepEqual(await stored(first.id), { client_id: first.id, report_source: custom.report_source,
      default_format: custom.default_format, report_title: custom.report_title, branding_mode: 'custom',
      branding_overrides: { agencyName: custom.agencyName, footerText: custom.footerText,
        primaryColor: custom.primaryColor, accentColor: custom.accentColor, textColor: custom.textColor },
      version: 1, updated_by_user_id: actors.owner.uid });
    assert.equal((await owner.reload({ waitUntil: 'networkidle2' })).status(), 200);
    await selectClient(owner, first.id); await text(owner, 'Saved profile loaded.');
    assert.deepEqual(await values(owner, Object.keys(custom)), custom);
    await fs.mkdir('/tmp/client-reporting-artifacts', { recursive: true });
    await owner.screenshot({ path: '/tmp/client-reporting-artifacts/desktop.png', fullPage: true });
    await owner.setViewport({ width: 390, height: 844 });
    await owner.screenshot({ path: '/tmp/client-reporting-artifacts/mobile.png', fullPage: true });
    assert.ok(await owner.$eval(PANEL, (el) => el.getBoundingClientRect().right <= innerWidth + 1), 'panel fits mobile viewport');
    await owner.setViewport({ width: 1440, height: 1050 });
  });
  async function pageClientNames(page) {
    await page.waitForSelector(`${PANEL} select[name="client_id"]:enabled`, { visible: true });
    const names = await page.$$eval(`${PANEL} select[name="client_id"] option`, (options) => options.map((option) => option.textContent));
    assert.deepEqual(names.slice(1), [`${first.name} (#${first.id})`, `${second.name} (#${second.id})`], 'only active clients in the current tenant');
  }
  await t.test('two real editors produce a conflict, retain the draft and require explicit reload', async () => {
    await fill(owner, { report_title: 'Unsaved local draft' });
    const editor = await session(actors.owner);
    await selectClient(editor, first.id); await fill(editor, { report_title: 'Saved by second editor' });
    const winner = await responseFor(editor, 'PUT', profilePath(first.id), () => button(editor, 'Save profile'));
    assert.equal(winner.profile.version, 2); await text(editor, 'Profile saved.');
    expected.set(owner, { path: profilePath(first.id), method: 'PUT', status: 409 });
    try {
      const stale = await responseFor(owner, 'PUT', profilePath(first.id), () => button(owner, 'Save profile'), 409);
      assert.equal(stale.error, 'version_conflict');
      await text(owner, 'Someone else saved this profile. Your changes are retained.');
    } finally { expected.delete(owner); }
    assert.deepEqual(await values(owner, ['report_title']), { report_title: 'Unsaved local draft' });
    assert.equal(await owner.$eval(`${FORM} button[type="submit"]`, (el) => el.disabled), true);
    assert.equal((await stored(first.id)).report_title, 'Saved by second editor');
    await responseFor(owner, 'GET', profilePath(first.id), () => button(owner, 'Discard changes and reload'));
    await text(owner, 'Saved profile loaded.');
    assert.deepEqual(await values(owner, ['report_title']), { report_title: 'Saved by second editor' });
    assert.equal((await stored(first.id)).version, 2);
  });
  await t.test('switching clients confirms draft discard without saving to either client', async () => {
    const before = writes.length;
    await fill(owner, { report_title: 'Must not follow the client switch' });
    await owner.select(`${PANEL} select[name="client_id"]`, String(second.id));
    await text(owner, 'Switching clients discards your unsaved changes.');
    await responseFor(owner, 'GET', profilePath(second.id), () => button(owner, 'Discard changes and switch'));
    await text(owner, 'Not configured. These defaults are unsaved.');
    assert.notEqual((await values(owner, ['report_title'])).report_title, 'Must not follow the client switch');
    assert.equal(await stored(second.id), undefined);
    assert.equal((await stored(first.id)).version, 2); assert.equal(writes.length, before);
  });
  await t.test('analyst direct navigation shows access denied and no client reporting data', async () => {
    const viewer = await session(actors.viewer);
    await text(viewer, 'Access denied. Ask your workspace administrator for workspace settings access.');
    assert.equal(await viewer.$(FORM), null);
    const rendered = await viewer.$eval(PANEL, (el) => el.textContent);
    for (const client of seeded) assert.ok(!rendered.includes(client.name), 'denied role sees no client names');
    assert.deepEqual(requests.get(viewer), [], 'UI verifies permission before requesting any reporting data');
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM client_reporting_profiles WHERE tenant_id=$1',
      [actors.other.tid])).rows[0].count, 0, 'another tenant remains untouched');
  });
});
