'use strict';

const crypto = require('crypto');
const { fail, OrchError } = require('./errors');
const { insertAudit } = require('./runner');
const { approvalContentHash } = require('./creative_validate');
const credits = require('./credits');
const outbox = require('./outbox');
const { preflight, releaseInflight, acquireGenerationInflight, generationInflightId } = require('./limits');
const { DEFAULT_REQUEST_MICROS, PLACEHOLDER_PROVIDER, PLACEHOLDER_MODEL } = require('./pricing');
const { toBigInt } = require('./money');
const { logger } = require('../infra/logger');
const { createVideoRuntime, completeVideoJob } = require('./video_adapter');
const { isVideoBrief, deriveContract, contractHash, generationRequestHash, assertStorageRef } = require('./video_validate');
const _db = require('../../db');
const _runtimeFlags = require('../runtime_flags');

const ESTIMATE = DEFAULT_REQUEST_MICROS;
const MAX_APPROVAL_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const RETRYABLE = new Set(['provider_timeout', 'provider_transient']);
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'permanently_failed']);
const nid = (p) => `${p}_${crypto.randomBytes(8).toString('hex')}`;
const reserveKey = (k) => `videogen:${k}:reserve`;
const outboxKey = (k) => `videogen:${k}`;
const jobKeyFromOutbox = (ob) => String((ob && ob.idempotency_key) || '').replace(/^videogen:/, '');
const sanitizeCode = (c) => /^[a-z0-9_]{1,40}$/.test(String(c || '')) ? String(c) : 'provider_malformed';
const one = (c, sql, p) => c.query(sql, p).then((r) => r.rows[0] || null);
const QJ = 'SELECT * FROM orchestrator_video_generation_jobs WHERE tenant_id=$1';
const loadJob = (c, tid, id) => one(c, `${QJ} AND id=$2`, [tid, id]);
const loadByKey = (c, tid, k) => one(c, `${QJ} AND idempotency_key=$2`, [tid, k]);
const lockJob = (c, tid, id) => one(c, `${QJ} AND id=$2 FOR UPDATE`, [tid, id]);
const loadOutput = (c, tid, jid) => one(c, `SELECT * FROM orchestrator_video_generation_outputs WHERE tenant_id=$1 AND job_id=$2`, [tid, jid]);

async function withTx(pool, fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const result = await fn(c);
    await c.query('COMMIT');
    return result;
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally { c.release(); }
}

async function note(client, o) {
  await insertAudit(client, {
    tenantId: o.tenantId, workflowId: o.workflowId, event: o.event, actorUserId: o.actorUserId,
    detail: { action: o.event, step_id: o.jobId, reservation_id: o.reservationId, amount_micros: Number(ESTIMATE), state: o.state, gate: 'creative_generation', error_code: o.errorCode },
    state: o.state, gate: 'creative_generation', errorCode: o.errorCode,
  });
  logger.info(o.event, { tenant_id: o.tenantId, workflow_id: o.workflowId, job_id: o.jobId, error_code: o.errorCode || null });
}

