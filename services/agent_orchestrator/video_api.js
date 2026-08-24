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
const { isVideoBrief } = require('./video_validate');
const { microsToJson } = require('./money');
const { enqueueVideoJob, getVideoJob, cancelVideoJob } = require('./video_jobs');

function publicJob(row, output) {
  if (!row) return null;
  const out = {
    id: row.id, tenant_id: row.tenant_id, workflow_id: row.workflow_id, proposal_id: row.proposal_id,
    proposal_version: Number(row.proposal_version), status: row.status, honesty_class: row.honesty_class,
    estimated_cost_micros: microsToJson(row.estimated_cost_micros),
    actual_cost_micros: row.actual_cost_micros == null ? null : microsToJson(row.actual_cost_micros),
    error_code: row.error_code, created_at: row.created_at, started_at: row.started_at,
    completed_at: row.completed_at, updated_at: row.updated_at,
    contract_hash: row.contract_hash, approval_hash: row.approval_hash,
  };
  if (output && output.usable) {
    out.output = {
      storage_ref: output.storage_ref, mime_type: output.mime_type, width_px: output.width_px,
      height_px: output.height_px, duration_ms: output.duration_ms, fps: output.fps,
      honesty_class: output.honesty_class, provenance: output.provenance,
    };
  }
  return out;
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
      const tid = await _tenantCtx.resolveTenantId(req, { label: 'orch-video-jobs' });
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
    if (body.mode === 'live') fail('capability_not_supported');
    const key = String(body.idempotency_key || extractIdempotencyKey(req) || '').trim();
    if (!key) fail('validation_failed');
    const run = await runIdempotent(pool, {
      tenantId: tid, key, endpoint: endpointOf(req), action: 'video_generate',
      requestHash: requestHashFrom(req), actorUserId: userId,
      workflowId: String(body.workflow_id || '').trim(), requestId: req.requestId,
      fn: async () => {
        const { job, replay } = await enqueueVideoJob(pool, {
          tenantId: tid, userId,
          workflowId: String(body.workflow_id || '').trim(),
          proposalId: String(body.proposal_id || '').trim(),
          proposalVersion: body.proposal_version,
          proposalContentHash: String(body.proposal_content_hash || '').trim(),
          approvalId: body.approval_id,
          approvalHash: String(body.approval_hash || '').trim(),
          estimatedMaxCostMicros: body.estimated_max_cost_micros,
          confirm: body.confirm, idempotencyKey: key, mode: body.mode,
          bodyTenantId: body.tenant_id,
        });
        const { output } = await getVideoJob(pool, tid, job.id);
        return { status: replay ? 200 : 201, body: { ok: true, replay: !!replay, job: publicJob(job, output) } };
      },
    });
    if (run.replay) {
      const bodyOut = run.body && typeof run.body === 'object' ? { ...run.body, replay: true } : run.body;
      const status = run.status >= 200 && run.status < 300 ? 200 : run.status;
      return { status, body: bodyOut };
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
      : arts.find((a) => isVideoBrief(a) && a.status === 'draft');
    if (!artifact) fail('not_found');
    if (!isVideoBrief(artifact)) fail('approval_scope_mismatch');
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
  const { job, output } = await getVideoJob(pool, tid, String(req.params.id || ''));
  return { status: 200, body: { ok: true, job: publicJob(job, output) } };
}));

router.post('/:id/cancel', capPayload, wrap(PERMS.cancel, async (req, tid, userId, pool) => {
  const job = await cancelVideoJob(pool, tid, String(req.params.id || ''), { actorUserId: userId });
  const { output } = await getVideoJob(pool, tid, job.id);
  return { status: 200, body: { ok: true, job: publicJob(job, output) } };
}));

module.exports = router;
