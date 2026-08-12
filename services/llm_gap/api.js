// LLM Gap Analyzer — who gets cited in AI answers vs your brand.
const express = require('express');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
async function _tid(req, label) { return _tenantCtx.resolveTenantId(req, { label }); }

async function _askModel(prompt, brand, competitors) {
  // Prefer Anthropic / OpenAI from env integrations.
  const OpenAI = require('openai');
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) return null;
  const openai = new OpenAI({
    apiKey: key,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });
  const sys = [
    'You are an AI-search citation analyst. Given a user prompt, list which brands/domains an LLM would likely cite and why. Return ONLY JSON:',
    '{"cited":[{"brand":"...","domain":"...","why":"...","strength":1-10}],"missing_angles":["..."],"content_fixes":["..."],"brand_mentioned":true|false,"brand_rank":null|number}',
    `Brand to evaluate: ${brand}. Known competitors: ${(competitors || []).join(', ') || 'n/a'}.`,
  ].join('\n');
  try {
    const r = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: prompt },
      ],
      max_tokens: 700,
      response_format: { type: 'json_object' },
    });
    const text = r.choices?.[0]?.message?.content || '{}';
    return JSON.parse(text);
  } catch (e) {
    console.warn('[llm-gap] model:', e.message);
    return null;
  }
}

router.post('/analyze', async (req, res) => {
  try {
    const tid = await _tid(req, 'llm-gap:analyze');
    const brand = String(req.body?.brand || req.body?.domain || '').trim();
    const competitors = (Array.isArray(req.body?.competitors) ? req.body.competitors : [])
      .map((c) => String(c).trim()).filter(Boolean).slice(0, 6);
    let prompts = Array.isArray(req.body?.prompts) ? req.body.prompts.map((p) => String(p).trim()).filter(Boolean) : [];
    if (!prompts.length && req.body?.prompt) prompts = [String(req.body.prompt).trim()];
    prompts = prompts.slice(0, 6);
    if (!brand) return _err(res, 400, 'brand required');
    if (!prompts.length) return _err(res, 400, 'prompts required');

    const gaps = [];
    for (const prompt of prompts) {
      let analysis = await _askModel(prompt, brand, competitors);
      if (!analysis) {
        // Deterministic offline fallback for demo/dev without credits.
        analysis = {
          cited: competitors.slice(0, 3).map((c, i) => ({
            brand: c, domain: c, why: 'Established authority for this query', strength: 8 - i,
          })),
          missing_angles: [
            'Original data or benchmark statistics',
            'Clear comparison table vs alternatives',
            'Fresh how-to with step screenshots',
          ],
          content_fixes: [
            `Publish a definitive guide answering: ${prompt}`,
            'Add FAQ schema and quotable one-sentence answers',
            'Earn 2–3 niche mentions linking to the guide',
          ],
          brand_mentioned: false,
          brand_rank: null,
        };
      }
      const citedCompetitors = (analysis.cited || []).filter((c) =>
        competitors.some((x) => String(c.brand || c.domain || '').toLowerCase().includes(String(x).toLowerCase()))
        || !String(c.brand || '').toLowerCase().includes(brand.toLowerCase())
      );
      gaps.push({
        prompt,
        brand_mentioned: !!analysis.brand_mentioned,
        brand_rank: analysis.brand_rank,
        cited: analysis.cited || [],
        competitor_citations: citedCompetitors,
        missing_angles: analysis.missing_angles || [],
        content_fixes: analysis.content_fixes || [],
        gap_severity: analysis.brand_mentioned ? 'medium' : 'high',
      });
    }

    if (_db.hasDb()) {
      await _db.getPool().query(
        `INSERT INTO llm_gap_runs (tenant_id, brand, prompts, gaps) VALUES ($1,$2,$3::jsonb,$4::jsonb)`,
        [tid, brand, JSON.stringify(prompts), JSON.stringify(gaps)]
      ).catch(() => {});
    }

    const missing = gaps.filter((g) => !g.brand_mentioned).length;
    res.json({
      ok: true,
      brand,
      prompts,
      gaps,
      summary: `${missing}/${gaps.length} prompts likely omit ${brand} — close citation gaps with structured, quotable content.`,
    });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/history', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, runs: [] });
  try {
    const tid = await _tid(req, 'llm-gap:history');
    const r = await _db.getPool().query(
      `SELECT id, brand, prompts, created_at FROM llm_gap_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`,
      [tid]
    );
    res.json({ ok: true, runs: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;
