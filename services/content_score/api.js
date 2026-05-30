// Content Score — per-subscore on-page audit with AI Fix-It suggestions
// POST /api/content-score/score   { url, keyword? }  → 9 subscores + total
// POST /api/content-score/fix     { url, subscore, context, keyword }  → AI rewrite hint
// GET  /api/content-score/runs    → recent history
// POST /api/content-score/auto-optimize  { url, keyword }  → fix all failing subscores at once

const express = require('express');
const router  = express.Router();
const _https  = require('https');
const _db     = require('../../db');
const _tenantCtx = require('../tenants/context');

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safe(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch(e => {
    console.warn('[content-score]', e.stack || e.message);
    if (!res.headersSent) _err(res, 500, 'Internal server error');
  });
}

function _hasOpenAI() {
  const k = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  return k && !/^_DUMMY/i.test(k);
}

// ── Lightweight page scraper ────────────────────────────────────────────────
function _fetchPage(url, timeoutMs = 12000) {
  return new Promise(resolve => {
    try {
      const mod = url.startsWith('https') ? require('https') : require('http');
      const req = mod.request(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; InfoGenie/1.0; +https://infogenie.app)',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      }, r => {
        if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
          const loc = r.headers.location;
          const next = loc.startsWith('http') ? loc : new URL(loc, url).href;
          return _fetchPage(next, timeoutMs).then(resolve);
        }
        if (r.statusCode >= 400) return resolve({ ok: false, error: `HTTP ${r.statusCode}` });
        const chunks = [];
        let size = 0;
        r.on('data', c => {
          size += c.length;
          if (size < 600 * 1024) chunks.push(c);
        });
        r.on('end', () => resolve({ ok: true, html: Buffer.concat(chunks).toString('utf-8') }));
        r.on('error', e => resolve({ ok: false, error: e.message }));
      });
      req.on('error', e => resolve({ ok: false, error: e.message }));
      req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
      req.end();
    } catch (e) { resolve({ ok: false, error: e.message }); }
  });
}

// ── Signal extraction ───────────────────────────────────────────────────────
function _strip(html) {
  return String(html || '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

function _signals(html, sourceUrl) {
  const clean = _strip(html);
  const title   = (clean.match(/<title[^>]*>([^<]{1,300})<\/title>/i) || [])[1]?.trim() || '';
  const metaDesc= (clean.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']{0,400})["']/i) || [])[1]?.trim() || '';
  const canonical= (clean.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']{0,500})["']/i) || [])[1]?.trim() || sourceUrl || '';
  const h1s  = (clean.match(/<h1[^>]*>([\s\S]*?)<\/h1>/gi) || []).map(h => h.replace(/<[^>]+>/g,'').trim()).filter(Boolean);
  const h2s  = (clean.match(/<h2[^>]*>([\s\S]*?)<\/h2>/gi) || []).map(h => h.replace(/<[^>]+>/g,'').trim()).filter(Boolean);
  const h3s  = (clean.match(/<h3[^>]*>([\s\S]*?)<\/h3>/gi) || []).map(h => h.replace(/<[^>]+>/g,'').trim()).filter(Boolean);
  const text = clean.replace(/<[^>]+>/g,' ').replace(/&[a-z]+;/gi,' ').replace(/\s+/g,' ').trim();
  const words = text ? text.split(/\s+/) : [];

  // Schema
  const schemaBlocks = clean.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  const schemaTypes = new Set();
  let hasFAQSchema = false;
  for (const b of schemaBlocks) {
    try {
      const inner = b.replace(/<\/?script[^>]*>/gi, '').trim();
      const parsed = JSON.parse(inner);
      const collect = n => {
        if (!n || typeof n !== 'object') return;
        const t = Array.isArray(n['@type']) ? n['@type'] : [n['@type']];
        t.filter(Boolean).forEach(x => { schemaTypes.add(x); if (/FAQPage/i.test(x)) hasFAQSchema = true; });
        if (Array.isArray(n['@graph'])) n['@graph'].forEach(collect);
      };
      [].concat(parsed).forEach(collect);
    } catch (_) {}
  }

  // Internal links
  const domain = sourceUrl ? (new URL(sourceUrl).hostname).replace(/^www\./,'') : '';
  const allHrefs = (clean.match(/href=["']([^"'#]{4,300})["']/gi) || []).map(h => (h.match(/href=["']([^"']+)["']/i)||[])[1]).filter(Boolean);
  let internalLinks = 0, externalLinks = 0;
  for (const h of allHrefs) {
    if (h.startsWith('/')) { internalLinks++; }
    else if (h.startsWith('http')) {
      try { if (new URL(h).hostname.replace(/^www\./,'') === domain) internalLinks++; else externalLinks++; }
      catch (_) {}
    }
  }

  // FAQ heuristic
  const faqStyleH = [...h2s, ...h3s].filter(h => /\?\s*$/.test(h)).length;
  const hasFAQ = hasFAQSchema || faqStyleH >= 3 || /<h[23][^>]*>\s*FAQ/i.test(clean);

  // Images with alt
  const allImgs = (clean.match(/<img[^>]+>/gi) || []);
  const imgsWithAlt = allImgs.filter(i => /alt=["'][^"']{2,}["']/i.test(i)).length;

  // Featured snippet indicator: concise answer paragraph ≤80 words near top
  const firstParas = (clean.match(/<p[^>]*>([\s\S]{30,600}?)<\/p>/gi) || []).slice(0,5);
  const hasSnippetPara = firstParas.some(p => {
    const t = p.replace(/<[^>]+>/g,'').trim();
    const wc = t.split(/\s+/).length;
    return wc >= 20 && wc <= 80;
  });

  return {
    title, metaDesc, canonical,
    h1s, h2s, h3s,
    wordCount: words.length,
    text: text.slice(0, 2000),
    schemaTypes: Array.from(schemaTypes),
    hasFAQSchema, hasFAQ,
    internalLinks, externalLinks,
    imgsWithAlt, totalImgs: allImgs.length,
    hasSnippetPara,
  };
}

