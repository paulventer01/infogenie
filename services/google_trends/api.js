// Google Trends integration — uses the unofficial `google-trends-api` npm
// package to surface trending keywords, interest over time, and related queries.
// No API key required. Responses are cached in-memory for 15 minutes.
const express = require('express');
const router  = express.Router();

// Lazy-load so server still boots if the package is missing for any reason
let _gt = null;
function gt() {
  if (!_gt) _gt = require('google-trends-api');
  return _gt;
}

// 15-minute in-memory cache: key -> { data, ts }
const _cache = new Map();
const CACHE_TTL = 15 * 60 * 1000;

function _cacheKey(...parts) { return parts.join('|'); }
function _cached(key) {
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data;
  return null;
}
function _store(key, data) { _cache.set(key, { data, ts: Date.now() }); }

function _safe(h) {
  return (req, res) =>
    Promise.resolve(h(req, res)).catch(e => {
      console.warn('[google-trends]', e.message);
      if (!res.headersSent)
        res.status(500).json({ ok: false, error: e.message });
    });
}

function _parseRaw(raw) {
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { return null; }
}

// ── GET /api/google-trends/interest?keyword=...&period=12m&geo= ──────────────
// Interest over time (0-100) for up to 3 comma-separated keywords.
router.get('/interest', _safe(async (req, res) => {
  const { keyword = '', period = '12m', geo = '' } = req.query;
  if (!keyword) return res.status(400).json({ ok: false, error: 'keyword required' });
  const keywords = keyword.split(',').map(k => k.trim()).filter(Boolean).slice(0, 3);

  const ck = _cacheKey('interest', keywords.join(','), period, geo);
  const cached = _cached(ck);
  if (cached) return res.json({ ok: true, ...cached, cached: true });

  const periodMap = { '1h':'now 1-H','4h':'now 4-H','1d':'now 1-d','7d':'now 7-d','1m':'today 1-m','3m':'today 3-m','12m':'today 12-m','5y':'today 5-y' };
  const timeStr = periodMap[period] || 'today 12-m';
  const opts = { keyword: keywords, startTime: undefined, geo: geo || undefined };
  if (timeStr.startsWith('now')) {
    opts.granularTimeResolution = true;
  }

  // Use the correct API for time-based comparison
  const raw = keywords.length > 1
    ? await gt().interestOverTime({ keyword: keywords, geo: geo || undefined, startTime: new Date(Date.now() - _periodMs(period)) })
    : await gt().interestOverTime({ keyword: keywords[0], geo: geo || undefined, startTime: new Date(Date.now() - _periodMs(period)) });

  const parsed = _parseRaw(raw);
  const timeline = parsed?.default?.timelineData || [];
  const result = { keywords, timeline };
  _store(ck, result);
  res.json({ ok: true, ...result });
}));

function _periodMs(p) {
  const map = { '1h':3600000,'4h':14400000,'1d':86400000,'7d':604800000,'1m':2592000000,'3m':7776000000,'12m':31536000000,'5y':157680000000 };
  return map[p] || 31536000000;
}

// ── GET /api/google-trends/related?keyword=...&geo= ──────────────────────────
// Related queries and topics for a keyword.
router.get('/related', _safe(async (req, res) => {
  const { keyword = '', geo = '' } = req.query;
  if (!keyword) return res.status(400).json({ ok: false, error: 'keyword required' });

  const ck = _cacheKey('related', keyword, geo);
  const cached = _cached(ck);
  if (cached) return res.json({ ok: true, ...cached, cached: true });

  const [rawQ, rawT] = await Promise.all([
    gt().relatedQueries({ keyword, geo: geo || undefined }),
    gt().relatedTopics({ keyword, geo: geo || undefined }),
  ]);

  const queries = _parseRaw(rawQ)?.default?.rankedList || [];
  const topics  = _parseRaw(rawT)?.default?.rankedList || [];

  const result = {
    keyword,
    relatedQueries: {
      top:   queries[0]?.rankedKeyword || [],
      rising: queries[1]?.rankedKeyword || [],
    },
    relatedTopics: {
      top:   topics[0]?.rankedKeyword || [],
      rising: topics[1]?.rankedKeyword || [],
    },
  };
  _store(ck, result);
  res.json({ ok: true, ...result });
}));

// ── GET /api/google-trends/trending?geo=US&count=20 ──────────────────────────
// Daily trending searches for a country.
router.get('/trending', _safe(async (req, res) => {
  const { geo = 'US', count = 20 } = req.query;

  const ck = _cacheKey('trending', geo);
  const cached = _cached(ck);
  if (cached) return res.json({ ok: true, ...cached, cached: true });

  const raw = await gt().dailyTrends({ geo, count: parseInt(count, 10) || 20 });
  const parsed = _parseRaw(raw);
  const trends = parsed?.default?.trendingSearchesDays?.[0]?.trendingSearches || [];
  const result = { geo, trends };
  _store(ck, result);
  res.json({ ok: true, ...result });
}));

// ── GET /api/google-trends/compare?keywords=k1,k2,k3&geo=&period= ────────────
// Side-by-side interest comparison of up to 5 keywords.
router.get('/compare', _safe(async (req, res) => {
  const { keywords = '', geo = '', period = '12m' } = req.query;
  const kws = keywords.split(',').map(k => k.trim()).filter(Boolean).slice(0, 5);
  if (kws.length < 2) return res.status(400).json({ ok: false, error: 'At least 2 keywords required' });

  const ck = _cacheKey('compare', kws.join(','), geo, period);
  const cached = _cached(ck);
  if (cached) return res.json({ ok: true, ...cached, cached: true });

  const raw = await gt().interestOverTime({
    keyword: kws,
    geo: geo || undefined,
    startTime: new Date(Date.now() - _periodMs(period)),
  });
  const parsed = _parseRaw(raw);
  const timeline = parsed?.default?.timelineData || [];
  const result = { keywords: kws, timeline };
  _store(ck, result);
  res.json({ ok: true, ...result });
}));

module.exports = router;
