const express    = require('express');
const _https     = require('https');
const _db        = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }

// ── DataForSEO helper ──────────────────────────────────────────────────────
function _dfsPost(path, body) {
  return new Promise(resolve => {
    const u = process.env.DATAFORSEO_LOGIN;
    const p = process.env.DATAFORSEO_PASSWORD;
    if (!u || !p) return resolve({ ok: false, error: 'DataForSEO not configured' });
    const auth    = 'Basic ' + Buffer.from(u + ':' + p).toString('base64');
    const payload = JSON.stringify(body);
    const req = _https.request({
      hostname: 'api.dataforseo.com', path, method: 'POST',
      headers: { 'Authorization': auth, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload) },
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const json = JSON.parse(d);
          if (json.status_code !== 20000) return resolve({ ok: false, error: json.status_message, raw: json });
          resolve({ ok: true, tasks: json.tasks || [] });
        } catch { resolve({ ok: false, error: 'parse error' }); }
      });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.setTimeout(30000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.write(payload); req.end();
  });
}

function _dfsItems(r) { return r?.tasks?.[0]?.result?.[0]?.items || []; }

// ── Firecrawl scraper ──────────────────────────────────────────────────────
function _scrape(url) {
  return new Promise(resolve => {
    const key = process.env.FIRECRAWL_API_KEY;
    if (!key) return resolve(null);
    const body = JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true });
    const req = _https.request({
      hostname: 'api.firecrawl.dev', path: '/v1/scrape', method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body) },
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const json = JSON.parse(d);
          if (!json.success) return resolve(null);
          const md = json.data?.markdown || '';
          // parse headings
          const headings = (md.match(/^#{1,3} .+/gm) || []).map(h => h.replace(/^#+\s*/, '').trim()).slice(0, 20);
          // word count
          const words = md.split(/\s+/).filter(Boolean).length;
          // meta from metadata
          const title = json.data?.metadata?.title || '';
          const meta  = json.data?.metadata?.description || '';
          resolve({ url, title, meta, headings, words });
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(20000, () => { req.destroy(); resolve(null); });
    req.write(body); req.end();
  });
}

// ── OpenAI brief synthesis ─────────────────────────────────────────────────
function _aiCall(messages, tokens) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return Promise.resolve(null);
  const body = JSON.stringify({
    model: 'gpt-4o-mini',
    messages,
    response_format: { type: 'json_object' },
    temperature: 0.4,
    max_tokens: tokens || 3000,
  });
  return new Promise(resolve => {
    const req = _https.request({
      hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body) },
    }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => {
        try {
          if (r.statusCode !== 200) return resolve(null);
          resolve(JSON.parse(JSON.parse(d).choices[0].message.content));
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(60000, () => req.destroy());
    req.write(body); req.end();
  });
}

// ── Template fallback ──────────────────────────────────────────────────────
function _templateBrief(keyword, competitorPages) {
  const avgWords = competitorPages.length
    ? Math.round(competitorPages.reduce((s, p) => s + (p.words || 0), 0) / competitorPages.length)
    : 1200;
  const target = Math.max(avgWords + 200, 1000);
  return {
    title: `The Complete Guide to ${keyword}`,
    seo_title: `${keyword} — Complete Guide (${new Date().getFullYear()})`,
    meta_description: `Everything you need to know about ${keyword}. Expert advice, tips, and strategies to get results in ${new Date().getFullYear()}.`,
    target_word_count: target,
    headings: [
      `What is ${keyword}?`,
      `Why ${keyword} matters`,
      `How to get started with ${keyword}`,
      `Best practices for ${keyword}`,
      `Common mistakes to avoid`,
      `Frequently asked questions`,
    ],
    must_cover_topics: [
      `Definition and overview of ${keyword}`,
      `Key benefits and use cases`,
      `Step-by-step implementation`,
      `Tools and resources`,
      `Real-world examples`,
    ],
    entities: [],
    questions_to_answer: [
      `What is ${keyword}?`,
      `How does ${keyword} work?`,
      `What are the benefits of ${keyword}?`,
      `How do I get started with ${keyword}?`,
    ],
    unique_angle: `Cover the topic more comprehensively than competitors by including data, examples, and actionable steps they missed.`,
    recommendations: [
      `Target ${target} words — ${avgWords > 0 ? `competitors average ${avgWords} words` : 'aim for depth over brevity'}`,
      `Include a FAQ section addressing the most common questions`,
      `Add original data or case studies to stand out from competitors`,
      `Use clear H2/H3 structure to match competitor heading patterns`,
    ],
    source: 'template',
  };
}