// ── Score engine ─────────────────────────────────────────────────────────────
// Returns { score:0-100, breakdown:{ [subscore]: { score, max, label, status, detail, fix } } }
function _score(sig, keyword) {
  const kw = (keyword || '').toLowerCase().trim();
  const titleL  = sig.title.toLowerCase();
  const metaL   = sig.metaDesc.toLowerCase();
  const h1Text  = sig.h1s.join(' ').toLowerCase();
  const bodyL   = sig.text.toLowerCase();
  const allText = (sig.title + ' ' + sig.metaDesc + ' ' + sig.h1s.join(' ') + ' ' + sig.h2s.join(' ') + ' ' + sig.h3s.join(' ') + ' ' + sig.text).toLowerCase();

  const kwInTitle = kw && titleL.includes(kw);
  const kwInMeta  = kw && metaL.includes(kw);
  const kwInH1    = kw && h1Text.includes(kw);
  const kwInBody  = kw && bodyL.includes(kw);
  const kwDensity = kw && sig.wordCount > 0
    ? Math.round(((bodyL.match(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g')) || []).length / sig.wordCount) * 1000) / 10
    : 0;

  const breakdown = {};

  // 1. Key Terms (15) — keyword present in title, H1, body
  let ktScore = 0, ktDetail = [], ktFix = '';
  if (kw) {
    if (kwInTitle) { ktScore += 5; } else { ktDetail.push('keyword missing from title'); }
    if (kwInH1)   { ktScore += 5; } else { ktDetail.push('keyword missing from H1'); }
    if (kwInBody) { ktScore += 5; } else { ktDetail.push('keyword missing from body'); }
    ktFix = ktDetail.length ? `Add "${keyword}" to: ${ktDetail.join(', ')}.` : '';
  } else {
    ktScore = 10; ktDetail = ['No target keyword provided — using generic checks'];
  }
  breakdown.keyTerms = { score: ktScore, max: 15, label: 'Key Terms', status: ktScore >= 12 ? 'pass' : ktScore >= 6 ? 'warn' : 'fail', detail: ktDetail.join('; ') || 'Keyword well-distributed', fix: ktFix };

  // 2. Meta Tags (15) — title (30-65ch, contains kw) + meta description (70-160ch)
  let mtScore = 0, mtDetail = [], mtFix = '';
  const titleLen = sig.title.length, metaLen = sig.metaDesc.length;
  if (sig.title) {
    if (titleLen >= 30 && titleLen <= 65) { mtScore += 5; } else { mtDetail.push(`title ${titleLen}ch (ideal 30-65)`); }
    if (!kw || kwInTitle) { mtScore += 3; } else { mtDetail.push('keyword absent from title'); }
  } else { mtDetail.push('no <title> tag'); }
  if (sig.metaDesc) {
    if (metaLen >= 70 && metaLen <= 160) { mtScore += 5; } else { mtDetail.push(`meta desc ${metaLen}ch (ideal 70-160)`); }
    if (!kw || kwInMeta) { mtScore += 2; } else { mtDetail.push('keyword absent from meta desc'); }
  } else { mtDetail.push('no meta description'); }
  mtFix = mtDetail.length ? `Fix: ${mtDetail.join('; ')}.` : '';
  breakdown.metaTags = { score: mtScore, max: 15, label: 'Meta Tags', status: mtScore >= 12 ? 'pass' : mtScore >= 6 ? 'warn' : 'fail', detail: mtDetail.join('; ') || 'Title and meta description are well-optimised', fix: mtFix };

  // 3. Content Depth (20) — word count
  let cdScore = 0, cdDetail = '', cdFix = '';
  const wc = sig.wordCount;
  if (wc >= 1500)     { cdScore = 20; cdDetail = `${wc} words — excellent depth`; }
  else if (wc >= 800) { cdScore = 15; cdDetail = `${wc} words — good (target 1500+)`; cdFix = `Expand to 1500+ words by adding case studies, FAQs, or deep-dive sections.`; }
  else if (wc >= 400) { cdScore = 10; cdDetail = `${wc} words — thin content`; cdFix = `Content is thin at ${wc} words. Add 400-1000 more words with examples, data, or a FAQ section.`; }
  else if (wc >= 150) { cdScore = 5;  cdDetail = `${wc} words — very thin`; cdFix = `Only ${wc} words. Aim for 800-1500 words with comprehensive coverage of the topic.`; }
  else                { cdScore = 0;  cdDetail = `${wc} words — insufficient`; cdFix = `Page has almost no readable text. Write substantive content (800+ words) covering the target topic.`; }
  breakdown.contentDepth = { score: cdScore, max: 20, label: 'Content Depth', status: cdScore >= 15 ? 'pass' : cdScore >= 10 ? 'warn' : 'fail', detail: cdDetail, fix: cdFix };

  // 4. Heading Structure (15) — H1/H2/H3 hierarchy
  let hsScore = 0, hsDetail = [], hsFix = '';
  if (sig.h1s.length === 1) { hsScore += 6; } else if (sig.h1s.length > 1) { hsScore += 3; hsDetail.push(`${sig.h1s.length} H1 tags (should be exactly 1)`); } else { hsDetail.push('no H1 tag'); }
  if (sig.h2s.length >= 4) { hsScore += 6; } else if (sig.h2s.length >= 2) { hsScore += 3; hsDetail.push(`only ${sig.h2s.length} H2 sections`); } else { hsDetail.push('no H2 subheadings'); }
  if (sig.h3s.length >= 2) { hsScore += 3; } else if (sig.h3s.length >= 1) { hsScore += 1; hsDetail.push(`only ${sig.h3s.length} H3 subheadings`); }
  hsFix = hsDetail.length ? `Improve heading structure: ${hsDetail.join('; ')}.` : '';
  breakdown.headings = { score: hsScore, max: 15, label: 'Heading Structure', status: hsScore >= 12 ? 'pass' : hsScore >= 7 ? 'warn' : 'fail', detail: hsDetail.join('; ') || `H1×${sig.h1s.length} H2×${sig.h2s.length} H3×${sig.h3s.length}`, fix: hsFix };

  // 5. Featured Snippet (10) — concise answer paragraph + FAQ schema
  let fsScore = 0, fsDetail = '', fsFix = '';
  if (sig.hasFAQSchema) { fsScore = 10; fsDetail = 'FAQPage schema present — strong snippet eligibility'; }
  else if (sig.hasFAQ && sig.hasSnippetPara) { fsScore = 7; fsDetail = 'FAQ section + answer paragraph found'; fsFix = 'Add FAQPage JSON-LD schema to formally mark up your FAQ.'; }
  else if (sig.hasFAQ) { fsScore = 5; fsDetail = 'FAQ headings present but no snippet paragraph'; fsFix = 'Add a concise answer paragraph (40-70 words) directly below the page H1.'; }
  else if (sig.hasSnippetPara) { fsScore = 4; fsDetail = 'Concise answer paragraph found but no FAQ'; fsFix = 'Add a FAQ section with FAQPage JSON-LD schema to boost snippet eligibility.'; }
  else { fsScore = 0; fsDetail = 'No FAQ or concise answer block found'; fsFix = 'Add a 40-70 word summary paragraph right after the H1, plus an FAQ section with FAQPage schema.'; }
  breakdown.featuredSnippet = { score: fsScore, max: 10, label: 'Featured Snippet', status: fsScore >= 8 ? 'pass' : fsScore >= 4 ? 'warn' : 'fail', detail: fsDetail, fix: fsFix };

  // 6. Schema Markup (10)
  let smScore = 0, smDetail = '', smFix = '';
  const richTypes = ['Article','BlogPosting','HowTo','Product','Recipe','Review','VideoObject','Course','FAQPage'];
  const hasRich = sig.schemaTypes.some(t => richTypes.includes(t));
  if (sig.schemaTypes.length >= 2 && hasRich) { smScore = 10; smDetail = `Schema types: ${sig.schemaTypes.join(', ')}`; }
  else if (sig.schemaTypes.length >= 1 && hasRich) { smScore = 7; smDetail = `Schema: ${sig.schemaTypes.join(', ')}`; smFix = 'Add Organization + Article or FAQPage schema for richer search appearance.'; }
  else if (sig.schemaTypes.length >= 1) { smScore = 4; smDetail = `Schema found: ${sig.schemaTypes.join(', ')} — no rich types`; smFix = 'Add a rich schema type (Article, HowTo, FAQPage, Product) alongside existing schema.'; }
  else { smScore = 0; smDetail = 'No JSON-LD schema markup found'; smFix = 'Add Organization schema to your site-wide <head> and Article/FAQPage schema to this page.'; }
  breakdown.schema = { score: smScore, max: 10, label: 'Schema Markup', status: smScore >= 8 ? 'pass' : smScore >= 4 ? 'warn' : 'fail', detail: smDetail, fix: smFix };

  // 7. Links (10) — internal + external
  let lkScore = 0, lkDetail = [], lkFix = '';
  if (sig.internalLinks >= 10) { lkScore += 5; } else if (sig.internalLinks >= 4) { lkScore += 3; lkDetail.push(`${sig.internalLinks} internal links (aim for 10+)`); } else { lkScore += 0; lkDetail.push(`only ${sig.internalLinks} internal links`); }
  if (sig.externalLinks >= 3) { lkScore += 5; } else if (sig.externalLinks >= 1) { lkScore += 3; lkDetail.push(`only ${sig.externalLinks} external links`); } else { lkDetail.push('no external authority links'); }
  lkFix = lkDetail.length ? `Link improvements needed: ${lkDetail.join('; ')}.` : '';
  breakdown.links = { score: lkScore, max: 10, label: 'Links', status: lkScore >= 8 ? 'pass' : lkScore >= 4 ? 'warn' : 'fail', detail: lkDetail.join('; ') || `${sig.internalLinks} internal + ${sig.externalLinks} external links`, fix: lkFix };

  // 8. Images (5) — presence + alt text
  let imgScore = 0, imgDetail = '', imgFix = '';
  if (sig.totalImgs === 0) { imgScore = 1; imgDetail = 'No images found'; imgFix = 'Add at least 1-2 relevant images with keyword-rich alt text.'; }
  else if (sig.imgsWithAlt >= sig.totalImgs) { imgScore = 5; imgDetail = `${sig.totalImgs} images, all with alt text`; }
  else if (sig.imgsWithAlt > 0) { imgScore = 3; imgDetail = `${sig.imgsWithAlt}/${sig.totalImgs} images have alt text`; imgFix = `Add descriptive alt text to the ${sig.totalImgs - sig.imgsWithAlt} image(s) missing it.`; }
  else { imgScore = 1; imgDetail = `${sig.totalImgs} images — none have alt text`; imgFix = `Add descriptive, keyword-relevant alt text to all ${sig.totalImgs} images.`; }
  breakdown.images = { score: imgScore, max: 5, label: 'Images & Alt Text', status: imgScore >= 4 ? 'pass' : imgScore >= 2 ? 'warn' : 'fail', detail: imgDetail, fix: imgFix };

  const total = Object.values(breakdown).reduce((s, b) => s + b.score, 0);
  return { score: total, max: 100, breakdown };
}

// ── OpenAI call ──────────────────────────────────────────────────────────────
function _gptFix(subscore, detail, keyword, pageTitle, maxTokens = 350) {
  return new Promise(resolve => {
    const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    if (!key || /^_DUMMY/i.test(key)) return resolve({ ok: false, suggestion: null });
    const body = JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are an SEO content specialist. Given a failing page audit subscore, return a precise, actionable fix. Reply ONLY with valid JSON: {"suggestion":"...","example":"..."} — no markdown, no preamble.' },
        { role: 'user', content: `Page title: "${pageTitle}"\nTarget keyword: "${keyword || 'not specified'}"\nFailing subscore: "${subscore}"\nCurrent state: ${detail}\n\nProvide a specific, actionable fix suggestion (2-4 sentences) and a short example or template the user can copy.` },
      ],
    });
    const req = _https.request({
      hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const j = JSON.parse(d);
          const txt = j?.choices?.[0]?.message?.content;
          const parsed = JSON.parse(txt);
          resolve({ ok: true, suggestion: parsed.suggestion || '', example: parsed.example || '' });
        } catch { resolve({ ok: false, suggestion: null }); }
      });
    });
    req.on('error', () => resolve({ ok: false, suggestion: null }));
    req.setTimeout(25000, () => { req.destroy(); resolve({ ok: false, suggestion: null }); });
    req.write(body); req.end();
  });
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/content-score/score
router.post('/score', _safe(async (req, res) => {
  const body = req.body || {};
  let url = String(body.url || '').trim();
  const keyword = String(body.keyword || '').trim().slice(0, 120);
  if (!url) return _err(res, 400, 'url is required');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  const fetched = await _fetchPage(url);
  if (!fetched.ok) return _err(res, 502, `Could not fetch page: ${fetched.error}`);

  const sig = _signals(fetched.html, url);
  const { score, max, breakdown } = _score(sig, keyword);

  if (_db.hasDb()) {
    try {
      await _db.getPool().query(
        `INSERT INTO content_score_runs (url, keyword, score, breakdown) VALUES ($1,$2,$3,$4)`,
        [url, keyword, score, JSON.stringify(breakdown)]
      );
    } catch (e) { console.warn('[content-score] insert failed', e.message); }
  }

  res.json({ ok: true, url, keyword, score, max, breakdown, signals: { wordCount: sig.wordCount, h1Count: sig.h1s.length, h2Count: sig.h2s.length, schemaTypes: sig.schemaTypes, hasFAQ: sig.hasFAQ } });
}));

