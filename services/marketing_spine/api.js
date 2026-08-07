const express = require('express');
const router = express.Router();
const _tenantCtx = require('../tenants/context');
const { buildSpineContext } = require('./context');
const {
  listActions,
  suggestFromSources,
  resolvePlan,
  applyAction,
  dismissAction,
} = require('./actions');

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _route(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) {
      console.error('[marketing-spine]', e.message || e);
      if (!res.headersSent) res.json({ ok: false, error: e.message || 'marketing_spine_error' });
    }
  };
}

router.get('/status', _route(async (req, res) => {
  res.json({ ok: true, service: 'marketing-spine', version: 1 });
}));

router.get('/context', _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'spine:context' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const ctx = await buildSpineContext(tid);
  res.json({ ok: true, ...ctx });
}));

router.get('/actions', _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'spine:actions' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const status = req.query.status ? String(req.query.status) : undefined;
  const limit = parseInt(req.query.limit, 10) || 50;
  const rows = await listActions(tid, { status, limit });
  res.json({ ok: true, actions: rows, count: rows.length });
}));

router.post('/suggest', express.json(), _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'spine:suggest' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const sources = Array.isArray(req.body?.sources) ? req.body.sources.map(String) : undefined;
  const result = await suggestFromSources(tid, { sources });
  res.json({ ok: true, ...result, insertedCount: result.inserted.length });
}));

router.post('/resolve', express.json(), _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'spine:resolve' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const plan = await resolvePlan(tid);
  res.json({ ok: true, ...plan });
}));

router.post('/apply/:id', express.json(), _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'spine:apply' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const id = String(req.params.id || '').trim();
  if (!id) return _err(res, 400, 'id required');
  const out = await applyAction(tid, id);
  res.json({ ok: true, ...out });
}));

router.post('/dismiss/:id', express.json(), _route(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'spine:dismiss' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const id = String(req.params.id || '').trim();
  if (!id) return _err(res, 400, 'id required');
  const out = await dismissAction(tid, id);
  res.json(out);
}));

module.exports = router;
