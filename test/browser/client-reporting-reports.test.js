'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const dedicatedUrl = process.env.PR10E9_TEST_DATABASE_URL;
const required = process.env.PR10F5_REQUIRE_BROWSER === '1';
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
async function call(page, path, method = 'GET', body) {
  return page.evaluate(async (url, verb, data) => {
    const response = await fetch(url, { method: verb, ...(data === undefined ? {} : {
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }) });
    return { status: response.status, body: await response.json() };
  }, path, method, body);
}
async function responseFor(page, method, path, action, status = 200) {
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === method && new URL(r.url()).pathname === path), action(),
  ]);
  assert.equal(response.status(), status, `${method} ${path}`); return response;
}
test('PR10F.5 report preview and generation browser acceptance (real PostgreSQL/TLS)', {
  skip: !dedicatedUrl && !required ? 'optional local run: no PR10E9_TEST_DATABASE_URL' : false,
  timeout: 600_000,
}, async (t) => {
  assert.ok(dedicatedUrl, 'PR10E9_TEST_DATABASE_URL required; ambient DATABASE_URL is never used');
  const errors = [], requests = new WeakMap(), expected = new WeakMap();
  let browser, pool, tenantIds, closing = false;
  const downloadPath = await fs.mkdtemp('/tmp/pr10f5-downloads-');
  t.after(async () => {
    closing = true; if (browser) await browser.close();
    await fs.rm(downloadPath, { recursive: true, force: true });
    if (pool && tenantIds) for (const table of ['search_intel_queries', 'ad_campaigns']) {
      await pool.query(`DELETE FROM ${table} WHERE tenant_id=ANY($1::int[])`, [tenantIds]);
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
    ($1,'PR10F5 Alpine'),($1,'PR10F5 Birch'),($1,'PR10F5 Empty'),($2,'PR10F5 Foreign') RETURNING id,name`,
  [actors.owner.tid, actors.other.tid])).rows;
  const [first, second, empty, foreign] = clients;
  for (const kind of ['search-intel', 'campaigns']) {
    const sql = kind === 'search-intel'
      ? 'INSERT INTO search_intel_queries (tenant_id,query,brand) VALUES ($1,$2,$3) RETURNING id'
      : "INSERT INTO ad_campaigns (tenant_id,name,platform_camp_id,platform) VALUES ($1,$2,$3,'google') RETURNING id";
    for (const label of ['ALPINE', 'BIRCH', 'UNMAPPED', 'FOREIGN']) {
      const tenant = label === 'FOREIGN' ? actors.other.tid : actors.owner.tid;
      const id = (await pool.query(sql, [tenant, label, randomUUID()])).rows[0].id;
      if (label === 'UNMAPPED') continue;
      const table = kind === 'search-intel' ? 'client_reporting_query_mappings' : 'client_reporting_campaign_mappings';
      const key = kind === 'search-intel' ? 'query_id' : 'campaign_id';
      await pool.query(`INSERT INTO ${table} (tenant_id,${key},client_id,mapping_id,created_by_user_id) VALUES ($1,$2,$3,$4,$5)`,
        [tenant, id, label === 'ALPINE' ? first.id : label === 'BIRCH' ? second.id : foreign.id,
          randomUUID(), label === 'FOREIGN' ? actors.other.uid : actors.owner.uid]);
    }
  }
  browser = await require('puppeteer').launch({ headless: true, pipe: true,
    args: ['--disable-dev-shm-usage', '--disable-background-networking', '--lang=en-US'] });
  async function session(actor) {
    const context = await browser.createBrowserContext({ downloadBehavior: { policy: 'allow', downloadPath } }), page = await context.newPage();
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
    async function loginStep(label, action) {
      try { return await action(); } catch (error) {
        const state = await page.evaluate((email, password) => ({
          path: location.pathname, emailMatches: document.querySelector('#email')?.value === email,
          passwordMatches: document.querySelector('#pass')?.value === password,
          buttons: [...document.querySelectorAll('button')].map((el) => el.textContent?.trim()),
        }), actor.email, actor.password).catch(() => ({ unavailable: true }));
        throw new Error(`Login ${label}: ${error.message}; ${JSON.stringify(state)}`);
      }
    }
    await loginStep('page', () => page.goto(`${baseUrl}/login?next=${encodeURIComponent(ROUTE)}`, { waitUntil: 'networkidle2' }));
    // Localhost login initializes demo defaults in its mount effect; wait before replacing them.
    await loginStep('hydration', () => page.waitForFunction(() => [...document.querySelectorAll('strong')].some((el) => el.textContent === 'Preview login')));
    await loginStep('tab', () => button(page, 'Log In', 'body'));
    await loginStep('email fill', () => page.locator('#email').fill(actor.email));
    await loginStep('password fill', () => page.locator('#pass').fill(actor.password));
    const [login, navigation] = await Promise.all([
      loginStep('response', () => page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/auth/login')),
      loginStep('navigation', () => page.waitForNavigation({ waitUntil: 'domcontentloaded' })),
      loginStep('submit', () => button(page, 'Log In →', 'form')),
    ]);
    const submitted = JSON.parse(login.request().postData());
    assert.ok(submitted.email === actor.email && submitted.password === actor.password, 'login submitted fixture credentials');
    assert.equal(login.status(), 200); assert.equal(navigation?.status(), 200);
    assert.equal(new URL(page.url()).pathname, ROUTE);
    const sid = (await context.cookies()).find((cookie) => cookie.name === 'infogenie.sid');
    assert.ok(sid?.httpOnly && decodeURIComponent(sid.value).startsWith('s:'), 'real signed session');
    return page;
  }
  const reportPath = (id) => `${API}/clients/${id}/report`;
  const previewPath = (id) => `${API}/clients/${id}/report-preview`;
  let version = 0, owner;
  const searchMetrics = ['brand_mentions', 'runs', 'mapped_queries'];
  const campaignMetrics = ['clicks', 'spend', 'mapped_campaigns'];
  const profile = (format, source = 'search-intel', expectedVersion = version, extra = {}) => ({
    report_source: source, default_format: format, report_title: 'Alpine saved report',
    branding_mode: 'custom', branding_overrides: { agencyName: 'Alpine Agency', footerText: 'Alpine private footer' },
    selected_metrics: source === 'campaigns' ? campaignMetrics : searchMetrics,
    reporting_period: 'last_30_days', reporting_timezone: 'UTC', expected_version: expectedVersion, ...extra,
  });
  async function save(format, source = 'search-intel', id = first.id, expectedVersion = version) {
    const result = await call(owner, profilePath(id), 'PUT', profile(format, source, expectedVersion));
    assert.equal(result.status, 200); if (id === first.id) version = result.body.profile.version;
  }
  const reportPosts = () => requests.get(owner).filter((r) => r.method === 'POST' && r.path.endsWith('/report')).length;
  async function preview(id = first.id) {
    const response = await responseFor(owner, 'GET', previewPath(id), () => button(owner, 'Preview report', SECTION));
    const data = await response.json(); await owner.waitForSelector(`${SECTION} article`, { visible: true }); return data;
  }
  await t.test('saved profile previews isolated records and explicitly downloads all three real formats', async () => {
    owner = await session(actors.owner);
    for (const [format, source] of [['pdf', 'search-intel'], ['pptx', 'campaigns'], ['xlsx', 'search-intel']]) {
      await save(format, source); await owner.reload({ waitUntil: 'networkidle2' }); await selectClient(owner, first.id);
      const before = reportPosts(), data = await preview();
      assert.equal(reportPosts(), before, 'preview never generates a download');
      assert.equal(data.can_generate, true); assert.equal(data.report.title, 'Alpine saved report');
      const visible = await owner.$eval(`${SECTION} article`, (el) => el.innerText);
      for (const included of ['ALPINE', 'Alpine Agency', 'Alpine private footer']) assert.ok(visible.includes(included), included);
      for (const excluded of ['BIRCH', 'UNMAPPED', 'FOREIGN']) assert.ok(!JSON.stringify(data).includes(excluded), excluded);
      const response = await responseFor(owner, 'POST', reportPath(first.id),
        () => button(owner, `Generate & download ${format.toUpperCase()}`, SECTION));
      // CDP can return an empty body for a Blob response; inspect the user's actual downloaded file.
      await owner.waitForFunction((selector) => {
        const section = document.querySelector(selector);
        return section?.querySelector('[role="alert"]') || section?.innerText.includes('Report download started.');
      }, {}, SECTION);
      const alert = await owner.$eval(SECTION, (el) => el.querySelector('[role="alert"]')?.textContent || '');
      assert.equal(alert, '', 'generation must reach an actual browser download');
      const filename = `${downloadPath}/client-${first.id}-report.${format}`;
      let bytes;
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        try { bytes = await fs.readFile(filename); break; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(bytes, `browser completed ${format} download within 45 seconds`);
      assert.ok(bytes.length > 500, `nonempty downloaded document: format=${format}, bytes=${bytes.length}`);
      assert.match(response.headers()['content-disposition'], new RegExp(`\\.${format}"?$`));
      if (format === 'pdf') {
        assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
        assert.ok(bytes.toString('latin1').includes('Alpine saved report'), 'PDF title metadata');
        assert.ok(bytes.toString('latin1').includes('Alpine Agency'), 'PDF author metadata');
      } else {
        const zip = await require('jszip').loadAsync(bytes);
        const xml = (await Promise.all(Object.values(zip.files).filter((file) => file.name.endsWith('.xml'))
          .map((file) => file.async('string')))).join('\n');
        for (const included of ['ALPINE', 'Alpine saved report', 'Alpine Agency', 'Alpine private footer']) assert.ok(xml.includes(included), included);
        for (const excluded of ['BIRCH', 'UNMAPPED', 'FOREIGN']) assert.ok(!xml.includes(excluded), excluded);
        assert.ok(zip.file(format === 'pptx' ? 'ppt/presentation.xml' : 'xl/workbook.xml'));
      }
      await text(owner, 'Report download started.'); assert.equal(reportPosts(), before + 1);
    }
    await fs.mkdir('/tmp/client-reporting-artifacts', { recursive: true });
    await owner.screenshot({ path: '/tmp/client-reporting-artifacts/report-desktop.png', fullPage: true });
    await owner.setViewport({ width: 390, height: 844 });
    await owner.screenshot({ path: '/tmp/client-reporting-artifacts/report-mobile.png', fullPage: true });
    assert.ok(await owner.$eval(SECTION, (el) => el.getBoundingClientRect().right <= innerWidth + 1), 'report fits mobile');
  });
  await t.test('dirty draft blocks generation and a real concurrent profile change rejects the stale version', async () => {
    await owner.setViewport({ width: 1440, height: 1050 });
    await owner.reload({ waitUntil: 'networkidle2' });
    await selectClient(owner, first.id);
    await owner.waitForFunction((selector) => document.querySelector(selector)?.value === 'Alpine saved report', {}, `${PANEL} input[name="report_title"]`);
    const before = reportPosts();
    await owner.locator(`${PANEL} input[name="report_title"]`).fill('Unsaved draft');
    await text(owner, 'Save or reload the reporting profile', PANEL);
    assert.equal(await owner.$(SECTION), null); assert.equal(reportPosts(), before);
    await owner.reload({ waitUntil: 'networkidle2' }); await selectClient(owner, first.id); await preview();
    const staleVersion = version; await save('xlsx');
    const path = reportPath(first.id); expected.set(owner, { path, method: 'POST', status: 409 });
    try {
      const conflict = await call(owner, path, 'POST', { expected_version: staleVersion });
      assert.equal(conflict.status, 409); assert.equal(conflict.body.error, 'version_conflict');
    } finally { expected.delete(owner); }
    const afterConflict = reportPosts();
    await button(owner, 'Generate & download XLSX', SECTION);
    await text(owner, 'The client or saved profile changed.');
    assert.equal(reportPosts(), afterConflict, 'profile verification stops stale UI generation before POST');
    assert.equal(await owner.$(`${SECTION} article`), null);
  });
  await t.test('preview honors saved metric order from profile', async () => {
    await save('pdf');
    await owner.reload({ waitUntil: 'networkidle2' });
    await selectClient(owner, first.id);
    const data = await preview();
    assert.equal(data.selected_metrics.join(','), searchMetrics.join(','));
    const ordered = data.report.sections.find((section) => section.title === 'Search totals')?.rows.map((row) => row[0]) || [];
    assert.deepEqual(ordered, ['Brand mentions', 'Runs']);
  });
  await t.test('empty, unconfigured and denied clients cannot generate or expose foreign report data', async () => {
    await save('pdf', 'search-intel', empty.id, 0);
    await owner.reload({ waitUntil: 'networkidle2' }); await selectClient(owner, empty.id);
    assert.equal((await preview(empty.id)).can_generate, false);
    await text(owner, 'No mapped records are available.');
    assert.equal(await owner.$eval(`${SECTION} button:last-of-type`, (el) => el.disabled), true);
    for (const [id, suffix, method, body, error] of [
      [empty.id, 'report', 'POST', { expected_version: 1 }, 'no_mapped_records'],
      [second.id, 'report-preview', 'GET', undefined, 'profile_required'],
    ]) {
      const path = `${API}/clients/${id}/${suffix}`; expected.set(owner, { path, method, status: 409 });
      try { const result = await call(owner, path, method, body); assert.equal(result.status, 409); assert.equal(result.body.error, error); }
      finally { expected.delete(owner); }
    }
    const viewer = await session(actors.viewer); await text(viewer, 'Access denied.', PANEL);
    assert.equal(await viewer.$(SECTION), null); assert.deepEqual(requests.get(viewer), []);
  });
});
