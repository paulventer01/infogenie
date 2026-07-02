// Majestic SEO integration — Trust Flow, Citation Flow, backlink data.
// Uses the OpenApps (free) tier: Fresh Index, 1000 req/day with attribution.
// Requires MAJESTIC_API_KEY (set via Manage → Platform APIs).
// Docs: https://developer.majestic.com/
const express = require('express');
const router  = express.Router();
const _tenantCtx = require('../tenants/context');

const BASE    = 'https://api.majestic.com/api/json';
const TIMEOUT = 12000;

function _key() { return process.env.MAJESTIC_API_KEY || ''; }
function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safe(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch(e => {
    console.warn('[majestic]', e.message);
    if (!res.headersSent) _err(res, 500, e.message);
  });
}

async function _mjGet(params = {}) {
  const key = _key();
  if (!key) throw new Error('MAJESTIC_API_KEY not configured');
  const qs = new URLSearchParams({ ...params, app_api_key: key }).toString();
  const url = `${BASE}?${qs}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = {}; }
  if (!r.ok || data.Code === 'ApiKeyUnauthorized' || data.Code === 'InvalidApiKey') {
    const msg = data.ErrorMessage || data.Code || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return data;
}

// ── GET /api/majestic/status ───────────────────────────────────────────────
router.get('/status', _safe(async (req, res) => {
  res.json({ ok: true, configured: !!_key() });
}));

// ── GET /api/majestic/item?url=&datasource=fresh ───────────────────────────
// Core authority metrics: Trust Flow, Citation Flow, backlinks, ref domains,
// and Topical Trust Flow categories for the domain/URL.
router.get('/item', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'MAJESTIC_API_KEY not configured');
  await _tenantCtx.resolveTenantId(req, { label: 'majestic:item' });
  const { url, datasource = 'fresh' } = req.query;
  if (!url) return _err(res, 400, 'url required');
  const data = await _mjGet({ cmd: 'GetIndexItemInfo', items: 1, item0: url, datasource });
  const item = data.DataTables?.Results?.Data?.[0] || {};
  res.json({
    ok: true,
    url,
    datasource,
    metrics: {
      trustFlow:        item.TrustFlow       ?? null,
      citationFlow:     item.CitationFlow     ?? null,
      refDomains:       item.RefDomains       ?? null,
      refIPs:           item.RefIPs           ?? null,
      extBackLinks:     item.ExtBackLinks     ?? null,
      indexedUrls:      item.IndexedURLs      ?? null,
      deletedBackLinks: item.DeletedBackLinks ?? null,
      // Topical TF: parallel arrays TopicalTrustFlow_Topic_Value/Name
      topicalTF: (() => {
        const vals  = item.TopicalTrustFlow_Topic_Value  ? String(item.TopicalTrustFlow_Topic_Value).split('|')  : [];
        const names = item.TopicalTrustFlow_Topic_Name   ? String(item.TopicalTrustFlow_Topic_Name).split('|')   : [];
        return names.map((n, i) => ({ topic: n, value: parseFloat(vals[i]) || 0 })).sort((a, b) => b.value - a.value).slice(0, 8);
      })(),
    },
    raw: item,
  });
}));

// ── GET /api/majestic/backlinks?url=&count=20&datasource=fresh ────────────
router.get('/backlinks', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'MAJESTIC_API_KEY not configured');
  await _tenantCtx.resolveTenantId(req, { label: 'majestic:backlinks' });
  const { url, count = 20, datasource = 'fresh', startIndex = 0 } = req.query;
  if (!url) return _err(res, 400, 'url required');
  const data = await _mjGet({ cmd: 'GetBackLinkData', URL: url, datasource, Count: Math.min(parseInt(count, 10) || 20, 100), StartIndex: parseInt(startIndex, 10) || 0 });
  const rows = data.DataTables?.BackLinks?.Data || [];
  res.json({ ok: true, url, backlinks: rows, total: data.DataTables?.BackLinks?.TotalMatchedResults || 0 });
}));

// ── GET /api/majestic/anchors?url=&count=20&datasource=fresh ─────────────
router.get('/anchors', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'MAJESTIC_API_KEY not configured');
  await _tenantCtx.resolveTenantId(req, { label: 'majestic:anchors' });
  const { url, count = 20, datasource = 'fresh' } = req.query;
  if (!url) return _err(res, 400, 'url required');
  const data = await _mjGet({ cmd: 'GetAnchorText', URL: url, datasource, Count: Math.min(parseInt(count, 10) || 20, 100), MaxSourceURLsPerRefDomain: 0, ShowDomainInfo: 0, StartIndex: 0 });
  const rows = data.DataTables?.AnchorText?.Data || [];
  res.json({ ok: true, url, anchors: rows });
}));

// ── GET /api/majestic/ref-domains?url=&count=20&datasource=fresh ──────────
router.get('/ref-domains', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'MAJESTIC_API_KEY not configured');
  await _tenantCtx.resolveTenantId(req, { label: 'majestic:ref-domains' });
  const { url, count = 20, datasource = 'fresh' } = req.query;
  if (!url) return _err(res, 400, 'url required');
  const data = await _mjGet({ cmd: 'GetRefDomainsInfo', URL: url, datasource, Count: Math.min(parseInt(count, 10) || 20, 100), StartIndex: 0 });
  const rows = data.DataTables?.RefDomains?.Data || [];
  res.json({ ok: true, url, refDomains: rows });
}));

module.exports = router;
