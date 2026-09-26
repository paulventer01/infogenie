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
  const { baseUrl, actors, fx, db } = await startAgencyBrowser(t);
  await require('../../services/ai_governance/schema').ensureAiGovernanceSchema();
  const realOwner = await fx.seedUser({ tenantId: actors.owner.tid, owner: true });
  const loginActor = { owner: { email: realOwner.email, password: realOwner.password } };

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
  const passThroughApi = new Set([
    '/api/auth/login',
    '/api/auth/me',
    '/api/ai-governance/status',
    '/api/ai-governance/policy',
    '/api/ai-governance/audit',
  ]);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!['data:', 'blob:'].includes(url.protocol) && url.origin !== baseUrl) {
      void request.abort('blockedbyclient');
      return;
    }
    if (request.method() === 'GET' && url.pathname.startsWith('/api/') && !passThroughApi.has(url.pathname)) {
      void request.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'not_required_for_governance_browser_test' }),
      });
      return;
    }
    void request.continue();
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (msg.location().url.startsWith(baseUrl + '/api/safe-agent/approve/') &&
        /^Failed to load resource:.*\b(400|403|404|409|503)\b/.test(text)) return;
    if (msg.location().url.startsWith(baseUrl + '/api/marketing-brief/') &&
        /^Failed to load resource:.*\b(403|404|503)\b/.test(text)) return;
    // Delivery fixtures assert provider rejection (502) and concurrent-send refusal (409).
    // Allow only their exact delivery route; other resource and runtime errors remain failures.
    if (msg.location().url.startsWith(baseUrl) &&
        /^\/api\/marketing-brief\/[1-9]\d*\/deliver$/.test(msg.location().url.slice(baseUrl.length)) &&
        /^Failed to load resource:.*\b(409|502)\b/.test(text)) return;
    if (msg.location().url.startsWith(baseUrl) &&
        /^\/api\/ai-attack-plan(?:\/ap_\d+_[a-f0-9]{12})?$/.test(msg.location().url.slice(baseUrl.length)) &&
        /^Failed to load resource:.*\b(403|404)\b/.test(text)) return;
    if (msg.location().url === baseUrl + '/api/launch-compliance/checklists' &&
        /^Failed to load resource:.*\b(403|503)\b/.test(text)) return;
    if (msg.location().url.startsWith(baseUrl) &&
        /^\/api\/review-monitor\/request-rules(?:\/[1-9]\d*)?$/.test(msg.location().url.slice(baseUrl.length)) &&
        /^Failed to load resource:.*\b(403|404|409|503)\b/.test(text)) return;
    if ([baseUrl + '/api/landing-page', baseUrl + '/api/generate-seo-article'].includes(msg.location().url) &&
        /^Failed to load resource:.*\b(400|403|503)\b/.test(text)) return;
    if (msg.location().url === baseUrl + '/api/publish-to-wordpress' &&
        /^Failed to load resource:.*\b(403|429|502|503)\b/.test(text)) return;
    if (text.includes('ERR_BLOCKED_BY_CLIENT.Inspector')) return;
    if (msg.location().url === baseUrl + '/api/wordpress/publish' &&
        /^Failed to load resource:.*\b(403|404|503)\b/.test(text)) return;
    if (msg.location().url.startsWith(baseUrl + '/api/review-monitor/replies/') &&
        msg.location().url.endsWith('/approve') && /^Failed to load resource:.*\b(403|404|409|503)\b/.test(text)) return;
    errors.push(text);
  });

  await login(page, baseUrl, loginActor);
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

  await require('../helpers/wordpress-safety-browser')({page,baseUrl,actors,db});
  await require('../helpers/review-reply-approval-browser')({page,baseUrl,actors,db});
  await require('../helpers/safe-agent-approval-browser')({page,baseUrl,actors,db});

  await require('../helpers/marketing-brief-safety-browser')({page,baseUrl,actors,db});

  await require('../helpers/attack-plan-warning-browser')({page,baseUrl,actors,db,fx});
  await require('../helpers/launch-checklist-save-browser')({page,baseUrl,actors,db,fx});
  await require('../helpers/review-rule-save-browser')({page,baseUrl,actors,db,fx});

  await require('../helpers/wordpress-page-safety-browser')({page,baseUrl,actors,db,fx});

  await require('../helpers/generated-content-metadata-browser')({page,baseUrl,actors,db,fx});

  await context.close();
});
