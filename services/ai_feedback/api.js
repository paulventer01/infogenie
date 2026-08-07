const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { recordFeedback, listFeedback, feedbackStats } = require('./store');

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
    note: 'AI output feedback — thumbs → memory + escalate candidates by surface',
  });
}));

router.post('/', _safe(async (req, res) => {
  const tid = await _tid(req, 'ai-feedback:create');
  if (!tid) return _err(res, 400, 'no_tenant');
  try {
    const saved = await recordFeedback({
      tenant_id: tid,
      user_email: req.user?.email || null,
      surface: req.body?.surface,
      call_trace_id: req.body?.call_trace_id,
      rating: req.body?.rating,
      comment: req.body?.comment,
      output_text: req.body?.output_text || req.body?.output,
      output_hash: req.body?.output_hash,
      meta: req.body?.meta || {},
    });
    res.json({ ok: true, feedback: saved });
  } catch (e) {
    return _err(res, 400, e.message);
  }
}));

router.get('/', _safe(async (req, res) => {
  const tid = await _tid(req, 'ai-feedback:list');
  if (!tid) return _err(res, 400, 'no_tenant');
  const items = await listFeedback({
    tenantId: tid,
    limit: req.query.limit,
    surface: req.query.surface,
  });
  res.json({ ok: true, feedback: items });
}));

router.get('/stats', _safe(async (req, res) => {
  const tid = await _tid(req, 'ai-feedback:stats');
  if (!tid) return _err(res, 400, 'no_tenant');
  const stats = await feedbackStats({
    tenantId: tid,
    hours: Number(req.query.hours) || 24 * 7,
  });
  res.json({ ok: true, stats });
}));

router._resetMem = require('./store')._resetMem;
module.exports = router;
