const express = require('express');
const router = express.Router();
const _https = require('https');
const _http = require('http');
const _db = require('../../db');
const { isUrlSafeToFetch } = require('../_shared/ssrf');
const _headless = require('../_shared/headless_fetch');

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safeAsync(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch(e => {
    console.warn('[seo-auditor]', e.stack || e.message);
    if (!res.headersSent) _err(res, 500, 'Internal server error');
  });
}

// Fetch HTML with redirect support, 10s timeout, 2MB cap, real browser UA.
// SSRF-safe: every redirect target is re-validated through isUrlSafeToFetch
// (DNS-resolves + rejects private/internal IPs) before the next hop is requested.
function _fetchHtml(rawUrl, redirects = 0) {
  return new Promise(async resolve => {
    if (redirects > 5) return resolve({ ok: false, error: 'Too many redirects' });
    // Re-validate every hop. The initial caller also validates, but that's defence-in-depth.
    const safe = await isUrlSafeToFetch(rawUrl);
    if (!safe.ok) return resolve({ ok: false, error: 'Blocked redirect target — ' + safe.error });
    let u;
    try { u = new URL(rawUrl); } catch { return resolve({ ok: false, error: 'Invalid URL' }); }
    const lib = u.protocol === 'https:' ? _https : _http;
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    }, r => {
      // Redirect — recurse, which will re-validate the next URL via isUrlSafeToFetch.
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        const next = new URL(r.headers.location, rawUrl).toString();
        r.resume();
        return resolve(_fetchHtml(next, redirects + 1));
      }
      if (r.statusCode >= 400) {
        r.resume();
        return resolve({ ok: false, error: `HTTP ${r.statusCode} from server` });
      }
      const chunks = [];
      let total = 0;
      r.on('data', c => {
        total += c.length;
        if (total > 2 * 1024 * 1024) { r.destroy(); return resolve({ ok: false, error: 'Response too large (>2MB)' }); }
        chunks.push(c);
      });
      r.on('end', () => resolve({ ok: true, html: Buffer.concat(chunks).toString('utf8'), finalUrl: rawUrl, status: r.statusCode, headers: r.headers || {} }));
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ ok: false, error: 'Timeout (10s)' }); });
    req.end();
  });
}

