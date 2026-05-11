// Tier 32 — Social Tags Audit
// Audits Open Graph, Twitter Cards, social profile links, tracking pixels and
// favicons. 12 weighted regex checks summing to 100. Pure regex, no LLM call.
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const _https = require('https');
const _http = require('http');
const _db = require('../../db');
const { isUrlSafeToFetch } = require('../_shared/ssrf');
const _headless = require('../_shared/headless_fetch');

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safeAsync(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch(e => {
    console.warn('[social-tags]', e.stack || e.message);
    if (!res.headersSent) _err(res, 500, 'Internal server error');
  });
}

function _fetchHtml(rawUrl, redirects = 0) {
  return new Promise(async resolve => {
    if (redirects > 4) return resolve({ ok: false, error: 'Too many redirects' });
    const safe = await isUrlSafeToFetch(rawUrl);
    if (!safe.ok) return resolve({ ok: false, error: safe.error });
    let u; try { u = new URL(rawUrl); } catch { return resolve({ ok: false, error: 'Invalid URL' }); }
    const lib = u.protocol === 'https:' ? _https : _http;
    const req = lib.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search, method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 InfoGenie-SocialTags/1.0', 'Accept': 'text/html' }
    }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        const next = new URL(r.headers.location, rawUrl).toString();
        r.resume(); return resolve(_fetchHtml(next, redirects + 1));
      }
      if (r.statusCode >= 400) { r.resume(); return resolve({ ok: false, error: 'HTTP ' + r.statusCode }); }
      const chunks = []; let total = 0;
      r.on('data', c => { total += c.length; if (total > 2 * 1024 * 1024) { r.destroy(); return resolve({ ok: false, error: 'too large' }); } chunks.push(c); });
      r.on('end', () => resolve({ ok: true, html: Buffer.concat(chunks).toString('utf8'), finalUrl: rawUrl }));
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.end();
  });
}

function _meta(html, prop) {
  const re = new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${prop.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}["'][^>]+content\\s*=\\s*["']([^"']+)["']`, 'i');
  const re2 = new RegExp(`<meta[^>]+content\\s*=\\s*["']([^"']+)["'][^>]+(?:property|name)\\s*=\\s*["']${prop.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}["']`, 'i');
  const m = html.match(re) || html.match(re2);
  return m ? m[1].trim() : '';
}

