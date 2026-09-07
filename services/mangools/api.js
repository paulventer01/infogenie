// Mangools SEO integration — KWFinder, SiteProfiler, LinkMiner, SERPChecker.
// API v3: https://api.mangools.com/v3  Auth: x-access-token header (NOT Bearer).
// Requires MANGOOLS_API_KEY (set via Manage → Platform APIs).
// Docs: https://api.mangools.com/v3/swagger.json · Token: https://mangools.com/api-token
const express = require('express');
const router  = express.Router();
const _tenantCtx = require('../tenants/context');

const BASE    = 'https://api.mangools.com/v3';
const TIMEOUT = 15000;
const DEFAULT_LOCATION = 2840; // United States (Google Ads location id)

function _key() { return process.env.MANGOOLS_API_KEY || ''; }
function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safe(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch(e => {
    console.warn('[mangools]', e.message);
    if (!res.headersSent) _err(res, 500, e.message);
  });
}

async function _mg(method, path, { params, body } = {}) {
  const key = _key();
  if (!key) throw new Error('MANGOOLS_API_KEY not configured');
  const qs = params ? '?' + new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))
  ).toString() : '';
  const r = await fetch(`${BASE}${path}${qs}`, {
    method,
    headers: {
      'x-access-token': key,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!r.ok) {
    const msg = data?.error?.message || data?.message || data?.error || `HTTP ${r.status}`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = r.status;
    throw err;
  }
  return data;
}

function _loc(q) {
  const n = parseInt(q.location_id || q.locationId || DEFAULT_LOCATION, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LOCATION;
}

// ── GET /api/mangools/status ──────────────────────────────────────────────────
router.get('/status', _safe(async (req, res) => {
  res.json({ ok: true, configured: !!_key() });
}));

// ── GET /api/mangools/limits ──────────────────────────────────────────────────
router.get('/limits', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'MANGOOLS_API_KEY not configured');
  const data = await _mg('GET', '/kwfinder/limits');
  res.json({ ok: true, limits: data });
}));

// ── GET /api/mangools/locations?query= ────────────────────────────────────────
router.get('/locations', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'MANGOOLS_API_KEY not configured');
  const query = String(req.query.query || '').trim();
  if (!query) return _err(res, 400, 'query required');
  const data = await _mg('GET', '/mangools/locations', { params: { query } });
  res.json({ ok: true, locations: Array.isArray(data) ? data : (data.locations || []) });
}));

// ── GET /api/mangools/related-keywords?kw=&location_id= ───────────────────────
router.get('/related-keywords', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'MANGOOLS_API_KEY not configured');
  await _tenantCtx.resolveTenantId(req, { label: 'mangools:related-kw' });
  const kw = String(req.query.kw || req.query.keyword || '').trim();
  if (!kw) return _err(res, 400, 'kw required');
  const location_id = _loc(req.query);
  const data = await _mg('GET', '/kwfinder/related-keywords', {
    params: { kw, location_id, language_id: req.query.language_id || undefined },
  });
  const keywords = (data.keywords || []).map(k => ({
    keyword: k.kw,
    searchVolume: k.sv ?? k.svn ?? null,
    cpc: k.cpc ?? null,
    ppc: k.ppc ?? null,
    difficulty: k.seo ?? null,
    monthly: k.msv || null,
  }));
  res.json({
    ok: true, kw, location_id,
    keywords,
    countBeforeLimit: data.countKeywordsBeforeLimit ?? keywords.length,
    location: data.location || null,
    language: data.language || null,
  });
}));

