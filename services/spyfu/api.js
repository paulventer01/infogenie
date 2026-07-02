// SpyFu integration — competitor PPC + SEO intelligence.
// API v2: domain stats, organic/paid keywords, competitor lists.
// Requires SPYFU_API_KEY (set via Manage → Platform APIs).
// Docs: https://www.spyfu.com/api/core
const express = require('express');
const router  = express.Router();
const _tenantCtx = require('../tenants/context');

const BASE    = 'https://www.spyfu.com/apis';
const TIMEOUT = 12000;

function _key() { return process.env.SPYFU_API_KEY || ''; }
function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safe(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch(e => {
    console.warn('[spyfu]', e.message);
    if (!res.headersSent) _err(res, 500, e.message);
  });
}

async function _sfGet(path, params = {}) {
  const key = _key();
  if (!key) throw new Error('SPYFU_API_KEY not configured');
  const qs = new URLSearchParams({ ...params, api_key: key }).toString();
  const url = `${BASE}/${path}?${qs}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = {}; }
  if (!r.ok) {
    const msg = data.message || data.error || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return data;
}

// ── GET /api/spyfu/status ──────────────────────────────────────────────────
router.get('/status', _safe(async (req, res) => {
  res.json({ ok: true, configured: !!_key() });
}));

// ── GET /api/spyfu/domain?domain=&countryCode=US ───────────────────────────
// Domain-level overview: organic keywords, PPC keywords, SEO value, PPC budget
router.get('/domain', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'SPYFU_API_KEY not configured');
  const { domain, countryCode = 'US' } = req.query;
  if (!domain) return _err(res, 400, 'domain required');
  const data = await _sfGet('domain_stats_api/v2/getDomainStatsForSingleDomain', { domain, countryCode });
  res.json({ ok: true, domain, stats: data });
}));

// ── GET /api/spyfu/organic-keywords?domain=&countryCode=US&page=1 ─────────
router.get('/organic-keywords', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'SPYFU_API_KEY not configured');
  await _tenantCtx.resolveTenantId(req, { label: 'spyfu:organic-kw' });
  const { domain, countryCode = 'US', page = 1 } = req.query;
  if (!domain) return _err(res, 400, 'domain required');
  const startingRow = ((parseInt(page, 10) - 1) * 20) + 1;
  const data = await _sfGet('url_api/v2/getOrganicKeywords', { domain, countryCode, startingRow, pageSize: 20 });
  res.json({ ok: true, domain, keywords: data.results || data || [], totalRows: data.totalRows || 0 });
}));

// ── GET /api/spyfu/paid-keywords?domain=&countryCode=US&page=1 ────────────
router.get('/paid-keywords', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'SPYFU_API_KEY not configured');
  await _tenantCtx.resolveTenantId(req, { label: 'spyfu:paid-kw' });
  const { domain, countryCode = 'US', page = 1 } = req.query;
  if (!domain) return _err(res, 400, 'domain required');
  const startingRow = ((parseInt(page, 10) - 1) * 20) + 1;
  const data = await _sfGet('url_api/v2/getPaidKeywords', { domain, countryCode, startingRow, pageSize: 20 });
  res.json({ ok: true, domain, keywords: data.results || data || [], totalRows: data.totalRows || 0 });
}));

// ── GET /api/spyfu/competitors?domain=&type=organic|paid&countryCode=US ───
router.get('/competitors', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'SPYFU_API_KEY not configured');
  await _tenantCtx.resolveTenantId(req, { label: 'spyfu:competitors' });
  const { domain, type = 'organic', countryCode = 'US' } = req.query;
  if (!domain) return _err(res, 400, 'domain required');
  const endpoint = type === 'paid'
    ? 'related_urls_api/v2/getPaidCompetitors'
    : 'related_urls_api/v2/getOrganicCompetitors';
  const data = await _sfGet(endpoint, { domain, countryCode });
  res.json({ ok: true, domain, type, competitors: data.results || data || [] });
}));

module.exports = router;
