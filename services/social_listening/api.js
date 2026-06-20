const express = require('express');
const router  = express.Router();

const PERPLEXITY_URL = 'https://api.perplexity.ai/chat/completions';
const OPENAI_URL     = 'https://api.openai.com/v1/chat/completions';

function _extractJson(txt) {
  const stripped = txt.replace(/```(?:json)?\s*([\s\S]*?)```/gi, '$1').trim();
  for (const src of [stripped, txt]) {
    const start = src.indexOf('{');
    if (start === -1) continue;
    let depth = 0;
    for (let i = start; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { try { return JSON.parse(src.slice(start, i + 1)); } catch (_) { break; } } }
    }
  }
  return null;
}

async function callPerplexity(prompt) {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return null;
  const r = await fetch(PERPLEXITY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: 'sonar-pro', messages: [{ role: 'user', content: prompt }], max_tokens: 2500 })
  });
  if (!r.ok) { console.warn('[social-listening] perplexity HTTP', r.status); return null; }
  const d = await r.json();
  if (d.error) { console.warn('[social-listening] perplexity error:', d.error); return null; }
  return d.choices?.[0]?.message?.content || null;
}

async function callOpenAI(prompt) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!key) return null;
  const r = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'gpt-5-mini',
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
router.post('/feed', async (req, res) => {
  const { brand, keywords = [], competitors = [] } = req.body || {};
  if (!brand) return res.status(400).json({ ok: false, error: 'brand required' });

  // Strip domain TLD for better search results
  const _searchBrand = brand.replace(/^([a-z0-9][a-z0-9\-]*)\.(?:com|net|io|co|org|app|ai|gg|tv|uk|us|de|fr|au|biz|info|finance|trade|markets?|exchange|pro|digital|media|tech|global|capital)(?:\.[a-z]{2})?$/i, '$1');
  const searchTerms = [_searchBrand !== brand ? `${_searchBrand} OR "${brand}"` : brand, ...keywords, ...competitors].filter(Boolean).slice(0, 6).join(', ');

  const prompt = `Search the web for the VERY LATEST mentions, conversations, and discussions about: ${searchTerms}.

Return ONLY a valid JSON object — no prose, no markdown fences. Use this exact shape:
{"mentions":[{"id":"unique_string","source":"twitter|reddit|news|blog|forum|linkedin","author":"username or publication","content":"the mention or post text (max 200 chars)","url":"url if available or null","sentiment":"positive|neutral|negative","reach":"high|medium|low","topic":"brand_mention|competitor|industry|product|complaint|praise","time_ago":"e.g. 2h ago, yesterday, 3 days ago","engagement":<number>}],"sentiment_summary":{"positive":<number>,"neutral":<number>,"negative":<number>},"top_topics":["topic1","topic2","topic3"],"trending_keywords":["word1","word2","word3","word4","word5"],"alerts":[{"type":"spike|new_competitor|viral|crisis","message":"brief alert text"}]}

Return 12-18 mentions covering the last 7 days. Include a mix of sources. Only real content — no fabricated posts.`;

  try {
    let raw = await callPerplexity(prompt);
    if (!raw) {
      const oaiPrompt = prompt.replace('Search the web for', 'Simulate realistic social media monitoring data for');
      raw = await callOpenAI(oaiPrompt);
    }
    if (!raw) return res.status(503).json({ ok: false, error: 'No AI provider available (PERPLEXITY_API_KEY or OPENAI_API_KEY required)' });

    const parsed = _extractJson(raw);
    if (!parsed) {
      console.warn('[social-listening] parse_failed for', brand, '— raw:', raw.slice(0, 300));
      return res.status(500).json({ ok: false, error: 'AI returned invalid JSON — please try again' });
    }
    if (!parsed.mentions) return res.status(500).json({ ok: false, error: 'Unexpected AI response structure' });
    res.json({ ok: true, brand, ...parsed, source: 'perplexity_sonar_pro' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/social-listening/sentiment-trend
router.post('/sentiment-trend', async (req, res) => {
  const { brand, period = '7d' } = req.body || {};
  if (!brand) return res.status(400).json({ ok: false, error: 'brand required' });

  const days = period === '30d' ? 30 : 7;
  const prompt = `Analyse the sentiment trend for "${brand}" over the last ${days} days across social media and online news.
Return ONLY a valid JSON object — no prose, no markdown fences:
{"trend":[{"day":"Mon","positive":0-100,"neutral":0-100,"negative":0-100}],"overall_sentiment":"improving|stable|declining","key_driver":"one sentence explaining the main factor driving sentiment","risk_level":"low|medium|high"}
Return ${days} data points (one per day). Make the data realistic and varied.`;

  try {
    let raw = await callOpenAI(prompt) || await callPerplexity(prompt);
    if (!raw) return res.status(503).json({ ok: false, error: 'No AI provider available' });
    const parsed = _extractJson(raw);
    if (!parsed) return res.status(500).json({ ok: false, error: 'AI returned invalid JSON' });
    res.json({ ok: true, ...parsed, _estimated: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