// ── GET /api/mangools/competitor-keywords?url=&location_id= ───────────────────
router.get('/competitor-keywords', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'MANGOOLS_API_KEY not configured');
  await _tenantCtx.resolveTenantId(req, { label: 'mangools:comp-kw' });
  const url = String(req.query.url || req.query.domain || '').trim();
  if (!url) return _err(res, 400, 'url required');
  const location_id = _loc(req.query);
  const data = await _mg('GET', '/kwfinder/competitor-keywords', { params: { url, location_id } });
  const keywords = (data.keywords || []).map(k => ({
    keyword: k.kw,
    searchVolume: k.sv ?? k.svn ?? null,
    cpc: k.cpc ?? null,
    ppc: k.ppc ?? null,
    difficulty: k.seo ?? null,
  }));
  res.json({
    ok: true, url, location_id,
    keywords,
    competitorDomains: data.competitors || [],
    urlType: data.url_type || null,
  });
}));

// ── GET /api/mangools/competitor-domains?url=&location_id= ────────────────────
router.get('/competitor-domains', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'MANGOOLS_API_KEY not configured');
  await _tenantCtx.resolveTenantId(req, { label: 'mangools:comp-domains' });
  const url = String(req.query.url || req.query.domain || '').trim();
  if (!url) return _err(res, 400, 'url required');
  const location_id = _loc(req.query);
  const data = await _mg('GET', '/kwfinder/competitor-domain', { params: { url, location_id } });
  const domains = Array.isArray(data) ? data : (data.competitors || data.domains || []);
  res.json({ ok: true, url, location_id, domains });
}));

// ── GET /api/mangools/suggested-keywords?url=&location_id= ────────────────────
router.get('/suggested-keywords', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'MANGOOLS_API_KEY not configured');
  await _tenantCtx.resolveTenantId(req, { label: 'mangools:suggested-kw' });
  const url = String(req.query.url || req.query.domain || '').trim();
  if (!url) return _err(res, 400, 'url required');
  const location_id = _loc(req.query);
  const data = await _mg('GET', '/kwfinder/suggested-keywords', { params: { url, location_id } });
  const keywords = Array.isArray(data) ? data : (data.keywords || []);
  res.json({
    ok: true, url, location_id,
    keywords: keywords.map(k => (typeof k === 'string' ? { keyword: k } : {
      keyword: k.kw || k.keyword,
      searchVolume: k.sv ?? k.svn ?? null,
      cpc: k.cpc ?? null,
      difficulty: k.seo ?? null,
    })),
  });
}));

// ── POST /api/mangools/gap-analysis ───────────────────────────────────────────
// Body: { domain, competitors: string[], location_id? }
router.post('/gap-analysis', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'MANGOOLS_API_KEY not configured');
  await _tenantCtx.resolveTenantId(req, { label: 'mangools:gap' });
  const domain = String(req.body?.domain || '').trim();
  let competitors = req.body?.competitors || [];
  if (typeof competitors === 'string') {
    competitors = competitors.split(',').map(s => s.trim()).filter(Boolean);
  }
  if (!domain) return _err(res, 400, 'domain required');
  if (!Array.isArray(competitors) || !competitors.length) return _err(res, 400, 'competitors required');
  const location_id = _loc({ location_id: req.body?.location_id || req.body?.locationId });
  const data = await _mg('POST', '/kwfinder/gap-analysis', {
    body: {
      domain,
      competitors: competitors.slice(0, 5),
      location_id,
      page: parseInt(req.body?.page, 10) || 1,
    },
  });
  res.json({ ok: true, domain, competitors, location_id, result: data });
}));

// ── GET /api/mangools/overview?url= ───────────────────────────────────────────
router.get('/overview', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'MANGOOLS_API_KEY not configured');
  await _tenantCtx.resolveTenantId(req, { label: 'mangools:overview' });
  const url = String(req.query.url || req.query.domain || '').trim();
  if (!url) return _err(res, 400, 'url required');
  const data = await _mg('GET', '/siteprofiler/overview', { params: { url } });
  const maj = data.majestic || {};
  const moz = data.moz || {};
  res.json({
    ok: true,
    url,
    domain: data.domain || data.domainId || url,
    metrics: {
      trustFlow: maj.TrustFlow ?? null,
      citationFlow: maj.CitationFlow ?? null,
      refIPs: maj.RefIPs ?? null,
      mozPda: moz.pda ?? null,
      mozUpa: moz.upa ?? null,
      topRank: typeof data.topRank === 'object' ? null : (data.topRank ?? null),
      rankDist: data.rankDist || null,
    },
    raw: data,
  });
}));

