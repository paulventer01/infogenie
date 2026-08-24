'use strict';

const crypto = require('crypto');
const { fail, OrchError } = require('./errors');
const { sha256Hex } = require('./hash');
const { insertAudit } = require('./runner');
const { approvalContentHash } = require('./creative_validate');
const credits = require('./credits');
const outbox = require('./outbox');
const { preflight, releaseInflight } = require('./limits');
const { DEFAULT_REQUEST_MICROS, PLACEHOLDER_PROVIDER, PLACEHOLDER_MODEL } = require('./pricing');
const { toBigInt, microsToJson } = require('./money');
const { logger } = require('../infra/logger');
const { putObject } = require('../infra/object_storage');
const { createGenerationRuntime, generateStaticImage, hasLiveKey } = require('./generation_adapter');

const ESTIMATE = DEFAULT_REQUEST_MICROS;
const MAX_APPROVAL_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const RETRYABLE = new Set(['provider_timeout', 'provider_transient']);
const nid = (p) => `${p}_${crypto.randomBytes(8).toString('hex')}`;
const reserveKey = (k) => `staticimg:${k}:reserve`;
const sanitizeCode = (c) => /^[a-z0-9_]{1,40}$/.test(String(c || '')) ? String(c) : 'provider_malformed';
const one = (c, sql, p) => c.query(sql, p).then((r) => r.rows[0] || null);
const loadJob = (c, tid, id) => one(c, `SELECT * FROM orchestrator_static_image_jobs WHERE tenant_id=$1 AND id=$2`, [tid, id]);
const loadByKey = (c, tid, k) => one(c, `SELECT * FROM orchestrator_static_image_jobs WHERE tenant_id=$1 AND idempotency_key=$2`, [tid, k]);
const loadAsset = (c, tid, jid) => one(c, `SELECT * FROM orchestrator_static_image_assets WHERE tenant_id=$1 AND job_id=$2`, [tid, jid]);

function generationRequestHash(f) {
  return sha256Hex({
    proposal_id: String(f.proposal_id), proposal_version: Number(f.proposal_version),
    proposal_content_hash: String(f.proposal_content_hash), approval_id: Number(f.approval_id),
    approval_hash: String(f.approval_hash), workflow_id: String(f.workflow_id),
    provider: String(f.provider), model: String(f.model), model_version: String(f.model_version || 'v1'),
    estimated_max_cost_micros: Number(f.estimated_max_cost_micros), contract: 'static_image_v1',
  });
}

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

function publicJob(row, asset) {
  if (!row) return null;
  const out = {
    id: row.id, tenant_id: row.tenant_id, workflow_id: row.workflow_id, proposal_id: row.proposal_id,
    proposal_version: Number(row.proposal_version), status: row.status, provider: row.provider,
    model: row.model, model_version: row.model_version, honesty_class: row.honesty_class,
    estimated_cost_micros: microsToJson(row.estimated_cost_micros),
    actual_cost_micros: row.actual_cost_micros == null ? null : microsToJson(row.actual_cost_micros),
    error_code: row.error_code, created_at: row.created_at, completed_at: row.completed_at,
  };
  if (asset && asset.usable) {
    out.asset = {
      id: asset.id, storage_ref: asset.storage_ref, mime_type: asset.mime_type, width_px: asset.width_px,
      height_px: asset.height_px, byte_size: asset.byte_size, asset_hash: asset.asset_hash,
      moderation_status: asset.moderation_status, honesty_class: asset.honesty_class, provenance: asset.provenance,
    };
  }
  return out;
}

async function note(client, { tenantId, workflowId, event, jobId, reservationId, state, errorCode }) {
  await insertAudit(client, {
    tenantId, workflowId, event,
    detail: {
      action: event, step_id: jobId, reservation_id: reservationId, amount_micros: Number(ESTIMATE),
      state, gate: 'creative_generation', error_code: errorCode,
    },
    state, gate: 'creative_generation', errorCode,
  });
  logger.info(event, { tenant_id: tenantId, workflow_id: workflowId, job_id: jobId, error_code: errorCode || null });
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
  if (!artifact) fail('approval_scope_mismatch');
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
  if (latest && latest.decision === 'approved'
      && (Number(latest.object_version) !== Number(approval.object_version) || String(latest.content_hash) !== String(o.approvalHash))) {
    fail('approval_stale');
  }
  const nowMs = o.now != null ? Number(o.now) : Date.now();
  const maxAge = o.maxApprovalAgeMs != null ? Number(o.maxApprovalAgeMs) : MAX_APPROVAL_AGE_MS;
  if (nowMs - new Date(approval.created_at).getTime() > maxAge) fail('approval_expired');
  return { wf, proposal, approval, artifact };
}

