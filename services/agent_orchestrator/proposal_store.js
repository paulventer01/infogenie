'use strict';

const crypto = require('crypto');
const { fail } = require('./errors');
const { contentHash, assertApprovalFresh } = require('./approvals');
const { insertAudit } = require('./runner');
const { insertCreativeArtifactTx } = require('./creative_store');
const { approvalContentHash } = require('./creative_validate');
const {
  generateProposalBundle, evidenceSnapshotHash, bundleContentHash,
} = require('./proposal_generate');
const P = require('./proposal_contracts');
const credits = require('./credits');
const { preflight, releaseInflight } = require('./limits');
const { DEFAULT_REQUEST_MICROS } = require('./pricing');
const { logger } = require('../infra/logger');
const { acquireLease, heartbeatLease, releaseLease } = require('./leases');

const UNIQUE_VIOLATION = '23505';
const ESTIMATE = DEFAULT_REQUEST_MICROS;

function newId() {
  return `pgen_${crypto.randomBytes(8).toString('hex')}`;
}

function reserveKey(idempotencyKey) {
  return `proposal:${idempotencyKey}:reserve`;
}

async function nextReserveKey(pool, tenantId, idempotencyKey) {
  const key = reserveKey(idempotencyKey);
  const existing = (await pool.query(
    `SELECT status FROM orchestrator_credit_reservations WHERE tenant_id=$1 AND idempotency_key=$2`,
    [tenantId, key]
  )).rows[0];
  if (!existing || existing.status === 'reserved' || existing.status === 'committed') return key;
  return `${key}:retry`;
}

function publicGeneration(row, artifacts) {
  if (!row) return null;
  const out = {
    id: row.id, tenant_id: row.tenant_id, workflow_id: row.workflow_id,
    research_run_id: row.research_run_id, version: Number(row.version), status: row.status,
    contract_version: row.contract_version, prompt_template_version: row.prompt_template_version,
    provider: row.provider, model: row.model, evidence_snapshot_hash: row.evidence_snapshot_hash,
    research_approval_id: row.research_approval_id, research_approval_hash: row.research_approval_hash,
    research_approval_object_version: Number(row.research_approval_object_version),
    content_hash: row.content_hash, artifact_ids: row.artifact_ids || [],
    error_code: row.error_code, generated_at: row.generated_at, created_at: row.created_at,
  };
  if (artifacts) out.artifacts = artifacts;
  return out;
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
  } finally {
    c.release();
  }
}

function loadOne(client, sql, params) {
  return client.query(sql, params).then((r) => r.rows[0] || null);
}

function loadWorkflow(client, tenantId, workflowId) {
  return loadOne(client, `SELECT * FROM orchestrator_workflows WHERE tenant_id=$1 AND id=$2`, [tenantId, workflowId]);
}

function loadRun(client, tenantId, runId) {
  return loadOne(client, `SELECT * FROM orchestrator_research_runs WHERE tenant_id=$1 AND id=$2`, [tenantId, runId]);
}

async function assertBoundApproval(client, tenantId, wf) {
  if (!wf) fail('not_found');
  if (wf.current_state === 'cancelled') fail('workflow_cancelled');
  if (wf.current_state === 'paused') fail('workflow_paused');
  if (!P.ALLOWED_WF.includes(String(wf.current_state))) {
    fail('approval_required', { field: 'current_state', reason: 'research_stage_required' });
  }
  const latest = (await client.query(
    `SELECT * FROM orchestrator_approvals
      WHERE tenant_id=$1 AND workflow_id=$2 AND gate='research_execution'
      ORDER BY created_at DESC LIMIT 1`,
    [tenantId, wf.id]
  )).rows[0];
  if (!latest || latest.decision !== 'approved') fail('approval_required');
  assertApprovalFresh(wf, latest, 'research_execution');
  if (String(latest.content_hash) !== contentHash(wf, 'research_execution')) fail('approval_stale');
  return latest;
}