async function bindApproval(client, o) {
  const wf = await one(client, `SELECT * FROM orchestrator_workflows WHERE tenant_id=$1 AND id=$2`, [o.tenantId, o.workflowId]);
  if (!wf) fail('not_found');
  if (wf.current_state === 'cancelled') fail('workflow_cancelled');
  if (wf.current_state === 'paused') fail('workflow_paused');
  const proposal = await one(client, `SELECT * FROM orchestrator_proposal_generations WHERE tenant_id=$1 AND id=$2`, [o.tenantId, o.proposalId]);
  if (!proposal || String(proposal.workflow_id) !== String(o.workflowId)) fail('not_found');
  if (Number(proposal.version) !== Number(o.proposalVersion) || String(proposal.content_hash) !== String(o.proposalContentHash)) fail('approval_stale');
  const approval = await one(client, `SELECT * FROM orchestrator_approvals WHERE tenant_id=$1 AND id=$2`, [o.tenantId, o.approvalId]);
  if (!approval) fail('approval_required');
  if (String(approval.workflow_id) !== String(o.workflowId)) fail('not_found');
  if (approval.gate !== 'creative_generation' || approval.object_type !== 'creative_artifact') fail('approval_scope_mismatch');
  if (String(approval.content_hash) !== String(o.approvalHash)) fail('approval_stale');
  if (approval.decision !== 'approved') fail('approval_required');
  const artifact = await one(client,
    `SELECT * FROM orchestrator_creative_artifacts WHERE tenant_id=$1 AND artifact_id=$2 AND version=$3`,
    [o.tenantId, approval.object_id, approval.object_version]);
  if (!artifact || !isVideoBrief(artifact)) fail('approval_scope_mismatch');
  if (String(artifact.workflow_id) !== String(o.workflowId)) fail('not_found');
  if (artifact.status === 'invalidated' || artifact.status === 'superseded') fail('approval_expired');
  if (artifact.status !== 'approved') fail('approval_required');
  if (Number(artifact.approval_id) !== Number(approval.id)) fail('approval_stale');
  if (approvalContentHash(artifact.content_hash, artifact.evidence_hash) !== String(approval.content_hash)) fail('approval_stale');
  const ids = Array.isArray(proposal.artifact_ids) ? proposal.artifact_ids.map(String) : [];
  if (!ids.includes(String(artifact.id))) fail('approval_scope_mismatch');
  const latest = (await client.query(
    `SELECT * FROM orchestrator_approvals WHERE tenant_id=$1 AND workflow_id=$2 AND gate='creative_generation' AND object_id=$3 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [o.tenantId, o.workflowId, approval.object_id]
  )).rows[0];
  if (latest && latest.decision === 'rejected') fail('approval_revoked');
  if (latest && latest.decision === 'approved' && (Number(latest.object_version) !== Number(approval.object_version) || String(latest.content_hash) !== String(o.approvalHash))) fail('approval_stale');
  const nowMs = o.now != null ? Number(o.now) : Date.now();
  const maxAge = o.maxApprovalAgeMs != null ? Number(o.maxApprovalAgeMs) : MAX_APPROVAL_AGE_MS;
  if (nowMs - new Date(approval.created_at).getTime() > maxAge) fail('approval_expired');
  return { wf, proposal, approval, artifact };
}

async function settleReleaseSafe(client, { tenantId, job }) {
  if (!job || !job.reservation_id) return;
  try {
    await credits.release({
      client, tenantId, reservationId: job.reservation_id, reasonCode: 'video_generate_release',
      idempotencyKey: `${reserveKey(job.idempotency_key)}:release`,
    });
  } catch (err) { if (!(err instanceof OrchError && err.code === 'not_found')) throw err; }
}
async function settle(client, { tenantId, job, commit }) {
  if (!job || !job.reservation_id) return;
  if (commit) {
    await credits.commit({
      client, tenantId, reservationId: job.reservation_id, actualMicros: toBigInt(job.reserved_cost_micros || ESTIMATE),
      idempotencyKey: `${reserveKey(job.idempotency_key)}:commit`,
    });
    return;
  }
  await settleReleaseSafe(client, { tenantId, job });
}
async function completeOutboxForCancel(client, { tenantId, outboxId }) {
  if (!outboxId) return;
  const row = await one(client, `SELECT state FROM orchestrator_outbox WHERE tenant_id=$1 AND id=$2`, [tenantId, outboxId]);
  if (!row || row.state === 'completed' || row.state === 'dead_letter') return;
  try { await outbox.complete(client, { tenantId, id: outboxId }); } catch (_) {
    try { await outbox.fail(client, { tenantId, id: outboxId, errorCode: 'cancelled' }); } catch (__) { /* ignore */ }
  }
}
async function releaseJobInflight(client, { tenantId, jobId }) {
  if (!jobId) return;
  try { await releaseInflight(client, { tenantId, inflightId: generationInflightId(jobId) }); } catch (_) { /* ignore */ }
}
async function parkOutboxPending(client, { tenantId, id }) {
  if (!id) return;
  await client.query(
    `UPDATE orchestrator_outbox SET state='pending', claimed_by=NULL, claimed_until=NULL, next_attempt_at=now(), updated_at=now()
      WHERE tenant_id=$1 AND id=$2 AND state='processing'`, [tenantId, id]);
}
async function loadWorkflowStop(client, tenantId, workflowId) {
  const wf = await one(client, `SELECT current_state FROM orchestrator_workflows WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, workflowId]);
  if (!wf || wf.current_state === 'cancelled') return { jobStatus: 'cancelled', errorCode: 'cancelled' };
  if (wf.current_state === 'paused') return { jobStatus: 'failed', errorCode: 'workflow_paused' };
  return null;
}
const CLEAR = `lease_holder=NULL, lease_expires_at=NULL, updated_at=now(), state_version=state_version+1`;
async function abortLockedJob(client, { tenantId, job, outboxId, jobStatus, errorCode, settleOutbox = true }) {
  const failed = jobStatus === 'failed' || jobStatus === 'permanently_failed';
  const status = failed ? (jobStatus === 'permanently_failed' ? 'permanently_failed' : 'failed') : 'cancelled';
  const code = sanitizeCode(errorCode || (failed ? 'provider_malformed' : 'cancelled'));
  if (!job) { if (settleOutbox) await completeOutboxForCancel(client, { tenantId, outboxId }); return null; }
  if (TERMINAL.has(job.status)) {
    await settleReleaseSafe(client, { tenantId, job });
    if (settleOutbox) await completeOutboxForCancel(client, { tenantId, outboxId });
    await releaseJobInflight(client, { tenantId, jobId: job.id });
    return job;
  }
  const row = (await client.query(
    `UPDATE orchestrator_video_generation_jobs SET status=$3, error_code=$4, completed_at=now(), ${CLEAR}
      WHERE tenant_id=$1 AND id=$2 AND status IN ('queued','reserved','running','retryable') RETURNING *`,
    [tenantId, job.id, status, code]
  )).rows[0] || job;
  await settleReleaseSafe(client, { tenantId, job: row });
  if (settleOutbox) await completeOutboxForCancel(client, { tenantId, outboxId });
  await releaseJobInflight(client, { tenantId, jobId: row.id });
  await note(client, { tenantId, workflowId: row.workflow_id, event: row.status === 'cancelled' ? 'video_job_cancelled' : 'video_job_failed', jobId: row.id, state: row.status, errorCode: code });
  return row;
}
function leaseHeldByOther(job, workerId) {
  return !!(job && job.status === 'running' && job.lease_holder && job.lease_holder !== workerId
    && job.lease_expires_at && new Date(job.lease_expires_at).getTime() > Date.now());
}

