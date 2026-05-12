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
    // Pre-seed an auth session in localStorage BEFORE any app script runs,
    // so the auth wall is skipped entirely.
    await page.evaluateOnNewDocument(() => {
      try {
        const email = 'manual@infogenie.local';
        let h = 0; const pw = 'manual1234';
        for (let i = 0; i < pw.length; i++) { h = ((h<<5)-h) + pw.charCodeAt(i); h |= 0; }
        const users = [{ name: 'Manual', email, pw: h, createdAt: new Date().toISOString() }];
        localStorage.setItem('ig-users', JSON.stringify(users));
        localStorage.setItem('ig-current-user', email);
      } catch (_) {}
    });
    // Always load the SPA shell at root — the server doesn't have /view/:id routes;
    // navigation must happen client-side via navigateTo().
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 25000 });
    // Belt-and-braces: remove the auth wall if it managed to render.
    await page.evaluate(() => {
      const w = document.getElementById('igAuthWall');
      if (w) w.remove();
    }).catch(() => {});
    // Wait for the SPA to boot (navigateTo must exist).
    await page.waitForFunction(
      () => typeof window.navigateTo === 'function',
      { timeout: 20000 }
    );
    // Some views (Battle Plan, Dashboard, Competitors, Intelligence) render an
    // empty "No Analysis Yet" state unless `analysisData` is populated. Seed a
    // realistic skeleton up-front so the views render their full UI for the
    // manual screenshots — this is the same shape `analyseDomain()` produces.
    const NEEDS_ANALYSIS = new Set([
      'battleplan', 'dashboard', 'competitors', 'intelligence',
      'battle-cards', 'sov-tracker', 'crisis-radar',
    ]);
    if (NEEDS_ANALYSIS.has(v.id)) {
      await page.evaluate(() => {
        try {
          const seed = {
            url: 'yourdomain.com',
            country: 'us',
            industryKey: 'saas',
            industry: { name: 'SaaS' },
            sectorOnly: false,
            websiteKPIs: { ctr: 2.4, roas: 3.8, traffic: 18400, conv: 3.1 },
            competitors: [
              {
                name: 'Acme Rivals', logo: 'A', threatLevel: 'high',
                topChannel: 'Google Ads', trafficMo: 245000,
                topKeywords: ['acme alternative', 'best saas tool', 'vs acme', 'top rated saas', 'acme pricing', 'acme review'],
                campaigns: [
                  { name: 'Branded Search', budget: 4200, status: 'active' },
                  { name: 'Competitor Conquest', budget: 2800, status: 'active' },
                ],
                audiences: [
                  { label: 'High-Intent Buyers', pct: 38 },
                  { label: 'Decision Makers', pct: 24 },
                  { label: 'Mid-Market Segment', pct: 22 },
                ],
                suggestions: [
                  'Weak personalisation in search ad copy',
                  'Generic creative with low audience specificity',
                  'No TikTok or Reels presence',
                  'Over-indexed on branded keywords',
                ],
                adCopy: [
                  'Switch to Acme — 30% off your first year',
                  'The #1 SaaS for growing teams',
                ],
              },
              {
                name: 'BetaCorp', logo: 'B', threatLevel: 'medium',
                topChannel: 'LinkedIn Ads', trafficMo: 128000,
                topKeywords: ['betacorp pricing', 'betacorp review', 'enterprise saas'],
                campaigns: [{ name: 'Webinar Funnel', budget: 1800, status: 'active' }],
                audiences: [{ label: 'Enterprise IT', pct: 41 }],
                suggestions: ['Slow page load on landing pages', 'No live chat after 5pm'],
                adCopy: ['Enterprise-grade SaaS, built for scale'],
              },
              {
                name: 'GammaSoft', logo: 'G', threatLevel: 'low',
                topChannel: 'Meta Ads', trafficMo: 64000,
                topKeywords: ['gammasoft alternative', 'cheap saas'],
                campaigns: [{ name: 'Retargeting', budget: 900, status: 'active' }],
                audiences: [{ label: 'Cost-Conscious SMB', pct: 33 }],
                suggestions: ['Outdated brand visuals', 'Limited integrations'],
                adCopy: ['SaaS that just works'],
              },
            ],
          };
          window.analysisData = seed;
          try { /* mirror to module-scoped var if exposed */ if (typeof analysisData !== 'undefined') analysisData = seed; } catch (_) {}
        } catch (_) {}
      }).catch(() => {});
    }

    // Trigger client-side navigation to the target view, unless it's home.
    if (v.id !== 'home') {
      await page.evaluate((id) => {
        try { window.navigateTo(id); } catch (_) {}
      }, v.id);
    }
    // Give the view time to render (build* functions, charts, async fetches).
    await new Promise(r => setTimeout(r, 900));
    // For Battle Plan specifically, force a re-render after navigation in case
    // the first render fired before the seed was readable in scope.
    if (v.id === 'battleplan') {
      await page.evaluate(() => {
        try { if (typeof window.buildBattlePlan === 'function') window.buildBattlePlan(); } catch (_) {}
      }).catch(() => {});
      await new Promise(r => setTimeout(r, 600));
    }
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
    // Confirm the target view container is actually visible before shooting.
    if (v.id !== 'home') {
      await page.waitForFunction(
        (id) => {
          const el = document.getElementById('view-' + id);
          if (!el) return true; // some views may not have view-<id> wrapper
          return el.classList.contains('active') || el.style.display === 'block';
        },
        { timeout: 6000 },
        v.id
      ).catch(() => {});
    }
    await new Promise(r => setTimeout(r, 600));
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