// ── POST /generate ─────────────────────────────────────────────────────────
router.post('/generate', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'content-brief:generate' });
  if (!tid) return _err(res, 400, 'no_tenant');

  const { keyword, location_code = 2840, language_code = 'en' } = req.body || {};
  if (!keyword || !keyword.trim()) return _err(res, 400, 'keyword is required');

  const kw = keyword.trim();

  // Run SERP + related keywords concurrently
  const [serpRes, relatedRes] = await Promise.all([
    _dfsPost('/v3/serp/google/organic/live/regular', [
      { keyword: kw, location_code, language_code, depth: 10 },
    ]),
    _dfsPost('/v3/dataforseo_labs/google/related_keywords/live', [
      { keyword: kw, location_code, language_code, limit: 40,
        filters: ['keyword_data.keyword_info.search_volume', '>', 0],
        order_by: ['keyword_data.keyword_info.search_volume,desc'] },
    ]),
  ]);

  // Parse SERP — top 10 organic URLs
  const serpItems = _dfsItems(serpRes).filter(i => i.type === 'organic').slice(0, 10);
  const serpSnapshot = serpItems.map(i => ({
    rank: i.rank_group,
    url: i.url,
    title: i.title,
    description: i.description,
  }));

  // Scrape top 5 competitor pages concurrently
  const topUrls = serpSnapshot.slice(0, 5).map(p => p.url);
  const scraped = await Promise.all(topUrls.map(url => _scrape(url)));
  const competitorPages = scraped.filter(Boolean);

  // Parse related keywords
  const rawRelated = _dfsItems(relatedRes);
  const relatedKws = rawRelated.map(item => ({
    keyword:       item.keyword_data?.keyword,
    search_volume: item.keyword_data?.keyword_info?.search_volume ?? null,
    difficulty:    item.keyword_data?.keyword_info?.keyword_difficulty ?? null,
    relevance:     item.relevance ?? null,
  })).filter(k => k.keyword).slice(0, 30);

  // Compute competitor stats
  const avgWords = competitorPages.length
    ? Math.round(competitorPages.reduce((s, p) => s + (p.words || 0), 0) / competitorPages.length)
    : 0;
  const allHeadings = competitorPages.flatMap(p => p.headings || []);

  // AI synthesis
  const aiPrompt = `You are an expert SEO content strategist. Generate a detailed content brief for the target keyword.

Keyword: "${kw}"
Location: ${location_code}

Top-ranking competitor pages (scraped data):
${competitorPages.map(p => `- URL: ${p.url}\n  Title: ${p.title}\n  Words: ${p.words}\n  Headings: ${p.headings.slice(0, 8).join(' | ')}`).join('\n')}

Average competitor word count: ${avgWords}
Common headings across top pages: ${[...new Set(allHeadings)].slice(0, 15).join(' | ')}

Related keywords (search volume):
${relatedKws.slice(0, 15).map(k => `${k.keyword} (${k.search_volume ?? 'n/a'}/mo)`).join(', ')}

Return STRICT JSON:
{
  "title": "H1 title (include keyword naturally)",
  "seo_title": "Under 60 chars, includes keyword",
  "meta_description": "Under 155 chars, compelling, includes keyword",
  "target_word_count": <integer — beat avg by 15-20%>,
  "headings": ["H2 heading 1", "H2 heading 2", ...],
  "must_cover_topics": ["topic 1", "topic 2", ...],
  "entities": ["named entity / concept to mention", ...],
  "questions_to_answer": ["Question 1?", "Question 2?", ...],
  "unique_angle": "How to differentiate and outrank competitors",
  "recommendations": ["Specific, actionable recommendation 1", ...]
}
Rules: minimum 6 headings, minimum 5 must_cover_topics, minimum 4 questions, minimum 4 recommendations. No placeholder text.`;

  const ai = await _aiCall([
    { role: 'system', content: 'You are an SEO expert. Return only valid JSON, no markdown.' },
    { role: 'user', content: aiPrompt },
  ], 2000);

  const brief = ai
    ? { ...ai, source: 'ai' }
    : _templateBrief(kw, competitorPages);

  // Persist
  const row = await _db.getPool().query(
    `INSERT INTO content_brief_runs
       (tenant_id, keyword, location_code, brief, related_kws, competitor_pages, serp_snapshot, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, created_at`,
    [tid, kw, location_code,
     JSON.stringify(brief),
     JSON.stringify(relatedKws),
     JSON.stringify(competitorPages),
     JSON.stringify(serpSnapshot),
     brief.source || 'ai']
  );

  res.json({
    ok: true,
    id: row.rows[0].id,
    keyword: kw,
    brief,
    related_keywords: relatedKws,
    competitor_pages: competitorPages,
    serp_snapshot: serpSnapshot,
    avg_word_count: avgWords,
    created_at: row.rows[0].created_at,
  });
});

// ── GET / — list briefs ────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'content-brief:list' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const rows = await _db.getPool().query(
    `SELECT id, keyword, source, created_at FROM content_brief_runs
     WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30`,
    [tid]
  );
  res.json({ ok: true, briefs: rows.rows });
});

// ── GET /:id — single brief ────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'content-brief:get' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const row = await _db.getPool().query(
    `SELECT * FROM content_brief_runs WHERE id=$1 AND tenant_id=$2`,
    [req.params.id, tid]
  );
  if (!row.rows.length) return _err(res, 404, 'not found');
  const r = row.rows[0];
  res.json({ ok: true, ...r });
});

// ── DELETE /:id ────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'content-brief:delete' });
  if (!tid) return _err(res, 400, 'no_tenant');
  await _db.getPool().query(
    `DELETE FROM content_brief_runs WHERE id=$1 AND tenant_id=$2`,
    [req.params.id, tid]
  );
  res.json({ ok: true });
});

module.exports = router;