async function enqueueVideoJob(pool, opts) {
  const {
    tenantId, userId, workflowId, proposalId, proposalVersion, proposalContentHash,
    approvalId, approvalHash, estimatedMaxCostMicros, confirm, idempotencyKey, mode, bodyTenantId, now, maxApprovalAgeMs,
  } = opts;
  if (bodyTenantId != null && Number(bodyTenantId) !== Number(tenantId)) fail('validation_failed', { field: 'tenant_id', reason: 'mismatch' });
  if (confirm !== true) fail('validation_failed', { field: 'confirm', reason: 'required' });
  if (!workflowId || !proposalId || !approvalId || !approvalHash || !proposalContentHash || !idempotencyKey) fail('validation_failed');
  if (toBigInt(estimatedMaxCostMicros) !== ESTIMATE) fail('validation_failed', { field: 'estimated_max_cost_micros' });
  if (mode === 'live') fail('capability_not_supported');
  const existing = await loadByKey(pool, tenantId, idempotencyKey);
  if (existing) return { job: existing, replay: true };
  return withTx(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`videogen:${tenantId}:${proposalId}`]);
    const replay = await loadByKey(client, tenantId, idempotencyKey);
    if (replay) return { job: replay, replay: true };
    const bound = await bindApproval(client, {
      tenantId, workflowId, proposalId, proposalVersion, proposalContentHash, approvalId, approvalHash, now, maxApprovalAgeMs,
    });
    const contract = deriveContract(bound.artifact);
    const cHash = contractHash(contract);
    const reqHash = generationRequestHash({
      proposal_id: proposalId, proposal_version: proposalVersion, proposal_content_hash: proposalContentHash,
      approval_id: approvalId, approval_hash: approvalHash, workflow_id: workflowId,
      contract_hash: cHash, estimated_max_cost_micros: Number(ESTIMATE),
    });
    const consumed = await client.query(
      `SELECT id FROM orchestrator_video_generation_jobs WHERE tenant_id=$1 AND approval_id=$2 AND generation_request_hash <> $3 AND status IN ('queued','reserved','running','retryable','succeeded') LIMIT 1`,
      [tenantId, approvalId, reqHash]);
    if (consumed.rowCount) fail('approval_stale');
    const active = await one(client,
      `SELECT * FROM orchestrator_video_generation_jobs WHERE tenant_id=$1 AND proposal_id=$2 AND generation_request_hash=$3 AND status IN ('queued','reserved','running','retryable')`,
      [tenantId, proposalId, reqHash]);
    if (active) return { job: active, replay: true };
    const pf = await preflight(client, {
      tenantId, workflowId, provider: PLACEHOLDER_PROVIDER, model: PLACEHOLDER_MODEL, estimatedMicros: ESTIMATE, recordStart: true,
    });
    const inflightId = pf && pf.inflight && pf.inflight.id;
    const id = nid('vgj');
    try {
      let row;
      try {
        row = (await client.query(
          `INSERT INTO orchestrator_video_generation_jobs (id, tenant_id, workflow_id, proposal_id, proposal_version, proposal_content_hash, approval_id, approval_hash, contract_hash, contract_json, generation_request_hash, provider, model, model_version, idempotency_key, status, reservation_id, estimated_cost_micros, reserved_cost_micros, credential_ref, honesty_class) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,'v1',$14,'queued',NULL,$15,$15,NULL,'fixture') RETURNING *`,
          [id, tenantId, workflowId, proposalId, Number(proposalVersion), proposalContentHash, approvalId, approvalHash, cHash, JSON.stringify(contract), reqHash, PLACEHOLDER_PROVIDER, PLACEHOLDER_MODEL, idempotencyKey, toBigInt(ESTIMATE).toString()]
        )).rows[0];
      } catch (err) {
        if (err && err.code === '23505') {
          const byKey = await loadByKey(client, tenantId, idempotencyKey);
          if (byKey) return { job: byKey, replay: true };
          fail('execution_in_progress');
        }
        throw err;
      }
      const reserved = await credits.reserve({
        client, tenantId, workflowId, stepId: id, amountMicros: ESTIMATE, estimatedMicros: ESTIMATE, runPreflight: false,
        idempotencyKey: reserveKey(idempotencyKey), provider: PLACEHOLDER_PROVIDER, operation: 'video_generate',
        model: PLACEHOLDER_MODEL, actorUserId: userId,
      });
      row = (await client.query(
        `UPDATE orchestrator_video_generation_jobs SET status='reserved', reservation_id=$3, updated_at=now(), state_version=state_version+1 WHERE tenant_id=$1 AND id=$2 AND status='queued' AND reservation_id IS NULL RETURNING *`,
        [tenantId, id, reserved.reservation.id]
      )).rows[0];
      if (!row) fail('invalid_transition');
      await outbox.enqueue(client, {
        tenantId, workflowId, destination: 'internal', operation: 'video_generate', credentialRef: null, idempotencyKey: outboxKey(idempotencyKey),
      });
      await note(client, { tenantId, workflowId, event: 'video_job_enqueued', jobId: id, reservationId: reserved.reservation.id, state: 'reserved', actorUserId: userId });
      if (inflightId) await releaseInflight(client, { tenantId, inflightId });
      return { job: row, replay: false };
    } catch (err) {
      try { if (inflightId) await releaseInflight(client, { tenantId, inflightId }); } catch (_) { /* keep */ }
      throw err;
    }
  });
}

