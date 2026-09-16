'use strict';

const assert = require('node:assert/strict');

const PANEL = '#ig-react-panel';

async function waitForLoginForm(page, timeout = 90_000) {
  await page.waitForSelector('#email', { visible: true, timeout });
  await page.waitForSelector('#pass', { visible: true, timeout });
  await page.waitForSelector('form button[type="submit"]', { visible: true, timeout });
}

async function agencyBrowserLogin(page, baseUrl, actors, opts = {}) {
  const next = opts.next || '/grow/goals';
  const timeout = opts.timeout || 90_000;
  const waitForPanel = opts.waitForPanel !== false;
  await page.goto(`${baseUrl}/login?next=${encodeURIComponent(next)}`, {
    waitUntil: 'domcontentloaded',
    timeout,
  });
  await waitForLoginForm(page, timeout);
  await page.locator('#email').fill(actors.owner.email);
  await page.locator('#pass').fill(actors.owner.password);
  const [login] = await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/auth/login',
      { timeout },
    ),
    page.locator('form button[type="submit"]').click(),
  ]);
  assert.equal(login.status(), 200);
  if (waitForPanel) {
    await page.waitForSelector(PANEL, { visible: true, timeout });
  }
}

function wireBrowserDiagnostics(page, bucket) {
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      bucket.console.push(`${msg.type()}: ${msg.text()}`);
    }
  });
  page.on('pageerror', (error) => bucket.pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    bucket.requestFailed.push(`${request.failure()?.errorText || 'failed'} ${request.url()}`);
  });
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith('/api/') && response.status() >= 400) {
      bucket.httpErrors.push(`${response.request().method()} ${path} ${response.status()}`);
    }
  });
}

async function dumpBrowserFailureState(page, bucket, label) {
  const panelText = await page.$eval(PANEL, (el) => el.innerText).catch(() => null);
  const bodySnippet = await page.evaluate(() => document.body?.innerText?.slice(0, 2500) || '').catch(() => '');
  console.error(`[${label}] browser failure state`, JSON.stringify({
    url: page.url(),
    panelText,
    bodySnippet,
    ...bucket,
  }, null, 2));
}

module.exports = {
  PANEL,
  waitForLoginForm,
  agencyBrowserLogin,
  wireBrowserDiagnostics,
  dumpBrowserFailureState,
};
