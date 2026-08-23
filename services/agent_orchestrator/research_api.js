'use strict';

const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { requirePermission } = require('../tenants/permission_enforce');
const { fail, sendError, sendOrchError } = require('./errors');
const { PERMS, GATE_PERMISSION } = require('./states');
const { actorId } = require('./runner');
const { extractIdempotencyKey } = require('./idempotency');
const { capPayload } = require('./payload_cap');
const { createResearchRuntime, CAPABILITY_MATRIX } = require('./research_runtime');
const {
  startResearchRun, getResearchRun, cancelResearchRun, publicRun,
} = require('./research_ingest');

function guardPerm(req, res, key) {
  let allowed = false;
  requirePermission(key)(req, res, () => { allowed = true; });
  return allowed;
}

function wrap(permission, handler) {
  return async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ ok: false, error: 'auth_required' });
      const tid = await _tenantCtx.resolveTenantId(req, { label: 'orch-research' });
      if (!tid) return sendError(res, 400, 'validation_failed');
      if (!guardPerm(req, res, permission)) return;
      if (!_db.hasDb()) return sendError(res, 503, 'validation_failed');
      const userId = actorId(req);
      if (!userId) return sendError(res, 400, 'validation_failed');
      const result = await handler(req, tid, userId, _db.getPool());
      return res.status(result.status || 200).json(result.body);
    } catch (err) {
      return sendOrchError(res, err);
    }
  };
}

router.get('/capabilities', wrap(PERMS.view, async () => ({
  status: 200,
  body: { ok: true, contract_version: 'v1', matrix: CAPABILITY_MATRIX },
})));

router.post('/runs', capPayload, wrap(GATE_PERMISSION.research_execution, async (req, tid, userId, pool) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const workflowId = String(body.workflow_id || '').trim();
  if (!workflowId) fail('validation_failed');
  const key = String(body.idempotency_key || extractIdempotencyKey(req) || '').trim();
  if (!key) fail('validation_failed');
  const runtime = createResearchRuntime({
    mode: body.mode === 'live' ? 'live' : 'fixture',
    transport: req.researchTransport || null,
    resolveSecret: req.researchResolveSecret || null,
  });
  const { run, replay } = await startResearchRun(pool, {
    tenantId: tid,
    userId,
    workflowId,
    requestedPlatforms: body.requested_platforms,
    researchBrief: body.research_brief,
    searchParameters: body.search_parameters,
    idempotencyKey: key,
    credentialRefs: body.credential_refs,
    operations: body.operations,
    runtime,
    execute: body.execute !== false,
  });
  return {
    status: replay ? 200 : 201,
    body: {
      ok: true,
      replay: !!replay,
      run: publicRun(run),
      error: run && run.error_code ? run.error_code : undefined,
    },
  };
}));

router.get('/runs/:id', wrap(PERMS.view, async (req, tid, _userId, pool) => {
  const run = await getResearchRun(pool, tid, String(req.params.id || ''));
  return { status: 200, body: { ok: true, run: publicRun(run) } };
}));

router.post('/runs/:id/cancel', wrap(PERMS.cancel, async (req, tid, _userId, pool) => {
  const run = await cancelResearchRun(pool, tid, String(req.params.id || ''));
  return { status: 200, body: { ok: true, run: publicRun(run) } };
}));

module.exports = router;