async function loadSnapshot(client, tenantId, workflowId, runId) {
  const run = await loadRun(client, tenantId, runId);
  if (!run) fail('not_found');
  if (String(run.workflow_id) !== String(workflowId)) fail('not_found');
  if (String(run.state) !== 'completed') {
    fail('validation_failed', { field: 'research_run_id', reason: 'run_not_completed' });
  }
  const r = await client.query(
    `SELECT e.*
       FROM orchestrator_research_evidence e
       JOIN orchestrator_research_runs r
         ON r.tenant_id = e.tenant_id AND r.id = e.research_run_id
      WHERE e.tenant_id=$1 AND e.research_run_id=$2 AND r.workflow_id=$3
        AND (e.expires_at IS NULL OR e.expires_at > now())
      ORDER BY e.created_at ASC`,
    [tenantId, runId, workflowId]
  );
  if (!r.rowCount) fail('validation_failed', { field: 'evidence', reason: 'empty_snapshot' });
  return { run, rows: r.rows };
}

async function loadGeneration(client, tenantId, id) {
  return loadOne(client, `SELECT * FROM orchestrator_proposal_generations WHERE tenant_id=$1 AND id=$2`, [tenantId, id]);
}

async function loadByIdempotency(client, tenantId, key) {
  return loadOne(client, `SELECT * FROM orchestrator_proposal_generations WHERE tenant_id=$1 AND idempotency_key=$2`, [tenantId, key]);
}

async function loadArtifacts(client, tenantId, artifactRowIds) {
  const ids = Array.isArray(artifactRowIds) ? artifactRowIds : [];
  if (!ids.length) return [];
  const r = await client.query(
    `SELECT * FROM orchestrator_creative_artifacts
      WHERE tenant_id=$1 AND id = ANY($2::text[])
      ORDER BY created_at ASC`,
    [tenantId, ids]
  );
  return r.rows.map((row) => ({
    id: row.id,
    artifact_id: row.artifact_id,
    kind: row.kind,
    status: row.status,
    version: Number(row.version),
    content_hash: row.content_hash,
    evidence_hash: row.evidence_hash,
    approval_id: row.approval_id,
    approval_hash: row.approval_id ? approvalContentHash(row.content_hash, row.evidence_hash) : null,
    format: row.payload && row.payload.format,
    payload: row.payload,
    citations: (row.payload && row.payload.citations) || [],
  }));
}

async function settleCredits(pool, {
  tenantId, reservationId, idempotencyKey, inflightId, commit, client,
}) {
  const target = client ? { client } : { pool };
  if (!reservationId) {
    if (inflightId) await releaseInflight(client || pool, { tenantId, inflightId });
    return;
  }
  if (commit) {
    await credits.commit({
      ...target, tenantId, reservationId, actualMicros: ESTIMATE,
      idempotencyKey: `${reserveKey(idempotencyKey)}:commit`,
    });
    if (inflightId) await releaseInflight(client || pool, { tenantId, inflightId });
  } else {
    await credits.release({
      ...target, tenantId, reservationId,
      reasonCode: 'proposal_release',
      idempotencyKey: `${reserveKey(idempotencyKey)}:release`,
      inflightId,
    });
  }
}

async function bindContext(client, tenantId, workflowId, researchRunId) {
  const wf = await loadWorkflow(client, tenantId, workflowId);
  const approval = await assertBoundApproval(client, tenantId, wf);
  const { rows } = await loadSnapshot(client, tenantId, workflowId, researchRunId);
  return { wf, approval, rows, snapshotHash: evidenceSnapshotHash(rows) };
}

