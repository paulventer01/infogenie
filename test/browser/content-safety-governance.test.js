'use strict';
// PR10H.1 — real Chromium browser acceptance for AI Governance Hub content safety UI.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const dedicatedUrl = process.env.PR10E9_TEST_DATABASE_URL;
const required = process.env.PR10H1_REQUIRE_BROWSER === '1';
const GOVERNANCE_ROUTE = '/manage/ai-governance';

async function login(page, baseUrl, actors) {
  await page.goto(`${baseUrl}/login?next=${encodeURIComponent(GOVERNANCE_ROUTE)}`, { waitUntil: 'domcontentloaded' });
  await page.locator('#email').fill(actors.owner.email);
  await page.locator('#pass').fill(actors.owner.password);
  const [loginRes] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/auth/login'),
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.locator('form button[type="submit"]').click(),
  ]);
  assert.equal(loginRes.status(), 200);
}

test('PR10H.1 AI Governance Hub content safety browser acceptance', {
  skip: !dedicatedUrl && !required ? 'optional local run: no PR10E9_TEST_DATABASE_URL' : false,
  timeout: 600_000,
}, async (t) => {
  assert.ok(dedicatedUrl, 'PR10E9_TEST_DATABASE_URL is required when PR10H1_REQUIRE_BROWSER=1');

  const errors = [];
  let browser;
  t.after(async () => {
    if (browser) await browser.close();
    assert.deepEqual(errors, [], 'no browser errors');
  });

  const { startAgencyBrowser } = require('../helpers/agency-browser');
  const { baseUrl, actors } = await startAgencyBrowser(t);
  await require('../../services/ai_governance/schema').ensureAiGovernanceSchema();

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
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await login(page, baseUrl, actors);
  await page.waitForFunction(
    () => window.location.pathname.includes('ai-governance'),
    { timeout: 90_000 },
  );

  await page.waitForFunction(
    () => document.body?.innerText?.includes('Content safety: Enforce'),
    { timeout: 90_000 },
  );
  const bannerText = await page.evaluate(() => document.body.innerText);
  assert.match(bannerText, /Content safety: Enforce/i);
  assert.match(bannerText, /AI Governance Hub/i);

  const statusPayload = await page.evaluate(async () => {
    const r = await fetch('/api/ai-governance/status', { credentials: 'include' });
    return r.json();
  });
  assert.equal(statusPayload.content_safety_mode, 'enforce');
  assert.ok(statusPayload.banner);

  await context.close();
});
