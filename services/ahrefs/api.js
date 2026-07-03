// Ahrefs integration — domain authority, backlinks, organic keywords, content gap.
// API v3: api.ahrefs.com/v3/ (JSON, Bearer auth)
// Requires AHREFS_API_KEY (set via Manage → Platform APIs).
// Docs: https://developer.ahrefs.com/api/
const express = require('express');
const router  = express.Router();
const _tenantCtx = require('../tenants/context');

const BASE    = 'https://api.ahrefs.com/v3';
const TIMEOUT = 15000;

function _key()  { return process.env.AHREFS_API_KEY || ''; }
function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safe(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch(e => {
    console.warn('[ahrefs]', e.message);
    if (!res.headersSent) _err(res, 500, e.message);
  });
}

async function _ahGet(path, params = {}) {
  const key = _key();
  if (!key) throw new Error('AHREFS_API_KEY not configured');
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE}/${path}${qs ? '?' + qs : ''}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const data = await r.json();
  if (!r.ok) {
    const msg = data?.detail || data?.message || data?.error || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return data;
}

// ── GET /api/ahrefs/status ────────────────────────────────────────────────
router.get('/status', (req, res) => {
  res.json({ ok: true, configured: !!_key() });
});

// ── POST /api/ahrefs/overview ─────────────────────────────────────────────
// Domain Rating, UR, backlinks, referring domains, organic keywords + traffic.
router.post('/overview', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'AHREFS_API_KEY not configured');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'ahrefs:overview' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { target, mode = 'domain' } = req.body;
  if (!target) return _err(res, 400, 'target required');
  const data = await _ahGet('site-explorer/overview', { target, mode });
  const m = data?.metrics || data?.domain_rating || data || {};
  res.json({
    ok: true, target, mode,
    overview: {
      domainRating:        m.domain_rating      ?? m.dr          ?? null,
      urlRating:           m.url_rating         ?? m.ur          ?? null,
      backlinks:           m.backlinks          ?? m.all_backlinks ?? null,
      refDomains:          m.refdomains         ?? m.ref_domains  ?? null,
      orgKeywords:         m.organic_keywords   ?? m.keywords     ?? null,
      orgTraffic:          m.organic_traffic    ?? m.traffic      ?? null,
      paidKeywords:        m.paid_keywords      ?? null,
      paidTraffic:         m.paid_traffic       ?? null,
    },
    raw: data,
  });
}));

// ── POST /api/ahrefs/backlinks ────────────────────────────────────────────
// Top backlinks for a domain/URL.
router.post('/backlinks', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'AHREFS_API_KEY not configured');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'ahrefs:backlinks' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { target, mode = 'domain', limit = 20 } = req.body;
  if (!target) return _err(res, 400, 'target required');
  const data = await _ahGet('site-explorer/all-backlinks', {
    target, mode,
    limit: Math.min(parseInt(limit, 10) || 20, 100),
    order_by: 'domain_rating:desc',
    select: 'url_from,domain_from,domain_rating_source,url_rating_source,traffic,anchor,title,first_seen,is_dofollow',
  });
  const links = data?.backlinks || data?.results || data?.data || [];
  res.json({
    ok: true, target, mode,
    backlinks: links.map(b => ({
      urlFrom:      b.url_from   || '',
      domainFrom:   b.domain_from || '',
      domainRating: b.domain_rating_source ?? b.dr ?? null,
      urlRating:    b.url_rating_source    ?? b.ur ?? null,
      traffic:      b.traffic   ?? null,
      anchor:       b.anchor    || '',
      title:        b.title     || '',
      firstSeen:    b.first_seen || '',
      dofollow:     b.is_dofollow ?? true,
    })),
    total: data?.total || links.length,
  });
}));

// ── POST /api/ahrefs/keywords ─────────────────────────────────────────────
// Top organic keywords a target ranks for.
router.post('/keywords', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'AHREFS_API_KEY not configured');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'ahrefs:keywords' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { target, mode = 'domain', country = 'us', limit = 20 } = req.body;
  if (!target) return _err(res, 400, 'target required');
  const data = await _ahGet('site-explorer/organic-keywords', {
    target, mode, country,
    limit: Math.min(parseInt(limit, 10) || 20, 100),
    order_by: 'traffic:desc',
    select: 'keyword,position,search_volume,keyword_difficulty,cpc,traffic,url',
  });
  const kws = data?.keywords || data?.results || data?.data || [];
  res.json({
    ok: true, target, mode, country,
    keywords: kws.map(k => ({
      keyword:      k.keyword      || '',
      position:     k.position     ?? null,
      searchVolume: k.search_volume ?? k.volume ?? null,
      difficulty:   k.keyword_difficulty ?? k.kd ?? null,
      cpc:          k.cpc          ?? null,
      traffic:      k.traffic      ?? null,
      url:          k.url          || '',
    })),
    total: data?.total || kws.length,
  });
}));

// ── POST /api/ahrefs/content-gap ─────────────────────────────────────────
// Keywords competitors rank for that the target doesn't — the content gap.
router.post('/content-gap', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'AHREFS_API_KEY not configured');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'ahrefs:content-gap' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { target, competitors = [], mode = 'domain', country = 'us', limit = 20 } = req.body;
  if (!target)              return _err(res, 400, 'target required');
  if (!competitors.length)  return _err(res, 400, 'at least 1 competitor required');

  const params = {
    target, mode, country,
    limit: Math.min(parseInt(limit, 10) || 20, 100),
    order_by: 'search_volume:desc',
    select: 'keyword,search_volume,keyword_difficulty,best_position,cpc',
  };
  competitors.slice(0, 5).forEach((c, i) => { params[`competitors[${i}]`] = c; });

  const data = await _ahGet('site-explorer/content-gap', params);
  const kws = data?.keywords || data?.results || data?.data || [];
  res.json({
    ok: true, target, competitors, country,
    gaps: kws.map(k => ({
      keyword:      k.keyword       || '',
      searchVolume: k.search_volume ?? k.volume ?? null,
      difficulty:   k.keyword_difficulty ?? k.kd ?? null,
      bestPosition: k.best_position ?? null,
      cpc:          k.cpc           ?? null,
    })),
    total: data?.total || kws.length,
  });
}));

module.exports = router;
