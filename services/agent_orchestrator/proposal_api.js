'use strict';

const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { requirePermission, hasPermission } = require('../tenants/permission_enforce');
const { fail, sendError, sendOrchError } = require('./errors');
const { PERMS, GATE_PERMISSION } = require('./states');
const { actorId } = require('./runner');
const { extractIdempotencyKey, requestHashFrom, endpointOf, runIdempotent } = require('./idempotency');
const { capPayload } = require('./payload_cap');
const { createProposalRuntime } = require('./proposal_generate');
const {
  startProposalGeneration, getProposalGeneration, cancelProposalGeneration, publicGeneration,
} = require('./proposal_store');

function guardPerm(req, res, key) {
  let allowed = false;
  requirePermission(key)(req, res, () => { allowed = true; });
  return allowed;
}

function guardAnyPerm(req, res, keys) {
  const list = Array.isArray(keys) ? keys : [keys];
  if (list.some((k) => hasPermission(req, k))) return true;
  return guardPerm(req, res, list[0]);
}

function wrap(permission, handler) {
  return async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ ok: false, error: 'auth_required' });
      const tid = await _tenantCtx.resolveTenantId(req, { label: 'orch-proposals' });
      if (!tid) return sendError(res, 400, 'validation_failed');
      const okPerm = Array.isArray(permission)
        ? guardAnyPerm(req, res, permission)
        : guardPerm(req, res, permission);
      if (!okPerm) return;
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

function runtimeFrom(req, body) {
  if (req.proposalRuntime) return req.proposalRuntime;
  return createProposalRuntime({
    mode: body && body.mode === 'live' ? 'live' : 'fixture',
  });
}

router.post('/', capPayload, wrap(
  [PERMS.edit, GATE_PERMISSION.creative_generation],
  async (req, tid, userId, pool) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const workflowId = String(body.workflow_id || '').trim();
    const researchRunId = String(body.research_run_id || '').trim();
    if (!workflowId || !researchRunId) fail('validation_failed');
    const key = String(body.idempotency_key || extractIdempotencyKey(req) || '').trim();
    if (!key) fail('validation_failed');
    const run = await runIdempotent(pool, {
      tenantId: tid,
      key,
      endpoint: endpointOf(req),
      action: 'proposal_generate',
      requestHash: requestHashFrom(req),
      actorUserId: userId,
      workflowId,
      requestId: req.requestId,
      fn: async () => {
        const { generation, artifacts, replay } = await startProposalGeneration(pool, {
          tenantId: tid,
          userId,
          workflowId,
          researchRunId,
          idempotencyKey: key,
          runtime: runtimeFrom(req, body),
          bodyTenantId: body.tenant_id,
        });
        return {
          status: replay ? 200 : 201,
          body: {
            ok: true,
            replay: !!replay,
            generation: publicGeneration(generation, artifacts),
          },
        };
      },
    });
    return { status: run.status, body: run.body };
  }
));

router.get('/:id', wrap(PERMS.view, async (req, tid, _userId, pool) => {
  const { generation, artifacts } = await getProposalGeneration(
    pool, tid, String(req.params.id || '')
  );
  return {
    status: 200,
    body: { ok: true, generation: publicGeneration(generation, artifacts) },
  };
}));

router.post('/:id/cancel', wrap(PERMS.cancel, async (req, tid, _userId, pool) => {
  const generation = await cancelProposalGeneration(pool, tid, String(req.params.id || ''));
  return { status: 200, body: { ok: true, generation: publicGeneration(generation) } };
}));

module.exports = router;
