'use strict';

// MODEL: inherit; MODEL SOURCE: cursor-fallback
// ESCALATION REASON: Cursor pins unavailable
// Backend owns helpers/agency-browser: isolated DB, real Express + Next dev,
// server egress guards, empty agency fixtures, current UTC week, and teardown.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const PANEL = '#ig-react-panel';
const dedicatedUrl = process.env.PR10E9_TEST_DATABASE_URL;
const required = process.env.PR10E9_REQUIRE_BROWSER === '1';
const form = (name) => `${PANEL} form[aria-label="${name}"]`;
const section = (name) => `${PANEL} section[aria-label="${name}"]`;
const paths = { capacity: '/manage/capacity', rates: '/manage/agency-rate-cards',
  scope: '/manage/agency-scope-budgets', time: '/manage/agency-time-entries',
  dashboard: '/manage/agency-ops-dashboard' };
// CI job 102534058964: AppShell restores optional analysis/brief state; app.js
// reads analytics config. These fixtures have no captures or global owner role.
const baselineReads = new Map([
  ['GET /api/diag-capture/latest 404', 'no captures yet — run Analyse Now once to seed'],
  ['GET /api/marketing-brief/merged 403', 'owner_only'],
  ['GET /api/config 403', 'owner_only'],
  ['GET /api/alerts/list?limit=30 403', 'owner_only'],
  ['GET /api/alerts/check-credits 403', 'owner_only'],
]);
const creditPath = '/api/alerts/check-credits', alertsPath = '/api/alerts/list?limit=30';
const pageAudits = new WeakMap();
async function drainAudits(page) {
  const state = pageAudits.get(page);
  if (!state) return;
  const started = Date.now();
  const document = new URL(page.url()).pathname.startsWith('/manage/')
    ? (await state.cdp.send('Page.getFrameTree', {}, { timeout: 10_000 })).frameTree.frame : null;
  const shellReady = () => {
    if (!document) return true;
    const reads = [...state.shellReads.values()].filter((read) => read.frameId === document.id &&
      read.loaderId === document.loaderId && read.bodyValid === true && read.finished);
    // app.js waits for replayed DOMContentLoaded; ig_mentions_gaps.js also
    // schedules a credit check followed by another list read on boot. Require
    // that real sequence, not the earlier auto-list or a fixed quiet delay.
    return reads.some((read) => new URL(read.url).pathname === '/api/data-mode/effective' && read.status === 200) &&
      reads.some((credit) => credit.path === creditPath && credit.status === 403 &&
        reads.some((list) => list.path === alertsPath && list.status === 403 && list.startedAt >= credit.respondedAt));
  };
  while (Date.now() - started < 10_000) {
    if (shellReady() && !state.requests.size && !state.audits.size && Date.now() - Math.max(started, state.changedAt) >= 250) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const requests = [...state.requests.values()].slice(0, 8).map((request) => ({ ...request, ageMs: Date.now() - request.at }));
  assert.fail(`Shell readiness/API drain exceeded 10s: ${JSON.stringify({ currentUrl: page.url(), document, shellReady: shellReady(),
    shellReads: [...state.shellReads.values()].filter((read) => read.loaderId === document?.loaderId).slice(-4), pending: state.requests.size,
    requests, pendingBodies: state.audits.size, bodies: [...state.audits.values()].slice(0, 8) })}`);
}
async function reload(page) {
  await drainAudits(page);
  const response = await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(response?.status(), 200, 'real document reload succeeds');
  await drainAudits(page);
  return response;
}

async function visibleText(page, text, scope = PANEL) {
  await page.waitForFunction((root, wanted) => {
    const el = document.querySelector(root);
    return el?.getBoundingClientRect().width > 0 && el.innerText.includes(wanted);
  }, {}, scope, text);
}
async function button(page, name, scope = PANEL) {
  await page.locator(`${scope} ::-p-aria([name="${name}"][role="button"])`).click();
}
async function fill(page, scope, values) {
  for (const [name, value] of Object.entries(values)) {
    const selector = `${scope} [name="${name}"]`;
    await page.waitForSelector(`${selector}:enabled`, { visible: true });
    const kind = await page.$eval(selector, (el) => el.tagName === 'SELECT' ? 'select' : el.type);
    if (kind === 'select') await page.select(selector, String(value));
    else if (kind === 'checkbox') {
      if (await page.$eval(selector, (el) => el.checked) !== value) await page.click(selector);
    } else if (kind === 'date') {
      // Native date editing varies by Chromium locale. Dispatch genuine input
      // events to the controlled form; all saves still go through its submit UI.
      await page.$eval(selector, (el, next) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, next);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, String(value));
    } else await page.locator(selector).fill(String(value));
  }
}
async function responseFor(page, method, pathname, action, status = 200) {
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === method && new URL(r.url()).pathname === pathname),
    action(),
  ]).catch((error) => { throw new Error(`Expected ${method} ${pathname} response: ${error.message}`, { cause: error }); });
  assert.equal(response.status(), status, `${method} ${pathname}`);
  const body = await response.json();
  assert.equal(body.ok, true, `${method} ${pathname} must confirm the real operation`);
  return body;
}
async function go(page, baseUrl, view) {
  await drainAudits(page);
  const response = await page.goto(baseUrl + paths[view], { waitUntil: 'domcontentloaded' });
  assert.equal(response.status(), 200, paths[view]);
  await page.waitForSelector(`${PANEL} h1`, { visible: true });
  assert.equal(new URL(page.url()).pathname, paths[view]);
  await drainAudits(page);
}
async function rows(page, scope) {
  return page.$$eval(`${scope} tbody tr`, (list) => list.map((tr) =>
    [...tr.querySelectorAll('td')].map((td) => td.innerText.trim())));
}
async function absent(page, tokens) {
  const rendered = await page.$eval(PANEL, (el) => el.textContent);
  for (const token of tokens) assert.ok(!rendered.includes(token), `foreign data visible: ${token}`);
}
async function metric(page, label, expected) {
  const actual = await page.$eval(PANEL, (root, name) => {
    const label = [...root.querySelectorAll('div')].find((el) => el.textContent === name);
    return label?.nextElementSibling?.textContent;
  }, label);
  assert.equal(actual, expected, label);
}
async function definitions(page, heading, expected) {
  const actual = await page.$eval(`${PANEL} section[aria-labelledby="${heading}"]`, (el) =>
    Object.fromEntries([...el.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent])));
  assert.deepEqual(actual, expected, heading);
}

