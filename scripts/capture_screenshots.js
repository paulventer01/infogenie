/* eslint-disable */
// Capture screenshots of every InfoGenie view using Puppeteer.
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:5000';
const OUT_DIR = path.join(__dirname, '..', 'attached_assets', 'manual_screenshots');

const VIEWS = [
  { id: 'home',             file: 'home.jpg' },
  { id: 'dashboard',        file: 'dashboard.jpg' },
  { id: 'competitors',      file: 'competitors.jpg' },
  { id: 'intelligence',     file: 'intelligence.jpg' },
  { id: 'battleplan',       file: 'battleplan.jpg' },
  { id: 'reddit',           file: 'reddit.jpg' },
  { id: 'icp-studio',       file: 'icp-studio.jpg' },
  { id: 'intent-map',       file: 'intent-map.jpg' },
  { id: 'keyword-map',      file: 'keyword-map.jpg' },
  { id: 'serp',             file: 'serp.jpg' },
  { id: 'brand-assets',     file: 'brand-assets.jpg' },
  { id: 'creative',         file: 'creative.jpg' },
  { id: 'campaigns',        file: 'campaigns.jpg' },
  { id: 'content',          file: 'content.jpg' },
  { id: 'social',           file: 'social.jpg' },
  { id: 'audience',         file: 'audience.jpg' },
  { id: 'advertise',        file: 'advertise.jpg' },
  { id: 'autoseo',          file: 'autoseo.jpg' },
  { id: 'aivisibility',     file: 'aivisibility.jpg' },
  { id: 'ai-audit-suite',   file: 'ai-audit-suite.jpg' },
  { id: 'action-center',    file: 'action-center.jpg' },
  { id: 'kpi-tracker',      file: 'kpi-tracker.jpg' },
  { id: 'master-calendar',  file: 'master-calendar.jpg' },
  { id: 'results',          file: 'results.jpg' },
  { id: 'reengage',         file: 'reengage.jpg' },
  { id: 'automations',      file: 'automations.jpg' },
  { id: 'agency',           file: 'agency.jpg' },
  { id: 'csuite',           file: 'csuite.jpg' },
  { id: 'technical-suite',  file: 'technical-suite.jpg' },
  { id: 'settings',         file: 'settings.jpg' },
];

function launchBrowser() {
  return puppeteer.launch({
    headless: 'new',
    executablePath: '/nix/store/khk7xpgsm5insk81azy9d560yq4npf77-chromium-131.0.6778.204/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
}

async function captureOne(browser, v) {
  let page;
  try {
    page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    const url = v.id === 'home' ? BASE + '/' : `${BASE}/view/${v.id}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await new Promise(r => setTimeout(r, 1800));
    await page.evaluate(() => {
      ['landingPageModal', 'wpCredentialsModal'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
      document.querySelectorAll('.modal-overlay,.modal-backdrop,.toast,.notification-toast,[role="dialog"]')
        .forEach(el => { el.style.display = 'none'; });
      document.body.style.overflow = 'auto';
      window.scrollTo(0, 0);
    }).catch(() => {});
    await new Promise(r => setTimeout(r, 700));
    const out = path.join(OUT_DIR, v.file);
    await page.screenshot({ path: out, type: 'jpeg', quality: 80, fullPage: false });
    return true;
  } finally {
    if (page) {
      try { await page.close(); } catch (_) { /* ignore detached frame errors */ }
    }
  }
}

(async () => {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const onlyArg = process.argv.find(a => a.startsWith('--only='));
  let targets = VIEWS;
  if (onlyArg) {
    const ids = onlyArg.split('=')[1].split(',');
    targets = VIEWS.filter(v => ids.includes(v.id));
  }

  let browser = await launchBrowser();
  const ok = [];
  const fail = [];

  for (const v of targets) {
    let attempt = 0;
    let success = false;
    while (attempt < 2 && !success) {
      attempt++;
      try {
        await captureOne(browser, v);
        ok.push(v.id);
        console.log('✓', v.id);
        success = true;
      } catch (err) {
        console.error('✗', v.id, `(attempt ${attempt})`, '—', err.message);
        // If browser connection is broken, relaunch
        try {
          if (!browser.isConnected()) {
            console.log('  ↻ relaunching browser');
            try { await browser.close(); } catch (_) {}
            browser = await launchBrowser();
          }
        } catch (_) {
          try { await browser.close(); } catch (_) {}
          browser = await launchBrowser();
        }
      }
    }
    if (!success) fail.push(v.id);
  }

  try { await browser.close(); } catch (_) {}

  console.log(`\nDone. ${ok.length} ok, ${fail.length} failed.`);
  if (fail.length) console.log('Failed:', fail.join(', '));
  process.exit(fail.length ? 1 : 0);
})();
