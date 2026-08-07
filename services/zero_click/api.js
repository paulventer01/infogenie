const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { analyzeZeroClick, SIGNALS } = require('./analyzer');

let _runGeoAudit;
try {
  _runGeoAudit = require('../geo_audit/api').runGeoAudit;
} catch {
  _runGeoAudit = null;
}

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _route(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) {
      console.error('[zero-click]', e.message || e);
      if (!res.headersSent) res.json({ ok: false, error: e.message || 'zero_click_error' });
    }
  };
}

router.get('/signals', (_req, res) => {
  res.json({ ok: true, signals: SIGNALS });
});

router.post('/run', express.json(), _route(async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!url) return _err(res, 400, 'url required');
  if (!/^https?:\/\//i.test(url)) return _err(res, 400, 'url must start with http:// or https://');
  if (!_runGeoAudit) return _err(res, 503, 'audit engine unavailable');

  const geo = await _runGeoAudit(url, { headless: !!req.body?.headless });
  if (!geo.ok) return _err(res, 400, geo.error);

  const report = analyzeZeroClick(geo);
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'zero-click:run' });
  const id = 'zc_' + crypto.randomBytes(6).toString('hex');

  if (_db.hasDb() && tid != null) {
    await _db.getPool().query(`
      INSERT INTO zero_click_runs (id, tenant_id, url, score, grade, clickless_pct, aeo_score, signals, fixes, summary)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `, [
      id, tid, report.url, report.score, report.grade, report.clicklessImpressionPct,
      report.aeoScore, JSON.stringify(report.signals), JSON.stringify(report.fixes),
      JSON.stringify(report.summary),
    ]);
  }

  res.json({ ok: true, id, ...report });
}));

router.get('/runs', _route(async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, runs: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'zero-click:runs' });
  const r = await _db.getPool().query(`
    SELECT id, url, score, grade, clickless_pct, aeo_score, created_at
    FROM zero_click_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30
  `, [tid]);
  res.json({ ok: true, runs: r.rows });
}));

module.exports = router;