// ── GET /api/mangools/site-competitors?url= ───────────────────────────────────
router.get('/site-competitors', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'MANGOOLS_API_KEY not configured');
  await _tenantCtx.resolveTenantId(req, { label: 'mangools:site-comp' });
  const url = String(req.query.url || req.query.domain || '').trim();
  if (!url) return _err(res, 400, 'url required');
  const data = await _mg('GET', '/siteprofiler/competitors', { params: { url } });
  res.json({ ok: true, url, competitors: data.competitors || [] });
}));

// ── GET /api/mangools/backlink-profile?url= ───────────────────────────────────
router.get('/backlink-profile', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'MANGOOLS_API_KEY not configured');
  await _tenantCtx.resolveTenantId(req, { label: 'mangools:backlinks' });
  const url = String(req.query.url || req.query.domain || '').trim();
  if (!url) return _err(res, 400, 'url required');
  const data = await _mg('GET', '/siteprofiler/backlink-profile', { params: { url } });
  const maj = data.majestic || {};
  res.json({
    ok: true,
    url,
    profile: {
      trustFlow: maj.TrustFlow ?? null,
      citationFlow: maj.CitationFlow ?? null,
      extBackLinks: maj.ExtBackLinks ?? null,
      refDomains: maj.RefDomains ?? null,
      refIPs: maj.RefIPs ?? null,
      refSubNets: maj.RefSubNets ?? null,
    },
    refDomains: data.majesticRefDomains || [],
    anchors: data.majesticAnchors || [],
    calendar: data.majesticBackLinkCalendar || [],
    raw: data,
  });
}));

// ── GET /api/mangools/top-content?url= ────────────────────────────────────────
router.get('/top-content', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'MANGOOLS_API_KEY not configured');
  await _tenantCtx.resolveTenantId(req, { label: 'mangools:top-content' });
  const url = String(req.query.url || req.query.domain || '').trim();
  if (!url) return _err(res, 400, 'url required');
  const data = await _mg('GET', '/siteprofiler/top-content', { params: { url } });
  res.json({ ok: true, url, topContent: data.topContent || [] });
}));

// ── GET /api/mangools/url-metrics?url= ────────────────────────────────────────
router.get('/url-metrics', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'MANGOOLS_API_KEY not configured');
  await _tenantCtx.resolveTenantId(req, { label: 'mangools:url-metrics' });
  const url = String(req.query.url || '').trim();
  if (!url) return _err(res, 400, 'url required');
  const data = await _mg('GET', '/linkminer/url-metrics', { params: { url } });
  const rows = Array.isArray(data) ? data : [];
  const first = rows[0] || {};
  const maj = first.m?.majestic?.v || first.m?.majestic || {};
  res.json({
    ok: true,
    url: first.url || url,
    metrics: {
      trustFlow: maj.TrustFlow ?? null,
      citationFlow: maj.CitationFlow ?? null,
      refDomains: maj.RefDomains ?? null,
      extBackLinks: maj.ExtBackLinks ?? null,
      refIPs: maj.RefIPs ?? null,
    },
    raw: first,
  });
}));

// ── GET /api/mangools/serps?kw=&location_id= ──────────────────────────────────
router.get('/serps', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'MANGOOLS_API_KEY not configured');
  await _tenantCtx.resolveTenantId(req, { label: 'mangools:serps' });
  const kw = String(req.query.kw || req.query.keyword || '').trim();
  if (!kw) return _err(res, 400, 'kw required');
  const location_id = _loc(req.query);
  const data = await _mg('GET', '/serpchecker/serps', {
    params: {
      kw,
      location_id,
      platform_id: req.query.platform_id || undefined,
    },
  });
  res.json({ ok: true, kw, location_id, serp: data });
}));

module.exports = router;