// POST /api/content-score/fix
router.post('/fix', _safe(async (req, res) => {
  const body = req.body || {};
  const subscore = String(body.subscore || '').trim();
  const detail   = String(body.detail || '').trim().slice(0, 400);
  const keyword  = String(body.keyword || '').trim().slice(0, 120);
  const pageTitle= String(body.pageTitle || '').trim().slice(0, 200);
  if (!subscore) return _err(res, 400, 'subscore is required');
  if (!_hasOpenAI()) return _err(res, 503, 'OpenAI not configured');
  const result = await _gptFix(subscore, detail, keyword, pageTitle);
  res.json({ ok: true, subscore, ...result });
}));

// POST /api/content-score/auto-optimize  — fix ALL failing subscores in one call
router.post('/auto-optimize', _safe(async (req, res) => {
  const body = req.body || {};
  let url = String(body.url || '').trim();
  const keyword = String(body.keyword || '').trim().slice(0, 120);
  if (!url) return _err(res, 400, 'url is required');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  if (!_hasOpenAI()) return _err(res, 503, 'OpenAI not configured');

  const fetched = await _fetchPage(url);
  if (!fetched.ok) return _err(res, 502, `Could not fetch page: ${fetched.error}`);
  const sig = _signals(fetched.html, url);
  const { score, max, breakdown } = _score(sig, keyword);

  const failing = Object.entries(breakdown)
    .filter(([, b]) => b.status !== 'pass' && b.fix)
    .slice(0, 6); // cap at 6 concurrent GPT calls

  const fixes = {};
  await Promise.all(failing.map(async ([key, b]) => {
    const r = await _gptFix(b.label, b.detail, keyword, sig.title, 280);
    fixes[key] = { label: b.label, suggestion: r.suggestion || b.fix, example: r.example || '' };
  }));

  res.json({ ok: true, url, keyword, score, max, breakdown, fixes });
}));

// GET /api/content-score/runs
router.get('/runs', _safe(async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, runs: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'content_score:runs' });
  const r = await _db.getPool().query(
    `SELECT id, url, keyword, score, created_at FROM content_score_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30`,
    [tid]
  );
  res.json({ ok: true, runs: r.rows });
}));

module.exports = router;
