// Tier 31 — Local SEO Basics
// Scores how well a page is set up for brick-and-mortar / local search:
// NAP visibility, LocalBusiness schema, Google Business Profile link, hours,
// click-to-call, click-for-directions, embedded map, contact page hint.
// 10 weighted regex checks summing to 100. Pure regex, no LLM call.
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const _https = require('https');
const _http = require('http');
const _db = require('../../db');
const { isUrlSafeToFetch } = require('../_shared/ssrf');

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safeAsync(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch(e => {
    console.warn('[local-seo]', e.stack || e.message);
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
      headers: { 'User-Agent': 'Mozilla/5.0 InfoGenie-LocalSEO/1.0', 'Accept': 'text/html' }
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

function _stripTags(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
             .replace(/<style[\s\S]*?<\/style>/gi, ' ')
             .replace(/<[^>]+>/g, ' ')
             .replace(/\s+/g, ' ')
             .trim();
}

function _runChecks(html, finalUrl) {
  const text = _stripTags(html);
  const lower = html.toLowerCase();
  const checks = [];
  const C = (id, label, status, weight, message, fix) => checks.push({
    id, label, status, weight,
    earned: status === 'pass' ? weight : status === 'warn' ? Math.floor(weight / 2) : 0,
    message, fix
  });

  // 1. Visible phone number (12 pts) — international-ish regex
  const phoneRe = /(\+?\d[\d\s().-]{7,}\d)/g;
  const phones = (text.match(phoneRe) || []).filter(p => p.replace(/\D/g, '').length >= 8 && p.replace(/\D/g, '').length <= 15);
  if (phones.length >= 1) C('phone', 'Phone number visible on page', 'pass', 12, `Phone found: ${phones[0].trim()}`, '');
  else C('phone', 'Phone number visible on page', 'fail', 12, 'No phone number detected.', 'Display your business phone number prominently in the header and footer. Local customers expect to see it without scrolling.');

  // 2. Click-to-call (tel:) link (8 pts)
  const telCount = (html.match(/href\s*=\s*["']tel:[^"']+["']/gi) || []).length;
  if (telCount >= 1) C('click_to_call', 'Click-to-call (tel:) link', 'pass', 8, `${telCount} tel: link(s).`, '');
  else C('click_to_call', 'Click-to-call (tel:) link', 'fail', 8, 'No tel: link.', 'Wrap your phone number in <a href="tel:+1234567890"> so mobile users can tap to call.');

  // 3. Visible street address (12 pts) — street + city/state/zip pattern
  const streetRe = /\b\d{1,6}\s+([A-Z][a-z]+\s+){1,4}(Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Highway|Hwy|Place|Pl)\b/i;
  const zipRe = /\b\d{4,5}(?:-\d{4})?\b/;
  const hasStreet = streetRe.test(text);
  const hasZip = zipRe.test(text);
  if (hasStreet && hasZip) C('address', 'Street address visible', 'pass', 12, 'Address with street + postcode found.', '');
  else if (hasStreet || hasZip) C('address', 'Street address visible', 'warn', 12, hasStreet ? 'Street found but no postcode nearby.' : 'Postcode found but no street pattern.', 'Display your full street address (street, city, state/province, postcode) in the footer of every page.');
  else C('address', 'Street address visible', 'fail', 12, 'No physical address pattern detected.', 'Display your full street address in the footer of every page so search engines and customers can find your physical location.');

  // 4. LocalBusiness JSON-LD schema (15 pts)
  const ldjson = (html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || []).map(b => b.replace(/<[^>]+>/g, ''));
  const hasLocal = ldjson.some(s => /"@type"\s*:\s*"(LocalBusiness|Restaurant|Store|MedicalBusiness|Dentist|HomeAndConstructionBusiness|AutomotiveBusiness|FoodEstablishment|LodgingBusiness|ProfessionalService|FinancialService|HealthAndBeautyBusiness|EmergencyService|ChildCare|LegalService)"/i.test(s));
  if (hasLocal) C('localbusiness_schema', 'LocalBusiness JSON-LD schema', 'pass', 15, 'LocalBusiness schema detected.', '');
  else if (ldjson.length) C('localbusiness_schema', 'LocalBusiness JSON-LD schema', 'warn', 15, `${ldjson.length} schema block(s) but no LocalBusiness type.`, 'Use the InfoGenie Schema Generator (T25) to add LocalBusiness JSON-LD with your name, address, geo coords, opening hours and phone.');
  else C('localbusiness_schema', 'LocalBusiness JSON-LD schema', 'fail', 15, 'No JSON-LD structured data.', 'Use the InfoGenie Schema Generator (T25) to add LocalBusiness JSON-LD — Google needs this to feature you in local pack and Maps results.');

  // 5. Google Business Profile / Google Maps link (10 pts)
  const hasGbpLink = /(maps\.google\.|maps\.app\.goo\.gl|g\.page\/|google\.com\/maps)/i.test(html);
  if (hasGbpLink) C('gbp_link', 'Google Business Profile / Maps link', 'pass', 10, 'Link to Google Maps / GBP found.', '');
  else C('gbp_link', 'Google Business Profile / Maps link', 'fail', 10, 'No Google Maps / GBP link found.', 'Add a "Find us on Google" link pointing to your Google Business Profile (g.page short link) or your Google Maps listing. Reinforces the GBP-website relationship for Google.');

  // 6. Embedded Google Map iframe (8 pts)
  const hasMapEmbed = /<iframe[^>]+src=["'][^"']*google\.com\/maps\/embed/i.test(html);
  if (hasMapEmbed) C('map_embed', 'Embedded Google Map', 'pass', 8, 'Google Maps iframe detected.', '');
  else C('map_embed', 'Embedded Google Map', 'warn', 8, 'No embedded Google Map.', 'Embed your location on a Contact page using Google Maps Embed (Share → Embed a map). Helps users orient and adds a strong local signal.');

  // 7. Opening hours / hours of operation (8 pts)
  const hasHoursWord = /\b(opening\s+hours|business\s+hours|hours\s+of\s+operation|store\s+hours|trading\s+hours|monday|mon[-–]fri|mon\s*[–-]\s*sun)\b/i.test(text);
  const hasHoursPattern = /\b(\d{1,2}(:\d{2})?\s*(am|pm)|\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}(:\d{2})?\s*(am|pm)|\d{1,2}:\d{2})/i.test(text);
  if (hasHoursWord && hasHoursPattern) C('hours', 'Opening hours visible', 'pass', 8, 'Hours of operation found.', '');
  else if (hasHoursWord || hasHoursPattern) C('hours', 'Opening hours visible', 'warn', 8, 'Partial hours signal — label or time range missing.', 'Display your opening hours clearly (e.g. "Mon-Fri 9:00am – 5:00pm") on Contact and homepage. Add openingHours to your LocalBusiness schema too.');
  else C('hours', 'Opening hours visible', 'fail', 8, 'No opening hours visible.', 'Display opening hours on every key page (homepage footer + dedicated Contact page). Add openingHours to your LocalBusiness JSON-LD.');

  // 8. Contact page exists (link/anchor mentioning contact) (8 pts)
  const hasContactLink = /<a[^>]+href=["'][^"']*\/contact[^"']*["']/i.test(html) || /<a[^>]*>\s*contact(\s+us)?\s*<\/a>/i.test(html);
  if (hasContactLink) C('contact_page', 'Contact page link in nav', 'pass', 8, 'Contact link detected.', '');
  else C('contact_page', 'Contact page link in nav', 'warn', 8, 'No obvious /contact link.', 'Add a top-level "Contact" link in your main nav pointing to /contact — a dedicated contact page is a strong local SEO signal.');

  // 9. NAP consistency hint — same number/address shouldn't appear with conflicting variations (6 pts)
  // Cheap heuristic: if multiple distinct phone numbers appear, warn.
  const distinctPhones = Array.from(new Set(phones.map(p => p.replace(/\D/g, ''))));
  if (distinctPhones.length === 0) C('nap_consistency', 'NAP consistency', 'warn', 6, 'No phone to compare.', 'Show ONE phone number consistently — same digits, same format — across header, footer, contact page and schema. Inconsistent NAP confuses Google.');
  else if (distinctPhones.length === 1) C('nap_consistency', 'NAP consistency', 'pass', 6, 'Single consistent phone number.', '');
  else if (distinctPhones.length === 2) C('nap_consistency', 'NAP consistency', 'warn', 6, `${distinctPhones.length} distinct phone numbers on the page.`, 'Use ONE primary business phone number consistently. Multiple numbers (sales/support/branch) are fine but flag them clearly so Google knows which is the canonical NAP.');
  else C('nap_consistency', 'NAP consistency', 'fail', 6, `${distinctPhones.length} distinct phone numbers — inconsistent NAP.`, 'Consolidate to one primary business phone. Multiple variations of your NAP across pages hurt local rankings.');

  // 10. Service area / city mentions (8 pts)
  // Lightweight: count proper-cased city-like tokens near street pattern, otherwise just reward presence of "located in"/"serving" phrases.
  const hasServiceArea = /\b(serving|located\s+in|based\s+in|proudly\s+serving|service\s+area)\b/i.test(text)
                       || /\b(near\s+me|local\s+(?:to\s+)?(?:you|us))\b/i.test(text);
  if (hasServiceArea) C('service_area', 'Service area / location signals', 'pass', 8, 'Service-area phrasing detected.', '');
  else C('service_area', 'Service area / location signals', 'warn', 8, 'No "serving X" or service-area phrasing.', 'Add explicit service-area language (e.g. "Proudly serving Cape Town and surrounds" or "Located in downtown Austin since 2012") on homepage and contact page.');

  // 11. HTTPS / canonical / robots (5 pts) — keeps total at 100
  const isHttps = String(finalUrl || '').startsWith('https:');
  const hasCanonical = /<link[^>]+rel=["']canonical["'][^>]+href=["'][^"']+["']/i.test(html);
  if (isHttps && hasCanonical) C('hygiene', 'HTTPS + canonical tag', 'pass', 5, 'HTTPS and canonical tag present.', '');
  else if (isHttps || hasCanonical) C('hygiene', 'HTTPS + canonical tag', 'warn', 5, isHttps ? 'HTTPS yes, canonical missing.' : 'Canonical present but plain HTTP.', isHttps ? 'Add <link rel="canonical" href="..."> to declare the preferred URL.' : 'Install a TLS certificate (Let\'s Encrypt is free) and force https://.');
  else C('hygiene', 'HTTPS + canonical tag', 'fail', 5, 'No HTTPS, no canonical.', 'Move to HTTPS and add a canonical link tag. Both are baseline ranking factors.');

  return { checks, phoneCount: distinctPhones.length, hasLocal, hasMapEmbed };
}

async function _runLocalSeo(url) {
  const safe = await isUrlSafeToFetch(url);
  if (!safe.ok) return { ok: false, error: safe.error };
  const fetched = await _fetchHtml(url);
  if (!fetched.ok) return { ok: false, error: fetched.error };
  const r = _runChecks(fetched.html, fetched.finalUrl);
  const totalW = r.checks.reduce((s, c) => s + c.weight, 0);
  if (totalW !== 100) console.warn('[local-seo] weight sum drift:', totalW);
  const earned = r.checks.reduce((s, c) => s + c.earned, 0);
  const score  = Math.round((earned / totalW) * 100);
  const grade  = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
  return {
    ok: true, url: fetched.finalUrl, score, grade,
    summary: { phoneCount: r.phoneCount, hasLocalBusinessSchema: r.hasLocal, hasMapEmbed: r.hasMapEmbed,
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
  const result = await _runLocalSeo(url);
  if (!result.ok) return _err(res, 400, result.error);
  if (_db.hasDb && _db.hasDb()) {
    try {
      const id = 'local_' + crypto.randomBytes(6).toString('hex');
      await _db.getPool().query(
        `INSERT INTO local_seo_runs (id, url, score, grade, summary, checks) VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, result.url, result.score, result.grade, JSON.stringify(result.summary), JSON.stringify(result.checks)]
      );
      result.id = id;
    } catch (e) { console.warn('[local-seo] insert failed', e.message); }
  }
  res.json(result);
}));

router.get('/runs', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok: true, runs: [] });
  const r = await _db.getPool().query(
    `SELECT id, url, score, grade, summary, created_at FROM local_seo_runs ORDER BY created_at DESC LIMIT 30`
  );
  res.json({ ok: true, runs: r.rows });
}));

router.get('/runs/:id', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 503, 'Database unavailable');
  const r = await _db.getPool().query(`SELECT * FROM local_seo_runs WHERE id=$1`, [req.params.id]);
  if (!r.rowCount) return _err(res, 404, 'Run not found');
  res.json({ ok: true, run: r.rows[0] });
}));

module.exports = router;
module.exports.runLocalSeo = _runLocalSeo;