test('PR10E.9 agency browser acceptance (real Chromium, Next dev, Express and PostgreSQL)', {
  skip: !dedicatedUrl && !required ? 'optional local run: no PR10E9_TEST_DATABASE_URL' : false,
  timeout: 600_000,
}, async (t) => {
  assert.ok(dedicatedUrl, 'PR10E9_TEST_DATABASE_URL is required; ambient DATABASE_URL is never used');
  const apiErrors = [], browserErrors = [], audits = [], held = new Set();
  const reportedBaselineReads = new Set();
  const expectedFailures = new WeakMap();
  let browser, fault = null, closing = false;
  // Register before the helper: close Chromium before stopping its real servers.
  t.after(async () => {
    for (const request of held) if (!request.isInterceptResolutionHandled()) await request.abort();
    if (browser) {
      try { await Promise.all((await browser.pages()).map(drainAudits)); }
      finally { closing = true; await browser.close(); }
    }
    await Promise.all(audits);
    assert.deepEqual({ apiErrors, browserErrors }, { apiErrors: [], browserErrors: [] }, 'application API and browser audit');
  });
  // No catch-and-skip: missing helper, Chrome, DB, fonts or boot errors fail.
  const { startAgencyBrowser } = require('../helpers/agency-browser');
  const harness = await startAgencyBrowser(t);
  assert.ok(harness, 'startAgencyBrowser must return the real app fixture');
  const { baseUrl, actors, dates } = harness;
  const origin = new URL(baseUrl);
  assert.ok(origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname));
  assert.notEqual(actors.owner.tid, actors.other.tid);
  assert.equal(actors.viewer.tid, actors.owner.tid, 'viewer must exercise the populated owner tenant');
  assert.equal(new Date(dates.monday + 'T00:00:00Z').getUTCDay(), 1);
  assert.equal(new Date(dates.tuesday + 'T00:00:00Z') - new Date(dates.monday + 'T00:00:00Z'), 86400000);
  assert.equal(new Date(dates.sunday + 'T00:00:00Z') - new Date(dates.monday + 'T00:00:00Z'), 6 * 86400000);
  const today = new Date().toISOString().slice(0, 10);
  assert.ok(dates.monday <= today && today <= dates.sunday, 'capacity uses the current UTC week');
  const puppeteer = require('puppeteer');
  browser = await puppeteer.launch({ headless: true, pipe: true,
    args: ['--disable-dev-shm-usage', '--disable-background-networking', '--lang=en-US'] });
  async function guardedPage(actor, mobile = false) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.setDefaultTimeout(45_000);
    page.setDefaultNavigationTimeout(90_000);
    await page.setViewport(mobile ? { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true }
      : { width: 1440, height: 1000, deviceScaleFactor: 1 });
    await page.emulateTimezone('UTC');
    await page.setBypassServiceWorker(true);
    const cdp = await page.createCDPSession();
    await cdp.send('Emulation.setLocaleOverride', { locale: 'en-US' });
    // Require real server reads; interception alone leaves caching enabled.
    await page.setCacheEnabled(false);
    await page.setRequestInterception(true);
    const deliberate = new WeakSet(), pendingAudits = new Map(), pendingRequests = new Map();
    const shellReads = new Map();
    const activity = { cdp, shellReads, requests: pendingRequests, audits: pendingAudits, changedAt: Date.now() };
    pageAudits.set(page, activity);
    // Duplicate Fetch.requestPaused events create multiple Puppeteer objects
    // for one network request. Only CDP Network terminal events settle this ledger.
    const networkKey = (id) => `${cdp.id()}:${id}`;
    cdp.on('Network.requestWillBeSent', (event) => {
      const key = networkKey(event.requestId), prior = pendingRequests.get(key), url = new URL(event.request.url);
      if (!prior && (url.origin !== origin.origin || !url.pathname.startsWith('/api/'))) return;
      if (prior && !event.redirectResponse) return;
      const redirects = event.redirectResponse ? [...(prior?.redirects || []),
        { url: event.redirectResponse.url, status: event.redirectResponse.status }].slice(-4) : [];
      const record = { key, url: url.href, path: url.pathname + url.search, method: event.request.method,
        at: Date.now(), startedAt: event.timestamp,
        frameId: event.frameId, loaderId: event.loaderId, documentUrl: event.documentURL, pageAtStart: page.url(),
        response: null, status: null, redirects,
        deliberate: prior?.deliberate || (fault?.page === page && event.request.method === 'GET' && url.pathname === fault.path) };
      pendingRequests.set(key, record);
      if (url.origin === origin.origin && event.request.method === 'GET' &&
        (url.pathname === '/api/data-mode/effective' || [creditPath, alertsPath].includes(record.path))) shellReads.set(key, record);
      activity.changedAt = Date.now();
    });
    cdp.on('Network.responseReceived', (event) => {
      const request = pendingRequests.get(networkKey(event.requestId));
      if (request) {
        Object.assign(request, { response: event.response.url, status: event.response.status,
          respondedAt: event.timestamp, fromDiskCache: event.response.fromDiskCache });
        activity.changedAt = Date.now();
      }
    });
    const finishNetwork = (event) => {
      const key = networkKey(event.requestId), request = pendingRequests.get(key);
      if (!request) return;
      if (event.errorText && !closing && !request.deliberate) apiErrors.push(`CDP failed ${request.method} ${request.url}: ${event.errorText}`);
      request.finished = !event.errorText;
      pendingRequests.delete(key); activity.changedAt = Date.now();
    };
    cdp.on('Network.loadingFinished', finishNetwork);
    cdp.on('Network.loadingFailed', finishNetwork);
    await cdp.send('Network.enable');
    await page.evaluateOnNewDocument(() => {
      window.__pr10e9Clicks = [];
      for (const type of ['pointerdown', 'click', 'submit']) document.addEventListener(type, (event) => {
        const el = event.target instanceof Element ? event.target : null, button = el?.closest('button');
        const submit = document.querySelector('#ig-react-panel form[aria-label="Save time entry"] button[type="submit"]');
        const rect = submit?.getBoundingClientRect();
        window.__pr10e9Clicks.push({ type, target: el?.tagName, name: el?.getAttribute('name'), button: button?.textContent?.trim(),
          form: el?.closest('form')?.getAttribute('aria-label'), x: event.clientX, y: event.clientY,
          submitRect: rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          enhanced: !!document.querySelector('#ig-react-panel [data-ig-bar]') });
        window.__pr10e9Clicks = window.__pr10e9Clicks.slice(-8);
      }, true);
    });
    page.on('request', (request) => {
      const url = new URL(request.url());
      // Includes Clarity emitted by root layout. Block analytics without
      // treating intentional external resource denial as an app API failure.
      if (!['data:', 'blob:'].includes(url.protocol) && url.origin !== origin.origin) {
        void request.abort('blockedbyclient'); return;
      }
      if (url.pathname === '/api/studio/ai-suggest' && request.method() === 'POST') {
        apiErrors.push('Unexpected POST /api/studio/ai-suggest during manual agency acceptance');
        audits.push(page.evaluate(() => window.__pr10e9Clicks).then((clicks) =>
          t.diagnostic(`Unexpected studio POST click trail: ${JSON.stringify(clicks)}`)).catch(() => {}));
      }
      if (fault?.page === page && request.method() === 'GET' && url.pathname === fault.path) {
        deliberate.add(request);
        if (fault.mode === 'hold') { held.add(request); fault.seen(); return; }
        void request.respond({ status: 503, contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: 'PR10E9 deliberate read failure' }) });
        return;
      }
      void request.continue();
    });
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (url.origin !== origin.origin || !url.pathname.startsWith('/api/')) return;
      const denied = actor === actors.viewer && response.status() === 403 &&
        ['/api/agency-ops/summary', '/api/agency-ops/capacity-summary'].includes(url.pathname);
      const expected = expectedFailures.get(page);
      const rejectedProbe = expected?.method === response.request().method() &&
        expected.path === url.pathname && expected.status === response.status();
      if (deliberate.has(response.request()) || denied || rejectedProbe) return;
      // Login performs a full document navigation, which can discard its CDP
      // response body. session() checks status, cookie and real identity reads.
      if (response.status() === 200 && response.request().method() === 'POST' && url.pathname === '/api/auth/login') return;
      const audit = (async () => {
        const key = `${response.request().method()} ${url.pathname}${url.search} ${response.status()}`;
        if (actor && baselineReads.has(key)) {
          const body = await response.json();
          const valid = body.ok === false && body.error === baselineReads.get(key);
          const shellRead = shellReads.get(networkKey(response.request().id));
          if (shellRead) shellRead.bodyValid = valid;
          if (!valid) {
            apiErrors.push(`unexpected shell probe response ${key}`);
          } else if (!reportedBaselineReads.has(key)) {
            reportedBaselineReads.add(key);
            t.diagnostic(`Known baseline shell read: ${key} (${body.error})`);
          }
          return;
        }
        if (response.status() >= 400) {
          apiErrors.push(`${response.status()} ${url.pathname}`);
          t.diagnostic(`Unexpected API response: ${response.request().method()} ${url.pathname} ${response.status()}`);
        }
        else if ((response.headers()['content-type'] || '').includes('application/json')) {
          const body = await response.json();
          const shellRead = shellReads.get(networkKey(response.request().id));
          if (shellRead && url.pathname === '/api/data-mode/effective') shellRead.bodyValid = body.ok === true;
          if (body.ok === false) apiErrors.push(`ok:false ${url.pathname}`);
        }
      })().catch(() => apiErrors.push(`unreadable API response ${url.pathname}`));
      audits.push(audit); pendingAudits.set(audit, `${response.request().method()} ${url.pathname}`); activity.changedAt = Date.now();
      void audit.finally(() => { pendingAudits.delete(audit); activity.changedAt = Date.now(); });
    });
    page.on('requestfailed', (request) => {
      const url = new URL(request.url());
      if (!closing && url.origin === origin.origin && url.pathname.startsWith('/api/') && !deliberate.has(request)) {
        apiErrors.push(`failed ${url.pathname}`);
      }
    });
    page.on('pageerror', (error) => browserErrors.push(error.message));
    return page;
  }
  async function probe(page, method, path, body, status = 200) {
    expectedFailures.set(page, { method, path: new URL(path, baseUrl).pathname, status });
    try {
      const response = await page.evaluate(async (method, path, body) => {
        const result = await fetch(path, { method, headers: { 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        return { status: result.status, body: await result.json() };
      }, method, path, body);
      assert.equal(response.status, status, `${method} ${new URL(path, baseUrl).pathname}`);
      assert.equal(response.body.ok, status < 400);
      return response.body;
    } finally { expectedFailures.delete(page); }
  }
  async function session(actor, mobile = false) {
    const page = await guardedPage(actor, mobile);
    await drainAudits(page);
    await page.goto(`${baseUrl}/login?next=${encodeURIComponent(paths.capacity)}`, { waitUntil: 'networkidle2' });
    await button(page, 'Log In', 'body');
    await page.locator('#email').fill(actor.email);
    await page.locator('#pass').fill(actor.password);
    await drainAudits(page);
    const [loginResponse, navigation] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/auth/login'),
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      button(page, 'Log In →', 'form'),
    ]);
    assert.equal(loginResponse.status(), 200, 'actual login POST succeeds');
    assert.equal(navigation?.status(), 200, 'login lands on the real app');
    assert.equal(new URL(page.url()).pathname, paths.capacity);
    await page.waitForSelector(`${PANEL} h1`, { visible: true });
    const sid = (await page.browserContext().cookies()).find((cookie) => cookie.name === 'infogenie.sid');
    assert.ok(sid?.httpOnly && decodeURIComponent(sid.value).startsWith('s:'), 'login issues a signed HttpOnly session cookie');
    // Identity checks use only real reads after the real login form issued a cookie.
    const auth = await probe(page, 'GET', '/api/auth/me');
    assert.equal(auth.authenticated, true);
    assert.equal(auth.user.id, actor.uid);
    assert.equal(auth.user.isOwner, false, 'no global owner bypass');
    const identity = await probe(page, 'GET', '/api/tenants/me');
    assert.equal(identity.user.id, actor.uid);
    assert.equal(identity.activeTenantId, actor.tid);
    const active = await probe(page, 'GET', '/api/tenants/active');
    assert.equal(active.tenant.id, actor.tid);
    assert.equal(active.isPlatformAdmin, false);
    assert.equal(active.platformRole, null);
    assert.equal(active.role.key, actor === actors.viewer ? 'analyst' : 'tenant_owner');
    for (const permission of ['manage.projects.view', 'manage.projects.edit', 'tenant.billing.manage']) {
      assert.equal(active.permissions.includes(permission), actor !== actors.viewer || permission === 'manage.projects.view');
    }
    await drainAudits(page);
    return page;
  }
  const client = 'PR10E9 client', memberName = 'PR10E9 marketer', work = 'PR10E9 delivery';
  const foreign = ['PR10E9 foreign member', 'PR10E9 foreign client', 'PR10E9 foreign work'];
  let owner, other, memberId, foreignId, entryId;
  async function snapshot() {
    const result = {};
    for (const table of ['team_capacity', 'capacity_assignments', 'agency_rate_cards', 'agency_scope_baselines', 'agency_time_entries']) {
      result[table] = (await harness.db.getPool().query(
        `SELECT * FROM ${table} WHERE tenant_id=ANY($1::int[]) ORDER BY id`, [[actors.owner.tid, actors.other.tid]])).rows;
    }
    return result;
  }
  async function createMember(page, name) {
    await fill(page, form('Roster details'), { member_name: name, role: 'strategist', weekly_hours: 40, allocated_hours: 2 });
    await button(page, 'Review member', form('Roster details'));
    await visibleText(page, name, section('Review capacity change'));
    const result = await responseFor(page, 'POST', '/api/capacity/members',
      () => button(page, 'Save change', section('Review capacity change')));
    await visibleText(page, 'Saved. Lists refreshed.');
    return result.id;
  }
  async function timeFilters(page) {
    await fill(page, form('Time-entry filters'), { from: dates.monday, to: dates.sunday });
    await responseFor(page, 'GET', '/api/agency-ops/time-entries',
      () => button(page, 'Apply filters / Refresh list', form('Time-entry filters')));
    await page.waitForSelector(`${section('Existing time entries')} [aria-busy="false"]`);
  }
  async function createTime(page, id, ref, item, hours, billable = true) {
    await fill(page, form('Save time entry'), { member_id: id, client_ref: ref, project_ref: 'launch',
      work_item: item, work_date: billable ? dates.monday : dates.tuesday, hours, billable });
    await responseFor(page, 'POST', '/api/agency-ops/time-entries',
      () => button(page, 'Create entry', form('Save time entry')), 201);
    await visibleText(page, 'Saved. The list is refreshed from persisted data');
  }
  async function period(page) {
    // Reporting period has wrapped labels but no names; select by those labels.
    for (const [label, value] of [['From', dates.monday], ['To', dates.sunday]]) {
      const input = await page.waitForSelector(`${form('Reporting period')} ::-p-aria([name="${label}"])`);
      await input.evaluate((el, next) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, next);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, value);
    }
    await visibleText(page, `Selected period: ${dates.monday} to ${dates.sunday}`);
    return responseFor(page, 'GET', '/api/agency-ops/summary', () => button(page, 'Refresh', form('Reporting period')));
  }
  async function dashboard(page) {
    const summary = await period(page);
    await visibleText(page, `Selected period: ${dates.monday} to ${dates.sunday}`);
    assert.deepEqual(summary.totals, { time_entries: 2, hours: 10, billable_hours: 8, non_billable_hours: 2,
      cost_value: 300, billable_value: 800, margin_value: 500, margin_pct: 62.5,
      unpriced_hours: 0, contracted_value: 1000, scope_overage_hours: 1, currency: 'USD' });
    for (const [label, value] of Object.entries({ 'Logged time': '10h', 'Billable time': '8h',
      Margin: '$500.00', 'Billable value': '$800.00', 'Pricing completeness': '100%', 'Scope overage': '1h' })) {
      await metric(page, label, value);
    }
    await definitions(page, 'financial-and-pricing-context', { 'Cost value': '$300.00', 'Contracted value': '$1,000.00',
      'Non-billable time': '2h', 'Reporting currency': 'USD' });
    await definitions(page, 'capacity-this-week', { 'Team members': '1', 'Weekly capacity': '40h', Allocated: '10h',
      'Logged this week': '10h', Utilization: '25%', 'Open tasks': '0' });
    await visibleText(page, '10h used of 9h allowed', `${PANEL} section[aria-labelledby="scope-signals"]`);
    await visibleText(page, 'Over scope', `${PANEL} section[aria-labelledby="scope-signals"]`);
    assert.deepEqual(await rows(page, `${PANEL} section[aria-labelledby="client-margin-detail"]`),
      [[client, '10h', '$500.00 (62.5%)', '10h complete']]);
    await absent(page, foreign);
  }

  await t.test('empty real tenants, roster and explicit reviewed assignment', async () => {
    other = await session(actors.other);
    foreignId = await createMember(other, foreign[0]);
    await go(other, baseUrl, 'time');
    await timeFilters(other);
    await createTime(other, foreignId, foreign[1], foreign[2], 3);
    owner = await session(actors.owner);
    await visibleText(owner, 'No teammates yet.');
    await absent(owner, foreign);
    memberId = await createMember(owner, memberName);
    await fill(owner, form('Assignment details'), { member_id: memberId, work_item: work, hours: 8, due_date: dates.sunday });
    await button(owner, 'Review assigned person and hours', form('Assignment details'));
    await visibleText(owner, `${work} · 8h`, section('Review capacity change'));
    const before = await owner.evaluate(async () => (await fetch('/api/capacity/summary')).json());
    assert.equal(before.totals.allocated_hours, 2, 'review must not save an assignment');
    assert.deepEqual(before.members[0].assignments, []);
    await responseFor(owner, 'POST', '/api/capacity/assignments',
      () => button(owner, 'Save change', section('Review capacity change')));
    await visibleText(owner, 'Saved. Lists refreshed.');
    await reload(owner);
    // Persisted NUMERIC(6,2) assignment hours render directly as 8.00h.
    await visibleText(owner, `${work} · 8.00h · due ${dates.sunday}`, `${PANEL} ul`);
    await absent(owner, foreign);
  });
  await t.test('real rate history and reviewed scope budget persist after reload', async () => {
    await go(owner, baseUrl, 'rates');
    await visibleText(owner, 'No rate records match these filters.');
    await absent(owner, foreign);
    // A conflicting role rate proves that member pricing takes precedence.
    for (const rate of [{ scope: 'role', role: 'strategist', cost_rate: 90, bill_rate: 200 },
      { scope: 'member', member_id: memberId, cost_rate: 30, bill_rate: 100 }]) {
      await fill(owner, form('Save rate'), { ...rate, currency: 'USD', effective_from: dates.monday });
      await responseFor(owner, 'POST', '/api/agency-ops/rates', () => button(owner, 'Save rate', form('Save rate')), 201);
      await visibleText(owner, 'Saved. Rate history was refreshed');
    }
    await reload(owner);
    await visibleText(owner, 'Stored rate history');
    const history = await rows(owner, section('Existing rates'));
    assert.equal(history.length, 2);
    assert.deepEqual(history.map((row) => row.slice(1)).sort(), [
      ['30.00', '100.00', 'USD', dates.monday, 'No end date', 'Yes'],
      ['90.00', '200.00', 'USD', dates.monday, 'No end date', 'Yes']]);
    await go(owner, baseUrl, 'scope');
    await visibleText(owner, 'No active baselines overlap this period and client filter.');
    await fill(owner, form('Review scope budget'), { client_ref: client, project_ref: 'launch', name: 'PR10E9 baseline',
      contracted_hours: 8, change_budget_hours: 1, contracted_value: 1000, currency: 'USD',
      period_start: dates.monday, period_end: dates.sunday });
    await button(owner, 'Review budget inputs', form('Review scope budget'));
    await visibleText(owner, '8.00 hours', section('Review baseline'));
    await responseFor(owner, 'POST', '/api/agency-ops/scope-baselines',
      () => button(owner, 'Save active baseline', section('Review baseline')), 201);
    await visibleText(owner, 'Saved. The list was refreshed for the created client and period.');
    await reload(owner);
    await fill(owner, form('Scope filters'), { filter_from: dates.monday, filter_to: dates.sunday });
    await button(owner, 'Apply filters', form('Scope filters'));
    await visibleText(owner, 'Active baselines matching the applied filters');
    assert.deepEqual(await rows(owner, section('Active scope baselines')),
      [['PR10E9 baseline', client, 'launch', dates.monday, dates.sunday, '8.00', '1.00', '1000.00', 'USD']]);
  });
  await t.test('create, correct and reload time; exact dashboard and mobile persistence', async () => {
    let stage, active = owner;
    const mark = (name) => { stage = name; t.diagnostic(`Time/mobile stage: ${name}`); };
    try {
    mark('desktop time entries and correction');
    await go(owner, baseUrl, 'time');
    await timeFilters(owner);
    await visibleText(owner, 'No time entries match these filters.');
    await absent(owner, foreign);
    assert.equal(await owner.$(`${section('Time-entry editor')} [data-ig-bar]`), null, 'human time editor has no AI toolbar');
    await createTime(owner, memberId, client, work, 6);
    await createTime(owner, memberId, client, 'PR10E9 internal', 2, false);
    await button(owner, `Correct ${work}`, section('Existing time entries'));
    await fill(owner, form('Save time entry'), { hours: 8, notes: 'PR10E9 corrected after review' });
    const entry = await owner.$eval(`${section('Time-entry editor')} p`, (el) => el.textContent.match(/Correcting entry (\S+)\./)[1]);
    entryId = entry;
    await responseFor(owner, 'PATCH', `/api/agency-ops/time-entries/${entry}`,
      () => button(owner, 'Save correction', form('Save time entry')));
    await visibleText(owner, 'Saved. The list is refreshed from persisted data');
    mark('desktop corrected entry reload');
    await reload(owner);
    await timeFilters(owner);
    const entries = await rows(owner, section('Existing time entries'));
    assert.equal(entries.length, 2, 'correction must not duplicate the entry');
    assert.deepEqual(entries.find((r) => r[3].startsWith(work)).slice(3, 6),
      [`${work}\nNotes: PR10E9 corrected after review`, '8', 'Yes']);
    assert.deepEqual(entries.find((r) => r[3] === 'PR10E9 internal').slice(4, 6), ['2', 'No']);
    mark('desktop dashboard totals');
    await go(owner, baseUrl, 'dashboard');
    await dashboard(owner);
    mark('fresh mobile context and actual owner login');
    const mobile = await session(actors.owner, true); active = mobile;
    mark('mobile dashboard totals and layout');
    await go(mobile, baseUrl, 'dashboard');
    await dashboard(mobile);
    mark('mobile dashboard reload persistence');
    await reload(mobile);
    await dashboard(mobile);
    const width = await mobile.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    if (width.scroll > width.client + 1) {
      const overflow = await mobile.evaluate(() => [...document.body.querySelectorAll('*')].flatMap((el) => {
        const rect = el.getBoundingClientRect(), css = getComputedStyle(el);
        if (!rect.width || !rect.height || rect.right <= document.documentElement.clientWidth + 1 || css.visibility === 'hidden') return [];
        return [{ node: el.tagName.toLowerCase(), id: el.id, label: el.getAttribute('aria-label') || el.getAttribute('aria-labelledby'),
          left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width),
          display: css.display, minWidth: css.minWidth, grid: css.gridTemplateColumns, overflowX: css.overflowX }];
      }).sort((a, b) => b.right - a.right).slice(0, 12));
      t.diagnostic(`Mobile overflow DOM: ${JSON.stringify(overflow)}`);
    }
    assert.ok(width.scroll <= width.client + 1, `mobile page overflow: ${width.scroll}/${width.client}`);
    mark('mobile time list and correction selection');
    await go(mobile, baseUrl, 'time');
    await timeFilters(mobile);
    await button(mobile, `Correct ${work}`, section('Existing time entries'));
    assert.equal(await mobile.$(`${section('Time-entry editor')} [data-ig-bar]`), null, 'mobile time editor has no AI toolbar');
    mark('mobile notes fill');
    await fill(mobile, form('Save time entry'), { notes: 'PR10E9 mobile correction' });
    mark('mobile Save correction click and real PATCH');
    assert.equal(await mobile.$(`${section('Time-entry editor')} [data-ig-bar]`), null, 'notes editing must not insert AI controls');
    await responseFor(mobile, 'PATCH', `/api/agency-ops/time-entries/${entry}`,
      () => button(mobile, 'Save correction', form('Save time entry')));
    await visibleText(mobile, 'Saved. The list is refreshed from persisted data');
    mark('mobile corrected entry reload');
    await reload(mobile);
    await timeFilters(mobile);
    await visibleText(mobile, 'Notes: PR10E9 mobile correction', section('Existing time entries'));
    } catch (error) {
      const clicks = await active.evaluate(() => window.__pr10e9Clicks).catch(() => []);
      t.diagnostic(`Time/mobile failure: ${stage}; URL=${active.url()}; clicks=${JSON.stringify(clicks)}`);
      throw new Error(`Time/mobile stage "${stage}": ${error.message}`, { cause: error });
    }
  });
  await t.test('visible viewer restrictions and populated foreign tenant absence', async () => {
    for (const view of ['rates', 'scope', 'time', 'dashboard']) {
      await go(other, baseUrl, view);
      if (view === 'time') await timeFilters(other);
      else if (view === 'dashboard') {
        const summary = await period(other);
        assert.equal(summary.totals.hours, 3);
        await visibleText(other, 'Selected period:');
      } else await visibleText(other, view === 'rates' ? 'No rate records match' : 'No active baselines overlap');
      await absent(other, [memberName, client, work, 'PR10E9 baseline', 'PR10E9 mobile correction']);
    }
    const viewer = await session(actors.viewer);
    await visibleText(viewer, 'Read-only access. Changes require project editing access.');
    await visibleText(viewer, `${work} · 8.00h · due ${dates.sunday}`, `${PANEL} ul`);
    for (const editor of ['Roster details', 'Assignment details']) {
      const enabled = await viewer.$$eval(`${form(editor)} input, ${form(editor)} select, ${form(editor)} button`,
        (controls) => controls.filter((el) => !el.matches(':disabled')).length);
      assert.equal(enabled, 0, `${editor}: analyst cannot mutate`);
    }
    await absent(viewer, foreign);
    for (const view of ['rates', 'scope', 'time']) {
      await go(viewer, baseUrl, view);
      await visibleText(viewer, 'Access denied.', `${PANEL} [role="alert"]`);
      assert.equal(await viewer.$(`${PANEL} form`), null, `${view}: restricted editor/filter absent`);
      assert.equal(await viewer.$(`${PANEL} table`), null, `${view}: financial history absent`);
      await absent(viewer, [memberName, client, work, ...foreign]);
    }
    await go(viewer, baseUrl, 'dashboard');
    await visibleText(viewer, 'Data unavailable:', `${PANEL} [role="alert"]`);
    await visibleText(viewer, 'Selected period:');
    await metric(viewer, 'Logged time', 'Unavailable');
    await metric(viewer, 'Margin', 'Unavailable');
    await absent(viewer, [client, work, ...foreign]);
    const before = await snapshot();
    await probe(viewer, 'POST', '/api/capacity/members',
      { member_name: 'PR10E9 forbidden', role: 'strategist', weekly_hours: 40, allocated_hours: 0 }, 403);
    await probe(viewer, 'POST', '/api/agency-ops/time-entries',
      { member_id: memberId, client_ref: client, work_item: work, work_date: dates.monday, hours: 1 }, 403);
    assert.deepEqual(await snapshot(), before, 'analyst denials leave persisted rows unchanged');
  });
  await t.test('invalid cookie and foreign IDs deny writes without changing either tenant', async () => {
    const before = await snapshot();
    const invalid = await guardedPage(null);
    await invalid.browserContext().setCookie({ name: 'infogenie.sid', value: 's:pr10e9-invalid.signature',
      domain: origin.hostname, path: '/', httpOnly: true, sameSite: 'Lax' });
    await drainAudits(invalid);
    await invalid.goto(baseUrl + '/login', { waitUntil: 'networkidle2' });
    await visibleText(invalid, 'Welcome back', 'body');
    const unauthenticated = await probe(invalid, 'GET', '/api/auth/me');
    assert.equal(unauthenticated.authenticated, false);
    assert.equal(unauthenticated.user, null);
    const body = { member_id: memberId, client_ref: client, project_ref: 'launch',
      work_item: work, work_date: dates.monday, hours: 1, billable: true };
    await probe(invalid, 'POST', '/api/agency-ops/time-entries', body, 401);
    const rejectedMember = await probe(owner, 'POST', '/api/agency-ops/time-entries',
      { ...body, member_id: foreignId, tenant_id: actors.other.tid }, 400);
    assert.equal(rejectedMember.error, 'member_id must belong to this tenant capacity roster');
    const rejectedEntry = await probe(other, 'PATCH', `/api/agency-ops/time-entries/${entryId}`,
      { hours: 12, tenant_id: actors.owner.tid }, 404);
    assert.equal(rejectedEntry.error, 'time entry not found');
    const filtered = await probe(owner, 'GET', `/api/agency-ops/time-entries?from=${dates.monday}&to=${dates.sunday}` +
      `&member_id=${foreignId}&tenant_id=${actors.other.tid}`);
    assert.deepEqual(filtered.entries, [], 'foreign member filter cannot reveal the other tenant');
    assert.deepEqual(await snapshot(), before, 'all denied writes preserve both tenants');
    await go(owner, baseUrl, 'time');
    await timeFilters(owner);
    await absent(owner, foreign);
  });
  await t.test('narrow read fault: visible loading, withheld failed totals and real recovery', async () => {
    await go(owner, baseUrl, 'dashboard');
    await dashboard(owner);
    let seen;
    const intercepted = new Promise((resolve) => { seen = resolve; });
    fault = { page: owner, path: '/api/agency-ops/summary', mode: 'hold', seen };
    await button(owner, 'Refresh', form('Reporting period'));
    await intercepted;
    await visibleText(owner, 'Loading Agency Operations data…', `${PANEL} [role="status"]`);
    assert.equal(await owner.$eval(`${form('Reporting period')} button`, (el) => el.disabled), true);
    fault.mode = 'fail';
    for (const request of held) {
      await request.respond({ status: 503, contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'PR10E9 deliberate read failure' }) });
    }
    held.clear();
    await visibleText(owner, 'PR10E9 deliberate read failure', `${PANEL} [role="alert"]`);
    await metric(owner, 'Logged time', 'Unavailable');
    await metric(owner, 'Margin', 'Unavailable');
    fault = null;
    await dashboard(owner);
  });
});