async function settle(client, { tenantId, job, commit }) {
  if (!job.reservation_id) return;
  if (commit) {
    await credits.commit({
      client, tenantId, reservationId: job.reservation_id, actualMicros: toBigInt(job.reserved_cost_micros || ESTIMATE),
      idempotencyKey: `${reserveKey(job.idempotency_key)}:commit`,
    });
  } else {
    await credits.release({
      client, tenantId, reservationId: job.reservation_id, reasonCode: 'static_image_release',
      idempotencyKey: `${reserveKey(job.idempotency_key)}:release`,
    });
  }
}

async function enqueueStaticImageJob(pool, opts) {
  const {
    tenantId, userId, workflowId, proposalId, proposalVersion, proposalContentHash,
    approvalId, approvalHash, estimatedMaxCostMicros, confirm, idempotencyKey, mode, bodyTenantId, now, maxApprovalAgeMs,
  } = opts;
  if (bodyTenantId != null && Number(bodyTenantId) !== Number(tenantId)) fail('validation_failed', { field: 'tenant_id', reason: 'mismatch' });
  if (confirm !== true) fail('validation_failed', { field: 'confirm', reason: 'required' });
  if (!workflowId || !proposalId || !approvalId || !approvalHash || !proposalContentHash || !idempotencyKey) fail('validation_failed');
  if (toBigInt(estimatedMaxCostMicros) !== ESTIMATE) fail('validation_failed', { field: 'estimated_max_cost_micros' });
  const existing = await loadByKey(pool, tenantId, idempotencyKey);
  if (existing) return { job: existing, replay: true };
  const live = mode === 'live';
  if (live && !hasLiveKey()) fail('provider_not_configured');
  const provider = live ? 'openai' : PLACEHOLDER_PROVIDER;
  const model = live ? 'gpt-image-1' : PLACEHOLDER_MODEL;
  const reqHash = generationRequestHash({
    proposal_id: proposalId, proposal_version: proposalVersion, proposal_content_hash: proposalContentHash,
    approval_id: approvalId, approval_hash: approvalHash, workflow_id: workflowId,
    provider, model, model_version: 'v1', estimated_max_cost_micros: Number(ESTIMATE),
  });
  return withTx(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`staticimg:${tenantId}:${proposalId}`]);
    const replay = await loadByKey(client, tenantId, idempotencyKey);
    if (replay) return { job: replay, replay: true };
    await bindApproval(client, {
      tenantId, workflowId, proposalId, proposalVersion, proposalContentHash, approvalId, approvalHash, now, maxApprovalAgeMs,
    });
    const consumed = await client.query(
      `SELECT id FROM orchestrator_static_image_jobs WHERE tenant_id=$1 AND approval_id=$2 AND generation_request_hash <> $3 AND status IN ('queued','running','succeeded') LIMIT 1`,
      [tenantId, approvalId, reqHash]
    );
    if (consumed.rowCount) fail('approval_stale');
    const active = await one(client,
      `SELECT * FROM orchestrator_static_image_jobs WHERE tenant_id=$1 AND proposal_id=$2 AND generation_request_hash=$3 AND status IN ('queued','running')`,
      [tenantId, proposalId, reqHash]);
    if (active) return { job: active, replay: true };
    const pf = await preflight(client, { tenantId, workflowId, provider, model, estimatedMicros: ESTIMATE, recordStart: true });
    const inflightId = pf && pf.inflight && pf.inflight.id;
    const id = nid('sij');
    try {
      const reserved = await credits.reserve({
        client, tenantId, workflowId, stepId: id, amountMicros: ESTIMATE, estimatedMicros: ESTIMATE,
        runPreflight: false, idempotencyKey: reserveKey(idempotencyKey),
        provider, operation: 'static_image_generate', model, actorUserId: userId,
      });
      let row;
      try {
        row = (await client.query(
          `INSERT INTO orchestrator_static_image_jobs
             (id, tenant_id, workflow_id, proposal_id, proposal_version, proposal_content_hash, approval_id, approval_hash,
              generation_request_hash, provider, model, model_version, idempotency_key, status, reservation_id,
              estimated_cost_micros, reserved_cost_micros, credential_ref, honesty_class)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'v1',$12,'queued',$13,$14,$14,$15,$16) RETURNING *`,
          [id, tenantId, workflowId, proposalId, Number(proposalVersion), proposalContentHash, approvalId, approvalHash,
            reqHash, provider, model, idempotencyKey, reserved.reservation.id, toBigInt(ESTIMATE).toString(),
            live ? 'platform_openai' : null, live ? 'provider' : 'fixture']
        )).rows[0];
      } catch (err) {
        if (err && err.code === '23505') fail('execution_in_progress');
        throw err;
      }
      const ob = await outbox.enqueue(client, {
        tenantId, workflowId, destination: 'internal', operation: 'static_image_generate',
        credentialRef: live ? 'platform_openai' : null, idempotencyKey: `staticimg:${idempotencyKey}`,
      });
      row = (await client.query(
        `UPDATE orchestrator_static_image_jobs SET outbox_id=$1, updated_at=now() WHERE tenant_id=$2 AND id=$3 RETURNING *`,
        [ob.id, tenantId, id]
      )).rows[0];
      await note(client, {
        tenantId, workflowId, event: 'static_image_enqueued', jobId: id,
        reservationId: reserved.reservation.id, state: 'queued',
      });
      if (inflightId) await releaseInflight(client, { tenantId, inflightId });
      return { job: row, replay: false };
    } catch (err) {
      try { if (inflightId) await releaseInflight(client, { tenantId, inflightId }); } catch (_) { /* keep */ }
      throw err;
    }
  });
}

