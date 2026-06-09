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

// Robust JSON extraction: finds the first complete balanced {...} object in text.
// Handles markdown fences, prose before/after the JSON, and nested objects.
function _extractJson(txt) {
  // Strip markdown code fences first
  const stripped = txt.replace(/```(?:json)?\s*([\s\S]*?)```/gi, '$1').trim();
  // Find first '{' and walk to find its matching '}'
  const sources = [stripped, txt];
  for (const src of sources) {
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

const PLATFORM_LABELS = {
  trustpilot: 'Trustpilot (trustpilot.com)',
  g2: 'G2 (g2.com)',
  google: 'Google Maps / Google Business Profile',
  capterra: 'Capterra (capterra.com)',
  tripadvisor: 'TripAdvisor (tripadvisor.com)'
};

async function _scrapePlatform(brand, platform) {
  if (!_hasPerplexity()) return { error: 'PERPLEXITY_API_KEY required' };
  const platformLabel = PLATFORM_LABELS[platform] || platform;
  const brandNote = brand.length <= 4
    ? ` Note: "${brand}" is likely a ticker symbol or brand shorthand — find the full company (e.g. financial broker or tech firm) using that name.`
    : '';
  const googleNote = platform === 'google'
    ? ` Search Google Maps and Google Business Profile for the company listing. Look for the business page with star ratings and customer reviews.`
    : '';
  const prompt = `Search ${platformLabel} right now for customer reviews of the company called "${brand}".${brandNote}${googleNote}

You MUST return ONLY a valid JSON object — no prose, no markdown, no explanation before or after. The JSON must be one of these two shapes:

If reviews are found:
{"found":true,"avg_rating":<number 0-5>,"total_reviews":<integer>,"reviews":[{"author":"<name>","rating":<1-5>,"date":"<YYYY-MM-DD or relative>","title":"<title or empty string>","body":"<review text>","sentiment":"positive|neutral|negative"}]}

If NOT found on ${platformLabel}:
{"found":false}

Return up to 8 of the most recent reviews. Do not invent reviews — only include what you actually found on the platform.`;

  return await new Promise(resolve => {
    const body = JSON.stringify({
      model: 'sonar-pro',
      temperature: 0.1,
      max_tokens: 2500,
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
          if (j.error) { console.warn('[review-agg] perplexity api error:', j.error); return resolve({ error: String(j.error.message || j.error) }); }
          const txt = j?.choices?.[0]?.message?.content || '';
          const parsed = _extractJson(txt);
          if (!parsed) {
            console.warn('[review-agg] parse_failed for', brand, 'on', platform, '— raw:', txt.slice(0, 300));
            return resolve({ error: 'parse_failed' });
          }
          resolve(parsed);
        } catch (e) { resolve({ error: 'parse_failed:' + e.message }); }
      });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.setTimeout(40000, () => { req.destroy(); resolve({ error: 'Perplexity timeout' }); });
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

  let _scanTid = null;
  try { _scanTid = await _tenantCtx.resolveTenantId(req, { label: 'review_aggregator:scan' }); } catch(_) {}

  if (!r.found) {
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
      );
    } catch(_) {}
  }
  res.json({ ok:true, brand, platform, found:true, avg_rating: r.avg_rating, total_reviews: r.total_reviews, counts, reviews });
  if (_scanTid != null) {
    _revMon.recordSnapshot(_scanTid, brand, platform, reviews).catch(() => {});
  }
}));

router.post('/compare', _safeAsync(async (req, res) => {
  const brands = Array.isArray(req.body?.brands)
    ? req.body.brands.slice(0, 4).map(b => String(b).trim().slice(0, 200)).filter(Boolean)
    : [];
  const platform = String(req.body?.platform || 'trustpilot').toLowerCase();
  if (brands.length < 2) return _err(res, 400, 'At least 2 brands required for comparison');
  if (!PLATFORMS.includes(platform)) return _err(res, 400, 'invalid platform');
  if (!_hasPerplexity()) return _err(res, 400, 'PERPLEXITY_API_KEY required');

  // Run all brands in parallel — each Perplexity call takes ~10-30s so serial = pain
  const settled = await Promise.all(brands.map(b => _scrapePlatform(b, platform)));
  const results = brands.map((b, i) => {
    const r = settled[i];
    if (r.error || !r.found) return { brand: b, found: false, _error: r.error || null };
    const revs = Array.isArray(r.reviews) ? r.reviews : [];
    return { brand: b, found: true, avg_rating: r.avg_rating, total_reviews: r.total_reviews, recent_count: revs.length };
  });
  res.json({ ok:true, platform, results });
}));

router.get('/runs', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok:true, runs:[] });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'review_aggregator:runs' });
  const r = await _db.getPool().query('SELECT id, brand, platform, avg_rating, total_reviews, pos_count, neu_count, neg_count, created_at FROM review_aggregator_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30', [tid]);
  res.json({ ok:true, runs: r.rows });
}));

module.exports = router;
