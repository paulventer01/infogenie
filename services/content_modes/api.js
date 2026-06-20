const express = require('express');
const _https  = require('https');
const _db     = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }

const MODES = ['article', 'affiliation', 'ecommerce', 'local', 'update', 'discovery'];

// ── AI generation ─────────────────────────────────────────────────────────
function _openAICall(system, user) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return Promise.resolve(null);
  const body = JSON.stringify({
    model: 'gpt-5-mini',
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_object' },
    temperature: 0.7, max_tokens: 4000,
  });
  return new Promise(resolve => {
    const req = _https.request({
      hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => {
        try { if (r.statusCode !== 200) return resolve(null); resolve(JSON.parse(JSON.parse(d).choices[0].message.content)); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(90000, () => req.destroy());
    req.write(body); req.end();
  });
}

// ── Mode prompts ──────────────────────────────────────────────────────────
function _buildPrompt(mode, params) {
  const { brand, keyword, location, existing_content, competitor_url, audience, tone } = params;
  const baseSchema = `{
  "title": "H1 title (keyword-rich)",
  "seo_title": "60-char SEO title",
  "meta_description": "155-char meta description",
  "word_count": 1200,
  "intro": "Opening paragraph (hook the reader, state the problem solved)",
  "sections": [{"heading": "H2 or H3 text", "body": "2-4 paragraphs of authoritative content"}],
  "conclusion": "Closing paragraph with takeaway",
  "cta": "Clear call to action",
  "internal_link_suggestions": ["Anchor text → target page topic"]
}`;

  const brandCtxNote = brand ? `Brand: ${brand}. ` : '';
  const audNote = audience ? `Target audience: ${audience}. ` : '';
  const toneNote = tone ? `Tone: ${tone}. ` : '';
  const langNote = (language && language.toLowerCase() !== 'english') ? `Write ALL content in ${language}. ` : '';

  if (mode === 'article') {
    return {
      system: `You are a senior SEO content writer. ${brandCtxNote}${audNote}${toneNote}${langNote}Write a comprehensive, humanized SEO blog article that ranks on Google. Return strict JSON:\n${baseSchema}\nRules: No placeholder text. Write as if a human expert wrote it. Include E-E-A-T signals.`,
      user: `Keyword: "${keyword || 'content marketing'}"\nWrite the full article now. Target 1200+ words.`,
    };
  }
  if (mode === 'affiliation') {
    const schema = `{
  "title": "...", "seo_title": "...", "meta_description": "...", "word_count": 1500,
  "intro": "...",
  "sections": [{"heading": "...", "body": "..."}],
  "pros": ["At least 5 genuine pros"],
  "cons": ["At least 3 honest cons"],
  "rating": 4.5,
  "verdict": "2-3 sentence expert verdict for buyers",
  "buy_cta": "Affiliate-friendly CTA without naming specific stores",
  "conclusion": "...",
  "internal_link_suggestions": ["..."]
}`;
    return {
      system: `You are an affiliate SEO content specialist. ${brandCtxNote}${audNote}${toneNote}Write a persuasive, honest product review or comparison that converts. Return strict JSON:\n${schema}\nRules: Genuine pros/cons. Balanced verdict builds trust. Reader-first, not spammy.`,
      user: `Product/topic to review: "${keyword || 'product'}"\nWrite the full affiliate review now.`,
    };
  }
  if (mode === 'ecommerce') {
    const schema = `{
  "title": "...", "seo_title": "...", "meta_description": "...", "word_count": 800,
  "intro": "Category/product intro (why buy here)",
  "features": ["Key product/category features"],
  "benefits": ["Buyer benefits (outcomes, not specs)"],
  "buying_guide": "150-200 word buying guide section",
  "sections": [{"heading": "...", "body": "..."}],
  "cta": "...",
  "internal_link_suggestions": ["..."]
}`;
    return {
      system: `You are an e-commerce copywriter expert at writing category and product pages that convert. ${brandCtxNote}${audNote}${toneNote}Return strict JSON:\n${schema}\nRules: Focus on buyer intent, benefits over specs, trust signals, clear CTA.`,
      user: `Product/category: "${keyword || 'product category'}"\nWrite the full e-commerce page content now.`,
    };
  }
  if (mode === 'local') {
    const loc = location || 'New York';
    const schema = `{
  "title": "...", "seo_title": "...", "meta_description": "...", "word_count": 1000,
  "intro": "...",
  "sections": [{"heading": "...", "body": "..."}],
  "local_keywords": ["10-15 local long-tail keywords naturally used"],
  "gmb_signals": ["Local trust signals / mentions of area landmarks, neighbourhoods"],
  "conclusion": "...",
  "cta": "...",
  "internal_link_suggestions": ["..."]
}`;
    return {
      system: `You are a local SEO content specialist. ${brandCtxNote}${audNote}${toneNote}Write location-based content that ranks in local search. Return strict JSON:\n${schema}\nRules: Naturally weave city/area references. Use local intent phrases. Mention local landmarks/neighborhoods. Avoid keyword stuffing.`,
      user: `Service/keyword: "${keyword || 'plumber'}"\nLocation: ${loc}\nWrite the full local SEO page now.`,
    };
  }
  if (mode === 'update') {
    const existing = existing_content ? existing_content.slice(0, 3000) : '(no existing content provided)';
    return {
      system: `You are a content refresh specialist. Analyse existing content and rewrite it to be fresher, more comprehensive, and better optimised. ${brandCtxNote}${audNote}${toneNote}Return strict JSON:\n${baseSchema}\nRules: Keep what works. Fix outdated info. Add missing sections. Improve E-E-A-T. Improve internal linking opportunities.`,
      user: `Target keyword: "${keyword || 'content to update'}"\nExisting content to refresh:\n${existing}\n\nRewrite and improve this content now.`,
    };
  }
  if (mode === 'discovery') {
    const schema = `{
  "title": "...", "seo_title": "...", "meta_description": "...", "word_count": 600,
  "hook": "Opening sentence designed to stop the scroll (20 words max)",
  "intro": "...",
  "sections": [{"heading": "...", "body": "..."}],
  "conclusion": "...",
  "cta": "...",
  "discovery_tips": ["Mobile-first formatting tips applied in this article"]
}`;
    return {
      system: `You are a Google Discover content strategist. Write short, highly engaging articles (500-700 words) optimised for Google Discover traffic. ${brandCtxNote}${audNote}${toneNote}Return strict JSON:\n${schema}\nRules: News-like angle. Curiosity gap hook. Short paragraphs (2-3 sentences). Mobile-first. Timely or trending angle. No clickbait — deliver on the promise.`,
      user: `Topic: "${keyword || 'trending topic'}"\nWrite the Discover-optimised article now.`,
    };
  }
  return null;
}

// ── Template fallback ─────────────────────────────────────────────────────
function _template(mode, params) {
  const kw = params.keyword || 'your topic';
  const loc = params.location || 'your city';
  const brand = params.brand || 'Your Brand';
  const base = {
    title: `Complete Guide to ${kw}`,
    seo_title: `${kw} — Expert Guide ${new Date().getFullYear()}`,
    meta_description: `Everything you need to know about ${kw}. Expert tips, actionable advice, and proven strategies.`,
    word_count: 1200,
    intro: `Looking to master ${kw}? You're in the right place. In this guide, we cover everything you need to know — from the basics to advanced strategies that actually work.`,
    sections: [
      { heading: `What Is ${kw}?`, body: `${kw} is a core concept in modern marketing. Understanding it gives you a significant edge over competitors who are still guessing.` },
      { heading: `Why ${kw} Matters for ${brand}`, body: `Brands that invest in ${kw} consistently see higher engagement, better conversion rates, and stronger customer retention.` },
      { heading: `How to Get Started with ${kw}`, body: `Start by auditing your current approach. Identify gaps, set measurable goals, and implement changes one step at a time.` },
    ],
    conclusion: `${kw} is not a one-time project — it's an ongoing process. Start with the fundamentals, measure your results, and iterate. The brands that win are the ones that never stop improving.`,
    cta: `Ready to take your ${kw} strategy to the next level? Let's talk.`,
    internal_link_suggestions: [`Learn more about ${kw} basics → beginner guide`, `See ${kw} case studies → results page`],
  };
  if (mode === 'affiliation') return { ...base, pros: ['Easy to use', 'Great value for money', 'Solid customer support', 'Regular updates', 'Wide feature set'], cons: ['Learning curve for beginners', 'Premium features cost extra', 'Mobile app needs improvement'], rating: 4.2, verdict: `Overall, ${kw} is a strong choice for most users. The pros outweigh the cons, especially at this price point.`, buy_cta: `Check the latest price and availability →` };
  if (mode === 'ecommerce') return { ...base, features: [`Premium quality ${kw}`, 'Multiple variants available', 'Fast shipping', '30-day return policy'], benefits: ['Save time and effort', 'Professional results every time', 'Peace of mind with guarantee'], buying_guide: `When choosing ${kw}, consider your budget, usage frequency, and specific needs. Look for quality certifications and read genuine customer reviews before purchasing.` };
  if (mode === 'local') return { ...base, title: `Best ${kw} in ${loc}`, local_keywords: [`${kw} ${loc}`, `${kw} near me`, `best ${kw} ${loc}`], gmb_signals: [`Serving ${loc} and surrounding areas`, `Local ${loc} expert team`, `Trusted by ${loc} residents since 2020`] };
  if (mode === 'discovery') return { ...base, word_count: 600, hook: `What nobody tells you about ${kw} — until now.`, discovery_tips: ['Short paragraphs used throughout', 'Curiosity-gap headline', 'Mobile-optimised structure'] };
  return base;
}

// ── POST /generate ─────────────────────────────────────────────────────────
router.post('/generate', async (req, res) => {
  const mode     = MODES.includes(req.body?.mode) ? req.body.mode : 'article';
  const keyword  = String(req.body?.keyword  || '').trim().slice(0, 200);
  const brand    = String(req.body?.brand    || '').trim().slice(0, 100);
  const location = String(req.body?.location || '').trim().slice(0, 100);
  const audience = String(req.body?.audience || '').trim().slice(0, 200);
  const tone     = String(req.body?.tone     || '').trim().slice(0, 100);
  const language = String(req.body?.language || 'English').trim().slice(0, 50);
  const existing_content = String(req.body?.existing_content || '').trim().slice(0, 6000);

  if (!keyword && mode !== 'update') return _err(res, 400, 'keyword required');

  const tid = await _tenantCtx.resolveTenantId(req, { label: 'content_modes:generate' });

  const params = { brand, keyword, location, audience, tone, language, existing_content };
  const prompt = _buildPrompt(mode, params);
  let result = null, source = 'openai';

  if (prompt) result = await _openAICall(prompt.system, prompt.user);
  if (!result) { result = _template(mode, params); source = 'template'; }

  if (_db.hasDb()) {
    try {
      await _db.getPool().query(
        `INSERT INTO content_mode_runs (tenant_id, mode, keyword, brand, location, result, source) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [tid, mode, keyword || null, brand || null, location || null, JSON.stringify(result), source]
      );
    } catch (e) { console.warn('[content-modes] persist failed:', e.message); }
  }

  res.json({ ok: true, mode, keyword, brand, source, article: result });
});

// ── GET /history ──────────────────────────────────────────────────────────
router.get('/history', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, runs: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'content_modes:history' });
  const r = await _db.getPool().query(
    `SELECT id, mode, keyword, brand, location, source, created_at
       FROM content_mode_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30`,
    [tid]
  );
  res.json({ ok: true, runs: r.rows });
});

router.get('/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const id = Number(req.params.id);
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'content_modes:get' });
  const r = await _db.getPool().query(
    `SELECT * FROM content_mode_runs WHERE id=$1 AND tenant_id=$2`, [id, tid]
  );
  if (!r.rows[0]) return _err(res, 404, 'not found');
  res.json({ ok: true, run: r.rows[0] });
});

module.exports = router;