async function getVideoJob(pool, tenantId, id) {
  const job = await loadJob(pool, tenantId, id);
  if (!job) fail('not_found');
  return { job, output: await loadOutput(pool, tenantId, job.id) };
}

async function cancelVideoJob(pool, tenantId, id, { actorUserId } = {}) {
  const job = await loadJob(pool, tenantId, id);
  if (!job) fail('not_found');
  if (TERMINAL.has(job.status)) return job;
  return withTx(pool, async (client) => {
    const ob = await one(client,
      `SELECT * FROM orchestrator_outbox WHERE tenant_id=$1 AND operation='video_generate' AND idempotency_key=$2`,
      [tenantId, outboxKey(job.idempotency_key)]);
    const early = (await client.query(
      `UPDATE orchestrator_video_generation_jobs SET status='cancelled', error_code='cancelled', completed_at=now(), ${CLEAR}
        WHERE tenant_id=$1 AND id=$2 AND status IN ('queued','reserved','retryable') RETURNING *`, [tenantId, id]
    )).rows[0];
    if (early) {
      await settle(client, { tenantId, job: early, commit: false });
      await completeOutboxForCancel(client, { tenantId, outboxId: ob && ob.id });
      await releaseJobInflight(client, { tenantId, jobId: early.id });
      await note(client, { tenantId, workflowId: early.workflow_id, event: 'video_job_cancelled', jobId: early.id, state: 'cancelled', actorUserId });
      return early;
    }
    const running = (await client.query(
      `UPDATE orchestrator_video_generation_jobs SET status='cancelled', error_code='cancelled', completed_at=now(), ${CLEAR}
        WHERE tenant_id=$1 AND id=$2 AND status='running' RETURNING *`, [tenantId, id]
    )).rows[0];
    if (running) {
      await releaseJobInflight(client, { tenantId, jobId: running.id });
      await note(client, { tenantId, workflowId: running.workflow_id, event: 'video_job_cancelled', jobId: running.id, state: 'cancelled', actorUserId });
      return running;
    }
    return loadJob(client, tenantId, id);
  });
}

