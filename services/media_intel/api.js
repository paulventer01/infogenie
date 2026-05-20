const express = require('express');
const router  = express.Router();
const _db     = require('../../db');

function pool() { return _db.getPool(); }

const PERPLEXITY_URL = 'https://api.perplexity.ai/chat/completions';
const OPENAI_URL     = 'https://api.openai.com/v1/chat/completions';

async function callPerplexity(messages, maxTokens = 2000) {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) return null;
  const r = await fetch(PERPLEXITY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: 'sonar', messages, max_tokens: maxTokens })
  });
  if (!r.ok) return null;
  const d = await r.json();
  return d.choices?.[0]?.message?.content || null;
}

async function callOpenAI(prompt, maxTokens = 2000) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!key) return null;
  const r = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: maxTokens
    })
  });
  if (!r.ok) return null;
  const d = await r.json();
  return d.choices?.[0]?.message?.content || null;
}

// POST /api/media-intel/scan
router.post('/scan', async (req, res) => {
  const { brand, competitors = [], industry = '' } = req.body || {};
  if (!brand) return res.status(400).json({ ok: false, error: 'brand required' });

  const allEntities = [brand, ...competitors].filter(Boolean).join(', ');

  const prompt = `You are a media intelligence analyst with access to real-time news and press coverage. 
Search for the latest news articles, press mentions, journalist coverage, and media stories about: ${allEntities}${industry ? ` in the ${industry} industry` : ''}.

Return a JSON object with exactly this structure:
{
  "stories": [
    {
      "id": "unique_id",
      "headline": "article headline",
      "publication": "publication name",
      "journalist": "journalist name or null",
      "journalist_twitter": "@handle or null",
      "url": "article url or null",
      "summary": "1-2 sentence summary",
      "entity_mentioned": "${brand} or competitor name",
      "sentiment": "positive|neutral|negative",
      "momentum": 1-100,
      "published": "e.g. 2 hours ago, yesterday, 3 days ago",
      "category": "product_launch|funding|controversy|partnership|hiring|award|regulation|market_trend"
    }
  ],
  "rising_narratives": [
    { "narrative": "short description", "momentum": 1-100, "opportunity": "pitch angle or response needed" }
  ],
  "journalist_watchlist": [
    { "name": "journalist name", "publication": "outlet", "beat": "what they cover", "recent_angle": "what they've been writing about", "twitter": "@handle or null" }
  ],
  "coverage_score": { "${brand}": 0-100${competitors.length ? ', ' + competitors.map(c => `"${c}": 0-100`).join(', ') : ''} },
  "media_opportunities": [
    { "type": "pitch|response|newsjack|byline", "headline": "opportunity description", "outlet": "suggested outlet", "urgency": "now|this_week|this_month" }
  ]
}

Return 8-12 stories from the last 14 days. Be specific about publications (TechCrunch, Forbes, WSJ, etc) and realistic about coverage.`;

  try {
    let raw = await callPerplexity([{ role: 'user', content: prompt }]);
    if (!raw) raw = await callOpenAI(prompt);
    if (!raw) return res.status(503).json({ ok: false, error: 'No AI provider available (PERPLEXITY_API_KEY required for best results)' });

    let parsed;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch {
      return res.status(500).json({ ok: false, error: 'AI returned invalid JSON' });
    }

    if (!parsed.stories) return res.status(500).json({ ok: false, error: 'Unexpected response structure' });

    // Persist to DB
    if (_db.hasDb()) {
      try {
        await pool().query(
          `INSERT INTO media_intel_scans (brand, competitors, results, summary) VALUES ($1,$2,$3,$4)`,
          [brand, competitors, JSON.stringify(parsed), parsed.rising_narratives?.[0]?.narrative || '']
        );
      } catch (_) {}
    }

    res.json({ ok: true, brand, ...parsed });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/media-intel/history
router.get('/history', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, history: [] });
  try {
    const r = await pool().query(
      `SELECT id, brand, competitors, summary, created_at FROM media_intel_scans ORDER BY created_at DESC LIMIT 20`
    );
    res.json({ ok: true, history: r.rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// GET /api/media-intel/scan/:id
router.get('/scan/:id', async (req, res) => {
  if (!_db.hasDb()) return res.status(404).json({ ok: false });
  try {
    const r = await pool().query(`SELECT * FROM media_intel_scans WHERE id=$1`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Not found' });
    const row = r.rows[0];
    res.json({ ok: true, brand: row.brand, ...row.results, created_at: row.created_at });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

module.exports = router;
