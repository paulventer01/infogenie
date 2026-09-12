'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const dedicatedUrl = process.env.PR10E9_TEST_DATABASE_URL;
const required = process.env.PR10G3_REQUIRE_BROWSER === '1';
const PANEL = '#ig-react-panel';
const GOALS_ROUTE = '/grow/goals';
const OKR_ROUTE = '/manage/marketing-okr';

const goalsFixture = {
  ok: true,
  goals: [
    {
      id: 'g-zero',
      label: 'Available zero spend',
      metric: 'ads.totalSpend',
      target: 1000,
      current: 0,
      pct: 0,
      status: 'on-track',
      metric_availability: 'available',
      metric_availability_reason: null,
      metric_is_proxy: false,
      meta: { unit: '$', direction: 'lte' },
    },
    {
      id: 'g-unavail',
      label: 'Unavailable ROAS',
      metric: 'ads.blendedRoas',
      target: 2,
      current: null,
      pct: null,
      status: 'unknown',
      metric_availability: 'unavailable',
      metric_availability_reason: 'source_query_failed',
      metric_is_proxy: false,
      meta: { unit: 'x', direction: 'gte' },
    },
  ],
  rootCause: {},
};

const okrFixture = {
  ok: true,
  objectives: [{
    id: 'okr1',
    title: 'PR10G3 ROAS objective',
    description: 'browser fixture',
    quarter: '2026-Q1',
    owner_email: '',
    status: 'on_track',
    created_at: '2026-01-01T00:00:00.000Z',
    key_results: [{
      id: 'kr-partial',
      title: 'Partial ROAS KR',
      metric_type: 'roas',
      linked_channel: '',
      target_value: 2,
      current_value: 1.2,
      unit: 'x',
      updated_at: '2026-01-01T00:00:00.000Z',
      metric_availability: 'partial',
      metric_availability_reason: 'input_unavailable:offline',
      metric_is_proxy: true,
    }],
  }],
};

async function login(page, baseUrl, actors) {
  await page.goto(`${baseUrl}/login?next=${encodeURIComponent(GOALS_ROUTE)}`, { waitUntil: 'domcontentloaded' });
  await page.locator('#email').fill(actors.owner.email);
  await page.locator('#pass').fill(actors.owner.password);
  const [login] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/auth/login'),
    page.locator('form button[type="submit"]').click(),
  ]);
  assert.equal(login.status(), 200);
}

test('PR10G.3 goals and OKR availability browser acceptance', {
  skip: !dedicatedUrl && !required ? 'optional local run: no PR10E9_TEST_DATABASE_URL' : false,
  timeout: 600_000,
}, async (t) => {
  assert.ok(dedicatedUrl, 'PR10E9_TEST_DATABASE_URL is required');
  const errors = [];
  let browser;
  let closing = false;
  t.after(async () => {
    closing = true;
    if (browser) await browser.close();
    assert.deepEqual(errors, [], 'no browser errors');
  });

  const { startAgencyBrowser } = require('../helpers/agency-browser');
  const { baseUrl, actors } = await startAgencyBrowser(t);
  await require('../../services/okr/schema').ensureOkrSchema();

  browser = await require('puppeteer').launch({
    headless: true,
    pipe: true,
    args: ['--disable-dev-shm-usage', '--disable-background-networking', '--lang=en-US'],
  });
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  page.setDefaultNavigationTimeout(90_000);
  await page.setViewport({ width: 1440, height: 1050 });
  await page.setBypassServiceWorker(true);
  await page.setCacheEnabled(false);
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!['data:', 'blob:'].includes(url.protocol) && url.origin !== baseUrl) {
      void request.abort('blockedbyclient');
      return;
    }
    if (request.method() === 'GET' && url.pathname === '/api/goals/check') {
      void request.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(goalsFixture),
      });
      return;
    }
    if (request.method() === 'GET' && url.pathname === '/api/okr/objectives') {
      void request.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(okrFixture),
      });
      return;
    }
    if (request.method() === 'GET' && url.pathname === '/api/okr/quarters') {
      void request.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, quarters: ['2026-Q1'], current: '2026-Q1' }),
      });
      return;
    }
    void request.continue();
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if ((path.startsWith('/api/goals') || path.startsWith('/api/okr')) && response.status() >= 400) {
      errors.push(`${response.request().method()} ${path} ${response.status()}`);
    }
  });
  page.on('requestfailed', (request) => {
    if (!closing) {
      const path = new URL(request.url()).pathname;
      if (path.startsWith('/api/goals') || path.startsWith('/api/okr')) {
        errors.push(`request failed: ${request.url()}`);
      }
    }
  });

  await login(page, baseUrl, actors);
  await page.waitForSelector(`${PANEL}`, { visible: true });
  await page.waitForFunction((panel, zeroLabel) => {
    const el = document.querySelector(panel);
    return el?.innerText.includes(zeroLabel) && el.innerText.includes('$0');
  }, {}, PANEL, 'Available zero spend');
  const goalsText = await page.$eval(PANEL, (el) => el.innerText);
  assert.match(goalsText, /Unavailable \(source query failed\)/i);
  assert.match(goalsText, /Unverified/);
  assert.ok(!/\b0%\b/.test(goalsText.split('Unavailable ROAS')[1] || ''), 'unavailable goal must not show 0% progress');

  const reloadGoals = await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(reloadGoals?.status(), 200);
  await page.waitForFunction((panel) => document.querySelector(panel)?.innerText.includes('Available zero spend'), {}, PANEL);

  await page.goto(`${baseUrl}${OKR_ROUTE}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(`${PANEL}`, { visible: true });
  await page.waitForFunction((panel) => document.querySelector(panel)?.innerText.includes('PR10G3 ROAS objective'), {}, PANEL);
  await page.evaluate((panel, title) => {
    const root = document.querySelector(panel);
    const row = [...root.querySelectorAll('div')].find((el) => el.textContent?.includes(title) && el.style?.cursor === 'pointer');
    if (!row) throw new Error('objective row not found');
    row.click();
  }, PANEL, 'PR10G3 ROAS objective');
  const okrText = await page.$eval(PANEL, (el) => el.innerText);
  assert.match(okrText, /Partial/);
  assert.match(okrText, /PROXY/);
  assert.match(okrText, /\(Partial\)/);

  const reloadOkr = await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(reloadOkr?.status(), 200);
  await page.waitForFunction((panel) => document.querySelector(panel)?.innerText.includes('PR10G3 ROAS objective'), {}, PANEL);
  await page.evaluate((panel, title) => {
    const root = document.querySelector(panel);
    const row = [...root.querySelectorAll('div')].find((el) => el.textContent?.includes(title) && el.style?.cursor === 'pointer');
    if (!row) throw new Error('objective row not found after reload');
    row.click();
  }, PANEL, 'PR10G3 ROAS objective');
  await page.waitForFunction((panel) => document.querySelector(panel)?.innerText.includes('Partial ROAS KR'), {}, PANEL);
});
