// Bing Webmaster Tools integration — fetches keyword performance, crawl data
// and site stats from Bing's Webmaster API using BING_WEBMASTER_API_KEY.
// API reference: https://learn.microsoft.com/en-us/dotnet/api/microsoft.bing.webmaster.api
const express = require('express');
const router  = express.Router();
const _db     = require('../../db');
const _tenantCtx = require('../tenants/context');

const BASE = 'https://ssl.bing.com/webmaster/api.svc/json';
const TIMEOUT = 12000;

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safe(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch(e => {
    console.warn('[bing-wmt]', e.message);
    if (!res.headersSent) _err(res, 500, 'Internal server error');
  });
}
function _key() { return process.env.BING_WEBMASTER_API_KEY || ''; }

async function _bingGet(path, params = {}) {
  const key = _key();
  if (!key) throw new Error('BING_WEBMASTER_API_KEY not configured');
  const qs = new URLSearchParams({ ...params, apikey: key }).toString();
  const url = `${BASE}/${path}?${qs}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = {}; }
  if (!r.ok || data.d === null) {
    const msg = data.Message || data.message || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return data.d !== undefined ? data.d : data;
}

async function _saveSnapshot(tenant_id, site_url, snap_type, data) {
  if (!_db.hasDb || !_db.hasDb()) return;
  try {
    const pool = _db.getPool();
    await pool.query(
      `INSERT INTO bing_wmt_snapshots(tenant_id, site_url, snap_type, data)
       VALUES($1,$2,$3,$4)`,
      [tenant_id, site_url, snap_type, JSON.stringify(data)]
    );
  } catch (e) { console.warn('[bing-wmt] snapshot save failed:', e.message); }
}

// ── GET /api/bing-webmaster/status ────────────────────────────────────────────
router.get('/status', _safe(async (req, res) => {
  const configured = !!_key();
  res.json({ ok: true, configured });
}));

// ── GET /api/bing-webmaster/sites ─────────────────────────────────────────────
router.get('/sites', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'BING_WEBMASTER_API_KEY not configured');
  const sites = await _bingGet('GetSites');
  res.json({ ok: true, sites: Array.isArray(sites) ? sites : [] });
}));

// ── GET /api/bing-webmaster/activity?siteUrl=&period=7 ────────────────────────
router.get('/activity', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'BING_WEBMASTER_API_KEY not configured');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'bing-wmt:activity' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { siteUrl } = req.query;
  if (!siteUrl) return _err(res, 400, 'siteUrl required');

  const now    = new Date();
  const period = parseInt(req.query.period, 10) || 30;
  const start  = new Date(now); start.setDate(start.getDate() - period);

  const fmt = (d) => d.toISOString().slice(0, 10);
  const data = await _bingGet('GetSiteActivityInfo', {
    siteUrl,
    startDate: fmt(start),
    endDate:   fmt(now),
  });

  await _saveSnapshot(tid, siteUrl, 'site_activity', data || {});
  res.json({ ok: true, activity: data });
}));

// ── GET /api/bing-webmaster/page-stats?siteUrl=&page= ────────────────────────
router.get('/page-stats', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'BING_WEBMASTER_API_KEY not configured');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'bing-wmt:page-stats' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { siteUrl, page } = req.query;
  if (!siteUrl) return _err(res, 400, 'siteUrl required');

  const now   = new Date();
  const start = new Date(now); start.setDate(start.getDate() - 30);
  const fmt   = (d) => d.toISOString().slice(0, 10);

  const params = { siteUrl, startDate: fmt(start), endDate: fmt(now) };
  if (page) params.page = page;

  const data = await _bingGet('GetPageQueryStats', params);
  await _saveSnapshot(tid, siteUrl, 'page_stats', data || {});
  res.json({ ok: true, pageStats: Array.isArray(data) ? data : [] });
}));

// ── GET /api/bing-webmaster/keywords?siteUrl=&q= ─────────────────────────────
// Returns Bing-specific keyword data: impressions, clicks, avg position on Bing
router.get('/keywords', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'BING_WEBMASTER_API_KEY not configured');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'bing-wmt:keywords' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { siteUrl, q, country = 'us', language = 'en-US' } = req.query;
  if (!siteUrl) return _err(res, 400, 'siteUrl required');

  const now   = new Date();
  const start = new Date(now); start.setDate(start.getDate() - 30);
  const fmt   = (d) => d.toISOString().slice(0, 10);

  const params = { siteUrl, startDate: fmt(start), endDate: fmt(now), country, language };
  if (q) params.q = q;

  const data = await _bingGet('GetKeywordStats', params);
  res.json({ ok: true, keywords: Array.isArray(data) ? data : [] });
}));

// ── GET /api/bing-webmaster/crawl?siteUrl= ────────────────────────────────────
router.get('/crawl', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'BING_WEBMASTER_API_KEY not configured');
  const { siteUrl } = req.query;
  if (!siteUrl) return _err(res, 400, 'siteUrl required');
  const data = await _bingGet('GetCrawlStats', { siteUrl });
  res.json({ ok: true, crawl: data });
}));

// ── GET /api/bing-webmaster/history?snap_type= ───────────────────────────────
router.get('/history', _safe(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok: true, history: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'bing-wmt:history' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { snap_type = 'site_activity' } = req.query;
  const r = await _db.getPool().query(
    `SELECT id, site_url, snap_type, data, created_at FROM bing_wmt_snapshots
     WHERE tenant_id=$1 AND snap_type=$2 ORDER BY created_at DESC LIMIT 30`,
    [tid, snap_type]
  );
  res.json({ ok: true, history: r.rows });
}));

module.exports = router;
