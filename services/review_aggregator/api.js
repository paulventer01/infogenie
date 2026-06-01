const express = require('express');
const router = express.Router();
const _https = require('https');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const _revMon = require('../review_monitor/api');

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _safeAsync(h) { return (req, res) => Promise.resolve(h(req, res)).catch(e => { console.warn('[review-agg]', e.stack || e.message); if (!res.headersSent) _err(res, 500, 'Internal server error'); }); }
function _hasPerplexity() { const k = process.env.PERPLEXITY_API_KEY; return k && !/^_DUMMY/i.test(k); }

const PLATFORMS = ['trustpilot','g2','google','capterra','tripadvisor'];

async function _scrapePlatform(brand, platform) {
  if (!_hasPerplexity()) return { error: 'PERPLEXITY_API_KEY required' };
  const prompt = `Search ${platform === 'g2' ? 'G2.com' : platform === 'google' ? 'Google Reviews/Maps' : platform === 'capterra' ? 'Capterra' : platform === 'tripadvisor' ? 'TripAdvisor' : 'Trustpilot'} for the company "${brand}". Return strict JSON only:
{
  "found": true,
  "avg_rating": 0.0-5.0,
  "total_reviews": <integer>,
  "reviews": [
    {"author":"...","rating":1-5,"date":"YYYY-MM-DD or relative","title":"...","body":"...","sentiment":"positive|neutral|negative"}
  ]
}
Return up to 8 most recent reviews. If nothing found, return {"found":false}. Never invent.`;
  return await new Promise(resolve => {
    const body = JSON.stringify({ model:'sonar', temperature:0.1, max_tokens:2000, messages:[{ role:'user', content: prompt }] });
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
          // Distinguish parse/format failures from a genuine "not found" response.
          // Only return {found:false} when the LLM explicitly said so; everything
          // else (no JSON, malformed JSON) is a transient error — do NOT treat it
          // as "no reviews" or it would falsely mark all tracked reviews as deleted.
          if (!m) return resolve({ error: 'parse_failed' });
          resolve(JSON.parse(m[0]));
        } catch { resolve({ error: 'parse_failed' }); }
      });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.setTimeout(35000, () => { req.destroy(); resolve({ error: 'Perplexity timeout' }); });
    req.write(body); req.end();
  });
}

router.get('/test', (req, res) => res.json({ ok:true, perplexity: _hasPerplexity(), db: _db.hasDb && _db.hasDb(), platforms: PLATFORMS }));

router.post('/scan', _safeAsync(async (req, res) => {
  const brand = String(req.body?.brand || '').trim().slice(0, 200);
  const platform = String(req.body?.platform || 'trustpilot').toLowerCase();
  if (!brand) return _err(res, 400, 'brand required');
  if (!PLATFORMS.includes(platform)) return _err(res, 400, 'platform must be one of: ' + PLATFORMS.join(', '));
  if (!_hasPerplexity()) return _err(res, 400, 'PERPLEXITY_API_KEY required');

  const r = await _scrapePlatform(brand, platform);
  if (r.error) return _err(res, 502, r.error);

  // Resolve tenant once, independently — snapshot diff must run for ALL scan outcomes,
  // including found:false (empty array marks any previously-tracked reviews as deleted).
  let _scanTid = null;
  try { _scanTid = await _tenantCtx.resolveTenantId(req, { label: 'review_aggregator:scan' }); } catch(_) {}

  if (!r.found) {
    // Still diff against snapshot — prior reviews for this brand/platform should become deleted
    if (_scanTid != null) _revMon.recordSnapshot(_scanTid, brand, platform, []).catch(() => {});
    return res.json({ ok:true, brand, platform, found:false, reviews: [] });
  }

  const reviews = Array.isArray(r.reviews) ? r.reviews : [];
  const counts = { pos: reviews.filter(x => x.sentiment === 'positive').length, neu: reviews.filter(x => x.sentiment === 'neutral').length, neg: reviews.filter(x => x.sentiment === 'negative').length };

  if (_db.hasDb && _db.hasDb() && _scanTid != null) {
    try {
      await _db.getPool().query(
      `INSERT INTO review_aggregator_runs (tenant_id, brand, platform, avg_rating, total_reviews, pos_count, neu_count, neg_count, reviews) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [_scanTid, brand, platform, parseFloat(r.avg_rating)||null, parseInt(r.total_reviews,10)||reviews.length, counts.pos, counts.neu, counts.neg, JSON.stringify(reviews)]
    ); } catch(_) {}
  }
  res.json({ ok:true, brand, platform, found:true, avg_rating: r.avg_rating, total_reviews: r.total_reviews, counts, reviews });
  // Fire-and-forget deleted-review snapshot diff — always runs after a successful scan
  if (_scanTid != null) {
    _revMon.recordSnapshot(_scanTid, brand, platform, reviews).catch(() => {});
  }
}));

router.post('/compare', _safeAsync(async (req, res) => {
  const brands = Array.isArray(req.body?.brands) ? req.body.brands.slice(0, 4).map(b => String(b).trim().slice(0, 200)).filter(Boolean) : [];
  const platform = String(req.body?.platform || 'trustpilot').toLowerCase();
  if (brands.length < 2) return _err(res, 400, 'At least 2 brands required for comparison');
  if (!PLATFORMS.includes(platform)) return _err(res, 400, 'invalid platform');
  if (!_hasPerplexity()) return _err(res, 400, 'PERPLEXITY_API_KEY required');

  const results = [];
  for (const b of brands) {
    const r = await _scrapePlatform(b, platform);
    if (r.error || !r.found) { results.push({ brand: b, found:false }); continue; }
    const revs = Array.isArray(r.reviews) ? r.reviews : [];
    results.push({ brand: b, found:true, avg_rating: r.avg_rating, total_reviews: r.total_reviews, recent_count: revs.length });
  }
  res.json({ ok:true, platform, results });
}));

router.get('/runs', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok:true, runs:[] });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'review_aggregator:runs' });
  const r = await _db.getPool().query('SELECT id, brand, platform, avg_rating, total_reviews, pos_count, neu_count, neg_count, created_at FROM review_aggregator_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30', [tid]);
  res.json({ ok:true, runs: r.rows });
}));

module.exports = router;