async function finishSuccess(pool, { tenantId, job, outboxId, generated, workerId }) {
  return withTx(pool, async (client) => {
    const locked = await lockJob(client, tenantId, job.id);
    if (!locked) { await completeOutboxForCancel(client, { tenantId, outboxId }); return null; }
    const stop = await loadWorkflowStop(client, tenantId, locked.workflow_id);
    if (stop) return abortLockedJob(client, { tenantId, job: locked, outboxId, ...stop });
    if (leaseHeldByOther(locked, workerId)) return locked;
    if (locked.status !== 'running') {
      if (locked.status === 'succeeded') {
        try { await outbox.complete(client, { tenantId, id: outboxId }); } catch (_) { /* ignore */ }
        await releaseJobInflight(client, { tenantId, jobId: locked.id });
        return locked;
      }
      await settleReleaseSafe(client, { tenantId, job: locked });
      await completeOutboxForCancel(client, { tenantId, outboxId });
      await releaseJobInflight(client, { tenantId, jobId: locked.id });
      return locked;
    }
    const reservation = locked.reservation_id
      ? await one(client, `SELECT id, status FROM orchestrator_credit_reservations WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [tenantId, locked.reservation_id]) : null;
    if (!reservation || reservation.status !== 'reserved') {
      return abortLockedJob(client, {
        tenantId, job: locked, outboxId,
        jobStatus: locked.status === 'cancelled' ? 'cancelled' : 'failed',
        errorCode: locked.status === 'cancelled' ? 'cancelled' : 'insufficient_credits',
      });
    }
    const bound = await bindApproval(client, {
      tenantId, workflowId: locked.workflow_id, proposalId: locked.proposal_id, proposalVersion: locked.proposal_version,
      proposalContentHash: locked.proposal_content_hash, approvalId: locked.approval_id, approvalHash: locked.approval_hash,
    });
    if (contractHash(deriveContract(bound.artifact)) !== String(locked.contract_hash)) fail('approval_stale');
    let output = await loadOutput(client, tenantId, locked.id);
    if (!output) {
      if (!generated || typeof generated !== 'object' || Buffer.isBuffer(generated)
          || generated.bytes != null || Buffer.isBuffer(generated.bytes)) fail('provider_malformed');
      const ref = assertStorageRef(generated.storage_ref, tenantId, locked.id);
      const honesty = ['fixture', 'synthetic', 'demo', 'test', 'mock'].includes(generated.honesty_class) ? generated.honesty_class : 'fixture';
      const modSrc = ['fixture', 'synthetic', 'internal'].includes(generated.moderation && generated.moderation.source) ? generated.moderation.source : 'fixture';
      output = (await client.query(
        `INSERT INTO orchestrator_video_generation_outputs (id, tenant_id, workflow_id, job_id, proposal_id, proposal_version, proposal_content_hash, approval_hash, contract_hash, request_hash, mime_type, width_px, height_px, duration_ms, fps, storage_ref, honesty_class, provenance, moderation_status, moderation_source, usable) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'fixture','passed',$18,true) RETURNING *`,
        [nid('vgo'), tenantId, locked.workflow_id, locked.id, locked.proposal_id, locked.proposal_version, locked.proposal_content_hash, locked.approval_hash, locked.contract_hash, locked.generation_request_hash, generated.mime || 'video/mp4', generated.width || generated.width_px, generated.height || generated.height_px, generated.duration_ms, generated.fps, ref, honesty, modSrc]
      )).rows[0];
    }
    const row = (await client.query(
      `UPDATE orchestrator_video_generation_jobs SET status='succeeded', output_id=$3, actual_cost_micros=$4, honesty_class=$5,
              completed_at=now(), ${CLEAR} WHERE tenant_id=$1 AND id=$2 AND status='running' RETURNING *`,
      [tenantId, locked.id, output.id, toBigInt(locked.reserved_cost_micros || ESTIMATE).toString(), output.honesty_class]
    )).rows[0];
    if (!row) fail('invalid_transition');
    await settle(client, { tenantId, job: locked, commit: true });
    await outbox.complete(client, { tenantId, id: outboxId });
    await releaseJobInflight(client, { tenantId, jobId: locked.id });
    await note(client, { tenantId, workflowId: locked.workflow_id, event: 'video_job_succeeded', jobId: locked.id, reservationId: locked.reservation_id, state: 'succeeded' });
    return row;
  });
}

async function finishFail(pool, { tenantId, job, outboxId, code }) {
  const errCode = sanitizeCode(code);
  return withTx(pool, async (client) => {
    const locked = await lockJob(client, tenantId, job.id);
    if (locked) {
      const stop = await loadWorkflowStop(client, tenantId, locked.workflow_id);
      if (stop) return abortLockedJob(client, { tenantId, job: locked, outboxId, ...stop });
    }
    if (!locked || TERMINAL.has(locked.status)) {
      if (locked && locked.status === 'cancelled') {
        await settleReleaseSafe(client, { tenantId, job: locked });
        await completeOutboxForCancel(client, { tenantId, outboxId });
      } else if (locked && (locked.status === 'failed' || locked.status === 'permanently_failed')) {
        try { await outbox.fail(client, { tenantId, id: outboxId, errorCode: errCode }); } catch (_) { /* ignore */ }
      }
      if (locked) await releaseJobInflight(client, { tenantId, jobId: locked.id });
      return locked;
    }
    const retry = RETRYABLE.has(errCode) && (Number(locked.attempt_count) || 0) < (Number(locked.max_attempts) || 3);
    if (retry) {
      await client.query(
        `UPDATE orchestrator_video_generation_jobs SET status='retryable', ${CLEAR} WHERE tenant_id=$1 AND id=$2 AND status='running'`,
        [tenantId, locked.id]);
      await outbox.fail(client, { tenantId, id: outboxId, errorCode: errCode });
      await releaseJobInflight(client, { tenantId, jobId: locked.id });
      logger.info('video_job_retry', { tenant_id: tenantId, workflow_id: locked.workflow_id, job_id: locked.id, error_code: errCode });
      return locked;
    }
    const terminal = RETRYABLE.has(errCode) ? 'permanently_failed' : 'failed';
    const row = (await client.query(
      `UPDATE orchestrator_video_generation_jobs SET status=$3, error_code=$4, completed_at=now(), ${CLEAR}
        WHERE tenant_id=$1 AND id=$2 AND status IN ('queued','reserved','running','retryable') RETURNING *`,
      [tenantId, locked.id, terminal, errCode]
    )).rows[0];
    await settle(client, { tenantId, job: locked, commit: false });
    await outbox.fail(client, { tenantId, id: outboxId, errorCode: errCode });
    await releaseJobInflight(client, { tenantId, jobId: locked.id });
    await note(client, { tenantId, workflowId: locked.workflow_id, event: 'video_job_failed', jobId: locked.id, state: terminal, errorCode: errCode });
    return row;
  });
}

async function claimAndStart(pool, { tenantId, workerId }) {
  return withTx(pool, async (client) => {
    const claimed = await outbox.claim(client, { tenantId, workerId, limit: 1, operation: 'video_generate' });
    if (!claimed.length) return null;
    const ob = claimed[0];
    if (ob.operation !== 'video_generate') {
      await parkOutboxPending(client, { tenantId, id: ob.id });
      return { skip: true };
    }
    const job = await one(client,
      `SELECT * FROM orchestrator_video_generation_jobs WHERE tenant_id=$1 AND idempotency_key=$2 FOR UPDATE`,
      [tenantId, jobKeyFromOutbox(ob)]);
    if (!job) { await outbox.complete(client, { tenantId, id: ob.id }); return { skip: true, job }; }
    if (job.status === 'succeeded') { await outbox.complete(client, { tenantId, id: ob.id }); return { skip: true, job }; }
    const stop = await loadWorkflowStop(client, tenantId, job.workflow_id);
    if (stop) { await abortLockedJob(client, { tenantId, job, outboxId: ob.id, ...stop }); return { skip: true, job }; }
    if (job.status === 'cancelled') {
      await abortLockedJob(client, { tenantId, job, outboxId: ob.id, jobStatus: 'cancelled', errorCode: 'cancelled' });
      return { skip: true, job };
    }
    if (job.status === 'failed' || job.status === 'permanently_failed') {
      await outbox.fail(client, { tenantId, id: ob.id, errorCode: job.error_code || 'outbox_failed' });
      await releaseJobInflight(client, { tenantId, jobId: job.id });
      return { skip: true, job };
    }
    if (leaseHeldByOther(job, workerId)) { await parkOutboxPending(client, { tenantId, id: ob.id }); return { skip: true, job }; }
    if ((Number(job.attempt_count) || 0) >= (Number(job.max_attempts) || 3)) {
      await abortLockedJob(client, { tenantId, job, outboxId: ob.id, jobStatus: 'permanently_failed', errorCode: job.error_code || 'outbox_failed' });
      return { skip: true, job };
    }
    const slot = await acquireGenerationInflight(client, {
      tenantId, workflowId: job.workflow_id, provider: job.provider, model: job.model, jobId: job.id,
    });
    if (!slot.acquired) { await parkOutboxPending(client, { tenantId, id: ob.id }); return { skip: true, defer: true, job }; }
    const started = (await client.query(
      `UPDATE orchestrator_video_generation_jobs SET status='running', state_version=state_version+1, attempt_count=attempt_count+1,
              lease_holder=$3, lease_expires_at=$4, started_at=COALESCE(started_at, now()), updated_at=now()
        WHERE tenant_id=$1 AND id=$2 AND status IN ('reserved','retryable','running') AND attempt_count < max_attempts RETURNING *`,
      [tenantId, job.id, workerId, new Date(Date.now() + 30_000)]
    )).rows[0];
    if (!started) {
      await abortLockedJob(client, { tenantId, job, outboxId: ob.id, jobStatus: 'failed', errorCode: 'invalid_transition' });
      return { skip: true, job };
    }
    const approval = await one(client, `SELECT object_id, object_version FROM orchestrator_approvals WHERE tenant_id=$1 AND id=$2`,
      [tenantId, started.approval_id]);
    const bound = approval ? await one(client,
      `SELECT * FROM orchestrator_creative_artifacts WHERE tenant_id=$1 AND artifact_id=$2 AND version=$3`,
      [tenantId, approval.object_id, approval.object_version]) : null;
    return { job: started, outbox: ob, brief: isVideoBrief(bound) && bound.status === 'approved' ? bound : null };
  });
}

async function resetStaleVideoOutbox(pool, tenantId) {
  return withTx(pool, async (client) => {
    const stale = await client.query(
      `SELECT * FROM orchestrator_outbox WHERE tenant_id=$1 AND operation='video_generate' AND state='processing' AND (claimed_until IS NULL OR claimed_until < now()) FOR UPDATE SKIP LOCKED`, [tenantId]);
    for (const row of stale.rows) {
      const attempts = Number(row.attempt_count) + 1;
      const dead = attempts >= (Number(row.max_attempts) || 8);
      await client.query(
        `UPDATE orchestrator_outbox SET attempt_count=$3, last_error_code='lease_expired', state=$4, next_attempt_at=now(), claimed_by=NULL, claimed_until=NULL, updated_at=now() WHERE tenant_id=$1 AND id=$2`,
        [tenantId, row.id, attempts, dead ? 'dead_letter' : 'failed']);
      logger.info(dead ? 'outbox_dead_letter' : 'outbox_failed', { tenant_id: tenantId, workflow_id: row.workflow_id || null, error_code: 'lease_expired' });
      if (!dead) continue;
      const job = await one(client, `${QJ} AND idempotency_key=$2 FOR UPDATE`, [tenantId, jobKeyFromOutbox(row)]);
      if (job && !TERMINAL.has(job.status)) {
        await abortLockedJob(client, { tenantId, job, outboxId: row.id, jobStatus: 'failed', errorCode: 'lease_expired', settleOutbox: false });
      } else if (job) {
        await settleReleaseSafe(client, { tenantId, job });
        await releaseJobInflight(client, { tenantId, jobId: job.id });
      }
    }
  });
}

async function processVideoJobs(pool, { tenantId, workerId, runtime } = {}) {
  const worker = String(workerId || `vgj:${process.pid}`);
  await resetStaleVideoOutbox(pool, tenantId);
  let n = 0;
  for (;;) {
    const claimed = await claimAndStart(pool, { tenantId, workerId: worker });
    if (!claimed) break;
    n += 1;
    if (claimed.defer) break;
    if (claimed.skip) { if (n >= 20) break; continue; }
    const { job, brief } = claimed;
    const outboxId = claimed.outbox.id;
    try {
      if (!brief) fail('approval_scope_mismatch');
      const existing = await loadOutput(pool, tenantId, job.id);
      const generated = existing ? undefined : await completeVideoJob({
        job, brief, contract: job.contract_json, runtime: runtime || createVideoRuntime(),
      });
      await finishSuccess(pool, { tenantId, job, outboxId, generated, workerId: worker });
    } catch (err) {
      await finishFail(pool, { tenantId, job, outboxId, code: (err instanceof OrchError && err.code) || (err && err.code) || 'provider_malformed' });
    } finally {
      try { await releaseInflight(pool, { tenantId, inflightId: generationInflightId(job.id) }); } catch (_) { /* ignore */ }
    }
    if (n >= 20) break;
  }
  return n;
}

let tickActive = false;
async function tickVideoWorker(opts = {}) {
  if (tickActive) return;
  tickActive = true;
  try {
    if (!_db.hasDb()) return;
    const due = await _db.getPool().query(
      `SELECT DISTINCT tenant_id FROM orchestrator_outbox WHERE destination='internal' AND operation='video_generate'
          AND ((state IN ('pending','failed') AND next_attempt_at <= now()) OR (state='processing' AND (claimed_until IS NULL OR claimed_until < now())))`);
    for (const row of due.rows) {
      try { await processVideoJobs(_db.getPool(), { tenantId: row.tenant_id, runtime: opts.runtime, workerId: opts.workerId }); } catch (err) {
        logger.info('video_job_worker_failed', { tenant_id: row.tenant_id, error_code: sanitizeCode(err && err.code) });
      }
    }
  } finally { tickActive = false; }
}

function startVideoWorker() {
  if (!_runtimeFlags.backgroundEnabled()) return null;
  return setInterval(() => {
    tickVideoWorker().catch((err) => { logger.info('video_job_worker_failed', { tenant_id: null, error_code: sanitizeCode(err && err.code) }); });
  }, 2000);
}

startVideoWorker();

module.exports = {
  enqueueVideoJob, getVideoJob, cancelVideoJob, processVideoJobs,
  tickVideoWorker, generationRequestHash, MAX_APPROVAL_AGE_MS, reserveKey, startVideoWorker,
};
