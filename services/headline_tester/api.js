const express = require('express');
const router = express.Router();
const _https = require('https');

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _safeAsync(h) { return (req, res) => Promise.resolve(h(req, res)).catch(e => { console.warn('[headline-tester]', e.stack || e.message); if (!res.headersSent) _err(res, 500, 'Internal server error'); }); }
function _hasOpenAI() { const k = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY; return k && !/^_DUMMY/i.test(k); }

const VARIANT_KINDS = ['curiosity','negative','question','listicle','urgent','specific_number','contrarian','social_proof','how_to','outcome'];

async function _generateAndScore({ headline, audience, channel, count }) {
  if (!_hasOpenAI()) return null;
  const sys = 'You are a senior conversion copywriter. Score headlines using virality patterns (clarity, curiosity gap, specificity, emotional valence, novelty, length-fit). Strict JSON only.';
  const user = `Original headline: "${headline}"
Audience: ${audience || 'general B2B marketers'}
Channel: ${channel || 'web/landing page'}

1) Score the original headline (0-100) and explain.
2) Generate ${count} alternative variants — one of each kind from this list: ${VARIANT_KINDS.slice(0, count).join(', ')}. For each variant, score it 0-100 and list which patterns it hits.

Reply strict JSON only:
{
  "original": {"text":"...","score":0-100,"strengths":["..."],"weaknesses":["..."]},
  "variants": [
    {"kind":"curiosity","text":"...","score":0-100,"patterns_hit":["clarity","curiosity gap"],"reasoning":"1-line"}
  ]
}`;
  return await new Promise(resolve => {
    const body = JSON.stringify({
      model:'gpt-5-mini', temperature:0.6, max_tokens:1800,
      response_format:{ type:'json_object' },
      messages:[{ role:'system', content: sys }, { role:'user', content: user }]
    });
    const req = _https.request({
      hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST',
      headers:{ 'Authorization':`Bearer ${process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY}`, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }
    }, r => {
      let d=''; r.on('data', c => d+=c);
      r.on('end', () => {
        try { const j = JSON.parse(d); resolve(JSON.parse(j?.choices?.[0]?.message?.content || '{}')); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(35000, () => { req.destroy(); resolve(null); });
    req.write(body); req.end();
  });
}

router.get('/test', (req, res) => res.json({ ok:true, openai: _hasOpenAI() }));

router.post('/test-headline', _safeAsync(async (req, res) => {
  const headline = String(req.body?.headline || '').trim();
  const audience = String(req.body?.audience || '').trim();
  const channel = String(req.body?.channel || 'landing_page').trim();
  const count = Math.max(3, Math.min(10, parseInt(req.body?.count || 8, 10)));
  if (!headline) return _err(res, 400, 'headline required');
  if (headline.length > 300) return _err(res, 400, 'headline too long (max 300 chars)');
  if (!_hasOpenAI()) return _err(res, 400, 'OPENAI_API_KEY required');
  const result = await _generateAndScore({ headline, audience, channel, count });
  if (!result || !result.variants) return _err(res, 502, 'AI scoring failed — try again');
  res.json({ ok:true, ...result });
}));

module.exports = router;