async function getStaticImageJob(pool, tenantId, id) {
  const job = await loadJob(pool, tenantId, id);
  if (!job) fail('not_found');
  return { job, asset: await loadAsset(pool, tenantId, job.id) };
}

async function cancelStaticImageJob(pool, tenantId, id) {
  const job = await loadJob(pool, tenantId, id);
  if (!job) fail('not_found');
  if (job.status === 'cancelled' || job.status === 'succeeded' || job.status === 'failed') return job;
  return withTx(pool, async (client) => {
    const updated = (await client.query(
      `UPDATE orchestrator_static_image_jobs SET status='cancelled', error_code='cancelled', completed_at=now(),
              updated_at=now(), lease_holder=NULL, lease_expires_at=NULL
        WHERE tenant_id=$1 AND id=$2 AND status IN ('queued','running') RETURNING *`,
      [tenantId, id]
    )).rows[0] || await loadJob(client, tenantId, id);
    if (updated.reservation_id) {
      await credits.release({
        client, tenantId, reservationId: updated.reservation_id, reasonCode: 'static_image_cancel',
        idempotencyKey: `${reserveKey(updated.idempotency_key)}:release`,
      });
    }
    if (updated.outbox_id) {
      try { await outbox.complete(client, { tenantId, id: updated.outbox_id }); }
      catch (_) { try { await outbox.fail(client, { tenantId, id: updated.outbox_id, errorCode: 'cancelled' }); } catch (__) { /* ignore */ } }
    }
    await note(client, { tenantId, workflowId: updated.workflow_id, event: 'static_image_cancelled', jobId: updated.id, state: 'cancelled' });
    return updated;
  });
}

