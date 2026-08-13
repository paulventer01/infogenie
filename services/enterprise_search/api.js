'use strict';

const express = require('express');
const router = express.Router();
const _tenantCtx = require('../tenants/context');
const { CONNECTORS, syncConnector, clearConnector, listStatus } = require('./sync');
const { ensureEnterpriseSearchSchema } = require('./schema');

function _err(res, code, msg, extra = {}) {
  res.status(code).json({ ok: false, error: msg, ...extra });
}
function _safe(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch((e) => {
    console.warn('[enterprise-search]', e.message);
    if (!res.headersSent) {
      _err(res, e.status || 500, e.message || 'Internal server error', e.hint ? { hint: e.hint } : {});
    }
  });
}

ensureEnterpriseSearchSchema().catch((e) => console.warn('[enterprise-search] schema:', e.message));

router.get('/connectors', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'enterprise_search:list' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const connectors = await listStatus(tid);
  res.json({
    ok: true,
    connectors,
    catalog: Object.entries(CONNECTORS).map(([id, c]) => ({
      id,
      label: c.label,
      dataType: c.dataType,
    })),
  });
}));

router.post('/sync/:connector', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'enterprise_search:sync' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const connector = String(req.params.connector || '').trim();
  if (!CONNECTORS[connector]) return _err(res, 400, 'unknown_connector');
  const result = await syncConnector(tid, connector, {
    maxPages: Math.min(40, parseInt(req.body?.limit, 10) || 20),
    maxFiles: Math.min(40, parseInt(req.body?.limit, 10) || 20),
    maxMessages: Math.min(80, parseInt(req.body?.limit, 10) || 40),
    query: String(req.body?.query || '').slice(0, 120),
  });
  res.json(result);
}));

router.post('/sync-all', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'enterprise_search:sync_all' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const results = [];
  for (const id of Object.keys(CONNECTORS)) {
    try {
      results.push(await syncConnector(tid, id, { maxPages: 15, maxFiles: 15, maxMessages: 30 }));
    } catch (e) {
      results.push({ ok: false, connector: id, error: e.message, hint: e.hint || null });
    }
  }
  res.json({ ok: results.some((r) => r.ok), results });
}));

router.delete('/connectors/:connector', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'enterprise_search:clear' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const connector = String(req.params.connector || '').trim();
  if (!CONNECTORS[connector]) return _err(res, 400, 'unknown_connector');
  const result = await clearConnector(tid, connector);
  res.json({ ok: true, connector, ...result });
}));

module.exports = router;
