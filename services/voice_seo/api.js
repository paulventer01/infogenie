const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { analyzeVoiceSeo } = require('./analyzer');

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
      console.error('[voice-seo]', e.message || e);
      if (!res.headersSent) res.json({ ok: false, error: e.message || 'voice_seo_error' });
    }
  };
}

router.post('/run', express.json(), _route(async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!url) return _err(res, 400, 'url required');
  if (!_runGeoAudit) return _err(res, 503, 'audit engine unavailable');

  const geo = await _runGeoAudit(url, { headless: !!req.body?.headless });
  if (!geo.ok) return _err(res, 400, geo.error);

  const report = analyzeVoiceSeo(geo);
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'voice-seo:run' });
  const id = 'vs_' + crypto.randomBytes(6).toString('hex');

  if (_db.hasDb() && tid != null) {
    await _db.getPool().query(`
      INSERT INTO voice_seo_runs (id, tenant_id, url, score, grade, signals, fixes, summary)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `, [
      id, tid, report.url, report.score, report.grade,
      JSON.stringify(report.signals), JSON.stringify(report.fixes), JSON.stringify(report.summary),
    ]);
  }

  res.json({ ok: true, id, ...report });
}));

router.get('/runs', _route(async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, runs: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'voice-seo:runs' });
  const r = await _db.getPool().query(`
    SELECT id, url, score, grade, created_at FROM voice_seo_runs
    WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30
  `, [tid]);
  res.json({ ok: true, runs: r.rows });
}));

module.exports = router;
