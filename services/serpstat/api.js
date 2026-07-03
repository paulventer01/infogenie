// Serpstat integration — domain overview, top keywords, organic competitors.
// API v4: api.serpstat.com/v4/ (JSON-RPC style POST)
// Requires SERPSTAT_API_KEY (set via Manage → Platform APIs).
// Docs: https://serpstat.com/api/
const express = require('express');
const router  = express.Router();
const _tenantCtx = require('../tenants/context');

const BASE    = 'https://api.serpstat.com/v4';
const TIMEOUT = 15000;

function _key()  { return process.env.SERPSTAT_API_KEY || ''; }
function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safe(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch(e => {
    console.warn('[serpstat]', e.message);
    if (!res.headersSent) _err(res, 500, e.message);
  });
}

async function _ssPost(method, params = {}) {
  const key = _key();
  if (!key) throw new Error('SERPSTAT_API_KEY not configured');
  const body = JSON.stringify({ id: 1, method, params: { ...params, token: key } });
  const r = await fetch(`${BASE}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const data = await r.json();
  if (data?.error) {
    const msg = data.error?.message || data.error?.code || JSON.stringify(data.error);
    throw new Error(msg);
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return data?.result || data;
}

// ── GET /api/serpstat/status ──────────────────────────────────────────────
router.get('/status', (req, res) => {
  res.json({ ok: true, configured: !!_key() });
});

// ── POST /api/serpstat/domain ─────────────────────────────────────────────
// Domain summary: SE traffic, keywords, visibility score, ad keywords.
router.post('/domain', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'SERPSTAT_API_KEY not configured');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'serpstat:domain' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { domain, se = 'g_us' } = req.body;
  if (!domain) return _err(res, 400, 'domain required');
  const result = await _ssPost('SerpstatDomainProcedure.getSummary', { domain, se });
  const d = result?.data || result || {};
  res.json({
    ok: true, domain, se,
    summary: {
      visibilityScore:   d.visible_percentage ?? d.visibility   ?? null,
      organicKeywords:   d.keywords           ?? null,
      organicTraffic:    d.traff              ?? d.traffic      ?? null,
      paidKeywords:      d.ad_keywords        ?? null,
      paidTraffic:       d.ad_traff           ?? null,
      newKeywords:       d.new_keywords       ?? null,
      lostKeywords:      d.lost_keywords      ?? null,
      riseKeywords:      d.rised_keywords     ?? null,
      fellKeywords:      d.felled_keywords    ?? null,
    },
  });
}));

// ── POST /api/serpstat/keywords ───────────────────────────────────────────
// Top organic keywords for a domain.
router.post('/keywords', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'SERPSTAT_API_KEY not configured');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'serpstat:keywords' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { domain, se = 'g_us', limit = 20, sort = 'traff' } = req.body;
  if (!domain) return _err(res, 400, 'domain required');
  const result = await _ssPost('SerpstatDomainProcedure.getTopUrls', {
    domain, se,
    size:      Math.min(parseInt(limit, 10) || 20, 100),
    order:     sort,
    order_dir: 'desc',
    filters:   [],
  });
  const rows = result?.data || [];
  res.json({
    ok: true, domain, se,
    keywords: rows.map(r => ({
      keyword:      r.keyword     || '',
      position:     r.position    ?? null,
      searchVolume: r.queries     ?? r.volume ?? null,
      trafficShare: r.traff       ?? null,
      cpc:          r.cost        ?? null,
      difficulty:   r.difficulty  ?? null,
      url:          r.url         || '',
    })),
    total: result?.total || rows.length,
  });
}));

// ── POST /api/serpstat/competitors ────────────────────────────────────────
// Organic competitors for a domain.
router.post('/competitors', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'SERPSTAT_API_KEY not configured');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'serpstat:competitors' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { domain, se = 'g_us', limit = 10 } = req.body;
  if (!domain) return _err(res, 400, 'domain required');
  const result = await _ssPost('SerpstatDomainProcedure.getCompetitors', {
    domain, se,
    size:      Math.min(parseInt(limit, 10) || 10, 30),
    order:     'relevance',
    order_dir: 'desc',
    filters:   [],
  });
  const rows = result?.data || [];
  res.json({
    ok: true, domain, se,
    competitors: rows.map(r => ({
      domain:          r.domain          || '',
      relevance:       r.relevance       ?? null,
      commonKeywords:  r.common_keywords ?? null,
      organicKeywords: r.keywords        ?? null,
      organicTraffic:  r.traff           ?? null,
    })),
    total: result?.total || rows.length,
  });
}));

// ── POST /api/serpstat/keyword-research ───────────────────────────────────
// Volume, CPC, difficulty, and related keywords for a phrase.
router.post('/keyword-research', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'SERPSTAT_API_KEY not configured');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'serpstat:kw-research' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { keyword, se = 'g_us', limit = 10 } = req.body;
  if (!keyword) return _err(res, 400, 'keyword required');
  const [mainRes, relRes] = await Promise.all([
    _ssPost('SerpstatKeywordProcedure.getKeywordsInfo', { keywords: [keyword], se }),
    _ssPost('SerpstatKeywordProcedure.getRelatedKeywords', {
      keyword, se,
      size:      Math.min(parseInt(limit, 10) || 10, 30),
      order:     'queries',
      order_dir: 'desc',
    }),
  ]);
  const main    = (mainRes?.data || [])[0] || {};
  const related = relRes?.data   || [];
  res.json({
    ok: true, keyword, se,
    metrics: {
      keyword:      main.keyword     || keyword,
      searchVolume: main.queries     ?? null,
      cpc:          main.cost        ?? null,
      difficulty:   main.difficulty  ?? null,
      competition:  main.competition ?? null,
    },
    relatedKeywords: related.map(r => ({
      keyword:      r.keyword     || '',
      searchVolume: r.queries     ?? null,
      cpc:          r.cost        ?? null,
      difficulty:   r.difficulty  ?? null,
    })),
  });
}));

module.exports = router;
