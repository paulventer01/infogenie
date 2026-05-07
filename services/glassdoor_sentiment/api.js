const express = require('express');
const router = express.Router();
const _https = require('https');
const _db = require('../../db');

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _safeAsync(h) { return (req, res) => Promise.resolve(h(req, res)).catch(e => { console.warn('[glassdoor]', e.stack || e.message); if (!res.headersSent) _err(res, 500, 'Internal server error'); }); }
function _hasPerplexity() { const k = process.env.PERPLEXITY_API_KEY; return k && !/^_DUMMY/i.test(k); }

async function _scan(company) {
  if (!_hasPerplexity()) return { error: 'PERPLEXITY_API_KEY required' };
  const prompt = `Search Glassdoor for current employee sentiment about "${company}". Return strict JSON only:
{
  "overall_rating": <number 1.0-5.0>,
  "ceo_approval": <integer 0-100>,
  "recommend_pct": <integer 0-100>,
  "total_reviews": <integer>,
  "reviews": [
    {"title":"...","pros":"...","cons":"...","role":"e.g. Software Engineer","tenure":"e.g. 2 years","rating":<number 1-5>,"date":"YYYY-MM or relative","sentiment":"positive|neutral|negative"}
  ],
  "top_complaints": ["short theme","short theme",...],
  "top_praises": ["short theme","short theme",...],
  "culture_signals": [
    "2-3 sentence insight about culture/management/strategy that emerges from the reviews",
    ...
  ]
}
Up to 12 reviews. 3-6 entries each in top_complaints and top_praises. 2-5 culture_signals. Never invent — only return real data you can find on Glassdoor.`;
  return await new Promise(resolve => {
    const body = JSON.stringify({ model:'sonar', temperature:0.2, max_tokens:3500, messages:[{ role:'user', content: prompt }] });
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
          if (!m) return resolve({ reviews:[], top_complaints:[], top_praises:[], culture_signals:[] });
          resolve(JSON.parse(m[0]));
        } catch { resolve({ reviews:[], top_complaints:[], top_praises:[], culture_signals:[] }); }
      });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.setTimeout(45000, () => { req.destroy(); resolve({ error: 'Perplexity timeout' }); });
    req.write(body); req.end();
  });
}

router.get('/test', (req, res) => res.json({ ok:true, perplexity: _hasPerplexity(), db: _db.hasDb && _db.hasDb() }));

router.post('/scan', _safeAsync(async (req, res) => {
  const company = String(req.body?.company || '').trim().slice(0, 200);
  if (!company) return _err(res, 400, 'company required');
  if (!_hasPerplexity()) return _err(res, 400, 'PERPLEXITY_API_KEY required');
  const r = await _scan(company);
  if (r.error) return _err(res, 502, r.error);

  const reviews = Array.isArray(r.reviews) ? r.reviews.slice(0, 25) : [];
  const overall = Number(r.overall_rating) || null;
  const ceo = Number(r.ceo_approval) || null;
  const rec = Number(r.recommend_pct) || null;
  const total = parseInt(r.total_reviews, 10) || null;

  if (_db.hasDb && _db.hasDb()) {
    try { await _db.getPool().query(
      `INSERT INTO glassdoor_runs (company, overall_rating, ceo_approval, recommend_pct, total_reviews, reviews, top_complaints, top_praises, culture_signals) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [company, overall, ceo, rec, total, JSON.stringify(reviews), JSON.stringify(r.top_complaints||[]), JSON.stringify(r.top_praises||[]), JSON.stringify(r.culture_signals||[])]
    ); } catch(_) {}
  }
  res.json({ ok:true, company, overall_rating: overall, ceo_approval: ceo, recommend_pct: rec, total_reviews: total, reviews, top_complaints: r.top_complaints||[], top_praises: r.top_praises||[], culture_signals: r.culture_signals||[] });
}));

router.get('/runs', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok:true, runs:[] });
  const r = await _db.getPool().query('SELECT id, company, overall_rating, ceo_approval, recommend_pct, total_reviews, culture_signals, created_at FROM glassdoor_runs ORDER BY created_at DESC LIMIT 30');
  res.json({ ok:true, runs: r.rows });
}));

module.exports = router;
