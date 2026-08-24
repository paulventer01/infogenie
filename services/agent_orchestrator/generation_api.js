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
const { approveCreativeArtifact } = require('./creative_store');
const { approvalContentHash } = require('./creative_validate');
const {
  enqueueStaticImageJob, getStaticImageJob, cancelStaticImageJob, publicJob,
} = require('./generation_jobs');

function isImageBrief(row) {
  return !!row && String(row.kind) === 'creative_brief'
    && !!row.payload && typeof row.payload === 'object' && row.payload.format === 'image';
}

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
      const tid = await _tenantCtx.resolveTenantId(req, { label: 'orch-static-images' });
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

router.post('/', capPayload, wrap(
  [PERMS.edit, GATE_PERMISSION.creative_generation],
  async (req, tid, userId, pool) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const key = String(body.idempotency_key || extractIdempotencyKey(req) || '').trim();
    if (!key) fail('validation_failed');
    const run = await runIdempotent(pool, {
      tenantId: tid,
      key,
      endpoint: endpointOf(req),
      action: 'static_image_generate',
      requestHash: requestHashFrom(req),
      actorUserId: userId,
      workflowId: String(body.workflow_id || '').trim(),
      requestId: req.requestId,
      fn: async () => {
        const { job, replay } = await enqueueStaticImageJob(pool, {
          tenantId: tid,
          userId,
          workflowId: String(body.workflow_id || '').trim(),
          proposalId: String(body.proposal_id || '').trim(),
          proposalVersion: body.proposal_version,
          proposalContentHash: String(body.proposal_content_hash || '').trim(),
          approvalId: body.approval_id,
          approvalHash: String(body.approval_hash || '').trim(),
          estimatedMaxCostMicros: body.estimated_max_cost_micros,
          confirm: body.confirm,
          idempotencyKey: key,
          mode: body.mode === 'live' ? 'live' : 'fixture',
          bodyTenantId: body.tenant_id,
        });
        const { asset } = await getStaticImageJob(pool, tid, job.id);
        return {
          status: replay ? 200 : 201,
          body: { ok: true, replay: !!replay, job: publicJob(job, asset) },
        };
      },
    });
    if (run.replay) {
      const body = run.body && typeof run.body === 'object' ? { ...run.body, replay: true } : run.body;
      const status = run.status >= 200 && run.status < 300 ? 200 : run.status;
      return { status, body };
    }
    return { status: run.status, body: run.body };
  }
));

router.post('/approve-brief', capPayload, wrap(
  GATE_PERMISSION.creative_generation,
  async (req, tid, userId, pool) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (body.tenant_id != null && Number(body.tenant_id) !== Number(tid)) {
      fail('validation_failed', { field: 'tenant_id', reason: 'mismatch' });
    }
    const proposalId = String(body.proposal_id || '').trim();
    if (!proposalId) fail('validation_failed');
    const proposal = (await pool.query(
      `SELECT * FROM orchestrator_proposal_generations WHERE tenant_id=$1 AND id=$2`, [tid, proposalId]
    )).rows[0];
    if (!proposal) fail('not_found');
    const ids = Array.isArray(proposal.artifact_ids) ? proposal.artifact_ids : [];
    const arts = ids.length
      ? (await pool.query(
        `SELECT * FROM orchestrator_creative_artifacts WHERE tenant_id=$1 AND id = ANY($2::text[])`,
        [tid, ids]
      )).rows : [];
    const want = body.artifact_id != null && String(body.artifact_id).trim();
    const artifact = want
      ? arts.find((a) => String(a.artifact_id) === want)
      : arts.find((a) => isImageBrief(a) && a.status === 'draft');
    if (!artifact) fail('not_found');
    // This endpoint mints the creative_generation approval that authorises
    // static-image rendering. The bundle also holds a video brief and text
    // artifacts; approving one of those here would produce an approval the
    // generation gate accepts for an image it does not describe.
    if (!isImageBrief(artifact)) fail('approval_scope_mismatch');
    const contentHash = approvalContentHash(artifact.content_hash, artifact.evidence_hash);
    const approved = await approveCreativeArtifact(pool, {
      tenantId: tid, artifactId: artifact.artifact_id, objectVersion: artifact.version,
      contentHash, req: { user: { id: userId } },
    });
    return {
      status: 200,
      body: {
        ok: true,
        approval: {
          id: approved.approval_id, content_hash: contentHash,
          object_version: Number(approved.version), artifact_id: approved.artifact_id,
        },
      },
    };
  }
));

router.get('/:id', wrap(PERMS.view, async (req, tid, _userId, pool) => {
  const { job, asset } = await getStaticImageJob(pool, tid, String(req.params.id || ''));
  return { status: 200, body: { ok: true, job: publicJob(job, asset) } };
}));

router.post('/:id/cancel', wrap(PERMS.cancel, async (req, tid, _userId, pool) => {
  const job = await cancelStaticImageJob(pool, tid, String(req.params.id || ''));
  const { asset } = await getStaticImageJob(pool, tid, job.id);
  return { status: 200, body: { ok: true, job: publicJob(job, asset) } };
}));

module.exports = router;
