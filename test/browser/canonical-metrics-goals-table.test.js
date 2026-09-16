'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const dedicatedUrl = process.env.PR10E9_TEST_DATABASE_URL;
const required = process.env.PR10G7_REQUIRE_BROWSER === '1' || process.env.PR10G8_REQUIRE_BROWSER === '1';
const {
  PANEL,
  agencyBrowserLogin,
  wireBrowserDiagnostics,
  dumpBrowserFailureState,
} = require('../helpers/agency-browser-login');
const CANONICAL_ROUTE = '/manage/canonical-metrics';

const canonicalFixture = {
  ok: true,
  days: 30,
  spend: 1000,
  blended_roas: 2.5,
  true_roas: 2.8,
  cac: 42,
  waste_cents: 0,
  spend_by_channel: { meta: 1000 },
  kpis: [
    { key: 'spend', label: 'Spend', value: 1000, unit: '$', availability: 'available' },
  ],
  goals_vs_actuals: [
    {
      source: 'okr',
      label: 'Channel objective · Meta ROAS',
      metric: 'roas',
      linked_channel: 'Meta',
      target: 2,
      actual: 1.5,
      unit: 'x',
      pct: 75,
      status: 'unverified',
      measurement_source: 'stored',
      unverified_reason: 'unsupported_scope',
    },
    {
      source: 'okr',
      label: 'Completed objective · ROAS',
      metric: 'roas',
      linked_channel: '',
      target: 2,
      actual: 2.5,
      unit: 'x',
      pct: 100,
      status: 'complete',
      objective_status: 'complete',
      measurement_source: 'stored',
      measurement_period_label: '2026-Q2',
    },
    {
      source: 'okr',
      label: 'QTD objective · Spend',
      metric: 'spend',
      linked_channel: '',
      target: 1000,
      actual: 420,
      unit: '$',
      pct: 42,
      status: 'at-risk',
      measurement_source: 'canonical',
      measurement_period_label: '2026-Q2 (quarter-to-date through 2026-06-15)',
      from_canonical: true,
      metric_availability: 'available',
    },
    {
      source: 'growth_goals',
      label: 'Spend cap',
      metric: 'ads.totalSpend',
      target: 2000,
      actual: null,
      unit: '$',
      status: 'unverified',
      unverified_reason: 'period_mismatch',
      metric_availability: 'unavailable',
      metric_availability_reason: 'period_mismatch',
    },
  ],
  pacing: null,
  daily: [],
  provenance: [],
  definition_version: '2026.09.1',
};

test('PR10G.8 canonical metrics goals vs actuals table browser acceptance', {
  skip: !dedicatedUrl && !required ? 'optional local run: no PR10E9_TEST_DATABASE_URL' : false,
  timeout: 600_000,
}, async (t) => {
  assert.ok(dedicatedUrl, 'PR10E9_TEST_DATABASE_URL is required');
  const errors = [];
  const diagnostics = { console: [], pageErrors: [], requestFailed: [], httpErrors: [] };
  let browser;
  let page;
  let closing = false;
  t.after(async () => {
    closing = true;
    if (browser) await browser.close();
    assert.deepEqual(errors, [], 'no browser errors');
  });

  const { startAgencyBrowser } = require('../helpers/agency-browser');
  const { baseUrl, actors } = await startAgencyBrowser(t);

  browser = await require('puppeteer').launch({
    headless: true,
    pipe: true,
    args: ['--disable-dev-shm-usage', '--disable-background-networking', '--lang=en-US'],
  });
  const context = await browser.createBrowserContext();
  page = await context.newPage();
  page.setDefaultTimeout(45_000);
  page.setDefaultNavigationTimeout(90_000);
  wireBrowserDiagnostics(page, diagnostics);
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
    if (request.method() === 'GET' && url.pathname === '/api/metrics/canonical') {
      void request.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(canonicalFixture),
      });
      return;
    }
    void request.continue();
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith('/api/metrics/canonical') && response.status() >= 400) {
      errors.push(`${response.request().method()} ${path} ${response.status()}`);
    }
  });
  page.on('requestfailed', (request) => {
    if (!closing) {
      const path = new URL(request.url()).pathname;
      if (path.startsWith('/api/metrics/canonical')) {
        errors.push(`request failed: ${request.url()}`);
      }
    }
  });

  try {
    await agencyBrowserLogin(page, baseUrl, actors, { next: '/grow/goals' });
    const nav = await page.goto(`${baseUrl}${CANONICAL_ROUTE}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    assert.ok(nav && nav.status() < 400, `canonical-metrics navigation failed: ${nav?.status()}`);
    await page.waitForFunction(
      (panel) => document.querySelector(panel)?.innerText.includes('Goals vs actuals'),
      { timeout: 90_000 },
      PANEL,
    );

    const text = await page.$eval(PANEL, (el) => el.innerText);
    assert.match(text, /Meta ROAS/);
    assert.match(text, /1\.5x \(stored\)/);
    assert.match(text, /unverified \(stored\)/);
    assert.doesNotMatch(text, /unverified \(stored\).*partial/i);
    assert.match(text, /complete/);
    assert.match(text, /period mismatch/i);
    assert.match(text, /Spend cap/);
    assert.match(text, /quarter-to-date through 2026-06-15/);
    assert.match(text, /2026-Q2/);
    assert.doesNotMatch(text, /Last 30 days \(rolling\)/i);
  } catch (error) {
    await dumpBrowserFailureState(page, diagnostics, 'PR10G.8');
    throw error;
  }
});
