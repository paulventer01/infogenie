// Tier 28 — White-Label Reports
// Single global brand profile stored in kv_store. Lets the user override the
// InfoGenie purple/navy palette + agency name + footer + (optional) logo on
// every PPTX / PDF / XLSX export. Mirrors the existing exports pipeline by
// passing a `brand` object through to each streamer; no schema needed.
const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const _kvScope = require('../tenants/kv_scope');

// Per-workspace brand profile. Stored as `white_label.brand_profile:t<tid>`.
// The legacy global key is migrated into the default (owner) tenant once at boot.
const KV_KEY = 'white_label.brand_profile';
_kvScope.migrateGlobalSingleton(KV_KEY, KV_KEY).catch(() => {});
async function _tid(req, label) { return await _tenantCtx.resolveTenantId(req, { label }); }

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safeAsync(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch(e => {
    console.warn('[white-label]', e.stack || e.message);
    if (!res.headersSent) _err(res, 500, 'Internal server error');
  });
}
function _safeColor(s, fallback) { return /^#[0-9A-Fa-f]{6}$/.test(String(s || '')) ? s : fallback; }
function _safeText(s, max) { return String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, '').slice(0, max); }
function _safeLogo(s) {
  // Accept only data:image/(png|jpeg|jpg|svg+xml);base64,... up to ~256 KB
  const v = String(s || '').trim();
  if (!v) return '';
  if (!/^data:image\/(png|jpeg|jpg|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(v)) return '';
  if (v.length > 350_000) return '';
  return v;
}

const DEFAULTS = {
  enabled: false,
  agencyName: '',
  logoDataUrl: '',
  primaryColor: '#1E1B4B',
  accentColor:  '#7C3AED',
  textColor:    '#0A1628',
  footerText:   '',
  hideInfoGenieBranding: false,
};

function _normalise(raw) {
  const r = (raw && typeof raw === 'object') ? raw : {};
  return {
    enabled: r.enabled === true,
    agencyName: _safeText(r.agencyName, 80),
    logoDataUrl: _safeLogo(r.logoDataUrl),
    primaryColor: _safeColor(r.primaryColor, DEFAULTS.primaryColor),
    accentColor:  _safeColor(r.accentColor,  DEFAULTS.accentColor),
    textColor:    _safeColor(r.textColor,    DEFAULTS.textColor),
    footerText:   _safeText(r.footerText, 200),
    hideInfoGenieBranding: r.hideInfoGenieBranding === true,
  };
}

async function getBrand(tid) {
  if (!_db.hasDb || !_db.hasDb()) return DEFAULTS;
  if (tid == null) return DEFAULTS; // no resolvable workspace → no white-label override
  try {
    const v = await _db.kvGet(_kvScope.tkey(KV_KEY, tid), null);
    if (!v) return DEFAULTS;
    return Object.assign({}, DEFAULTS, _normalise(v));
  } catch { return DEFAULTS; }
}

router.get('/profile', _safeAsync(async (req, res) => {
  const brand = await getBrand(await _tid(req, 'white-label:get'));
  res.json({ ok: true, brand, defaults: DEFAULTS });
}));

router.put('/profile', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 503, 'Database unavailable');
  const tid = await _tid(req, 'white-label:put');
  if (tid == null) return _err(res, 400, 'no_tenant');
  const brand = _normalise(req.body || {});
  await _db.kvSet(_kvScope.tkey(KV_KEY, tid), brand);
  res.json({ ok: true, brand });
}));

router.delete('/profile', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 503, 'Database unavailable');
  const tid = await _tid(req, 'white-label:delete');
  if (tid == null) return _err(res, 400, 'no_tenant');
  await _db.kvSet(_kvScope.tkey(KV_KEY, tid), DEFAULTS);
  res.json({ ok: true, brand: DEFAULTS });
}));

// Sample report — generates a tiny PDF with the current brand applied so the
// user can preview their theme before regenerating real reports.
router.get('/preview/:format', _safeAsync(async (req, res) => {
  const fmt = req.params.format;
  if (!['pdf', 'pptx', 'xlsx'].includes(fmt)) return _err(res, 400, 'unknown format');
  const brand = await getBrand(await _tid(req, 'white-label:preview'));
  const report = {
    title: (brand.agencyName ? brand.agencyName + ' — ' : '') + 'Sample Branded Report',
    generated_at: Date.now(),
    sections: [
      { kind: 'text', title: 'Executive Summary',
        body: 'This is a preview showing how your branded reports will look. Cover colour, title bar, table headers and footer all use your White-Label palette. Replace this with real data exports from any /api/exports source once you are happy.' },
      { kind: 'table', title: 'Sample Metrics',
        headers: ['Channel', 'Sessions', 'Conversions', 'CVR %'],
        rows: [
          ['Organic Search', '12,840', '482', '3.75%'],
          ['Paid Search',    '8,210',  '391', '4.76%'],
          ['Social',         '4,920',  '128', '2.60%'],
          ['Email',          '3,180',  '215', '6.76%'],
          ['Direct',         '6,450',  '237', '3.67%'],
        ],
      },
    ],
  };
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${(brand.agencyName || 'whitelabel').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-preview-${stamp}.${fmt}`;
  const { streamPptx } = require('../exports/pptx_report');
  const { streamPdf }  = require('../exports/pdf_report');
  const { streamXlsx } = require('../exports/xlsx_report');
  if (fmt === 'pptx') return await streamPptx(report, res, filename, brand);
  if (fmt === 'xlsx') return await streamXlsx(report, res, filename, brand);
  return streamPdf(report, res, filename, brand);
}));

module.exports = router;
module.exports.getBrand = getBrand;
module.exports.DEFAULTS = DEFAULTS;
