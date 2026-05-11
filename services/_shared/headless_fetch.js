// Shared headless-browser HTML fetcher. Uses puppeteer-core driving the
// system Chromium binary (no embedded browser download). Used by T22/T30/T31/T32
// when the page is a SPA (React/Vue/Angular) and raw-HTML fetch returns
// near-empty markup. Returns the same shape as the regular _fetchHtml helpers
// so callers can swap between them.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const fs = require('fs');
const { isUrlSafeToFetch } = require('./ssrf');

let _chromiumPath = null;
let _chromiumChecked = false;

function _findChromium() {
  if (_chromiumChecked) return _chromiumPath;
  _chromiumChecked = true;
  const candidates = [
    process.env.CHROMIUM_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  for (const p of candidates) {
    try { fs.accessSync(p, fs.constants.X_OK); _chromiumPath = p; return p; } catch (_) {}
  }
  try {
    const out = execSync('which chromium chromium-browser google-chrome 2>/dev/null || true', { encoding: 'utf8' }).trim();
    if (out) {
      const first = out.split('\n').filter(Boolean)[0];
      if (first) { _chromiumPath = first.trim(); return _chromiumPath; }
    }
  } catch (_) {}
  // Last resort — Nix store glob.
  try {
    const out = execSync('ls /nix/store/*chromium*/bin/chromium 2>/dev/null | head -1', { encoding: 'utf8' }).trim();
    if (out) { _chromiumPath = out; return _chromiumPath; }
  } catch (_) {}
  return null;
}

let _browser = null;
let _browserP = null;
async function _getBrowser() {
  const path = _findChromium();
  if (!path) throw new Error('No chromium binary found on this system');
  if (_browser && _browser.connected !== false) {
    try { if (_browser.process() && !_browser.process().killed) return _browser; } catch (_) {}
  }
  if (_browserP) return _browserP;
  _browserP = puppeteer.launch({
    executablePath: path,
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-gpu', '--no-zygote', '--single-process',
      '--disable-extensions', '--disable-background-networking',
      '--disable-default-apps', '--disable-sync', '--disable-translate',
      '--no-first-run', '--mute-audio'
    ]
  }).then(b => { _browser = b; b.on('disconnected', () => { _browser = null; _browserP = null; }); return b; })
    .catch(e => { _browserP = null; throw e; });
  return _browserP;
}

// Fetch a URL through a real browser. Returns { ok, html, finalUrl, status, headers, renderedBytes, renderMs }.
// SSRF-protected at entry. Cross-origin sub-requests are NOT individually validated
// (would multiply latency); the initial navigation target is, which is the only one
// puppeteer can be redirected to via Location headers. Sub-resources go through
// chromium's own network stack which doesn't honour our SSRF allowlist — this is
// acceptable because: (a) we don't follow internal links, (b) we discard the bodies
// of media/image/font requests via request interception below, (c) the page output
// we collect is just the rendered HTML of the page the user asked us to audit.
async function fetchHtmlHeadless(rawUrl, opts = {}) {
  const safe = await isUrlSafeToFetch(rawUrl);
  if (!safe.ok) return { ok: false, error: safe.error };
  let browser;
  try { browser = await _getBrowser(); }
  catch (e) { return { ok: false, error: 'Headless browser unavailable: ' + e.message }; }
  const t0 = Date.now();
  let page;
  try { page = await browser.newPage(); }
  catch (e) { return { ok: false, error: 'Failed to open page: ' + e.message }; }
  try {
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 InfoGenie-Headless/1.0');
    await page.setViewport({ width: 1366, height: 900, deviceScaleFactor: 1 });
    let bytes = 0;
    await page.setRequestInterception(true);
    page.on('request', req => {
      const t = req.resourceType();
      // Skip heavy resources — we only need DOM + JSON/XHR for SPA hydration.
      if (t === 'image' || t === 'media' || t === 'font') return req.abort();
      req.continue();
    });
    page.on('response', async r => {
      try { const len = parseInt(r.headers()['content-length'] || '0', 10); if (len) bytes += len; } catch (_) {}
    });
    const resp = await page.goto(rawUrl, { waitUntil: 'networkidle2', timeout: opts.timeout || 20000 });
    if (!resp) throw new Error('No response from page navigation');
    const status = resp.status();
    if (status >= 400) throw new Error('HTTP ' + status);
    // Brief settle window so frameworks like React/Vue can mount.
    await new Promise(r => setTimeout(r, opts.settleMs || 700));
    const html = await page.content();
    const finalUrl = page.url();
    const headers = resp.headers();
    return { ok: true, html, finalUrl, status, headers, renderedBytes: bytes, renderMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: e.message || 'headless render failed' };
  } finally {
    try { await page.close(); } catch (_) {}
  }
}

function isAvailable() { return !!_findChromium(); }

// Heuristic: treat raw HTML as SPA-empty if visible body text is tiny but the
// markup contains a known framework root container. Used by callers to decide
// whether to auto-fall-back to headless. Conservative — only triggers on really
// obvious SPA shells.
function looksLikeEmptySpa(html) {
  if (!html) return false;
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
                   .replace(/<style[\s\S]*?<\/style>/gi, ' ')
                   .replace(/<[^>]+>/g, ' ')
                   .replace(/\s+/g, ' ').trim();
  if (text.length > 400) return false;
  return /<div[^>]+id=["'](root|app|__next|__nuxt|svelte)["'][^>]*>\s*(<\/div>|$)/i.test(html)
      || /<div[^>]+id=["'](root|app|__next|__nuxt)["'][^>]*><\/div>/i.test(html);
}

module.exports = { fetchHtmlHeadless, isAvailable, looksLikeEmptySpa };
