const express = require('express');
const router = express.Router();
const _https = require('https');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

async function _tid(req, label) { return await _tenantCtx.resolveTenantId(req, { label }); }

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _safeAsync(h) { return (req, res) => Promise.resolve(h(req, res)).catch(e => { console.warn('[twitter-pulse]', e.stack || e.message); if (!res.headersSent) _err(res, 500, 'Internal server error'); }); }
function _hasPerplexity() { const k = process.env.PERPLEXITY_API_KEY; return k && !/^_DUMMY/i.test(k); }

async function _scanTwitter(brand, keywords) {
  if (!_hasPerplexity()) return { error: 'PERPLEXITY_API_KEY required' };
  const kw = keywords.length ? keywords.join(' OR ') : brand;
  const prompt = `Search X (Twitter) for recent public posts mentioning "${brand}" with keywords (${kw}) from the last 7 days. Return strict JSON only:
{
  "tweets": [
    {"author":"@handle","handle":"@handle","text":"...","date":"YYYY-MM-DD or relative","likes":<int>,"retweets":<int>,"replies":<int>,"url":"https://x.com/...","sentiment":"positive|neutral|negative","viral":true|false}
  ]
}
Mark viral=true if the post has >1000 likes OR >500 retweets. Up to 20 tweets. Never invent — only return real recent tweets you can find.`;
  return await new Promise(resolve => {
    const body = JSON.stringify({ model:'sonar', temperature:0.1, max_tokens:2500, messages:[{ role:'user', content: prompt }] });
    const req = _https.request({
      hostname:'api.perplexity.ai', path:'/chat/completions', method:'POST',
      headers:{ 'Authorization':`Bearer ${process.env.PERPLEXITY_API_KEY}`, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }
    }, r => {
      let d=''; r.on('data', c => d+=c);
      r.on('end', () => {
        try {
          const j = JSON.parse(d);
          const txt = j?.choices?.[0]?.message?.content || '';
          const m = txt.match(/\{[\s\S]*\}/);
          if (!m) return resolve({ tweets: [] });
          resolve(JSON.parse(m[0]));
        } catch { resolve({ tweets: [] }); }
      });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.setTimeout(40000, () => { req.destroy(); resolve({ error: 'Perplexity timeout' }); });
    req.write(body); req.end();
  });
}

router.get('/test', (req, res) => res.json({ ok:true, perplexity: _hasPerplexity(), db: _db.hasDb && _db.hasDb() }));

router.post('/scan', _safeAsync(async (req, res) => {
  const brand = String(req.body?.brand || '').trim().slice(0, 200);
  const keywords = Array.isArray(req.body?.keywords) ? req.body.keywords.slice(0, 8).map(k => String(k).trim().slice(0, 80)).filter(Boolean) : [];
  if (!brand) return _err(res, 400, 'brand required');
  if (!_hasPerplexity()) return _err(res, 400, 'PERPLEXITY_API_KEY required');

  const r = await _scanTwitter(brand, keywords);
  if (r.error) return _err(res, 502, r.error);
  const tweets = Array.isArray(r.tweets) ? r.tweets : [];
  const counts = { pos: tweets.filter(t => t.sentiment === 'positive').length, neu: tweets.filter(t => t.sentiment === 'neutral').length, neg: tweets.filter(t => t.sentiment === 'negative').length };
  const viralCount = tweets.filter(t => t.viral === true).length;

  if (_db.hasDb && _db.hasDb()) {
    try { await _db.getPool().query(
      `INSERT INTO twitter_pulse_runs (brand, keywords, total_tweets, pos_count, neu_count, neg_count, tweets, viral_thread_count) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [brand, JSON.stringify(keywords), tweets.length, counts.pos, counts.neu, counts.neg, JSON.stringify(tweets.slice(0, 50)), viralCount]
    ); } catch(_) {}
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