async function finishSuccess(pool, { tenantId, job, outboxId, generated, storageRef }) {
  return withTx(pool, async (client) => {
    const locked = await one(client, `SELECT * FROM orchestrator_static_image_jobs WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, job.id]);
    if (!locked || locked.status !== 'running') {
      if (locked && locked.status === 'succeeded') await outbox.complete(client, { tenantId, id: outboxId });
      return locked;
    }
    let asset = await loadAsset(client, tenantId, job.id);
    if (!asset) {
      let honesty = String(generated.honesty_class || 'fixture');
      let provenance = generated.provenance === 'live' ? 'live' : 'fixture';
      if (provenance === 'live') { if (honesty !== 'live' && honesty !== 'provider') honesty = 'provider'; }
      else if (!['fixture', 'synthetic', 'demo', 'test', 'mock'].includes(honesty)) honesty = 'fixture';
      const allowed = new Set(['fixture', 'synthetic', 'provider', 'internal']);
      const modSource = allowed.has(generated.moderation && generated.moderation.source) ? generated.moderation.source : 'fixture';
      const hash = crypto.createHash('sha256').update(generated.bytes).digest('hex');
      asset = (await client.query(
        `INSERT INTO orchestrator_static_image_assets
           (id, tenant_id, workflow_id, job_id, proposal_id, proposal_version, proposal_content_hash, approval_hash,
            provider, model, model_version, request_hash, mime_type, width_px, height_px, byte_size, asset_hash,
            storage_ref, moderation_status, moderation_source, honesty_class, provenance, usable)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'passed',$19,$20,$21,true) RETURNING *`,
        [nid('sia'), tenantId, locked.workflow_id, locked.id, locked.proposal_id, locked.proposal_version,
          locked.proposal_content_hash, locked.approval_hash, locked.provider, locked.model, locked.model_version,
          locked.generation_request_hash, generated.mime, generated.width, generated.height, generated.bytes.length,
          hash, storageRef, modSource, honesty, provenance]
      )).rows[0];
    }
    const row = (await client.query(
      `UPDATE orchestrator_static_image_jobs SET status='succeeded', asset_id=$3, actual_cost_micros=$4, honesty_class=$5,
              completed_at=now(), updated_at=now(), lease_holder=NULL, lease_expires_at=NULL, state_version=state_version+1
        WHERE tenant_id=$1 AND id=$2 AND status='running' RETURNING *`,
      [tenantId, locked.id, asset.id, toBigInt(locked.reserved_cost_micros || ESTIMATE).toString(), asset.honesty_class]
    )).rows[0];
    await settle(client, { tenantId, job: locked, commit: true });
    await outbox.complete(client, { tenantId, id: outboxId });
    await note(client, {
      tenantId, workflowId: locked.workflow_id, event: 'static_image_succeeded', jobId: locked.id,
      reservationId: locked.reservation_id, state: 'succeeded',
    });
    return row;
  });
}

async function finishFail(pool, { tenantId, job, outboxId, code }) {
  const errCode = sanitizeCode(code);
  return withTx(pool, async (client) => {
    const locked = await one(client, `SELECT * FROM orchestrator_static_image_jobs WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, job.id]);
    if (!locked || ['succeeded', 'cancelled', 'failed'].includes(locked.status)) {
      if (locked && locked.status === 'failed') await outbox.fail(client, { tenantId, id: outboxId, errorCode: errCode });
      return locked;
    }
    const retry = RETRYABLE.has(errCode) && (Number(locked.attempt_count) || 0) < (Number(locked.max_attempts) || 3);
    if (retry) {
      await client.query(
        `UPDATE orchestrator_static_image_jobs SET lease_holder=NULL, lease_expires_at=NULL, updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status='running'`,
        [tenantId, locked.id]
      );
      await outbox.fail(client, { tenantId, id: outboxId, errorCode: errCode });
      logger.info('static_image_retry', { tenant_id: tenantId, workflow_id: locked.workflow_id, job_id: locked.id, error_code: errCode });
      return locked;
    }
    const row = (await client.query(
      `UPDATE orchestrator_static_image_jobs SET status='failed', error_code=$3, completed_at=now(), updated_at=now(),
              lease_holder=NULL, lease_expires_at=NULL, state_version=state_version+1
        WHERE tenant_id=$1 AND id=$2 AND status IN ('queued','running') RETURNING *`,
      [tenantId, locked.id, errCode]
    )).rows[0];
    await settle(client, { tenantId, job: locked, commit: false });
    await outbox.fail(client, { tenantId, id: outboxId, errorCode: errCode });
    await note(client, {
      tenantId, workflowId: locked.workflow_id, event: 'static_image_failed', jobId: locked.id, state: 'failed', errorCode: errCode,
    });
    return row;
  });
}

