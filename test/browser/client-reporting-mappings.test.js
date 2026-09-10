'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const dedicatedUrl = process.env.PR10E9_TEST_DATABASE_URL;
const required = process.env.PR10F4_REQUIRE_BROWSER === '1';
const PANEL = '#ig-react-panel', ROUTE = '/manage/client-reporting';
const SECTION = `${PANEL} [aria-label="Client reporting data mappings"]`;
const API = '/api/client-reporting';
const mappingPath = (client, kind, id) => `${API}/clients/${client}/mappings/${kind}/${id}`;
const row = (id) => `${SECTION} [data-record-id="${id}"]`;
async function button(page, name, scope = PANEL) {
  await page.locator(`${scope} ::-p-aria([name="${name}"][role="button"])`).click();
}
async function text(page, wanted, scope = SECTION) {
  await page.waitForFunction((selector, value) => document.querySelector(selector)?.innerText.includes(value), {}, scope, wanted);
}
async function responseFor(page, method, path, action, status = 200) {
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === method && new URL(r.url()).pathname === path), action(),
  ]);
  assert.equal(response.status(), status, `${method} ${path}`);
  return response.json();
}
async function selectClient(page, id) {
  await page.waitForSelector(`${PANEL} select[name="client_id"]:enabled`);
  await page.select(`${PANEL} select[name="client_id"]`, String(id));
  await page.waitForSelector(`${SECTION} select[name="mapping_source"]:enabled`);
}

