// Influencer Discovery — Perplexity-powered creator finder, results pipe
// directly into the existing /api/influencers CRM.
const express = require('express');
const _https = require('https');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

async function _perplexityCreators({ niche, platform, country, count }) {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return null;
  const platformTxt = platform && platform !== 'any' ? `on ${platform}` : 'across major social platforms';
  const countryTxt  = country && country !== 'GLOBAL' ? `, audience primarily in ${country}` : '';
  const n = Math.min(15, Math.max(3, count || 8));
  const prompt = `Find ${n} real, currently-active influencers / content creators in the "${niche}" niche ${platformTxt}${countryTxt}. For each, output: handle (without @), platform, follower estimate (number), engagement rate estimate (0-1 decimal), 1-line "why they're a fit" reason, and 1-3 source URLs (their profile, recent press, or a creator-database listing). Skip nano accounts under 5,000 followers. Output STRICT JSON only — no markdown:
{"creators":[{"handle":"...","platform":"instagram|tiktok|youtube|x|linkedin|other","followers":123000,"engagement":0.034,"niche":"${niche}","reason":"...","sources":["url1"]}]}`;
  const body = JSON.stringify({
    model: 'sonar', messages: [{ role:'user', content: prompt }],
    temperature: 0.25, max_tokens: 1800,
  });
  return await new Promise(resolve => {
    const req = _https.request({
      hostname:'api.perplexity.ai', path:'/chat/completions', method:'POST',
      headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) },
    }, r => { let d=''; r.on('data', c => d += c); r.on('end', () => {
      try {
        if (r.statusCode !== 200) return resolve(null);
        const j = JSON.parse(d);
        const txt = (j.choices?.[0]?.message?.content || '').trim().replace(/^```json|```$/g,'').trim();
        const m = txt.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(m ? m[0] : txt);
        if (Array.isArray(parsed.creators)) resolve(parsed.creators);
        else resolve(null);
      } catch { resolve(null); }
    }); });
    req.on('error', () => resolve(null));
    req.setTimeout(40000, () => { req.destroy(); resolve(null); });
    req.write(body); req.end();
  });
}

router.post('/influencers', async (req, res) => {
  const niche = String(req.body?.niche || '').trim().slice(0, 120);
  if (!niche) return _err(res, 400, 'niche required');
  const platform = req.body?.platform ? String(req.body.platform).toLowerCase().slice(0, 20) : 'any';
  const country = req.body?.country ? String(req.body.country).toUpperCase().slice(0, 16) : 'GLOBAL';
  const count = Number(req.body?.count) || 8;
  try {
    const creators = await _perplexityCreators({ niche, platform, country, count });
    if (!creators || !creators.length) {
      return res.json({ ok:true, source:'template', niche, platform, country, creators: [
        { handle:'connect_perplexity', platform:'other', followers:0, engagement:0, niche, reason:'Set PERPLEXITY_API_KEY to discover real creators in this niche.', sources:[] },
      ] });
    }
    const cleaned = creators.slice(0, 15).map(c => ({
      handle: String(c.handle || '').replace(/^@+/, '').trim().slice(0, 80),
      platform: ['instagram','tiktok','youtube','x','linkedin','other'].includes((c.platform||'').toLowerCase()) ? c.platform.toLowerCase() : 'other',
      followers: Math.max(0, Math.round(Number(c.followers) || 0)),
      engagement: Math.max(0, Math.min(1, Number(c.engagement) || 0)),
      niche: String(c.niche || niche).slice(0, 120),
      reason: String(c.reason || '').slice(0, 400),
      sources: (Array.isArray(c.sources) ? c.sources : []).map(s => String(s).slice(0, 300)).slice(0, 3),
    })).filter(c => c.handle);
    res.json({ ok:true, source:'perplexity', niche, platform, country, creators: cleaned });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;
