// Tier 30 — GEO Audit (Generative Engine Optimization)
// Scores how well a page is structured to be cited by ChatGPT / Perplexity /
// Gemini answers. 10 weighted checks summing to 100, A–F grade, prioritised
// fixes. Pure HTML regex parsing — no LLM call required for the core audit.
// Also includes AI Citation Tracking: queries OpenAI / Perplexity / Gemini
// with page-derived questions and records whether your domain is cited.
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const _https = require('https');
const _http = require('http');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { isUrlSafeToFetch } = require('../_shared/ssrf');
const _headless = require('../_shared/headless_fetch');
const OpenAI = require('openai');

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safeAsync(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch(e => {
    console.warn('[geo-audit]', e.stack || e.message);
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
      headers: { 'User-Agent': 'Mozilla/5.0 InfoGenie-GEO-Audit/1.0', 'Accept': 'text/html' }
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

function _probe(rawUrl) {
  return new Promise(async resolve => {
    const safe = await isUrlSafeToFetch(rawUrl);
    if (!safe.ok) return resolve(false);
    let u; try { u = new URL(rawUrl); } catch { return resolve(false); }
    const lib = u.protocol === 'https:' ? _https : _http;
    const req = lib.request({ hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname, method: 'HEAD',
      headers: { 'User-Agent': 'InfoGenie-GEO-Audit' } }, r => {
      r.resume(); resolve(r.statusCode >= 200 && r.statusCode < 300);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(4000, () => { req.destroy(); resolve(false); });
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

function _runChecks(html, finalUrl, sidecars) {
  const lower = html.toLowerCase();
  const text = _stripTags(html);
  const words = text.split(/\s+/).filter(Boolean);
  const checks = [];
  const C = (id, label, status, weight, message, fix) => checks.push({
    id, label, status, weight,
    earned: status === 'pass' ? weight : status === 'warn' ? Math.floor(weight / 2) : 0,
    message, fix
  });

  // 1. Clear question-style headings (h2/h3 ending in ?) — LLMs love Q&A structure (12 pts)
  const h2h3 = (html.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi) || []).map(s => _stripTags(s));
  const qHeadings = h2h3.filter(h => /\?\s*$/.test(h)).length;
  if (qHeadings >= 3) C('q_headings', 'Question-style H2/H3 headings', 'pass', 12, `${qHeadings} question headings found.`, '');
  else if (qHeadings >= 1) C('q_headings', 'Question-style H2/H3 headings', 'warn', 12, `Only ${qHeadings} question heading(s). Aim for 3+.`, 'Rewrite section headings as natural questions a user would ask (e.g. "How does X work?", "What are the benefits of Y?"). LLMs prefer Q&A structures because that\'s how users ask them.');
  else C('q_headings', 'Question-style H2/H3 headings', 'fail', 12, 'No question-style headings.', 'Convert at least 3 H2/H3 headings into natural questions ending with ?');

  // 2. JSON-LD schema present (12 pts)
  const ldjsonBlocks = (html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || []);
  const ldjsonCount = ldjsonBlocks.length;
  let hasFAQ = false, hasArticle = false, hasOrg = false;
  for (const blk of ldjsonBlocks) {
    const inner = blk.replace(/<[^>]+>/g, '').trim();
    if (/"@type"\s*:\s*"FAQPage"/i.test(inner)) hasFAQ = true;
    if (/"@type"\s*:\s*"Article"/i.test(inner) || /"@type"\s*:\s*"BlogPosting"/i.test(inner)) hasArticle = true;
    if (/"@type"\s*:\s*"Organization"/i.test(inner)) hasOrg = true;
  }
  if (hasFAQ || (ldjsonCount >= 2 && (hasArticle || hasOrg))) C('schema', 'JSON-LD structured data', 'pass', 12, `${ldjsonCount} schema block(s)${hasFAQ ? ' incl. FAQPage' : ''}${hasArticle ? ' incl. Article' : ''}.`, '');
  else if (ldjsonCount >= 1) C('schema', 'JSON-LD structured data', 'warn', 12, `${ldjsonCount} schema block(s) but missing FAQPage / Article.`, 'Add a FAQPage schema with the 3-5 most-asked questions on this page. AI engines lean heavily on FAQPage and Article schema for answer extraction.');
  else C('schema', 'JSON-LD structured data', 'fail', 12, 'No JSON-LD structured data.', 'Use the InfoGenie Schema Generator (T25) to add at minimum Organization + FAQPage JSON-LD to this page.');

  // 3. Concise answer paragraphs (avg paragraph ≤ 80 words) (10 pts)
  const paragraphs = (html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || []).map(s => _stripTags(s)).filter(p => p.split(/\s+/).length >= 5);
  const avgPara = paragraphs.length ? paragraphs.reduce((s, p) => s + p.split(/\s+/).length, 0) / paragraphs.length : 0;
  if (paragraphs.length === 0) C('concise_paras', 'Concise answer paragraphs', 'fail', 10, 'No real <p> paragraphs found.', 'Wrap your content in <p> tags with paragraphs of 30-80 words each. AI engines extract paragraph-level snippets.');
  else if (avgPara <= 80) C('concise_paras', 'Concise answer paragraphs (≤80 words avg)', 'pass', 10, `${paragraphs.length} paragraphs, avg ${Math.round(avgPara)} words.`, '');
  else if (avgPara <= 120) C('concise_paras', 'Concise answer paragraphs', 'warn', 10, `${paragraphs.length} paragraphs, avg ${Math.round(avgPara)} words (ideal ≤80).`, 'Break long paragraphs into shorter ones of 30-80 words. AI engines prefer to lift single paragraphs as direct answers.');
  else C('concise_paras', 'Concise answer paragraphs', 'fail', 10, `Avg ${Math.round(avgPara)} words/paragraph — too long for AI extraction.`, 'Aggressively break paragraphs to 30-80 words each so AI engines can lift discrete answers.');

  // 4. Author / E-E-A-T signals (10 pts)
  const hasAuthor = /\bauthor\b/i.test(html) && (/<meta[^>]+name=["']author["']/i.test(html) || /"author"\s*:/i.test(html) || /by\s+<a/i.test(html) || /class=["'][^"']*author/i.test(html));
  const hasBio = /class=["'][^"']*(?:author|bio|byline)/i.test(html);
  if (hasAuthor && hasBio) C('eeat', 'Author / E-E-A-T signals', 'pass', 10, 'Author + bio found.', '');
  else if (hasAuthor) C('eeat', 'Author / E-E-A-T signals', 'warn', 10, 'Author present but no bio block.', 'Add a short author bio block with credentials, photo and link to a dedicated author page. Helps AI engines decide whether to cite you.');
  else C('eeat', 'Author / E-E-A-T signals', 'fail', 10, 'No author attribution found.', 'Attribute the article to a named author with a short bio (credentials, link to author page). E-E-A-T strongly influences AI citation likelihood.');

  // 5. Freshness — visible date or article:published_time (8 pts)
  const hasOG = /<meta[^>]+property=["']article:(published_time|modified_time)["'][^>]+content=["']([^"']+)["']/i.test(html);
  const hasDateTag = /<time[^>]+datetime=["']([^"']+)["']/i.test(html);
  let isFresh = false, dateStr = '';
  const ogMatch = html.match(/<meta[^>]+property=["']article:(?:modified_time|published_time)["'][^>]+content=["']([^"']+)["']/i);
  const tMatch  = html.match(/<time[^>]+datetime=["']([^"']+)["']/i);
  const cand = (ogMatch && ogMatch[1]) || (tMatch && tMatch[1]) || '';
  if (cand) {
    const t = Date.parse(cand);
    if (!isNaN(t)) { dateStr = new Date(t).toISOString().slice(0,10); isFresh = (Date.now() - t) < 1000*60*60*24*365; }
  }
  if (isFresh) C('freshness', 'Freshness signals', 'pass', 8, `Last published/modified ${dateStr}.`, '');
  else if (hasOG || hasDateTag) C('freshness', 'Freshness signals', 'warn', 8, `Date present (${dateStr || 'unparseable'}) but >1y old.`, 'Republish or refresh the page and update <meta property="article:modified_time"> to the new date. Recency signals matter to AI engines.');
  else C('freshness', 'Freshness signals', 'fail', 8, 'No published/modified date in metadata or <time> tag.', 'Add <meta property="article:published_time" content="2026-01-15"> and a visible <time datetime="..."> on the page.');

  // 6. Page reads as a direct answer — first <p> ≤ 60 words and complete sentence (10 pts)
  if (paragraphs.length) {
    const first = paragraphs[0];
    const firstW = first.split(/\s+/).length;
    if (firstW >= 15 && firstW <= 60 && /[.!?]\s*$/.test(first)) C('lead_answer', 'Lead paragraph as direct answer', 'pass', 10, `Lead is ${firstW} words.`, '');
    else if (firstW >= 10 && firstW <= 90) C('lead_answer', 'Lead paragraph as direct answer', 'warn', 10, `Lead is ${firstW} words (ideal 15-60).`, 'Open with a single complete-sentence paragraph of 15-60 words that directly answers the page\'s primary question. AI engines extract leading paragraphs as snippets.');
    else C('lead_answer', 'Lead paragraph as direct answer', 'fail', 10, `Lead is ${firstW} words — not a clean snippet.`, 'Rewrite the first paragraph as a 15-60 word direct answer to the page\'s main question.');
  } else {
    C('lead_answer', 'Lead paragraph as direct answer', 'fail', 10, 'No paragraphs found.', 'Open with a 15-60 word direct-answer paragraph in a <p> tag.');
  }

  // 7. Lists & tables (semantic chunking) (8 pts)
  const lists = (html.match(/<(ul|ol)\b/gi) || []).length;
  const tables = (html.match(/<table\b/gi) || []).length;
  const sem = lists + tables;
  if (sem >= 3) C('semantic_chunks', 'Lists & tables', 'pass', 8, `${lists} list(s), ${tables} table(s).`, '');
  else if (sem >= 1) C('semantic_chunks', 'Lists & tables', 'warn', 8, `${sem} list/table block(s). Aim for 3+.`, 'Add bullet lists, ordered steps and comparison tables — AI engines lift these wholesale into answers.');
  else C('semantic_chunks', 'Lists & tables', 'fail', 8, 'No lists or tables found.', 'Convert at least one section into a bulleted list and one into a comparison table.');

  // 8. Image alt-text coverage (6 pts)
  const imgs = (html.match(/<img\b[^>]*>/gi) || []);
  const altImgs = imgs.filter(i => /\balt\s*=\s*["'][^"']+["']/i.test(i)).length;
  const altPct = imgs.length ? Math.round((altImgs / imgs.length) * 100) : 100;
  if (imgs.length === 0 || altPct >= 90) C('alt_text', 'Image alt-text coverage', 'pass', 6, imgs.length ? `${altPct}% of ${imgs.length} images have alt text.` : 'No images on page.', '');
  else if (altPct >= 60) C('alt_text', 'Image alt-text coverage', 'warn', 6, `Only ${altPct}% of images have alt text.`, 'Add descriptive alt text to every image — AI engines use alt text to understand visual context.');
  else C('alt_text', 'Image alt-text coverage', 'fail', 6, `${altPct}% alt coverage — too low.`, 'Add descriptive alt text to all images.');

  // 9. Internal linking (citations to deeper content) (6 pts)
  let host = ''; try { host = new URL(finalUrl).host; } catch {}
  const aTags = html.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi) || [];
  let internal = 0;
  for (const a of aTags) {
    const m = a.match(/href=["']([^"']+)["']/i);
    if (!m) continue;
    try {
      const u = new URL(m[1], finalUrl);
      if (u.host === host) internal++;
    } catch {}
  }
  if (internal >= 5) C('internal_links', 'Internal links', 'pass', 6, `${internal} internal links.`, '');
  else if (internal >= 2) C('internal_links', 'Internal links', 'warn', 6, `${internal} internal links (aim for 5+).`, 'Link out to 5+ related pages on your site. AI engines follow internal links to build topical authority.');
  else C('internal_links', 'Internal links', 'fail', 6, `Only ${internal} internal links.`, 'Add at least 5 contextual internal links to related deeper content.');

  // 10. /llms.txt present (8 pts) — emerging AI standard for content licensing/preference
  if (sidecars && sidecars.llmsTxt) C('llms_txt', '/llms.txt for AI engines', 'pass', 8, '/llms.txt found at site root.', '');
  else C('llms_txt', '/llms.txt for AI engines', 'warn', 8, 'No /llms.txt at site root.', 'Add a /llms.txt file at your site root listing the canonical pages you want AI engines to cite. New emerging standard adopted by Anthropic and others.');

  // 11. <title> present and concise — needed for AI snippet titles (5 pts)
  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleM ? titleM[1].trim() : '';
  if (title && title.length >= 20 && title.length <= 70) C('title', 'Page title (20-70 chars)', 'pass', 5, `Title: "${title.slice(0,80)}"`, '');
  else if (title) C('title', 'Page title', 'warn', 5, `Title is ${title.length} chars (ideal 20-70).`, 'Rewrite title to 20-70 chars summarising the answer this page provides.');
  else C('title', 'Page title', 'fail', 5, 'No <title> tag.', 'Add a <title> tag of 20-70 chars summarising the page.');

  // 12. Meta description as snippet seed (5 pts)
  const dM = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
          || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  const dt = dM ? dM[1].trim() : '';
  if (dt && dt.length >= 70 && dt.length <= 160) C('meta_desc', 'Meta description (70-160 chars)', 'pass', 5, `${dt.length} chars.`, '');
  else if (dt) C('meta_desc', 'Meta description', 'warn', 5, `${dt.length} chars (ideal 70-160).`, 'Rewrite meta description as a 70-160 char direct answer summary.');
  else C('meta_desc', 'Meta description', 'fail', 5, 'No meta description.', 'Add a 70-160 char meta description summarising the page\'s direct answer.');

  return { checks, words: words.length, paragraphs: paragraphs.length, qHeadings, ldjsonCount };
}

async function _runGeoAudit(url, opts = {}) {
  const safe = await isUrlSafeToFetch(url);
  if (!safe.ok) return { ok: false, error: safe.error };
  const fetched = (opts.headless && _headless.isAvailable())
    ? await _headless.fetchHtmlHeadless(url)
    : await _fetchHtml(url);
  if (!fetched.ok) return { ok: false, error: fetched.error };
  let originRoot = '';
  try { const u = new URL(fetched.finalUrl); originRoot = `${u.protocol}//${u.host}`; } catch {}
  const llmsTxt = originRoot ? await _probe(originRoot + '/llms.txt') : false;
  const r = _runChecks(fetched.html, fetched.finalUrl, { llmsTxt });
  const totalW = r.checks.reduce((s, c) => s + c.weight, 0);
  const earned = r.checks.reduce((s, c) => s + c.earned, 0);
  const score  = Math.round((earned / totalW) * 100);
  const grade  = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
  return {
    ok: true, url: fetched.finalUrl, score, grade,
    summary: { words: r.words, paragraphs: r.paragraphs, qHeadings: r.qHeadings, schemaBlocks: r.ldjsonCount,
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
  const result = await _runGeoAudit(url, { headless: !!(req.body && req.body.headless) });
  if (!result.ok) return _err(res, 400, result.error);
  if (_db.hasDb && _db.hasDb()) {
    try {
      const id = 'geo_' + crypto.randomBytes(6).toString('hex');
      const tid = await _tenantCtx.resolveTenantId(req, { label: 'geo_audit:run' });
      await _db.getPool().query(
        `INSERT INTO geo_audit_runs (tenant_id, id, url, score, grade, summary, checks) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [tid, id, result.url, result.score, result.grade, JSON.stringify(result.summary), JSON.stringify(result.checks)]
      );
      result.id = id;
    } catch (e) { console.warn('[geo-audit] insert failed', e.message); }
  }
  res.json(result);
}));

router.get('/runs', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok: true, runs: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'geo_audit:runs' });
  const r = await _db.getPool().query(
    `SELECT id, url, score, grade, summary, created_at FROM geo_audit_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30`,
    [tid]
  );
  res.json({ ok: true, runs: r.rows });
}));

router.get('/runs/:id', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 503, 'Database unavailable');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'geo_audit:run' });
  const r = await _db.getPool().query(`SELECT * FROM geo_audit_runs WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  if (!r.rowCount) return _err(res, 404, 'Run not found');
  res.json({ ok: true, run: r.rows[0] });
}));

// ── AI Citation Tracking ──────────────────────────────────────────────────────

function _extractQuerySignals(html) {
  const strip = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleM ? strip(titleM[1]) : '';
  const descM = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
              || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  const desc = descM ? descM[1].trim() : '';
  const h1M = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const h1 = h1M ? strip(h1M[1]) : '';
  const h2s = (html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/gi) || []).map(strip).filter(Boolean).slice(0, 3);

  const topic = h1 || title || desc || '';
  const queries = [];

  if (topic) {
    queries.push(`What is ${topic}?`);
    queries.push(`Who provides the best ${topic}?`);
  }
  if (h2s[0]) queries.push(`${h2s[0].replace(/\?$/, '')}?`);
  if (h2s[1]) queries.push(`${h2s[1].replace(/\?$/, '')}?`);
  if (desc && !queries.some(q => q.includes(desc.slice(0, 30)))) {
    queries.push(desc.slice(0, 120));
  }

  return queries.filter(Boolean).slice(0, 5);
}

async function _runCitationCheck(domain, queries) {
  const results = [];
  const openai = process.env.AI_INTEGRATIONS_OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY }) : null;

  const domainCore = domain.replace(/^www\./, '').toLowerCase();

  for (const query of queries) {
    const row = { query, providers: [] };

    // OpenAI
    if (openai) {
      try {
        const r = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: query }],
          max_tokens: 400,
        });
        const answer = r.choices[0]?.message?.content || '';
        const cited = answer.toLowerCase().includes(domainCore);
        const competitorRegex = /([a-z0-9-]+\.(?:com|io|co|net|ai|org))/gi;
        const competitors = [...(answer.matchAll(competitorRegex) || [])]
          .map(m => m[1]).filter(d => !d.includes(domainCore)).slice(0, 4);
        row.providers.push({ name: 'ChatGPT', cited, answer: answer.slice(0, 400), competitors });
      } catch (e) { row.providers.push({ name: 'ChatGPT', cited: false, error: e.message, competitors: [] }); }
    }

    // Perplexity
    if (process.env.PERPLEXITY_API_KEY) {
      try {
        const r = await fetch('https://api.perplexity.ai/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'sonar', messages: [{ role: 'user', content: query }], max_tokens: 400 }),
        });
        const j = await r.json();
        const answer = j.choices?.[0]?.message?.content || '';
        const cited = answer.toLowerCase().includes(domainCore);
        const competitorRegex = /([a-z0-9-]+\.(?:com|io|co|net|ai|org))/gi;
        const competitors = [...(answer.matchAll(competitorRegex) || [])]
          .map(m => m[1]).filter(d => !d.includes(domainCore)).slice(0, 4);
        row.providers.push({ name: 'Perplexity', cited, answer: answer.slice(0, 400), competitors });
      } catch (e) { row.providers.push({ name: 'Perplexity', cited: false, error: e.message, competitors: [] }); }
    }

    // Gemini
    if (process.env.GEMINI_API_KEY) {
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: query }] }], generationConfig: { maxOutputTokens: 400 } }),
          }
        );
        const j = await r.json();
        const answer = j.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const cited = answer.toLowerCase().includes(domainCore);
        const competitorRegex = /([a-z0-9-]+\.(?:com|io|co|net|ai|org))/gi;
        const competitors = [...(answer.matchAll(competitorRegex) || [])]
          .map(m => m[1]).filter(d => !d.includes(domainCore)).slice(0, 4);
        row.providers.push({ name: 'Gemini', cited, answer: answer.slice(0, 400), competitors });
      } catch (e) { row.providers.push({ name: 'Gemini', cited: false, error: e.message, competitors: [] }); }
    }

    results.push(row);
  }

  const totalProbes = results.reduce((s, r) => s + r.providers.length, 0);
  const totalCited  = results.reduce((s, r) => s + r.providers.filter(p => p.cited).length, 0);
  const citationRate = totalProbes > 0 ? parseFloat((totalCited / totalProbes).toFixed(3)) : 0;

  return { queries, results, citationRate, totalProbes, totalCited };
}