test('PR10F.4 client data mapping browser acceptance (real PostgreSQL/TLS)', {
  skip: !dedicatedUrl && !required ? 'optional local run: no PR10E9_TEST_DATABASE_URL' : false,
  timeout: 600_000,
}, async (t) => {
  assert.ok(dedicatedUrl, 'PR10E9_TEST_DATABASE_URL required; ambient DATABASE_URL is never used');
  const errors = [], requests = new WeakMap(), expected = new WeakMap();
  let browser, pool, tenantIds, closing = false;
  t.after(async () => {
    closing = true;
    if (browser) await browser.close();
    if (pool && tenantIds) {
      for (const table of ['search_intel_queries', 'ad_campaigns']) {
        await pool.query(`DELETE FROM ${table} WHERE tenant_id=ANY($1::int[])`, [tenantIds]);
      }
    }
    assert.deepEqual(errors, [], 'no browser errors or unexpected reporting failures');
  });
  const { startAgencyBrowser } = require('../helpers/agency-browser');
  const { baseUrl, db, actors } = await startAgencyBrowser(t);
  await require('../../services/search_intel/schema').ensureSearchIntelSchema();
  await require('../../services/optimizer/schema').ensureOptimizerSchema();
  const schema = require('../../services/client_reporting/schema');
  await schema.ensureClientReportingSchema(); await schema.ensureClientReportingMappingSchema();
  pool = db.getPool(); tenantIds = [actors.owner.tid, actors.other.tid];
  const clients = (await pool.query(`INSERT INTO clients (tenant_id,name) VALUES
    ($1,'PR10F4 Alpine'),($1,'PR10F4 Birch'),($2,'PR10F4 Foreign') RETURNING id,name`,
  [actors.owner.tid, actors.other.tid])).rows;
  const [first, second] = clients, fixtures = {};
  for (const kind of ['search-intel', 'campaigns']) {
    const sql = kind === 'search-intel'
      ? 'INSERT INTO search_intel_queries (tenant_id,query,brand) VALUES ($1,$2,$3) RETURNING id'
      : "INSERT INTO ad_campaigns (tenant_id,name,platform_camp_id,platform) VALUES ($1,$2,$3,'google') RETURNING id";
    fixtures[kind] = {};
    for (const label of ['Available', 'Other client', 'Foreign tenant']) {
      fixtures[kind][label] = (await pool.query(sql,
        [label === 'Foreign tenant' ? actors.other.tid : actors.owner.tid, `PR10F4 ${kind} ${label}`, randomUUID()])).rows[0].id;
    }
    const table = kind === 'search-intel' ? 'client_reporting_query_mappings' : 'client_reporting_campaign_mappings';
    const key = kind === 'search-intel' ? 'query_id' : 'campaign_id';
    await pool.query(`INSERT INTO ${table} (tenant_id,${key},client_id,mapping_id,created_by_user_id) VALUES ($1,$2,$3,$4,$5)`,
      [actors.owner.tid, fixtures[kind]['Other client'], second.id, randomUUID(), actors.owner.uid]);
  }
  browser = await require('puppeteer').launch({ headless: true, pipe: true,
    args: ['--disable-dev-shm-usage', '--disable-background-networking', '--lang=en-US'] });
  async function session(actor) {
    const context = await browser.createBrowserContext(), page = await context.newPage();
    page.setDefaultTimeout(45_000); page.setDefaultNavigationTimeout(90_000);
    await page.setViewport({ width: 1440, height: 1050 });
    await page.setBypassServiceWorker(true); await page.setCacheEnabled(false); await page.setRequestInterception(true);
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
    // Localhost login initializes demo defaults in its mount effect; wait before replacing them.
    await page.waitForFunction(() => [...document.querySelectorAll('strong')].some((el) => el.textContent === 'Preview login'));
    await button(page, 'Log In', 'body');
    await page.locator('#email').fill(actor.email); await page.locator('#pass').fill(actor.password);
    const [login, navigation] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/auth/login'),
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }), button(page, 'Log In →', 'form'),
    ]);
    const submitted = JSON.parse(login.request().postData());
    assert.ok(submitted.email === actor.email && submitted.password === actor.password, 'login submitted fixture credentials');
    assert.equal(login.status(), 200); assert.equal(navigation?.status(), 200);
    assert.equal(new URL(page.url()).pathname, ROUTE);
    const sid = (await context.cookies()).find((cookie) => cookie.name === 'infogenie.sid');
    assert.ok(sid?.httpOnly && decodeURIComponent(sid.value).startsWith('s:'), 'real signed session');
    return page;
  }
  const stored = async (kind, id) => {
    const table = kind === 'search-intel' ? 'client_reporting_query_mappings' : 'client_reporting_campaign_mappings';
    const key = kind === 'search-intel' ? 'query_id' : 'campaign_id';
    return (await pool.query(`SELECT client_id,mapping_id,created_by_user_id FROM ${table} WHERE tenant_id=$1 AND ${key}=$2`,
      [actors.owner.tid, id])).rows[0];
  };
  let owner;
  await t.test('both source kinds assign persistently, exclude foreign records, and require confirmation to remove', async () => {
    owner = await session(actors.owner); await selectClient(owner, first.id);
    for (const [kind, f] of Object.entries(fixtures)) {
      await owner.select(`${SECTION} select[name="mapping_source"]`, kind);
      await text(owner, 'Unassigned', row(f.Available));
      assert.equal(await owner.$(row(f['Foreign tenant'])), null);
      await text(owner, 'Assigned to another client', row(f['Other client']));
      assert.equal(await owner.$(`${row(f['Other client'])} button`), null, 'another client assignment cannot be stolen');
      const saved = await responseFor(owner, 'POST', mappingPath(first.id, kind, f.Available),
        () => button(owner, 'Assign to client', row(f.Available)), 201);
      await text(owner, 'Assigned to this client', row(f.Available));
      assert.deepEqual(await stored(kind, f.Available), { client_id: first.id,
        mapping_id: saved.mapping.mapping_id, created_by_user_id: actors.owner.uid });
      await owner.reload({ waitUntil: 'networkidle2' }); await selectClient(owner, first.id);
      await owner.select(`${SECTION} select[name="mapping_source"]`, kind);
      await text(owner, 'Assigned to this client', row(f.Available));
      const before = requests.get(owner).filter((r) => r.method === 'DELETE').length;
      await button(owner, 'Remove mapping', row(f.Available)); await button(owner, 'Cancel removal');
      assert.equal(requests.get(owner).filter((r) => r.method === 'DELETE').length, before);
      await button(owner, 'Remove mapping', row(f.Available));
      await responseFor(owner, 'DELETE', mappingPath(first.id, kind, f.Available), () => button(owner, 'Confirm removal'));
      await text(owner, 'Unassigned', row(f.Available)); assert.equal(await stored(kind, f.Available), undefined);
      assert.equal((await stored(kind, f['Other client'])).client_id, second.id);
    }
  });
  await t.test('real concurrent removal and replacement rejects a stale UUID and requires reload', async () => {
    const kind = 'search-intel', id = fixtures[kind].Available, path = mappingPath(first.id, kind, id);
    await owner.select(`${SECTION} select[name="mapping_source"]`, kind); await text(owner, 'Unassigned', row(id));
    const original = await responseFor(owner, 'POST', path, () => button(owner, 'Assign to client', row(id)), 201);
    await text(owner, 'Assigned to this client', row(id));
    const editor = await session(actors.owner);
    const replacement = await editor.evaluate(async (url, token) => {
      const call = async (method, body) => {
        const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        return { status: response.status, body: await response.json() };
      };
      return [await call('DELETE', { mapping_id: token }), await call('POST', {})];
    }, path, original.mapping.mapping_id);
    assert.equal(replacement[0].status, 200); assert.equal(replacement[1].status, 201);
    assert.notEqual(replacement[1].body.mapping.mapping_id, original.mapping.mapping_id);
    await button(owner, 'Remove mapping', row(id));
    expected.set(owner, { path, method: 'DELETE', status: 409 });
    try {
      const conflict = await responseFor(owner, 'DELETE', path, () => button(owner, 'Confirm removal'), 409);
      assert.equal(conflict.error, 'mapping_conflict');
      await text(owner, 'This mapping changed elsewhere. Reload mappings before trying again.');
      await owner.waitForFunction((selector) => [...document.querySelectorAll(`${selector} li button`)].every((el) => el.disabled), {}, SECTION);
    } finally { expected.delete(owner); }
    assert.equal((await stored(kind, id)).mapping_id, replacement[1].body.mapping.mapping_id);
    await button(owner, 'Reload mappings'); await text(owner, 'Assigned to this client', row(id));
    await button(owner, 'Remove mapping', row(id));
    await responseFor(owner, 'DELETE', path, () => button(owner, 'Confirm removal'));
    assert.equal(await stored(kind, id), undefined);
    await text(owner, 'Mapping removed.');
    await owner.waitForSelector(SECTION, { visible: true });
    await fs.mkdir('/tmp/client-reporting-artifacts', { recursive: true });
    await owner.screenshot({ path: '/tmp/client-reporting-artifacts/mappings-desktop.png', fullPage: true });
    await owner.setViewport({ width: 390, height: 844 });
    await owner.screenshot({ path: '/tmp/client-reporting-artifacts/mappings-mobile.png', fullPage: true });
    assert.ok(await owner.$eval(SECTION, (el) => el.getBoundingClientRect().right <= innerWidth + 1), 'mappings fit mobile');
  });
  await t.test('empty source and denied role expose no foreign reporting data', async () => {
    // This workspace has one real source per kind; remove its fixture before opening its first candidate view.
    await pool.query('DELETE FROM search_intel_queries WHERE tenant_id=$1', [actors.other.tid]);
    const other = await session(actors.other); await selectClient(other, clients[2].id);
    await text(other, 'No records');
    assert.equal(await other.$(`${SECTION} [data-record-id]`), null);
    const viewer = await session(actors.viewer);
    await text(viewer, 'Access denied.', PANEL);
    assert.equal(await viewer.$(SECTION), null); assert.deepEqual(requests.get(viewer), []);
  });
});