// Simple HEAD probe for robots.txt / sitemap.xml. SSRF-safe: re-validates target
// via isUrlSafeToFetch before any network I/O. Refuses redirects (probe should
// be a single hop on a known root domain).
function _probe(rawUrl) {
  return new Promise(async resolve => {
    const safe = await isUrlSafeToFetch(rawUrl);
    if (!safe.ok) return resolve(false);
    let u;
    try { u = new URL(rawUrl); } catch { return resolve(false); }
    const lib = u.protocol === 'https:' ? _https : _http;
    const req = lib.request({ hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname, method: 'HEAD',
      headers: { 'User-Agent': 'Mozilla/5.0 InfoGenie SEO Auditor' } }, r => {
      r.resume();
      // 2xx only — refuse to follow probe redirects (could re-target an internal host).
      resolve(r.statusCode >= 200 && r.statusCode < 300);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(4000, () => { req.destroy(); resolve(false); });
    req.end();
  });
}

// Tiny regex-based parser. Cheap, no deps. Good enough for hygiene checks.
function _parseAndScore(html, finalUrl, headers = {}) {
  const lower = html.toLowerCase();
  const checks = [];
  const C = (id, label, status, weight, message, fix) => checks.push({ id, label, status, weight, earned: status === 'pass' ? weight : status === 'warn' ? Math.floor(weight / 2) : 0, message, fix });
  // Lowercase header keys (Node delivers them lowercased already, but be defensive).
  const H = {}; for (const k of Object.keys(headers || {})) H[k.toLowerCase()] = headers[k];

  // 1. HTTPS
  const isHttps = finalUrl.startsWith('https:');
  C('https', 'HTTPS', isHttps ? 'pass' : 'fail', 10,
    isHttps ? 'Page served over HTTPS.' : 'Page served over plain HTTP.',
    'Install a TLS certificate (Let\'s Encrypt is free) and force redirects to https://.');

  // 2. <title>
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';
  let titleStatus = 'fail', titleMsg = 'No <title> tag found.';
  if (title) {
    if (title.length >= 30 && title.length <= 60) { titleStatus = 'pass'; titleMsg = `Title (${title.length} chars): "${title.slice(0, 80)}"`; }
    else if (title.length >= 20 && title.length <= 70) { titleStatus = 'warn'; titleMsg = `Title length ${title.length} chars (ideal 30-60): "${title.slice(0, 80)}"`; }
    else { titleStatus = 'warn'; titleMsg = `Title is ${title.length} chars — ${title.length < 20 ? 'too short' : 'too long, will get truncated in SERPs'}.`; }
  }
  C('title', 'Title tag (30-60 chars)', titleStatus, 8, titleMsg, 'Write a unique 30-60 character title containing your primary keyword and brand.');

  // 3. Meta description
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
                 || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  const desc = descMatch ? descMatch[1].trim() : '';
  let descStatus = 'fail', descMsg = 'No meta description found.';
  if (desc) {
    if (desc.length >= 70 && desc.length <= 160) { descStatus = 'pass'; descMsg = `Meta description (${desc.length} chars).`; }
    else if (desc.length >= 50 && desc.length <= 200) { descStatus = 'warn'; descMsg = `Meta description ${desc.length} chars (ideal 70-160).`; }
    else { descStatus = 'warn'; descMsg = `Meta description ${desc.length} chars — ${desc.length < 50 ? 'too short' : 'too long, will be truncated'}.`; }
  }
  C('meta_description', 'Meta description (70-160 chars)', descStatus, 8, descMsg, 'Add a 70-160 character meta description with a clear value proposition and call to action.');

  // 4. Single <h1>
  const h1s = html.match(/<h1[^>]*>[\s\S]*?<\/h1>/gi) || [];
  let h1Status = 'fail', h1Msg = 'No <h1> tag found.';
  if (h1s.length === 1) { h1Status = 'pass'; h1Msg = 'Exactly one <h1> on page.'; }
  else if (h1s.length > 1) { h1Status = 'warn'; h1Msg = `${h1s.length} <h1> tags — should be exactly one.`; }
  C('h1', 'Single H1 heading', h1Status, 6, h1Msg, 'Use exactly one <h1> per page describing the page topic. Use h2-h6 for subsections.');

  // 5. Viewport
  const hasViewport = /<meta[^>]+name=["']viewport["']/i.test(html);
  C('viewport', 'Mobile viewport meta', hasViewport ? 'pass' : 'fail', 6,
    hasViewport ? 'Viewport meta present.' : 'No <meta name="viewport"> tag — page may not render correctly on mobile.',
    'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to <head>.');

  // 6. lang attribute
  const langMatch = html.match(/<html[^>]+lang=["']([^"']+)["']/i);
  C('lang', 'HTML lang attribute', langMatch ? 'pass' : 'warn', 3,
    langMatch ? `lang="${langMatch[1]}"` : 'No lang attribute on <html>.',
    'Add lang="en" (or your locale) to <html> for accessibility & search engines.');

  // 7. Canonical
  const canon = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
  C('canonical', 'Canonical URL', canon ? 'pass' : 'warn', 5,
    canon ? `Canonical: ${canon[1]}` : 'No <link rel="canonical"> found.',
    'Add <link rel="canonical" href="https://yoursite.com/this-page"> to prevent duplicate-content issues.');

  // 8. Open Graph
  const ogTitle = /property=["']og:title["']/i.test(html);
  const ogDesc = /property=["']og:description["']/i.test(html);
  const ogImg = /property=["']og:image["']/i.test(html);
  const ogCount = (ogTitle ? 1 : 0) + (ogDesc ? 1 : 0) + (ogImg ? 1 : 0);
  let ogStatus = ogCount === 3 ? 'pass' : ogCount >= 1 ? 'warn' : 'fail';
  C('og', 'Open Graph tags (og:title/description/image)', ogStatus, 6,
    `${ogCount}/3 OG tags present.`,
    'Add og:title, og:description and og:image so social shares look good.');

  // 9. Twitter Card
  const twCard = /name=["']twitter:card["']/i.test(html);
  C('twitter', 'Twitter Card', twCard ? 'pass' : 'warn', 3,
    twCard ? 'Twitter Card present.' : 'No twitter:card meta tag.',
    'Add <meta name="twitter:card" content="summary_large_image"> for prettier tweet previews.');

  // 10. JSON-LD schema.org
  const jsonLd = /<script[^>]+type=["']application\/ld\+json["']/i.test(html);
  C('schema', 'Schema.org JSON-LD', jsonLd ? 'pass' : 'warn', 5,
    jsonLd ? 'JSON-LD structured data present.' : 'No structured data — missing rich-result eligibility.',
    'Add JSON-LD for Organization, WebPage, Article or Product as appropriate.');

  // 11. Image alt text
  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  const imgsWithAlt = imgs.filter(t => /\balt\s*=\s*["'][^"']+["']/i.test(t));
  let altStatus = 'pass', altMsg = `0 images on page.`;
  if (imgs.length > 0) {
    const ratio = imgsWithAlt.length / imgs.length;
    altMsg = `${imgsWithAlt.length}/${imgs.length} images have descriptive alt text.`;
    if (ratio === 1) altStatus = 'pass';
    else if (ratio >= 0.7) altStatus = 'warn';
    else altStatus = 'fail';
  }
  C('alt_text', 'Image alt text', altStatus, 8, altMsg,
    'Add descriptive alt="" to every <img>. Decorative images can use alt="".');

  // 12. Robots noindex
  const noindex = /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(html);
  C('noindex', 'Not blocked by noindex', noindex ? 'fail' : 'pass', 5,
    noindex ? '⚠ Page has noindex meta — Google will NOT show this page.' : 'No noindex blocker.',
    'If this page should rank, remove the noindex meta tag.');

  // 13. Favicon
  const hasFavicon = /<link[^>]+rel=["'][^"']*icon[^"']*["']/i.test(html);
  C('favicon', 'Favicon', hasFavicon ? 'pass' : 'warn', 2,
    hasFavicon ? 'Favicon link present.' : 'No favicon — looks unfinished in browser tabs.',
    'Add <link rel="icon" type="image/png" href="/favicon.png">');

  // 14. Word count
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const words = text ? text.split(/\s+/).length : 0;
  let wordStatus = 'fail', wordMsg = `${words} visible words — too thin to rank.`;
  if (words >= 600) { wordStatus = 'pass'; wordMsg = `${words} visible words.`; }
  else if (words >= 300) { wordStatus = 'warn'; wordMsg = `${words} visible words — pages with 600+ words tend to rank better.`; }
  C('content_length', 'Content length (≥300 words)', wordStatus, 4, wordMsg,
    'Aim for 600+ words of unique, useful content per page.');

  // 15. Internal links
  let originHost = '';
  try { originHost = new URL(finalUrl).hostname; } catch (_) {}
  const links = html.match(/<a\b[^>]+href=["']([^"']+)["']/gi) || [];
  const internalLinks = links.filter(a => {
    const m = a.match(/href=["']([^"']+)["']/i); if (!m) return false;
    const href = m[1];
    if (href.startsWith('/') || href.startsWith('#')) return true;
    try { return new URL(href).hostname === originHost; } catch { return false; }
  });
  C('internal_links', 'Internal links', internalLinks.length >= 3 ? 'pass' : 'warn', 3,
    `${internalLinks.length} internal links on page.`,
    'Add 3+ internal links to related pages so crawlers can discover them.');

  // 16. Mixed content (https page loading http resources)
  let mixedStatus = 'pass', mixedMsg = 'No mixed content.';
  if (isHttps) {
    const httpResources = (html.match(/(?:src|href)=["']http:\/\/[^"']+["']/gi) || []).length;
    if (httpResources > 0) { mixedStatus = 'fail'; mixedMsg = `${httpResources} http:// resources on an https page (mixed content — browsers will block).`; }
  }
  C('mixed_content', 'No mixed content', mixedStatus, 4, mixedMsg,
    'Update all <img>, <script>, <link> URLs to https:// or use protocol-relative // URLs.');

  // 17. h1 not empty
  const h1Empty = h1s.length > 0 && h1s.some(t => !t.replace(/<[^>]+>/g, '').trim());
  C('h1_content', 'H1 has text', h1Empty ? 'fail' : 'pass', 2,
    h1Empty ? 'H1 tag is empty.' : 'H1 contains text.',
    'Add meaningful text inside <h1>.');

  // 18. Link to robots.txt + sitemap (probed below — placeholder)
  // 19. (placeholder for robots/sitemap, filled by caller)

  // ── Tier 22 expansion (T33 phase 2): 12 additional checks ──────────────
  // 20. <!doctype html>
  const hasDoctype = /^\s*<!doctype\s+html/i.test(html);
  C('doctype', 'HTML5 doctype', hasDoctype ? 'pass' : 'warn', 2,
    hasDoctype ? '<!doctype html> declared.' : 'No <!doctype html> at top of document.',
    'Add <!doctype html> as the very first line of every page so browsers render in standards mode.');

  // 21. UTF-8 charset
  const charsetMatch = html.match(/<meta[^>]+charset=["']?([\w-]+)["']?/i);
  const charset = charsetMatch ? charsetMatch[1].toLowerCase() : '';
  if (charset === 'utf-8') C('charset', 'UTF-8 charset', 'pass', 2, '<meta charset="utf-8"> present.', '');
  else if (charset) C('charset', 'UTF-8 charset', 'warn', 2, `Charset is "${charset}" — not UTF-8.`, 'Switch to <meta charset="utf-8"> for full unicode support.');
  else C('charset', 'UTF-8 charset', 'warn', 2, 'No <meta charset> declared.', 'Add <meta charset="utf-8"> as the first tag inside <head>.');

  // 22. Strict-Transport-Security (HSTS) header
  const hsts = H['strict-transport-security'];
  if (hsts && /max-age=\d+/.test(hsts)) C('hsts', 'HSTS (Strict-Transport-Security)', 'pass', 4, `HSTS active: "${hsts.slice(0,80)}"`, '');
  else if (isHttps) C('hsts', 'HSTS (Strict-Transport-Security)', 'warn', 4, 'No HSTS response header.', 'Send "Strict-Transport-Security: max-age=31536000; includeSubDomains" to enforce HTTPS for return visitors.');
  else C('hsts', 'HSTS (Strict-Transport-Security)', 'fail', 4, 'No HSTS (and page is plain HTTP).', 'Move to HTTPS first, then add Strict-Transport-Security header.');

  // 23. X-Robots-Tag response header
  const xRobots = H['x-robots-tag'] || '';
  if (/noindex|none/i.test(xRobots)) C('x_robots', 'X-Robots-Tag header', 'fail', 3, `X-Robots-Tag blocks indexing: "${xRobots}"`, 'Remove "noindex" from the X-Robots-Tag response header if you want this page to rank.');
  else if (xRobots) C('x_robots', 'X-Robots-Tag header', 'pass', 3, `Header set: "${xRobots}"`, '');
  else C('x_robots', 'X-Robots-Tag header', 'pass', 3, 'No X-Robots-Tag (default = indexable).', '');

  // 24. hreflang (international SEO) — informational pass
  const hreflangCount = (html.match(/<link[^>]+rel=["']alternate["'][^>]+hreflang=/gi) || []).length;
  if (hreflangCount >= 1) C('hreflang', 'hreflang for international SEO', 'pass', 2, `${hreflangCount} hreflang link(s) declared.`, '');
  else C('hreflang', 'hreflang for international SEO', 'pass', 2, 'No hreflang (single-language site assumed).', 'Only relevant if you publish in multiple languages — then add <link rel="alternate" hreflang="..."> for each variant.');

  // 25. Web App Manifest (PWA)
  const hasManifest = /<link[^>]+rel=["']manifest["'][^>]+href=/i.test(html);
  C('manifest', 'Web App Manifest', hasManifest ? 'pass' : 'warn', 2,
    hasManifest ? 'manifest.json linked.' : 'No <link rel="manifest"> — page is not installable as a PWA.',
    'Add <link rel="manifest" href="/manifest.json"> with name, icons and theme-color so users can install your site.');

  // 26. theme-color meta (mobile address bar)
  const hasThemeColor = /<meta[^>]+name=["']theme-color["']/i.test(html);
  C('theme_color', 'theme-color meta', hasThemeColor ? 'pass' : 'warn', 2,
    hasThemeColor ? 'theme-color set.' : 'No <meta name="theme-color"> — mobile address bar will use default.',
    'Add <meta name="theme-color" content="#yourbrand"> so Chrome on Android tints the URL bar with your brand.');

  // 27. RSS / Atom feed
  const hasFeed = /<link[^>]+rel=["']alternate["'][^>]+type=["']application\/(rss|atom)\+xml["']/i.test(html);
  C('feed', 'RSS / Atom feed', hasFeed ? 'pass' : 'warn', 2,
    hasFeed ? 'Feed link present.' : 'No RSS/Atom feed linked.',
    'If you publish content (blog/podcast/news), add <link rel="alternate" type="application/rss+xml" href="/feed.xml">');

  // 28. Inline event handlers (security/CSP smell)
  const inlineHandlers = (html.match(/\son(?:click|load|error|mouseover|focus|submit|keydown|keyup)\s*=/gi) || []).length;
  if (inlineHandlers === 0) C('inline_handlers', 'No inline event handlers', 'pass', 2, 'No onclick/onload-style attributes.', '');
  else if (inlineHandlers <= 3) C('inline_handlers', 'No inline event handlers', 'warn', 2, `${inlineHandlers} inline handler attribute(s).`, 'Move event handlers into addEventListener() calls in your JS — required for strict Content-Security-Policy.');
  else C('inline_handlers', 'No inline event handlers', 'fail', 2, `${inlineHandlers} inline handler attributes — blocks strict CSP.`, 'Replace onclick="..." attributes with addEventListener() so you can ship a strict CSP and harden against XSS.');

  // 29. Lazy loading on images (perf)
  if (imgs.length === 0) C('lazy_images', 'Lazy-loaded images', 'pass', 2, 'No images on page.', '');
  else {
    const lazyCount = imgs.filter(t => /\bloading\s*=\s*["']lazy["']/i.test(t)).length;
    const ratio = lazyCount / imgs.length;
    if (ratio >= 0.6) C('lazy_images', 'Lazy-loaded images', 'pass', 2, `${lazyCount}/${imgs.length} images use loading="lazy".`, '');
    else if (ratio > 0) C('lazy_images', 'Lazy-loaded images', 'warn', 2, `${lazyCount}/${imgs.length} lazy.`, 'Add loading="lazy" to non-hero images so off-screen images don\'t block first paint.');
    else C('lazy_images', 'Lazy-loaded images', 'warn', 2, '0 images use loading="lazy".', 'Add loading="lazy" to off-screen images for faster first paint and better Core Web Vitals.');
  }

  // 30. Heading hierarchy (no skipping levels)
  const headingTags = html.match(/<h[1-6]\b/gi) || [];
  const levels = headingTags.map(t => parseInt(t.match(/h([1-6])/i)[1], 10));
  let skipped = false;
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] > levels[i-1] + 1) { skipped = true; break; }
  }
  if (levels.length === 0) C('heading_order', 'Heading hierarchy', 'fail', 3, 'No headings on page.', 'Use <h1>-<h6> in order to structure content for search engines and screen readers.');
  else if (!skipped) C('heading_order', 'Heading hierarchy', 'pass', 3, `${levels.length} heading(s) in correct order.`, '');
  else C('heading_order', 'Heading hierarchy', 'warn', 3, 'Headings skip levels (e.g. h2 → h4).', 'Don\'t skip heading levels — use h1 → h2 → h3 in order for accessibility and SEO.');

  // 31. Multiple meta descriptions (duplicate-tag smell)
  const descTagCount = (html.match(/<meta[^>]+name=["']description["']/gi) || []).length;
  if (descTagCount <= 1) C('dup_meta_desc', 'Single meta description', 'pass', 2, descTagCount === 1 ? 'Exactly one description tag.' : 'No description (covered above).', '');
  else C('dup_meta_desc', 'Single meta description', 'warn', 2, `${descTagCount} <meta name="description"> tags — Google picks one unpredictably.`, 'Remove duplicate <meta name="description"> tags so Google uses the one you intended.');

  // 32. Inline <script> bytes (page weight smell)
  const inlineScripts = html.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi) || [];
  const inlineBytes = inlineScripts.reduce((s, b) => s + Buffer.byteLength(b, 'utf8'), 0);
  if (inlineBytes < 30 * 1024) C('inline_script_size', 'Inline script size', 'pass', 2, `${(inlineBytes/1024).toFixed(1)}KB inline JS.`, '');
  else if (inlineBytes < 80 * 1024) C('inline_script_size', 'Inline script size', 'warn', 2, `${(inlineBytes/1024).toFixed(1)}KB inline JS — start splitting to external files.`, 'Move large inline <script> blocks into external .js files so the browser can cache them across page loads.');
  else C('inline_script_size', 'Inline script size', 'fail', 2, `${(inlineBytes/1024).toFixed(1)}KB inline JS — heavy on first paint.`, 'Move inline scripts to external files. Inline JS isn\'t cacheable and bloats every HTML response.');

  const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
  const earned = checks.reduce((s, c) => s + c.earned, 0);
  const score = Math.round((earned / totalWeight) * 100);
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';

  return { score, grade, checks, title, desc, words, h1Count: h1s.length, imgCount: imgs.length };
}

router.get('/test', (req, res) => res.json({ ok: true, db: _db.hasDb && _db.hasDb() }));

router.post('/audit', _safeAsync(async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!url) return _err(res, 400, 'url required');
  const useHeadless = !!(req.body && req.body.headless);

  const safe = await isUrlSafeToFetch(url);
  if (!safe.ok) return _err(res, 400, safe.error);

  let fetched;
  let renderMode = 'http';
  if (useHeadless) {
    if (!_headless.isAvailable()) return _err(res, 503, 'Headless browser not available on this server');
    fetched = await _headless.fetchHtmlHeadless(url);
    renderMode = 'headless';
  } else {
    fetched = await _fetchHtml(url);
    // Auto-suggest headless if raw HTML looks like an empty SPA shell.
    if (fetched.ok && _headless.looksLikeEmptySpa(fetched.html) && _headless.isAvailable()) {
      const headlessAttempt = await _headless.fetchHtmlHeadless(url);
      if (headlessAttempt.ok) { fetched = headlessAttempt; renderMode = 'headless-auto'; }
    }
  }
  if (!fetched.ok) return _err(res, 502, fetched.error);

  const parsed = _parseAndScore(fetched.html, fetched.finalUrl, fetched.headers || {});

  // Probe robots + sitemap in parallel (root-domain level).
  let originRoot = '';
  try { const u = new URL(fetched.finalUrl); originRoot = `${u.protocol}//${u.host}`; } catch (_) {}
  const [robotsOk, sitemapOk] = originRoot ? await Promise.all([
    _probe(originRoot + '/robots.txt'),
    _probe(originRoot + '/sitemap.xml')
  ]) : [false, false];

  // Add the two probes as additional checks
  parsed.checks.push({ id: 'robots_txt', label: 'robots.txt accessible', status: robotsOk ? 'pass' : 'warn', weight: 4, earned: robotsOk ? 4 : 0,
    message: robotsOk ? `robots.txt found at ${originRoot}/robots.txt` : 'No robots.txt found at site root.',
    fix: 'Create /robots.txt — even an empty file or User-agent: * Allow: / is better than nothing.' });
  parsed.checks.push({ id: 'sitemap_xml', label: 'sitemap.xml accessible', status: sitemapOk ? 'pass' : 'warn', weight: 4, earned: sitemapOk ? 4 : 0,
    message: sitemapOk ? `sitemap.xml found at ${originRoot}/sitemap.xml` : 'No sitemap.xml found at site root.',
    fix: 'Generate a sitemap.xml and reference it in robots.txt as Sitemap: https://yoursite.com/sitemap.xml' });

  // Recompute score with the two extra checks
  const totalWeight = parsed.checks.reduce((s, c) => s + c.weight, 0);
  const earned = parsed.checks.reduce((s, c) => s + c.earned, 0);
  const score = Math.round((earned / totalWeight) * 100);
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';

  const summary = {
    title: parsed.title, description: parsed.desc, words: parsed.words,
    h1Count: parsed.h1Count, imgCount: parsed.imgCount, finalUrl: fetched.finalUrl,
    renderMode, renderMs: fetched.renderMs || null,
    passed: parsed.checks.filter(c => c.status === 'pass').length,
    warned: parsed.checks.filter(c => c.status === 'warn').length,
    failed: parsed.checks.filter(c => c.status === 'fail').length
  };

  let runId = null;
  if (_db.hasDb && _db.hasDb()) {
    try {
      const r = await _db.getPool().query(
        `INSERT INTO seo_audit_runs (url, score, grade, checks, summary) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [fetched.finalUrl, score, grade, JSON.stringify(parsed.checks), JSON.stringify(summary)]
      );
      runId = r.rows[0].id;
    } catch (_) {}
  }

  res.json({ ok: true, runId, url: fetched.finalUrl, score, grade, summary, checks: parsed.checks, renderMode });
}));

router.get('/headless-status', (req, res) => res.json({ ok: true, available: _headless.isAvailable() }));

router.get('/runs', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok: true, runs: [] });
  const r = await _db.getPool().query(
    `SELECT id, url, score, grade, summary, created_at FROM seo_audit_runs ORDER BY created_at DESC LIMIT 30`
  );
  res.json({ ok: true, runs: r.rows });
}));

// Internal helper — exported so the embeddable-widget service can reuse the audit logic.
async function runAudit(url, opts = {}) {
  const safe = await isUrlSafeToFetch(url);
  if (!safe.ok) return { ok: false, error: safe.error };
  let fetched;
  if (opts.headless && _headless.isAvailable()) {
    fetched = await _headless.fetchHtmlHeadless(url);
  } else {
    fetched = await _fetchHtml(url);
  }
  if (!fetched.ok) return { ok: false, error: fetched.error };
  const parsed = _parseAndScore(fetched.html, fetched.finalUrl, fetched.headers || {});
  let originRoot = '';
  try { const u = new URL(fetched.finalUrl); originRoot = `${u.protocol}//${u.host}`; } catch (_) {}
  const [robotsOk, sitemapOk] = originRoot
    ? await Promise.all([_probe(originRoot + '/robots.txt'), _probe(originRoot + '/sitemap.xml')])
    : [false, false];
  parsed.checks.push({ id: 'robots_txt', label: 'robots.txt accessible', status: robotsOk ? 'pass' : 'warn', weight: 4, earned: robotsOk ? 4 : 0, message: robotsOk ? 'found' : 'missing', fix: 'Create /robots.txt.' });
  parsed.checks.push({ id: 'sitemap_xml', label: 'sitemap.xml accessible', status: sitemapOk ? 'pass' : 'warn', weight: 4, earned: sitemapOk ? 4 : 0, message: sitemapOk ? 'found' : 'missing', fix: 'Create /sitemap.xml.' });
  const totalWeight = parsed.checks.reduce((s, c) => s + c.weight, 0);
  const earned = parsed.checks.reduce((s, c) => s + c.earned, 0);
  const score = Math.round((earned / totalWeight) * 100);
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
  return { ok: true, url: fetched.finalUrl, score, grade,
    summary: { title: parsed.title, description: parsed.desc, words: parsed.words, h1Count: parsed.h1Count, imgCount: parsed.imgCount,
      passed: parsed.checks.filter(c => c.status === 'pass').length, warned: parsed.checks.filter(c => c.status === 'warn').length, failed: parsed.checks.filter(c => c.status === 'fail').length },
    checks: parsed.checks };
}

module.exports = router;
module.exports.runAudit = runAudit;