async function persistCommitted(pool, {
  tenantId, userId, workflowId, researchRunId, idempotencyKey,
  approval, snapshotHash, bundle, reservationId, inflightId, hooks,
}) {
  return withTx(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `proposal_gen:${tenantId}:${workflowId}:${researchRunId}`,
    ]);
    const replay = await loadByIdempotency(client, tenantId, idempotencyKey);
    if (replay && replay.status === 'pending_review') {
      if (inflightId) await releaseInflight(client, { tenantId, inflightId });
      return { replay: true, row: replay };
    }
    const wf = await loadWorkflow(client, tenantId, workflowId);
    const fresh = await assertBoundApproval(client, tenantId, wf);
    if (Number(fresh.id) !== Number(approval.id)
        || String(fresh.content_hash) !== String(approval.content_hash)
        || Number(fresh.object_version) !== Number(approval.object_version)
        || Number(wf.version) !== Number(approval.object_version)) {
      fail('approval_stale');
    }
    if (typeof hooks.beforePersist === 'function') {
      await hooks.beforePersist({ client, workflowId, researchRunId });
    }
    if (hooks.cancelled && hooks.cancelled.value) fail('workflow_cancelled');
    const wf2 = await loadWorkflow(client, tenantId, workflowId);
    await assertBoundApproval(client, tenantId, wf2);
    const nextVersion = Number((await client.query(
      `SELECT COALESCE(MAX(version), 0) + 1 AS n
         FROM orchestrator_proposal_generations
        WHERE tenant_id=$1 AND workflow_id=$2 AND research_run_id=$3
          AND status='pending_review'`,
      [tenantId, workflowId, researchRunId]
    )).rows[0].n);
    const id = newId();
    const ids = [];
    const req = { user: { id: userId } };
    for (let i = 0; i < bundle.artifacts.length; i++) {
      const saved = await insertCreativeArtifactTx(client, bundle.artifacts[i], { tenantId, req });
      if (saved.status !== 'draft' || saved.approval_id) {
        fail('validation_failed', { field: 'status', reason: 'self_approve_forbidden' });
      }
      ids.push(saved.id);
      if (i === 0 && typeof hooks.afterFirstArtifact === 'function') {
        await hooks.afterFirstArtifact({ client, saved });
      }
    }
    const draft = {
      workflow_id: workflowId,
      research_run_id: researchRunId,
      evidence_snapshot_hash: snapshotHash,
      contract_version: P.CONTRACT_VERSION,
      prompt_template_version: bundle.prompt_template_version,
    };
    const hash = bundleContentHash(draft, bundle.artifacts);
    let row;
    try {
      row = (await client.query(
        `INSERT INTO orchestrator_proposal_generations
           (id, tenant_id, workflow_id, research_run_id, version, status,
            contract_version, prompt_template_version, provider, model,
            evidence_snapshot_hash, research_approval_id, research_approval_hash,
            research_approval_object_version, content_hash, idempotency_key,
            reservation_id, artifact_ids, generated_at)
         VALUES ($1,$2,$3,$4,$5,'pending_review',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,now())
         RETURNING *`,
        [
          id, tenantId, workflowId, researchRunId, nextVersion,
          P.CONTRACT_VERSION, bundle.prompt_template_version,
          bundle.provider, bundle.model, snapshotHash,
          approval.id, approval.content_hash, approval.object_version,
          hash, idempotencyKey, reservationId, JSON.stringify(ids),
        ]
      )).rows[0];
    } catch (err) {
      if (err && err.code === UNIQUE_VIOLATION) {
        const existing = await loadByIdempotency(client, tenantId, idempotencyKey);
        if (existing) return { replay: true, row: existing };
        fail('execution_in_progress');
      }
      throw err;
    }
    await settleCredits(client, {
      client, tenantId, reservationId, idempotencyKey, inflightId, commit: true,
    });
    await insertAudit(client, {
      tenantId, workflowId, event: 'proposal_generated', actorUserId: userId,
      detail: { action: 'proposal_generated', version: Number(row.version), state: row.status },
      state: row.status,
    });
    return { replay: false, row };
  });
}

