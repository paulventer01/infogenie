const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { listTraces, traceStats, recordTrace } = require('./store');

const _safe = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const _err = (res, code, msg) => res.status(code).json({ ok: false, error: msg });

async function _tid(req, label) {
  const tid = await _tenantCtx.resolveTenantId(req, { label });
  if (tid) return tid;
  if (!_db.hasDb()) return 1;
  return null;
}

router.get('/status', _safe(async (_req, res) => {
  res.json({
    ok: true,
    ready: true,
    note: 'AI call traces — latency, provider, cascade tier, estimated cost',
  });
}));

router.get('/', _safe(async (req, res) => {
  const tid = await _tid(req, 'ai-traces:list');
  if (!tid) return _err(res, 400, 'no_tenant');
  const traces = await listTraces({
    tenantId: tid,
    limit: req.query.limit,
    surface: req.query.surface,
  });
  res.json({ ok: true, traces });
}));

router.get('/stats', _safe(async (req, res) => {
  const tid = await _tid(req, 'ai-traces:stats');
  if (!tid) return _err(res, 400, 'no_tenant');
  const stats = await traceStats({ tenantId: tid, hours: Number(req.query.hours) || 24 });
  res.json({ ok: true, stats });
}));

/** Manual/test insert */
router.post('/', _safe(async (req, res) => {
  const tid = await _tid(req, 'ai-traces:create');
  if (!tid) return _err(res, 400, 'no_tenant');
  const t = await recordTrace({ ...req.body, tenant_id: tid });
  res.json({ ok: !!t, trace: t });
}));

router._resetMem = require('./store')._resetMem;
module.exports = router;
