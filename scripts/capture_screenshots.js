/* eslint-disable */
// Capture screenshots of every InfoGenie view using Puppeteer.
// View list is sourced from scripts/manual_data.js so it stays in sync with
// the user-manual builder.
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { VIEWS } = require('./manual_data');

const BASE = process.env.SCREENSHOT_BASE || 'http://localhost:5000';
const OUT_DIR = path.join(__dirname, '..', 'attached_assets', 'manual_screenshots');

function findChromium() {
  // Try a few likely locations; fall back to puppeteer's bundled binary.
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/nix/store/khk7xpgsm5insk81azy9d560yq4npf77-chromium-131.0.6778.204/bin/chromium',
  ].filter(Boolean);
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch (_) {} }
  // Try /nix/store/*chromium*
  try {
    const dirs = fs.readdirSync('/nix/store').filter(n => /chromium-\d/.test(n));
    for (const d of dirs) {
      const p = path.join('/nix/store', d, 'bin', 'chromium');
      if (fs.existsSync(p)) return p;
    }
  } catch (_) {}
  return null;
}

function launchBrowser() {
  const opts = {
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  };
  const exe = findChromium();
  if (exe) opts.executablePath = exe;
  return puppeteer.launch(opts);
}

async function captureOne(browser, v) {
  let page;
  try {
    page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    const url = v.id === 'home' ? BASE + '/' : `${BASE}/view/${v.id}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
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
  const skipExistingArg = process.argv.includes('--skip-existing');
  let targets = VIEWS;
  if (onlyArg) {
    const ids = onlyArg.split('=')[1].split(',');
    targets = VIEWS.filter(v => ids.includes(v.id));
  }
  if (skipExistingArg) {
    targets = targets.filter(v => !fs.existsSync(path.join(OUT_DIR, v.file)));
    console.log(`Skipping existing — ${targets.length} remaining`);
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
