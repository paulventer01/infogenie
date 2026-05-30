const express = require('express');
const router  = express.Router();
const _db     = require('../../db');
const _tenantCtx = require('../tenants/context');

const _err = (res, code, msg) => res.status(code).json({ ok: false, error: msg });

function _hasPerplexity() { return !!process.env.PERPLEXITY_API_KEY; }
function _hasFirecrawl()  { return !!process.env.FIRECRAWL_API_KEY; }

// ── GET /test ─────────────────────────────────────────────────────────────────
router.get('/test', (req, res) => {
  res.json({
    ok: true,
    perplexity: _hasPerplexity(),
    firecrawl: _hasFirecrawl(),
    note: !_hasPerplexity() ? 'PERPLEXITY_API_KEY required for LinkedIn Ad research.' : null
  });
});

// ── POST /search ──────────────────────────────────────────────────────────────
// { company, industry? }
router.post('/search', async (req, res) => {
  if (!_hasPerplexity()) return _err(res, 503, 'PERPLEXITY_API_KEY not configured.');
  const company  = String(req.body?.company || '').trim();
  const industry = String(req.body?.industry || '').trim();
  if (!company) return _err(res, 400, 'company required');

  const prompt = `You are a paid advertising analyst. Research "${company}"${industry ? ` in the ${industry} industry` : ''} and their LinkedIn advertising strategy.

Return ONLY valid JSON with this exact structure — no extra text:
{
  "company": "${company}",
  "overview": "2-3 sentence summary of their LinkedIn ad approach",
  "ad_formats": [{"format":"string","usage":"string","frequency":"high|medium|low"}],
  "copy_themes": [{"theme":"string","example_headline":"string","example_cta":"string"}],
  "targeting": {"likely_audiences":["string"],"job_titles":["string"],"industries":["string"],"seniority":["string"]},
  "creative_style": "string describing visual/design approach",
  "posting_cadence": "string",
  "budget_signal": "string — estimate spend tier based on ad volume",
  "top_performing_angles": ["string"],
  "gaps_to_exploit": ["string — weaknesses or gaps in their LinkedIn ad strategy"],
  "sources": ["string"]
}`;

  try {
    const pResp = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'sonar',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1200,
        temperature: 0.2
      }),
      signal: AbortSignal.timeout(25000)
    });
    const pData = await pResp.json();
    const raw = pData?.choices?.[0]?.message?.content || '';

    let result;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      result = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch { result = null; }

    if (!result || /^_DUMMY/i.test(Object.keys(result)[0])) {
      result = {
        company,
        overview: `LinkedIn ad intelligence for ${company} is not publicly available. Try running a manual search at linkedin.com/ad-library.`,
        ad_formats: [],
        copy_themes: [],
        targeting: { likely_audiences: [], job_titles: [], industries: [], seniority: [] },
        creative_style: 'Unknown',
        posting_cadence: 'Unknown',
        budget_signal: 'Unknown',
        top_performing_angles: [],
        gaps_to_exploit: [],
        sources: []
      };
    }

    // Optionally enrich with Firecrawl scrape of LinkedIn Ad Library
    if (_hasFirecrawl()) {
      try {
        const libUrl = `https://www.linkedin.com/ad-library/search?q=${encodeURIComponent(company)}&dateRange=past-month`;
        const fcResp = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: libUrl, formats: ['markdown'], onlyMainContent: true }),
          signal: AbortSignal.timeout(15000)
        });
        const fcData = await fcResp.json();
        if (fcData?.success && fcData?.data?.markdown) {
          result._library_snapshot = fcData.data.markdown.slice(0, 2000);
        }
      } catch { /* Firecrawl enrichment is best-effort */ }
    }

    if (_db.hasDb()) {
      const tid = await _tenantCtx.resolveTenantId(req, { label: 'linkedin_ads:search' });
      await _db.getPool().query(
        `INSERT INTO linkedin_ad_searches (tenant_id, company, result) VALUES ($1,$2,$3)`,
        [tid, company, JSON.stringify(result)]
      );
    }
    res.json({ ok: true, company, result });
  } catch(e) { _err(res, 500, e.message); }
});

// ── GET /history ──────────────────────────────────────────────────────────────
router.get('/history', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, history: [] });
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'linkedin_ads:history' });
    const { rows } = await _db.getPool().query(
      `SELECT id, company, created_at,
              result->>'overview' AS overview
       FROM linkedin_ad_searches WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 30`,
      [tid]
    );
    res.json({ ok: true, history: rows });
  } catch(e) { _err(res, 500, e.message); }
});

// ── GET /library-link ─────────────────────────────────────────────────────────
router.get('/library-link', (req, res) => {
  const company = String(req.query.company || '').trim();
  const url = company
    ? `https://www.linkedin.com/ad-library/search?q=${encodeURIComponent(company)}`
    : 'https://www.linkedin.com/ad-library/';
  res.json({ ok: true, url });
});

module.exports = router;