async function startProposalGeneration(pool, {
  tenantId, userId, workflowId, researchRunId, idempotencyKey, runtime, signal,
  bodyTenantId,
}) {
  if (bodyTenantId != null && Number(bodyTenantId) !== Number(tenantId)) {
    fail('validation_failed', { field: 'tenant_id', reason: 'mismatch' });
  }
  if (!idempotencyKey) fail('validation_failed', { field: 'idempotency_key', reason: 'required' });

  const existing = await loadByIdempotency(pool, tenantId, idempotencyKey);
  if (existing && existing.status === 'pending_review') {
    const artifacts = await loadArtifacts(pool, tenantId, existing.artifact_ids);
    return { generation: existing, artifacts, replay: true };
  }

  let inflightId = null;
  let reservationId = null;
  let holder = null;
  const hooks = (runtime && runtime.hooks) || {};

  try {
    const bound = await bindContext(pool, tenantId, workflowId, researchRunId);
    const provider = (runtime && runtime.mode === 'live') ? P.LIVE_PROVIDER : P.FIXTURE_PROVIDER;
    const model = (runtime && runtime.mode === 'live') ? P.LIVE_MODEL : P.FIXTURE_MODEL;
    const pf = await withTx(pool, (client) => preflight(client, {
      tenantId, workflowId, provider, model,
      estimatedMicros: ESTIMATE, recordStart: true,
    }));
    inflightId = pf && pf.inflight && pf.inflight.id;
    const reserved = await credits.reserve({
      pool, tenantId, workflowId, amountMicros: ESTIMATE, estimatedMicros: ESTIMATE,
      runPreflight: false, idempotencyKey: await nextReserveKey(pool, tenantId, idempotencyKey),
      provider, operation: 'proposal_generation',
      model, actorUserId: userId,
    });
    reservationId = reserved.reservation && reserved.reservation.id;
    if (reserved.replay && reserved.reservation && reserved.reservation.status === 'committed') {
      const replayed = await loadByIdempotency(pool, tenantId, idempotencyKey);
      if (replayed) {
        if (inflightId) await releaseInflight(pool, { tenantId, inflightId });
        const artifacts = await loadArtifacts(pool, tenantId, replayed.artifact_ids);
        return { generation: replayed, artifacts, replay: true };
      }
    }

    const lease = await acquireLease(pool, tenantId, workflowId, { actorUserId: userId });
    holder = lease.holder;
    if (typeof hooks.beforeProvider === 'function') await hooks.beforeProvider({ bound });
    await bindContext(pool, tenantId, workflowId, researchRunId);
    if (signal && signal.aborted) fail('workflow_cancelled');

    const binding = {
      tenant_id: tenantId,
      workflow_id: workflowId,
      research_run_id: researchRunId,
      objective: bound.wf.objective,
      offer: bound.wf.offer,
      target_audience: Array.isArray(bound.wf.target_audiences)
        ? String(bound.wf.target_audiences[0] || 'In-market shoppers')
        : 'In-market shoppers',
    };
    const bundle = await generateProposalBundle({
      binding, evidenceRows: bound.rows, runtime, signal,
    });

    const beat = await heartbeatLease(pool, tenantId, workflowId, holder);
    if (!beat) fail('lease_conflict');
    if (signal && signal.aborted) fail('workflow_cancelled');

    const persisted = await persistCommitted(pool, {
      tenantId, userId, workflowId, researchRunId, idempotencyKey,
      approval: bound.approval, snapshotHash: bound.snapshotHash, bundle,
      reservationId, inflightId, hooks,
    });
    const artifacts = await loadArtifacts(pool, tenantId, persisted.row.artifact_ids);
    logger.info('proposal_generated', {
      tenant_id: tenantId, workflow_id: workflowId, actor_user_id: userId,
    });
    return { generation: persisted.row, artifacts, replay: !!persisted.replay };
  } catch (err) {
    try {
      await settleCredits(pool, {
        tenantId, reservationId, idempotencyKey, inflightId, commit: false,
      });
    } catch (_) { /* keep original error */ }
    throw err;
  } finally {
    if (holder) {
      try { await releaseLease(pool, tenantId, workflowId, holder); } catch (_) { /* ignore */ }
    }
  }
}

async function getProposalGeneration(pool, tenantId, id) {
  const row = await loadGeneration(pool, tenantId, id);
  if (!row) fail('not_found');
  const artifacts = row.status === 'pending_review'
    ? await loadArtifacts(pool, tenantId, row.artifact_ids)
    : [];
  return { generation: row, artifacts };
}

async function cancelProposalGeneration(pool, tenantId, id, flag) {
  if (flag && typeof flag === 'object' && flag.cancelled) flag.cancelled.value = true;
  const row = await loadGeneration(pool, tenantId, id);
  if (!row) fail('not_found');
  if (row.status === 'pending_review') fail('invalid_transition');
  if (row.status === 'cancelled') return row;
  const updated = (await pool.query(
    `UPDATE orchestrator_proposal_generations
        SET status='cancelled', error_code='cancelled'
      WHERE tenant_id=$1 AND id=$2 AND status IN ('pending','running')
      RETURNING *`,
    [tenantId, id]
  )).rows[0];
  return updated || row;
}

module.exports = {
  startProposalGeneration,
  getProposalGeneration,
  cancelProposalGeneration,
  publicGeneration,
  loadGeneration,
  bindContext,
};
