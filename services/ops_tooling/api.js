'use strict';

const express = require('express');
const router = express.Router();
const _tenantCtx = require('../tenants/context');
const { collectOpsToolingStatus } = require('./status');
const { collectSyntheticsStatus, runLocalProbes } = require('./checkly');
const { createConnectSession, connectionStatusForTenant, listConnections } = require('./nango');
const { collectGitGuardianStatus } = require('./gitguardian');
const { collectPromptfooStatus, assertPromptGateOrThrow } = require('./promptfoo_gate');
const { collectLlmFinops } = require('./llm_finops');
const { otelStatus, flushSpans } = require('./otel');

function _err(res, code, msg, extra) {
  res.status(code).json({ ok: false, error: msg, ...(extra || {}) });
}
function _safe(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch((e) => {
    console.warn('[ops-tooling]', e.message);
    if (!res.headersSent) _err(res, e.status || 500, e.message || 'internal error', e.details ? { details: e.details } : undefined);
  });
}

async function _tid(req, label) {
  return _tenantCtx.resolveTenantId(req, { label });
}

router.get('/status', _safe(async (req, res) => {
  const tid = await _tid(req, 'ops-tooling:status');
  const status = await collectOpsToolingStatus({
    tenantId: tid,
    tenantKey: tid != null ? `tenant-${tid}` : null,
  });
  res.json({ ok: true, status, generatedAt: new Date().toISOString() });
}));

router.get('/synthetics', _safe(async (_req, res) => {
  const synthetics = await collectSyntheticsStatus();
  res.json({ ok: true, synthetics });
}));

router.post('/synthetics/run', _safe(async (_req, res) => {
  const checks = await runLocalProbes();
  res.json({ ok: checks.every((c) => c.ok || !c.critical), checks });
}));

router.get('/otel', _safe(async (_req, res) => {
  await flushSpans();
  res.json({ ok: true, otel: otelStatus() });
}));

router.get('/nango/status', _safe(async (req, res) => {
  const tid = await _tid(req, 'ops-tooling:nango');
  const status = await connectionStatusForTenant(tid != null ? `tenant-${tid}` : null);
  res.json({ ok: true, nango: status });
}));

router.get('/nango/connections', _safe(async (_req, res) => {
  const listed = await listConnections();
  res.json({ ok: listed.ok, ...listed });
}));

router.post('/nango/connect-session', _safe(async (req, res) => {
  const tid = await _tid(req, 'ops-tooling:nango-session');
  const session = await createConnectSession({
    endUserId: req.body?.endUserId || (tid != null ? `tenant-${tid}` : req.session?.userId),
    endUserEmail: req.body?.email || req.session?.email,
    allowedIntegrations: req.body?.integrations,
  });
  if (!session.ok) return _err(res, session.error === 'nango_not_configured' ? 503 : 502, session.error);
  res.json({ ok: true, ...session });
}));

router.get('/gitguardian', _safe(async (_req, res) => {
  const status = await collectGitGuardianStatus();
  res.json({ ok: true, gitguardian: status });
}));

router.get('/promptfoo', _safe(async (_req, res) => {
  res.json({ ok: true, promptfoo: collectPromptfooStatus() });
}));

router.post('/promptfoo/assert-gate', _safe(async (_req, res) => {
  const status = assertPromptGateOrThrow();
  res.json({ ok: true, promptfoo: status });
}));

router.get('/finops', _safe(async (req, res) => {
  const tid = await _tid(req, 'ops-tooling:finops');
  const finops = await collectLlmFinops({ tenantId: tid });
  res.json({ ok: true, finops });
}));

module.exports = router;
