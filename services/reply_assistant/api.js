const express = require('express');
const _http = require('http');
const _https = require('https');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

const HIGH_REACH_HOSTS = new Set([
  'reuters.com','bloomberg.com','nytimes.com','wsj.com','ft.com','cnbc.com',
  'theguardian.com','bbc.com','techcrunch.com','forbes.com','cnn.com','axios.com',
  'theverge.com','wired.com','businessinsider.com','yahoo.com','reddit.com',
  'twitter.com','x.com','facebook.com','linkedin.com','tiktok.com','instagram.com',
]);

function _hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./,''); } catch { return ''; }
}

function _loopback(path, body) {
  const port = process.env.PORT || 5000;
  const payload = body ? JSON.stringify(body) : null;
  const headers = body ? { 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(payload) } : {};
  if (process.env.INFOGENIE_API_KEY) headers['X-InfoGenie-Key'] = process.env.INFOGENIE_API_KEY;
  return new Promise((resolve, reject) => {
    const req = _http.request({
      hostname:'localhost', port, path, method: body ? 'POST' : 'GET', headers,
    }, r => { let d=''; r.on('data', c => d += c); r.on('end', () => {
      try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('non-JSON status '+r.statusCode)); }
    }); });
    req.on('error', reject);
    req.setTimeout(45000, () => req.destroy(new Error('loopback timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

// GET /api/reply-assistant/inbox?brand=X&days=N — returns ranked mentions worth replying to
router.get('/inbox', async (req, res) => {
  const brand = String(req.query.brand || '').trim().slice(0, 80);
  if (!brand) return _err(res, 400, 'brand required');
  const days = Math.min(14, Math.max(1, parseInt(req.query.days, 10) || 3));
  try {
    const r = await _loopback('/api/mentions', { brand, competitors: [], country: 'US', days });
    const mentions = (r.mentions || r.items || []).slice(0, 200);
    // Score: negative=+3, neutral=+1, positive=+0.5; high-reach host=+2
    const scored = mentions.map(m => {
      const sentiment = (m.sentiment || 'neutral').toLowerCase();
      let score = sentiment === 'negative' ? 3 : sentiment === 'positive' ? 0.5 : 1;
      const host = _hostOf(m.url || m.link || '');
      if (HIGH_REACH_HOSTS.has(host)) score += 2;
      return { ...m, _host: host, _score: score };
    });
    scored.sort((a, b) => b._score - a._score);
    // Dedup by url
    const seen = new Set(); const out = [];
    for (const m of scored) {
      const k = m.url || m.link || (m.title || '').slice(0, 80);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(m);
      if (out.length >= 30) break;
    }
    res.json({ ok:true, brand, count: out.length, mentions: out });
  } catch (e) { _err(res, 500, e.message); }
});

// POST /api/reply-assistant/draft { mention:{title,snippet,url,sentiment}, brand, tone, ourPosition }
router.post('/draft', async (req, res) => {
  const m = req.body?.mention || {};
  const brand = String(req.body?.brand || '').trim().slice(0, 80);
  const tone = ['supportive','neutral','firm','grateful','curious'].includes(req.body?.tone) ? req.body.tone : 'neutral';
  const ourPosition = String(req.body?.ourPosition || '').slice(0, 600);
  if (!brand) return _err(res, 400, 'brand required');
  if (!m.title && !m.snippet) return _err(res, 400, 'mention required');

  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) {
    return res.json({ ok:true, source:'template', draft: _templateReply({ m, brand, tone, ourPosition }) });
  }

  const sys = `You are the social media manager for ${brand}. Draft a reply to this online mention. Tone: ${tone}.
Rules:
- 1-3 short paragraphs max (suitable for Twitter/X reply, LinkedIn comment, or news article comment).
- Address the specific point made in the mention; do not generic-PR-spin.
- Never apologise unnecessarily; never accept blame for things outside the brand's control.
- If the mention is critical, acknowledge concern briefly then redirect to the brand's actual position or strength.
- If positive, thank without being saccharine; reinforce the brand value mentioned.
- Output JSON: {"reply":"...","alt_short":"a single-tweet under 240 chars version","confidence":"low|med|high"}`;

  const user = `Mention:
Title: ${m.title || ''}
Source: ${m.url || m.link || 'unknown'}
Sentiment: ${m.sentiment || 'unknown'}
Snippet: ${m.snippet || m.text || ''}

Our position / context: ${ourPosition || 'none provided'}

Draft the reply now.`;

  const body = JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [{ role:'system', content: sys }, { role:'user', content: user }],
    response_format: { type:'json_object' },
    temperature: 0.5, max_tokens: 600,
  });

  try {
    const draft = await new Promise((resolve, reject) => {
      const req2 = _https.request({
        hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST',
        headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) },
      }, r => { let d=''; r.on('data', c => d += c); r.on('end', () => {
        try {
          if (r.statusCode !== 200) return reject(new Error('openai '+r.statusCode));
          const j = JSON.parse(d);
          resolve(JSON.parse(j.choices[0].message.content));
        } catch (e) { reject(e); }
      }); });
      req2.on('error', reject);
      req2.setTimeout(30000, () => req2.destroy(new Error('openai timeout')));
      req2.write(body); req2.end();
    });
    res.json({ ok:true, source:'openai', draft });
  } catch (e) {
    res.json({ ok:true, source:'template', draft: _templateReply({ m, brand, tone, ourPosition }), warn: e.message });
  }
});

function _templateReply({ m, brand, tone, ourPosition }) {
  const sentiment = (m.sentiment || 'neutral').toLowerCase();
  if (sentiment === 'negative') {
    return {
      reply: `Thanks for sharing this perspective. We hear the concern raised here. ${ourPosition || `At ${brand} we're focused on continuous improvement and transparency, and we'd welcome a direct conversation to dig into specifics.`}`,
      alt_short: `Thanks for the feedback — we hear you and we're working on it. Always happy to chat directly. — ${brand}`,
      confidence: 'low',
    };
  }
  if (sentiment === 'positive') {
    return {
      reply: `Really appreciate the kind words! ${ourPosition || `It means a lot to the team at ${brand}. We'll keep pushing.`}`,
      alt_short: `Thanks so much! 🙏 — ${brand}`,
      confidence: 'med',
    };
  }
  return {
    reply: `Thanks for covering this. ${ourPosition || `Happy to share more context from ${brand} if useful.`}`,
    alt_short: `Thanks for the mention — happy to add context if useful. — ${brand}`,
    confidence: 'low',
  };
}

module.exports = router;
