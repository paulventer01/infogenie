const express = require('express');
const router = express.Router();
const _https = require('https');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

async function _tid(req, label) { return await _tenantCtx.resolveTenantId(req, { label }); }

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _safeAsync(h) { return (req, res) => Promise.resolve(h(req, res)).catch(e => { console.warn('[twitter-pulse]', e.stack || e.message); if (!res.headersSent) _err(res, 500, 'Internal server error'); }); }
function _hasPerplexity() { const k = process.env.PERPLEXITY_API_KEY; return k && !/^_DUMMY/i.test(k); }

// Robust JSON extraction: strips markdown fences then finds first balanced {...}
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

// Strip domain TLD so "fxpro.com" → searches for "fxpro", not "fxpro.com"
function _brandForSearch(name) {
  const m = name.match(/^([a-z0-9](?:[a-z0-9\-]*[a-z0-9])?)\.(?:com|net|io|co|org|app|ai|gg|tv|uk|us|de|fr|au|za|biz|info|finance|trade|markets?|exchange|group|capital|pro|digital|media|online|agency|studio|tech|solutions|systems|software|services?|platform|global|world|international|inc|ltd|llc)(?:\.[a-z]{2})?$/i);
  return m ? m[1] : name;
}

async function _scanTwitter(brand, keywords) {
  if (!_hasPerplexity()) return { error: 'PERPLEXITY_API_KEY required' };
  const searchBrand = _brandForSearch(brand);
  const kw = keywords.length ? keywords.join(', ') : searchBrand;
  const prompt = `Search X (formerly Twitter) for real, recent public posts mentioning "${searchBrand}" in the last 7 days. Related keywords to look for: ${kw}.

You MUST return ONLY a valid JSON object — no prose, no markdown fences, no explanation. Use this exact shape:
{"tweets":[{"author":"@handle","handle":"@handle","text":"<tweet text>","date":"YYYY-MM-DD or relative","likes":<int>,"retweets":<int>,"replies":<int>,"url":"https://x.com/...","sentiment":"positive|neutral|negative","viral":<true if >1000 likes OR >500 retweets, else false>}]}

Return up to 20 of the most recent, highest-engagement tweets. Do not invent tweets — only include real posts you can find. If no tweets are found, return {"tweets":[]}.`;

  return await new Promise(resolve => {
    const body = JSON.stringify({
      model: 'sonar-pro',
      temperature: 0.1,
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }]
    });
    const req = _https.request({
      hostname: 'api.perplexity.ai', path: '/chat/completions', method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j.error) { console.warn('[twitter-pulse] perplexity error:', j.error); return resolve({ error: String(j.error.message || j.error) }); }
          const txt = j?.choices?.[0]?.message?.content || '';
          const parsed = _extractJson(txt);
          if (!parsed) {
            console.warn('[twitter-pulse] parse_failed for', brand, '— raw:', txt.slice(0, 300));
            return resolve({ tweets: [] });
          }
          resolve(parsed);
        } catch (e) { resolve({ tweets: [] }); }
      });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.setTimeout(45000, () => { req.destroy(); resolve({ error: 'Perplexity timeout' }); });
    req.write(body); req.end();
  });
}

router.get('/test', (req, res) => res.json({ ok:true, perplexity: _hasPerplexity(), db: _db.hasDb && _db.hasDb() }));

router.post('/scan', _safeAsync(async (req, res) => {
  const brand = String(req.body?.brand || '').trim().slice(0, 200);
  const keywords = Array.isArray(req.body?.keywords)
    ? req.body.keywords.slice(0, 8).map(k => String(k).trim().slice(0, 80)).filter(Boolean)
    : [];
  if (!brand) return _err(res, 400, 'brand required');
  if (!_hasPerplexity()) return _err(res, 400, 'PERPLEXITY_API_KEY required');

  const r = await _scanTwitter(brand, keywords);
  if (r.error) return _err(res, 502, r.error);
  const tweets = Array.isArray(r.tweets) ? r.tweets : [];
  const counts = {
    pos: tweets.filter(t => t.sentiment === 'positive').length,
    neu: tweets.filter(t => t.sentiment === 'neutral').length,
    neg: tweets.filter(t => t.sentiment === 'negative').length
  };
  const viralCount = tweets.filter(t => t.viral === true).length;

  if (_db.hasDb && _db.hasDb()) {
    try {
      const tid = await _tid(req, 'twitter-pulse:scan');
      await _db.getPool().query(
        `INSERT INTO twitter_pulse_runs (tenant_id, brand, keywords, total_tweets, pos_count, neu_count, neg_count, tweets, viral_thread_count) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [tid, brand, JSON.stringify(keywords), tweets.length, counts.pos, counts.neu, counts.neg, JSON.stringify(tweets.slice(0, 50)), viralCount]
      );
    } catch(_) {}
  }
  res.json({ ok:true, brand, total: tweets.length, counts, viral_count: viralCount, tweets });
}));

router.get('/runs', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok:true, runs:[] });
  const tid = await _tid(req, 'twitter-pulse:runs');
  const r = await _db.getPool().query('SELECT id, brand, keywords, total_tweets, pos_count, neu_count, neg_count, viral_thread_count, created_at FROM twitter_pulse_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30', [tid]);
  res.json({ ok:true, runs: r.rows });
}));

module.exports = router;