router.post('/runs/:id/cite-check', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 503, 'Database unavailable');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'geo_audit:cite-check' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const p = _db.getPool();

  const runRow = await p.query(`SELECT * FROM geo_audit_runs WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  if (!runRow.rowCount) return _err(res, 404, 'Run not found');
  const run = runRow.rows[0];

  let domain = '';
  try { domain = new URL(run.url).hostname; } catch { return _err(res, 400, 'Invalid URL in run'); }

  const fetched = await _fetchHtml(run.url);
  const queries = fetched.ok ? _extractQuerySignals(fetched.html) : [`What is ${domain}?`, `Who provides ${domain}?`];
  if (!queries.length) queries.push(`What is ${domain}?`);

  const check = await _runCitationCheck(domain, queries);

  const id = 'gcite_' + crypto.randomBytes(6).toString('hex');
  await p.query(
    `INSERT INTO geo_citation_checks(id, run_id, tenant_id, domain, queries, results, citation_rate)
     VALUES($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (id) DO NOTHING`,
    [id, run.id, tid, domain, JSON.stringify(check.queries), JSON.stringify(check.results), check.citationRate]
  );

  res.json({ ok: true, id, domain, ...check });
}));

router.get('/runs/:id/cite-check', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok: true, check: null });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'geo_audit:cite-check-get' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const p = _db.getPool();
  const r = await p.query(
    `SELECT * FROM geo_citation_checks WHERE run_id=$1 AND tenant_id=$2 ORDER BY checked_at DESC LIMIT 1`,
    [req.params.id, tid]
  );
  res.json({ ok: true, check: r.rows[0] || null });
}));

module.exports = router;
module.exports.runGeoAudit = _runGeoAudit;
