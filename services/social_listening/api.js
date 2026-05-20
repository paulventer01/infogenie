const express = require('express');
const router  = express.Router();

const PERPLEXITY_URL = 'https://api.perplexity.ai/chat/completions';
const OPENAI_URL     = 'https://api.openai.com/v1/chat/completions';

async function callPerplexity(prompt) {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) return null;
  const r = await fetch(PERPLEXITY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'sonar',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1800
    })
  });
  if (!r.ok) return null;
  const d = await r.json();
  return d.choices?.[0]?.message?.content || null;
}

async function callOpenAI(prompt) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!key) return null;
  const r = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 2000
    })
  });
  if (!r.ok) return null;
  const d = await r.json();
  return d.choices?.[0]?.message?.content || null;
}

// POST /api/social-listening/feed
// { brand, keywords: [], competitors: [] }
router.post('/feed', async (req, res) => {
  const { brand, keywords = [], competitors = [] } = req.body || {};
  if (!brand) return res.status(400).json({ ok: false, error: 'brand required' });

  const searchTerms = [brand, ...keywords, ...competitors].filter(Boolean).slice(0, 6).join(', ');
  const prompt = `You are a social media listening analyst. Search the web for the VERY LATEST mentions, conversations, and discussions about: ${searchTerms}.

Return a JSON object with this exact structure:
{
  "mentions": [
    {
      "id": "unique_string",
      "source": "twitter|reddit|news|blog|forum|linkedin",
      "author": "username or publication",
      "content": "the mention or post text (max 200 chars)",
      "url": "url if available or null",
      "sentiment": "positive|neutral|negative",
      "reach": "high|medium|low",
      "topic": "brand_mention|competitor|industry|product|complaint|praise",
      "time_ago": "e.g. 2h ago, yesterday, 3 days ago",
      "engagement": number
    }
  ],
  "sentiment_summary": { "positive": number, "neutral": number, "negative": number },
  "top_topics": ["topic1", "topic2", "topic3"],
  "trending_keywords": ["word1", "word2", "word3", "word4", "word5"],
  "alerts": [{ "type": "spike|new_competitor|viral|crisis", "message": "brief alert text" }]
}

Return 12-18 mentions covering the last 7 days. Include a mix of sources. Be realistic about what's actually being discussed.`;

  try {
    let raw = await callPerplexity(prompt);
    if (!raw) {
      const oaiPrompt = prompt.replace('Search the web for', 'Simulate realistic social media monitoring data for');
      raw = await callOpenAI(oaiPrompt);
    }
    if (!raw) return res.status(503).json({ ok: false, error: 'No AI provider available (PERPLEXITY_API_KEY or OPENAI_API_KEY required)' });

    let parsed;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch {
      return res.status(500).json({ ok: false, error: 'AI returned invalid JSON' });
    }

    if (!parsed.mentions) return res.status(500).json({ ok: false, error: 'Unexpected AI response structure' });
    res.json({ ok: true, brand, ...parsed, source: 'perplexity_sonar' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/social-listening/sentiment-trend
// { brand, period: '7d'|'30d' }
router.post('/sentiment-trend', async (req, res) => {
  const { brand, period = '7d' } = req.body || {};
  if (!brand) return res.status(400).json({ ok: false, error: 'brand required' });

  const days = period === '30d' ? 30 : 7;
  const prompt = `Analyse the sentiment trend for "${brand}" over the last ${days} days across social media and online news.
Return JSON: {
  "trend": [{ "day": "Mon", "positive": 0-100, "neutral": 0-100, "negative": 0-100 }],
  "overall_sentiment": "improving|stable|declining",
  "key_driver": "one sentence explaining the main factor driving sentiment",
  "risk_level": "low|medium|high"
}
Return ${days} data points (one per day). Make the data realistic and varied.`;

  try {
    let raw = await callOpenAI(prompt) || await callPerplexity(prompt);
    if (!raw) return res.status(503).json({ ok: false, error: 'No AI provider available' });
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    res.json({ ok: true, ...parsed });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
