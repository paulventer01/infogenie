'use strict';

const express = require('express');
const router = express.Router();
const _tenantCtx = require('../tenants/context');
const { computeCanonicalMetrics, readMetric, DEFINITION_VERSION } = require('./compute');
const { listDefinitions, resolveDefinition } = require('./definitions');
const { computeContribution } = require('./contribution');

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safe(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch((e) => {
    console.warn('[canonical-metrics]', e.message);
    if (!res.headersSent) _err(res, 500, e.message || 'internal error');
  });
}

// GET /api/metrics/definitions — versioned dictionary
router.get('/definitions', _safe(async (_req, res) => {
  res.json({ ok: true, ...listDefinitions() });
}));

router.get('/definitions/:key', _safe(async (req, res) => {
  const def = resolveDefinition(req.params.key);
  if (!def) return _err(res, 404, 'unknown_metric');
  res.json({ ok: true, version: DEFINITION_VERSION, definition: def });
}));

// GET /api/metrics/canonical?days=30
router.get('/canonical', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'metrics:canonical' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 30));
  const snap = await computeCanonicalMetrics(tid, { days });
  res.json(snap);
}));

// GET /api/metrics/canonical/metric?key=ads.trueRoas&days=30
router.get('/canonical/metric', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'metrics:canonical-metric' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const key = String(req.query.key || '').trim();
  if (!key) return _err(res, 400, 'key required');
  const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 30));
  const snap = await computeCanonicalMetrics(tid, { days });
  const def = resolveDefinition(key);
  res.json({
    ok: true,
    key,
    value: readMetric(snap, key),
    days,
    kind: def?.kind || null,
    definition: def || null,
    definition_version: DEFINITION_VERSION,
    labelled: snap.labelled?.[def?.key] || null,
    provenance: snap.provenance,
  });
}));

// GET /api/metrics/canonical/goals-vs-actuals
router.get('/canonical/goals-vs-actuals', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'metrics:goals-vs-actuals' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 30));
  const snap = await computeCanonicalMetrics(tid, { days });
  res.json({
    ok: true,
    days,
    items: snap.goals_vs_actuals,
    spend: snap.spend,
    blended_roas: snap.blended_roas,
    true_roas: snap.true_roas,
    labelled: snap.labelled,
    definition_version: DEFINITION_VERSION,
    provenance: snap.provenance,
  });
}));

// GET /api/metrics/contribution?days=30 — causal system of record
router.get('/contribution', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'metrics:contribution' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const days = Math.min(90, Math.max(7, parseInt(req.query.days, 10) || 30));
  const record = await computeContribution(tid, { days });
  res.json(record);
}));

// POST /api/metrics/contribution/refresh — same payload (explicit refresh)
router.post('/contribution/refresh', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'metrics:contribution-refresh' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const days = Math.min(90, Math.max(7, parseInt(req.body?.days || req.query.days, 10) || 30));
  const record = await computeContribution(tid, { days });
  res.json(record);
}));

module.exports = router;
module.exports.computeCanonicalMetrics = computeCanonicalMetrics;
module.exports.readMetric = readMetric;
module.exports.computeContribution = computeContribution;
module.exports.DEFINITION_VERSION = DEFINITION_VERSION;