function _runChecks(html, finalUrl) {
  const checks = [];
  const C = (id, label, status, weight, message, fix) => checks.push({
    id, label, status, weight,
    earned: status === 'pass' ? weight : status === 'warn' ? Math.floor(weight / 2) : 0,
    message, fix
  });

  // 1. og:title (12 pts)
  const ogTitle = _meta(html, 'og:title');
  if (ogTitle && ogTitle.length >= 10 && ogTitle.length <= 95) C('og_title', 'og:title', 'pass', 12, `"${ogTitle.slice(0,80)}"`, '');
  else if (ogTitle) C('og_title', 'og:title', 'warn', 12, `${ogTitle.length} chars (ideal 10-95).`, 'Tighten og:title to 10-95 chars — Facebook truncates beyond that.');
  else C('og_title', 'og:title', 'fail', 12, 'Missing.', 'Add <meta property="og:title" content="..."> so links to this page show your title in Facebook, LinkedIn and Slack previews.');

  // 2. og:description (8 pts)
  const ogDesc = _meta(html, 'og:description');
  if (ogDesc && ogDesc.length >= 50 && ogDesc.length <= 200) C('og_desc', 'og:description', 'pass', 8, `${ogDesc.length} chars.`, '');
  else if (ogDesc) C('og_desc', 'og:description', 'warn', 8, `${ogDesc.length} chars (ideal 50-200).`, 'Tune og:description to 50-200 chars.');
  else C('og_desc', 'og:description', 'fail', 8, 'Missing.', 'Add <meta property="og:description" content="..."> so social previews show a meaningful summary.');

  // 3. og:image (14 pts)
  const ogImage = _meta(html, 'og:image');
  if (ogImage) C('og_image', 'og:image', 'pass', 14, ogImage.length > 80 ? ogImage.slice(0, 80) + '…' : ogImage, '');
  else C('og_image', 'og:image', 'fail', 14, 'Missing.', 'Add <meta property="og:image" content="https://yoursite.com/og.png"> with a 1200x630 image. This is the single biggest social-share lift.');

  // 4. og:type (4 pts)
  const ogType = _meta(html, 'og:type');
  if (ogType) C('og_type', 'og:type', 'pass', 4, `"${ogType}"`, '');
  else C('og_type', 'og:type', 'warn', 4, 'Missing.', 'Add <meta property="og:type" content="website"> (or "article" for blog posts).');

  // 5. og:url (4 pts)
  const ogUrl = _meta(html, 'og:url');
  if (ogUrl) C('og_url', 'og:url', 'pass', 4, ogUrl.length > 80 ? ogUrl.slice(0, 80) + '…' : ogUrl, '');
  else C('og_url', 'og:url', 'warn', 4, 'Missing.', 'Add <meta property="og:url" content="..."> with the canonical URL of this page.');

  // 6. Twitter Card type (10 pts)
  const twCard = _meta(html, 'twitter:card');
  if (twCard) C('tw_card', 'twitter:card', 'pass', 10, `"${twCard}"`, '');
  else C('tw_card', 'twitter:card', 'fail', 10, 'Missing.', 'Add <meta name="twitter:card" content="summary_large_image"> so X/Twitter shares render with a big preview image.');

  // 7. Twitter image / title fallbacks (6 pts)
  const twImage = _meta(html, 'twitter:image');
  const twTitle = _meta(html, 'twitter:title');
  if (twImage && twTitle) C('tw_meta', 'twitter:image + twitter:title', 'pass', 6, 'Both present.', '');
  else if (twImage || twTitle || ogImage) C('tw_meta', 'twitter:image + twitter:title', 'warn', 6, twImage ? 'image yes, title missing' : twTitle ? 'title yes, image missing' : 'falling back to og:image only', 'Add explicit twitter:image and twitter:title — relying on og:* fallback works but explicit tags render more reliably across X clients.');
  else C('tw_meta', 'twitter:image + twitter:title', 'fail', 6, 'Neither set.', 'Add twitter:image and twitter:title meta tags.');

  // 8. Facebook Pixel (8 pts)
  const hasPixel = /fbq\(\s*['"]init['"]/i.test(html) || /connect\.facebook\.net\/[^'"\s]+\/fbevents\.js/i.test(html);
  if (hasPixel) C('fb_pixel', 'Facebook Pixel installed', 'pass', 8, 'fbq init / fbevents.js detected.', '');
  else C('fb_pixel', 'Facebook Pixel installed', 'warn', 8, 'No Facebook Pixel.', 'Install the Meta Pixel (fbq) so you can build custom audiences and track conversions from Facebook/Instagram ads. Skip only if you never run Meta ads.');

  // 9. Google Analytics / Tag Manager (8 pts)
  const hasGTM = /googletagmanager\.com\/gtm\.js/i.test(html);
  const hasGA4 = /googletagmanager\.com\/gtag\/js\?id=G-/i.test(html) || /gtag\(\s*['"]config['"]\s*,\s*['"]G-/i.test(html);
  const hasGAuni = /google-analytics\.com\/analytics\.js/i.test(html) || /ga\(\s*['"]create['"]/i.test(html);
  if (hasGA4 || hasGTM) C('analytics', 'GA4 / Tag Manager', 'pass', 8, hasGTM ? 'GTM detected.' : 'GA4 detected.', '');
  else if (hasGAuni) C('analytics', 'GA4 / Tag Manager', 'warn', 8, 'Universal Analytics (deprecated July 2023) detected.', 'Migrate to GA4 — Universal Analytics no longer collects data. Install via Google Tag Manager or direct gtag.js snippet.');
  else C('analytics', 'GA4 / Tag Manager', 'fail', 8, 'No GA4 / GTM tag found.', 'Install Google Analytics 4 (or Google Tag Manager) so you can measure traffic, conversions and campaign attribution.');

  // 10. Social profile links — count distinct platforms in <a href>
  const profileTests = [
    { id: 'fb', re: /facebook\.com\/(?!sharer|share|tr\?|plugins)/i, name: 'Facebook' },
    { id: 'tw', re: /(?:twitter|x)\.com\/(?!intent|share)/i, name: 'X / Twitter' },
    { id: 'li', re: /linkedin\.com\/(?:company|in|school)\//i, name: 'LinkedIn' },
    { id: 'ig', re: /instagram\.com\/(?!p\/|reel\/)/i, name: 'Instagram' },
    { id: 'yt', re: /youtube\.com\/(?:c\/|channel\/|user\/|@)/i, name: 'YouTube' },
    { id: 'tt', re: /tiktok\.com\/@/i, name: 'TikTok' },
  ];
  const aHrefs = (html.match(/<a\b[^>]*href=["'][^"']+["'][^>]*>/gi) || []).join(' ');
  const platforms = profileTests.filter(p => p.re.test(aHrefs));
  if (platforms.length >= 3) C('social_profiles', 'Social profile links', 'pass', 10, `${platforms.length} platforms: ${platforms.map(p=>p.name).join(', ')}.`, '');
  else if (platforms.length >= 1) C('social_profiles', 'Social profile links', 'warn', 10, `${platforms.length} platform(s): ${platforms.map(p=>p.name).join(', ')}. Aim for 3+.`, 'Add links to all your active social profiles in the footer (Facebook, X, LinkedIn, Instagram, YouTube, TikTok). Helps customers verify legitimacy and reinforces your brand sameAs schema.');
  else C('social_profiles', 'Social profile links', 'fail', 10, 'No social profile links found.', 'Add links to your social profiles in the footer of every page.');

  // 11. Favicon (6 pts)
  const hasFavicon = /<link[^>]+rel=["'](?:shortcut\s+)?icon["']/i.test(html);
  if (hasFavicon) C('favicon', 'Favicon', 'pass', 6, 'Favicon link tag present.', '');
  else C('favicon', 'Favicon', 'fail', 6, 'No favicon link.', 'Add <link rel="icon" href="/favicon.ico"> — affects browser tab branding and search snippet logos.');

  // 12. Apple touch icon (6 pts)
  const hasAppleIcon = /<link[^>]+rel=["']apple-touch-icon[^"']*["']/i.test(html);
  if (hasAppleIcon) C('apple_icon', 'Apple touch icon', 'pass', 6, 'apple-touch-icon link present.', '');
  else C('apple_icon', 'Apple touch icon', 'warn', 6, 'No apple-touch-icon.', 'Add <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"> for proper iOS home-screen icon when users save your page.');

  // 13. Organization sameAs schema linking social profiles (4 pts) — keeps total at 100
  const ldjson = (html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || []).map(b => b.replace(/<[^>]+>/g, ''));
  const hasSameAs = ldjson.some(s => /"sameAs"\s*:\s*\[/i.test(s));
  if (hasSameAs) C('sameas_schema', 'Organization sameAs links in schema', 'pass', 4, 'sameAs array detected in JSON-LD.', '');
  else C('sameas_schema', 'Organization sameAs links in schema', 'warn', 4, 'No sameAs[] in JSON-LD.', 'In your Organization schema (T25), add a sameAs[] array listing all your social profile URLs. Tells Google these accounts belong to your brand → richer Knowledge Panel.');

  return { checks, ogImage, twCard, hasPixel, hasGA4: hasGA4 || hasGTM, platforms: platforms.map(p => p.name) };
}

async function _runSocialTags(url, opts = {}) {
  const safe = await isUrlSafeToFetch(url);
  if (!safe.ok) return { ok: false, error: safe.error };
  const fetched = (opts.headless && _headless.isAvailable())
    ? await _headless.fetchHtmlHeadless(url)
    : await _fetchHtml(url);
  if (!fetched.ok) return { ok: false, error: fetched.error };
  const r = _runChecks(fetched.html, fetched.finalUrl);
  const totalW = r.checks.reduce((s, c) => s + c.weight, 0);
  if (totalW !== 100) console.warn('[social-tags] weight sum drift:', totalW);
  const earned = r.checks.reduce((s, c) => s + c.earned, 0);
  const score  = Math.round((earned / totalW) * 100);
  const grade  = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
  return {
    ok: true, url: fetched.finalUrl, score, grade,
    summary: { ogImage: !!r.ogImage, twCard: r.twCard, hasPixel: r.hasPixel, hasGA4: r.hasGA4, platforms: r.platforms,
      passed: r.checks.filter(c => c.status === 'pass').length,
      warned: r.checks.filter(c => c.status === 'warn').length,
      failed: r.checks.filter(c => c.status === 'fail').length },
    checks: r.checks
  };
}

router.post('/run', _safeAsync(async (req, res) => {
  const url = String((req.body && req.body.url) || '').trim();
  if (!url) return _err(res, 400, 'url required');
  if (!/^https?:\/\//i.test(url)) return _err(res, 400, 'url must start with http:// or https://');
  const result = await _runSocialTags(url, { headless: !!(req.body && req.body.headless) });
  if (!result.ok) return _err(res, 400, result.error);
  if (_db.hasDb && _db.hasDb()) {
    try {
      const id = 'social_' + crypto.randomBytes(6).toString('hex');
      await _db.getPool().query(
        `INSERT INTO social_tags_runs (id, url, score, grade, summary, checks) VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, result.url, result.score, result.grade, JSON.stringify(result.summary), JSON.stringify(result.checks)]
      );
      result.id = id;
    } catch (e) { console.warn('[social-tags] insert failed', e.message); }
  }
  res.json(result);
}));

router.get('/runs', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok: true, runs: [] });
  const r = await _db.getPool().query(
    `SELECT id, url, score, grade, summary, created_at FROM social_tags_runs ORDER BY created_at DESC LIMIT 30`
  );
  res.json({ ok: true, runs: r.rows });
}));

router.get('/runs/:id', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 503, 'Database unavailable');
  const r = await _db.getPool().query(`SELECT * FROM social_tags_runs WHERE id=$1`, [req.params.id]);
  if (!r.rowCount) return _err(res, 404, 'Run not found');
  res.json({ ok: true, run: r.rows[0] });
}));

module.exports = router;
module.exports.runSocialTags = _runSocialTags;