async function claimAndStart(pool, { tenantId, workerId }) {
  return withTx(pool, async (client) => {
    const claimed = await outbox.claim(client, { tenantId, workerId, limit: 1 });
    if (!claimed.length) return null;
    const ob = claimed[0];
    if (ob.operation !== 'static_image_generate') {
      await outbox.complete(client, { tenantId, id: ob.id });
      return { skip: true };
    }
    const job = await one(client, `SELECT * FROM orchestrator_static_image_jobs WHERE tenant_id=$1 AND outbox_id=$2 FOR UPDATE`, [tenantId, ob.id]);
    if (!job || job.status === 'succeeded' || job.status === 'cancelled') {
      await outbox.complete(client, { tenantId, id: ob.id });
      return { skip: true, job };
    }
    if (job.status === 'failed') {
      await outbox.fail(client, { tenantId, id: ob.id, errorCode: job.error_code || 'outbox_failed' });
      return { skip: true, job };
    }
    const now = Date.now();
    const live = job.lease_expires_at && new Date(job.lease_expires_at).getTime() > now;
    if (job.status === 'running' && live && job.lease_holder && job.lease_holder !== workerId) return { skip: true, job };
    const started = (await client.query(
      `UPDATE orchestrator_static_image_jobs SET status='running', state_version=state_version+1, attempt_count=attempt_count+1,
              lease_holder=$3, lease_expires_at=$4, started_at=COALESCE(started_at, now()), updated_at=now()
        WHERE tenant_id=$1 AND id=$2 AND status IN ('queued','running') RETURNING *`,
      [tenantId, job.id, workerId, new Date(now + 30_000)]
    )).rows[0];
    if (!started) return { skip: true, job };
    const proposal = await one(client, `SELECT * FROM orchestrator_proposal_generations WHERE tenant_id=$1 AND id=$2`, [tenantId, started.proposal_id]);
    const ids = proposal && Array.isArray(proposal.artifact_ids) ? proposal.artifact_ids : [];
    let brief = null;
    if (ids.length) {
      const arts = await client.query(`SELECT * FROM orchestrator_creative_artifacts WHERE tenant_id=$1 AND id = ANY($2::text[])`, [tenantId, ids]);
      brief = arts.rows.find((a) => a.kind === 'creative_brief' && a.payload && a.payload.format === 'image') || null;
    }
    return { job: started, outbox: ob, brief };
  });
}

async function processStaticImageJobs(pool, { tenantId, workerId, runtime } = {}) {
  const worker = String(workerId || `sij:${process.pid}`);
  await pool.query(
    `UPDATE orchestrator_outbox SET state='failed', claimed_by=NULL, claimed_until=NULL, updated_at=now()
      WHERE tenant_id=$1 AND operation='static_image_generate' AND state='processing'
        AND (claimed_until IS NULL OR claimed_until < now())`,
    [tenantId]
  );
  let n = 0;
  for (;;) {
    const claimed = await claimAndStart(pool, { tenantId, workerId: worker });
    if (!claimed) break;
    n += 1;
    if (claimed.skip) { if (n >= 20) break; continue; }
    const { job, brief } = claimed;
    const outboxId = claimed.outbox.id;
    try {
      const existing = await loadAsset(pool, tenantId, job.id);
      const jobRt = runtime || createGenerationRuntime({ mode: job.provider === 'openai' ? 'live' : 'fixture' });
      if (existing) {
        await finishSuccess(pool, { tenantId, job, outboxId, generated: { bytes: existing, mime: existing.mime_type, width: existing.width_px, height: existing.height_px, honesty_class: existing.honesty_class, provenance: existing.provenance, moderation: { source: existing.moderation_source } }, storageRef: existing.storage_ref });
      } else {
        const generated = await generateStaticImage({ job, brief, runtime: jobRt });
        const ext = generated.mime === 'image/jpeg' ? 'jpeg' : generated.mime === 'image/webp' ? 'webp' : 'png';
        const storageRef = await putObject(`orchestrator/static-images/${tenantId}/${job.id}.${ext}`, generated.bytes, { contentType: generated.mime });
        await finishSuccess(pool, { tenantId, job, outboxId, generated, storageRef });
      }
    } catch (err) {
      await finishFail(pool, { tenantId, job, outboxId, code: (err instanceof OrchError && err.code) || (err && err.code) || 'provider_malformed' });
    }
    if (n >= 20) break;
  }
  return n;
}

module.exports = {
  enqueueStaticImageJob, getStaticImageJob, cancelStaticImageJob, processStaticImageJobs,
  publicJob, generationRequestHash, MAX_APPROVAL_AGE_MS, reserveKey,
};
