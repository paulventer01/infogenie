const express = require('express');
const router = express.Router();
const _https = require('https');
const _db = require('../../db');

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _safeAsync(h) { return (req, res) => Promise.resolve(h(req, res)).catch(e => { console.warn('[reddit-pulse]', e.stack || e.message); if (!res.headersSent) _err(res, 500, 'Internal server error'); }); }
function _hasOpenAI() { const k = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY; return k && !/^_DUMMY/i.test(k); }

function _redditSearch(subreddit, query, limit) {
  return new Promise(resolve => {
    const sub = String(subreddit || 'all').replace(/[^a-z0-9_]/gi,'').slice(0,50) || 'all';
    const path = `/r/${sub}/search.json?q=${encodeURIComponent(query)}&restrict_sr=1&sort=new&limit=${limit}&t=week`;
    const req = _https.request({ hostname:'www.reddit.com', path, method:'GET', headers:{ 'User-Agent':'InfoGenie/1.0 (Marketing intelligence; +https://infogenie.app)' } }, r => {
      let d=''; r.on('data', c => d+=c);
      r.on('end', () => {
        try {
          const j = JSON.parse(d);
          const posts = (j?.data?.children || []).map(c => ({
            id: c.data?.id, title: String(c.data?.title || '').slice(0, 300),
            author: c.data?.author, subreddit: c.data?.subreddit,
            url: c.data?.permalink ? `https://www.reddit.com${c.data.permalink}` : null,
            upvotes: c.data?.ups || 0, comments: c.data?.num_comments || 0,
            created: c.data?.created_utc ? new Date(c.data.created_utc * 1000).toISOString() : null,
            selftext: String(c.data?.selftext || '').slice(0, 400)
          }));
          resolve(posts);
        } catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(15000, () => { req.destroy(); resolve([]); });
    req.end();
  });
}

async function _classifySentiment(posts) {
  if (!_hasOpenAI() || !posts.length) return posts.map(p => ({ ...p, sentiment: 'neutral' }));
  const sample = posts.slice(0, 30).map((p, i) => `${i}. ${p.title}${p.selftext ? ' — ' + p.selftext.slice(0, 120) : ''}`).join('\n');
  return await new Promise(resolve => {
    const body = JSON.stringify({
      model:'gpt-4o-mini', temperature:0.1, max_tokens:1000,
      response_format: { type:'json_object' },
      messages:[
        { role:'system', content:'Classify each Reddit post sentiment about the target brand as "positive", "neutral", or "negative". Reply strict JSON only: {"sentiments":["positive","neutral",...]} — array length must equal input count.' },
        { role:'user', content:`Posts:\n${sample}` }
      ]
    });
    const req = _https.request({
      hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST',
      headers:{ 'Authorization':`Bearer ${process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY}`, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }
    }, r => {
      let d=''; r.on('data', c => d+=c);
      r.on('end', () => {
        try {
          const j = JSON.parse(d);
          const txt = j?.choices?.[0]?.message?.content;
          const parsed = JSON.parse(txt);
          const arr = parsed.sentiments || [];
          resolve(posts.map((p, i) => ({ ...p, sentiment: arr[i] || 'neutral' })));
        } catch { resolve(posts.map(p => ({ ...p, sentiment: 'neutral' }))); }
      });
    });
    req.on('error', () => resolve(posts.map(p => ({ ...p, sentiment: 'neutral' }))));
    req.setTimeout(20000, () => { req.destroy(); resolve(posts.map(p => ({ ...p, sentiment: 'neutral' }))); });
    req.write(body); req.end();
  });
}

router.get('/test', (req, res) => res.json({ ok:true, openai: _hasOpenAI(), db: _db.hasDb && _db.hasDb() }));

router.post('/scan', _safeAsync(async (req, res) => {
  const brand = String(req.body?.brand || '').trim();
  const subreddits = Array.isArray(req.body?.subreddits) ? req.body.subreddits.slice(0, 10) : ['all'];
  const keywords = Array.isArray(req.body?.keywords) && req.body.keywords.length ? req.body.keywords.slice(0, 5) : [brand];
  if (!brand) return _err(res, 400, 'brand required');
  const perSub = Math.max(5, Math.min(25, parseInt(req.body?.limit || 15, 10)));

  const all = [];
  for (const sub of subreddits) {
    for (const kw of keywords) {
      const posts = await _redditSearch(sub, kw, perSub);
      for (const p of posts) if (!all.find(x => x.id === p.id)) all.push(p);
    }
  }
  const classified = await _classifySentiment(all);
  const counts = { pos: classified.filter(p => p.sentiment === 'positive').length, neu: classified.filter(p => p.sentiment === 'neutral').length, neg: classified.filter(p => p.sentiment === 'negative').length };

  if (_db.hasDb && _db.hasDb()) {
    try { await _db.getPool().query('INSERT INTO reddit_pulse_runs (brand, subreddits, keywords, total_posts, pos_count, neu_count, neg_count, posts) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [brand, JSON.stringify(subreddits), JSON.stringify(keywords), classified.length, counts.pos, counts.neu, counts.neg, JSON.stringify(classified.slice(0, 100))]); } catch(_) {}
  }
  res.json({ ok:true, brand, total: classified.length, counts, posts: classified });
}));

router.get('/runs', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok:true, runs:[] });
  const r = await _db.getPool().query('SELECT id, brand, subreddits, keywords, total_posts, pos_count, neu_count, neg_count, created_at FROM reddit_pulse_runs ORDER BY created_at DESC LIMIT 30');
  res.json({ ok:true, runs: r.rows });
}));

module.exports = router;
