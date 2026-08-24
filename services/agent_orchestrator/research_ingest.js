'use strict';

const crypto = require('crypto');
const { fail } = require('./errors');
const C = require('./research_contracts');
const { assertResearchRun, assertContinuationState } = require('./research_validate');
const { insertCompetitor, insertEvidenceItem } = require('./research_store');
const { assertPageHonesty, honestyFieldsFromPage } = require('./research_honesty');
const { acquireLease, heartbeatLease, releaseLease, getLease, isLeaseExpired } = require('./leases');
const { latestApproval, insertAudit } = require('./runner');
const { createResearchRuntime } = require('./research_runtime');
const { safeRef } = require('./research_auth');
const { sanitizeConnectorMessage } = require('./research_errors');
const { logger } = require('../infra/logger');
const { assertApprovalFresh, asPlatforms, materialChanged } = require('./approvals');
const { isEmptyPlan, planHash, validatePlan, intersectPlatforms } = require('./research_plan');
const { toBigInt } = require('./money');
const credits = require('./credits');
const { DEFAULT_REQUEST_MICROS, PLACEHOLDER_PROVIDER, PLACEHOLDER_MODEL } = require('./pricing');

const TERMINAL_RUN = new Set(['completed', 'failed', 'cancelled']);
const STALE_WORKFLOW_STATES = new Set([
  'cancelled', 'paused', 'completed', 'failed', 'stopped', 'research_failed',
]);
// Sequential platform execution. Do not raise without a lease/credit review.
const MAX_CONCURRENCY = 1;
const RESEARCH_CREDIT_ESTIMATE_MICROS = DEFAULT_REQUEST_MICROS;

function reserveKey(run) {
  return `research:${run.idempotency_key}:reserve`;
}

function emptyProgress() {
  return { state: 'pending', pages: 0, records: 0, cursor: null, error_code: null, honesty_class: null };
}

function safeErrorMessage(msg) {
  try {
    return sanitizeConnectorMessage(msg);
  } catch (_) {
    return 'redacted';
  }
}

function honestyClassOf(rt, page, prior) {
  const fromPage = honestyFieldsFromPage(page).honesty_class;
  if (rt && (rt.mode === 'fixture' || rt.mode === 'synthetic' || rt.mode === 'demo' || rt.mode === 'mock')) {
    if (fromPage === 'live' || fromPage === 'provider') return prior || 'fixture';
    return fromPage || prior || 'fixture';
  }
  return fromPage || prior || null;
}

function newRunId() {
  return `rr_${crypto.randomBytes(8).toString('hex')}`;
}

function isUnique(err) {
  return err && (err.code === '23505' || /duplicate key/i.test(String(err.message || '')));
}

function publicRun(row) {
  if (!row) return null;
  const cont = row.continuation_state || {};
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    workflow_id: row.workflow_id,
    state: row.state,
    requested_platforms: row.requested_platforms,
    plan_hash: cont.plan_hash || null,
    outcome: cont.outcome || null,
    platform_progress: cont.platform_progress || {},
    continuation_state: cont,
    failure_class: row.failure_class,
    error_code: row.error_code,
    error_message: row.error_message,
    started_at: row.started_at,
    completed_at: row.completed_at,
    failed_at: row.failed_at,
    created_at: row.created_at,
  };
}

function errorCodeOf(page) {
  if (!page || page.ok) return null;
  const msg = String(page.message || page.error || '');
  if (/capability_not_supported/.test(msg)) return 'capability_not_supported';
  if (/connector_unavailable/.test(msg)) return 'connector_unavailable';
  if (/missing_credentials|invalid_credential_ref/.test(msg)) return 'missing_credentials';
  if (page.error === 'rate_limit') return 'rate_limit';
  if (msg === 'cancelled') return 'cancelled';
  if (msg === 'lease_lost') return 'lease_lost';
  const s = String(page.error || 'terminal').replace(/[^a-z0-9_]/g, '');
  return s.slice(0, 40) || 'terminal';
}

async function loadRun(pool, tenantId, runId, { forUpdate = false } = {}) {
  const r = await pool.query(
    `SELECT * FROM orchestrator_research_runs
      WHERE tenant_id=$1 AND id=$2${forUpdate ? ' FOR UPDATE' : ''}`,
    [tenantId, runId]
  );
  return r.rows[0] || null;
}

async function updateRun(pool, tenantId, runId, fields, { requireState, holder, workflowId } = {}) {
  if (holder && workflowId) {
    const beat = await heartbeatLease(pool, tenantId, workflowId, holder);
    if (!beat) return null;
  }
  const sets = [];
  const vals = [];
  let i = 1;
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'continuation_state') {
      sets.push(`${k}=$${i++}::jsonb`);
      vals.push(JSON.stringify(assertContinuationState(v)));
    } else {
      sets.push(`${k}=$${i++}`);
      vals.push(v);
    }
  }
  sets.push('id=id');
  vals.push(tenantId, runId);
  let sql = `UPDATE orchestrator_research_runs SET ${sets.join(', ')}
              WHERE tenant_id=$${i++} AND id=$${i++}`;
  if (requireState) {
    sql += ` AND state=$${i++}`;
    vals.push(requireState);
  }
  sql += ' RETURNING *';
  const r = await pool.query(sql, vals);
  return r.rows[0] || null;
}

function capturedNumber(ctx, ...keys) {
  if (!ctx) return null;
  for (const key of keys) {
    if (ctx[key] != null && ctx[key] !== '') return Number(ctx[key]);
  }
  return null;
}

async function stillWritable(pool, ctx = {}, { forUpdate = false } = {}) {
  const { tenantId, runId, holder } = ctx;
  const run = await loadRun(pool, tenantId, runId, { forUpdate });
  if (!run || run.state !== 'running') return null;

  const workflowId = ctx.workflowId || run.workflow_id;
  if (workflowId) {
    const wf = (await pool.query(
      `SELECT id, current_state, version FROM orchestrator_workflows
        WHERE tenant_id=$1 AND id=$2${forUpdate ? ' FOR UPDATE' : ''}`,
      [tenantId, workflowId]
    )).rows[0];
    if (!wf) return null;
    if (STALE_WORKFLOW_STATES.has(wf.current_state)) return null;
    const capturedVersion = capturedNumber(ctx, 'version', 'workflowVersion');
    const capturedApproval = capturedNumber(ctx, 'approval_object_version', 'approvalObjectVersion');
    if (capturedVersion != null && Number(wf.version) !== capturedVersion) return null;
    if (capturedApproval != null && Number(wf.version) !== capturedApproval) return null;
    if (capturedApproval != null && Number(run.approval_object_version) !== capturedApproval) return null;
    if (run.approval_object_version != null
        && Number(wf.version) !== Number(run.approval_object_version)) {
      return null;
    }
  }

  if (holder && workflowId) {
    const lease = forUpdate
      ? ((await pool.query(
        `SELECT * FROM orchestrator_execution_leases
          WHERE tenant_id=$1 AND workflow_id=$2 FOR UPDATE`,
        [tenantId, workflowId]
      )).rows[0] || null)
      : await getLease(pool, tenantId, workflowId);
    if (!lease || isLeaseExpired(lease) || lease.holder !== holder) return null;
    const beat = await heartbeatLease(pool, tenantId, workflowId, holder);
    if (!beat) return null;
  }
  return run;
}

async function persistDurableRecord(pool, ctx, { kind, index, records, write }) {
  // beforeWrite stays outside BEGIN so cancelResearchRun in tests cannot
  // deadlock behind this transaction's FOR UPDATE.
  if (ctx && typeof ctx.beforeWrite === 'function') {
    await ctx.beforeWrite({ kind, index, records });
  }

  const client = await pool.connect();
  let unrolled = null;
  try {
    await client.query('BEGIN');
    const writable = await stillWritable(client, ctx, { forUpdate: true });
    if (ctx && typeof ctx.afterLock === 'function') {
      await ctx.afterLock({ kind, index, records, writable: !!writable });
    }
    if (!writable) {
      await client.query('ROLLBACK');
      return { stale: true };
    }
    await client.query('SAVEPOINT persist_row');
    try {
      await write(client);
      await client.query('COMMIT');
      return { stale: false, wrote: true };
    } catch (err) {
      if (!isUnique(err)) throw err;
      await client.query('ROLLBACK TO SAVEPOINT persist_row');
      await client.query('COMMIT');
      return { stale: false, wrote: false };
    }
  } catch (err) {
    unrolled = err;
    try { await client.query('ROLLBACK'); unrolled = null; } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release(unrolled || undefined);
  }
}

async function persistPage(pool, page, ctx) {
  assertPageHonesty({ mode: ctx && ctx.mode, page });
  let records = 0;

  const competitors = page.competitors || [];
  for (let i = 0; i < competitors.length; i++) {
    const result = await persistDurableRecord(pool, ctx, {
      kind: 'competitor',
      index: i,
      records,
      write: (client) => insertCompetitor(client, competitors[i], { tenantId: ctx.tenantId }),
    });
    if (result.stale) return { stale: true, records };
    if (result.wrote) records += 1;
  }

  const evidence = page.evidence || [];
  for (let i = 0; i < evidence.length; i++) {
    const result = await persistDurableRecord(pool, ctx, {
      kind: 'evidence',
      index: i,
      records,
      write: (client) => insertEvidenceItem(client, evidence[i], {
        tenantId: ctx.tenantId,
        mode: ctx && ctx.mode,
      }),
    });
    if (result.stale) return { stale: true, records };
    if (result.wrote) records += 1;
  }
  return { stale: false, records };
}

function connectorIdFor(platform) {
  return C.PLATFORM_CONNECTOR[platform];
}

function shouldPreflight(workflow, requireCredits) {
  if (requireCredits) return true;
  try {
    return toBigInt(workflow && workflow.credit_ceiling_micros != null ? workflow.credit_ceiling_micros : 0) > 0n;
  } catch (_) {
    return false;
  }
}

async function loadWorkflowRow(pool, tenantId, workflowId) {
  return (await pool.query(
    `SELECT * FROM orchestrator_workflows WHERE tenant_id=$1 AND id=$2`,
    [tenantId, workflowId]
  )).rows[0] || null;
}

async function findReserve(pool, tenantId, run) {
  const r = await pool.query(
    `SELECT id, status FROM orchestrator_credit_reservations
      WHERE tenant_id=$1 AND idempotency_key=$2`,
    [tenantId, reserveKey(run)]
  );
  return r.rows[0] || null;
}

async function ensureResearchReserve(pool, {
  tenantId, userId, run, workflow, requireCredits,
}) {
  if (!shouldPreflight(workflow, requireCredits)) return null;
  const existing = await findReserve(pool, tenantId, run);
  if (existing) return existing.id;
  const result = await credits.reserve({
    pool,
    tenantId,
    workflowId: run.workflow_id,
    amountMicros: RESEARCH_CREDIT_ESTIMATE_MICROS,
    estimatedMicros: RESEARCH_CREDIT_ESTIMATE_MICROS,
    runPreflight: true,
    idempotencyKey: reserveKey(run),
    provider: PLACEHOLDER_PROVIDER,
    operation: 'research',
    model: PLACEHOLDER_MODEL,
    actorUserId: userId,
  });
  return result.reservation && result.reservation.id;
}

async function settleResearchCredits(pool, tenantId, run, { commit = false } = {}) {
  const row = await findReserve(pool, tenantId, run);
  if (!row || row.status !== 'reserved') return;
  try {
    if (commit) {
      await credits.commit({
        pool, tenantId, reservationId: row.id,
        actualMicros: RESEARCH_CREDIT_ESTIMATE_MICROS,
        idempotencyKey: `${reserveKey(run)}:commit`,
      });
    } else {
      await credits.release({
        pool, tenantId, reservationId: row.id,
        reasonCode: 'research_release',
        idempotencyKey: `${reserveKey(run)}:release`,
      });
    }
  } catch (_) { /* settle is best-effort after the run outcome */ }
}

function buildContinuation({
  pages, records, cursor, connector, planHashValue, progress, outcome, reservationId, honesty,
}) {
  return assertContinuationState({
    pages,
    records,
    cursor: cursor || null,
    connector: connector || null,
    plan_hash: planHashValue || null,
    outcome: outcome || null,
    reservation_id: reservationId || null,
    platform_progress: progress,
    ...honesty,
  });
}

async function executeResearchRun(pool, {
  tenantId, runId, userId, holder, runtime, credentialRefs, operations, signal,
  betweenPages, requireCredits,
}) {
  const run = await loadRun(pool, tenantId, runId);
  if (!run) fail('not_found');
  if (TERMINAL_RUN.has(run.state)) return run;
  const rt = runtime || createResearchRuntime({ mode: 'fixture' });
  const prior = run.continuation_state || {};
  let records = Number(prior.records || 0);
  let pages = Number(prior.pages || 0);
  let honesty = honestyFieldsFromPage({ continuation_state: prior });
  const platforms = run.requested_platforms || [];
  const progress = {};
  for (const p of platforms) {
    progress[p] = Object.assign(emptyProgress(), (prior.platform_progress && prior.platform_progress[p]) || {});
  }
  const planHashValue = prior.plan_hash || null;
  let reservationId = prior.reservation_id || null;
  const maxPages = Math.min(
    C.LIMITS.max_pages.max,
    Number((run.search_parameters && run.search_parameters.max_pages) || C.LIMITS.max_pages.max)
  );
  const writeCtx = {
    tenantId, runId, workflowId: run.workflow_id, holder,
    version: run.approval_object_version,
    approval_object_version: run.approval_object_version,
  };

  const wf = await loadWorkflowRow(pool, tenantId, run.workflow_id);
  if (wf && shouldPreflight(wf, requireCredits)) {
    reservationId = await ensureResearchReserve(pool, {
      tenantId, userId, run, workflow: wf, requireCredits,
    });
  }

  // MAX_CONCURRENCY = 1: platforms run sequentially; a failed platform does
  // not stop the remaining approved platforms.
  void MAX_CONCURRENCY;
  for (const platform of platforms) {
    const slot = progress[platform] || emptyProgress();
    if (slot.state === 'completed' || slot.state === 'failed') continue;
    const connectorId = connectorIdFor(platform);
    const credRef = credentialRefs && (credentialRefs[connectorId] || credentialRefs[platform]);
    let cursor = slot.cursor || null;
    let pageNo = Number(slot.pages || 0);
    slot.state = 'running';
    progress[platform] = slot;

    while (pageNo < maxPages) {
      if (signal && signal.aborted) {
        await settleResearchCredits(pool, tenantId, run, { commit: false });
        await updateRun(pool, tenantId, runId, {
          state: 'cancelled',
          error_code: 'cancelled',
          error_message: 'cancelled',
          continuation_state: buildContinuation({
            pages, records, cursor, connector: connectorId, planHashValue,
            progress, outcome: 'cancelled', reservationId, honesty,
          }),
        }, { requireState: 'running' });
        return loadRun(pool, tenantId, runId);
      }
      const writable = await stillWritable(pool, writeCtx);
      if (!writable) return loadRun(pool, tenantId, runId);

      const page = await rt.fetchPage({
        connector_id: connectorId,
        connector_version: (rt.connectors && rt.connectors[connectorId] && rt.connectors[connectorId].version) || '1.0.0',
        contract_version: 'v1',
        tenant_id: tenantId,
        research_run_id: runId,
        workflow_id: run.workflow_id,
        approval_id: run.approval_id,
        approval_object_version: run.approval_object_version,
        requested_platforms: run.requested_platforms,
        research_brief: run.research_brief,
        search_parameters: run.search_parameters,
        cursor,
        continuation_state: { pages, records },
        idempotency_key: `${run.idempotency_key}:${connectorId}:${pageNo}`,
      }, {
        tenantId,
        userId,
        credentialRef: credRef,
        signal,
        operation: operations && (operations[connectorId] || operations[platform]),
      });

      if (page.ok !== true) {
        const code = errorCodeOf(page);
        slot.state = 'failed';
        slot.error_code = code;
        slot.honesty_class = honestyClassOf(rt, page, slot.honesty_class);
        slot.cursor = cursor;
        progress[platform] = slot;
        await updateRun(pool, tenantId, runId, {
          continuation_state: buildContinuation({
            pages, records, cursor, connector: connectorId, planHashValue,
            progress, reservationId, honesty,
          }),
          error_code: code,
          error_message: safeErrorMessage(page.message || page.error),
          failure_class: page.error && C.FAILURE_CLASSES.includes(page.error) ? page.error : null,
        }, { requireState: 'running', holder, workflowId: run.workflow_id });
        logger.info('research_platform_failed', {
          tenant_id: tenantId, workflow_id: run.workflow_id, error_code: code,
        });
        break;
      }

      const saved = await persistPage(pool, page, {
        tenantId, runId, workflowId: run.workflow_id, holder, mode: rt.mode,
        version: run.approval_object_version,
        approval_object_version: run.approval_object_version,
      });
      if (saved.stale) return loadRun(pool, tenantId, runId);
      records += saved.records;
      pages += 1;
      pageNo += 1;
      slot.pages = pageNo;
      slot.records = Number(slot.records || 0) + saved.records;
      cursor = page.page && page.page.has_more ? page.page.next_cursor : null;
      slot.cursor = cursor;
      honesty = { ...honesty, ...honestyFieldsFromPage(page) };
      slot.honesty_class = honestyClassOf(rt, page, honesty.honesty_class || slot.honesty_class);
      progress[platform] = slot;
      const moved = await updateRun(pool, tenantId, runId, {
        continuation_state: buildContinuation({
          pages, records, cursor, connector: connectorId, planHashValue,
          progress, reservationId, honesty,
        }),
      }, { requireState: 'running', holder, workflowId: run.workflow_id });
      if (!moved) return loadRun(pool, tenantId, runId);
      if (!cursor) {
        slot.state = 'completed';
        slot.cursor = null;
        progress[platform] = slot;
        break;
      }
      if (betweenPages) await betweenPages();
    }
    if (slot.state === 'running') {
      slot.state = 'completed';
      slot.cursor = null;
      progress[platform] = slot;
    }
  }

  const states = platforms.map((p) => (progress[p] && progress[p].state) || 'pending');
  const allDone = states.every((s) => s === 'completed');
  const allFailed = states.length > 0 && states.every((s) => s === 'failed');
  const mixed = states.some((s) => s === 'completed') && states.some((s) => s === 'failed');
  let outcome = 'completed';
  let nextState = 'completed';
  const fields = { completed_at: new Date().toISOString() };
  if (allFailed) {
    outcome = 'failed';
    nextState = 'failed';
    fields.failed_at = new Date().toISOString();
    delete fields.completed_at;
    const failed = platforms.map((p) => progress[p]).find((s) => s && s.state === 'failed');
    if (failed && failed.error_code) fields.error_code = failed.error_code;
  } else if (mixed) {
    outcome = 'partially_completed';
  } else if (!allDone) {
    return loadRun(pool, tenantId, runId);
  }
  const done = await updateRun(pool, tenantId, runId, {
    state: nextState,
    ...fields,
    continuation_state: buildContinuation({
      pages, records, cursor: null, planHashValue, progress,
      outcome, reservationId, honesty,
    }),
  }, { requireState: 'running', holder, workflowId: run.workflow_id });
  await settleResearchCredits(pool, tenantId, run, { commit: nextState === 'completed' });
  return done || loadRun(pool, tenantId, runId);
}

function resolveRunPlan(wf, approval, {
  tenantId, requestedPlatforms, searchParameters, planHash: bodyHash, researchPlan,
}) {
  const stored = wf.research_plan || {};
  const storedHash = planHash(stored);
  if (bodyHash && String(bodyHash) !== storedHash) fail('approval_stale');
  if (researchPlan) {
    const incoming = validatePlan(researchPlan, {
      tenantId, creditCeilingMicros: wf.credit_ceiling_micros,
    });
    if (planHash(incoming) !== storedHash) fail('approval_stale');
  }
  if (!isEmptyPlan(stored)) {
    const plan = validatePlan(stored, {
      tenantId, creditCeilingMicros: wf.credit_ceiling_micros,
    });
    if (planHash(plan) !== storedHash) fail('approval_stale');
    const approved = asPlatforms(approval.approved_platforms);
    const platforms = intersectPlatforms(plan.requested_platforms, approved);
    if (!platforms.length) fail('approval_scope_mismatch');
    return {
      platforms,
      searchParameters: plan.search_parameters || searchParameters || {},
      planHashValue: storedHash,
    };
  }
  return {
    platforms: requestedPlatforms && requestedPlatforms.length
      ? requestedPlatforms
      : (wf.selected_platforms || []),
    searchParameters: searchParameters || {},
    planHashValue: storedHash,
  };
}

async function startResearchRun(pool, {
  tenantId, userId, workflowId, requestedPlatforms, researchBrief,
  searchParameters, idempotencyKey, credentialRefs, operations, runtime, signal,
  execute = true, requireCredits, planHash: bodyHash, researchPlan,
}) {
  const wf = await loadWorkflowRow(pool, tenantId, workflowId);
  if (!wf) fail('not_found');
  if (wf.current_state === 'cancelled') fail('workflow_cancelled');
  if (wf.current_state === 'paused') fail('workflow_paused');

  const approval = await latestApproval(pool, tenantId, workflowId, 'research_execution');
  assertApprovalFresh(wf, approval, 'research_execution');

  const resolved = resolveRunPlan(wf, approval, {
    tenantId, requestedPlatforms, searchParameters, planHash: bodyHash, researchPlan,
  });
  const refs = {};
  for (const [k, v] of Object.entries(credentialRefs || {})) {
    const ref = safeRef(v);
    if (v && !ref) fail('validation_failed');
    if (ref) refs[k] = ref;
  }

  const draft = assertResearchRun({
    id: newRunId(),
    tenant_id: tenantId,
    workflow_id: workflowId,
    approval_id: approval.id,
    approval_object_version: approval.object_version,
    requested_platforms: resolved.platforms,
    research_brief: researchBrief || '',
    search_parameters: resolved.searchParameters,
    idempotency_key: idempotencyKey,
    state: 'pending',
    continuation_state: { plan_hash: resolved.planHashValue, platform_progress: {}, outcome: null },
  }, { tenantId });

  const inserted = await pool.query(
    `INSERT INTO orchestrator_research_runs
       (id, tenant_id, workflow_id, approval_id, approval_object_version,
        requested_platforms, research_brief, search_parameters, idempotency_key, state,
        continuation_state)
     VALUES ($1,$2,$3,$4,$5,$6::text[],$7,$8::jsonb,$9,'pending',$10::jsonb)
     ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
     RETURNING *`,
    [
      draft.id, tenantId, workflowId, draft.approval_id, draft.approval_object_version,
      draft.requested_platforms, draft.research_brief, JSON.stringify(draft.search_parameters),
      draft.idempotency_key, JSON.stringify(draft.continuation_state),
    ]
  );
  let run = inserted.rows[0];
  if (!run) {
    run = (await pool.query(
      `SELECT * FROM orchestrator_research_runs WHERE tenant_id=$1 AND idempotency_key=$2`,
      [tenantId, draft.idempotency_key]
    )).rows[0];
    if (!run) fail('not_found');
    if (run.workflow_id !== workflowId) fail('idempotency_conflict');
    return { run, replay: true };
  }

  if (execute && shouldPreflight(wf, requireCredits)) {
    try {
      await ensureResearchReserve(pool, {
        tenantId, userId, run, workflow: wf, requireCredits,
      });
    } catch (err) {
      await updateRun(pool, tenantId, run.id, {
        state: 'failed',
        error_code: (err && err.code) || 'insufficient_credits',
        error_message: safeErrorMessage((err && err.code) || 'insufficient_credits'),
        failed_at: new Date().toISOString(),
      }, { requireState: 'pending' });
      throw err;
    }
  }

  const started = await updateRun(pool, tenantId, run.id, {
    state: 'running',
    started_at: new Date().toISOString(),
  }, { requireState: 'pending' });
  if (!started) return { run: await loadRun(pool, tenantId, run.id), replay: false };

  if (!execute) return { run: started, replay: false };

  let leaseHolder = null;
  try {
    const lease = await acquireLease(pool, tenantId, workflowId, { actorUserId: userId });
    leaseHolder = lease.holder;
    const finished = await executeResearchRun(pool, {
      tenantId,
      runId: started.id,
      userId,
      holder: leaseHolder,
      runtime,
      credentialRefs: refs,
      operations,
      signal,
      requireCredits,
    });
    return { run: finished, replay: false };
  } finally {
    if (leaseHolder) {
      try { await releaseLease(pool, tenantId, workflowId, leaseHolder); } catch (_) { /* ignore */ }
    }
  }
}

async function getResearchRun(pool, tenantId, runId) {
  const run = await loadRun(pool, tenantId, runId);
  if (!run) fail('not_found');
  return run;
}

async function continueResearchRun(pool, {
  tenantId, userId, runId, runtime, credentialRefs, operations, signal, requireCredits,
}) {
  const run = await loadRun(pool, tenantId, runId);
  if (!run) fail('not_found');
  if (TERMINAL_RUN.has(run.state)) return { run, replay: true };
  if (run.state !== 'running' && run.state !== 'pending') fail('invalid_transition');
  if (run.state === 'pending') {
    const started = await updateRun(pool, tenantId, runId, {
      state: 'running',
      started_at: new Date().toISOString(),
    }, { requireState: 'pending' });
    if (!started) return { run: await loadRun(pool, tenantId, runId), replay: false };
  }
  const refs = {};
  for (const [k, v] of Object.entries(credentialRefs || {})) {
    const ref = safeRef(v);
    if (v && !ref) fail('validation_failed');
    if (ref) refs[k] = ref;
  }
  let leaseHolder = null;
  try {
    const lease = await acquireLease(pool, tenantId, run.workflow_id, { actorUserId: userId });
    leaseHolder = lease.holder;
    const finished = await executeResearchRun(pool, {
      tenantId,
      runId: run.id,
      userId,
      holder: leaseHolder,
      runtime,
      credentialRefs: refs,
      operations,
      signal,
      requireCredits,
    });
    return { run: finished, replay: false };
  } finally {
    if (leaseHolder) {
      try { await releaseLease(pool, tenantId, run.workflow_id, leaseHolder); } catch (_) { /* ignore */ }
    }
  }
}

async function putResearchPlan(pool, { tenantId, userId, workflowId, body, requestId }) {
  const wf = await loadWorkflowRow(pool, tenantId, workflowId);
  if (!wf) fail('not_found');
  if (wf.current_state === 'cancelled') fail('workflow_cancelled');
  if (wf.current_state === 'paused') fail('workflow_paused');
  const plan = validatePlan(body, { tenantId, creditCeilingMicros: wf.credit_ceiling_micros });
  const material = materialChanged(wf, { ...wf, research_plan: plan });
  if (material) {
    const lease = await getLease(pool, tenantId, workflowId);
    if (!isLeaseExpired(lease)) fail('execution_in_progress');
  }
  const hadApprovals = (await pool.query(
    `SELECT 1 FROM orchestrator_approvals WHERE tenant_id=$1 AND workflow_id=$2 LIMIT 1`,
    [tenantId, workflowId]
  )).rowCount > 0;
  const invalidate = material && (hadApprovals || wf.current_state !== 'draft');
  const sets = ['research_plan=$1::jsonb', 'updated_at=now()'];
  const vals = [JSON.stringify(plan)];
  let i = 2;
  if (invalidate) {
    sets.push(
      `version=$${i++}`,
      `current_state=$${i++}`,
      `previous_state=$${i++}`,
      `current_phase=$${i++}`,
      `next_approval_gate=$${i++}`
    );
    vals.push(
      Number(wf.version) + 1,
      'research_approval_required',
      wf.current_state,
      'research',
      'research_execution'
    );
  }
  vals.push(tenantId, workflowId, Number(wf.version));
  const row = (await pool.query(
    `UPDATE orchestrator_workflows SET ${sets.join(', ')}
      WHERE tenant_id=$${i++} AND id=$${i++} AND version=$${i}
      RETURNING *`,
    vals
  )).rows[0];
  if (!row) fail('approval_stale');
  if (invalidate) {
    await insertAudit(pool, {
      tenantId,
      workflowId,
      event: 'approval_invalidated',
      actorUserId: userId,
      requestId,
      state: row.current_state,
      gate: 'research_execution',
      detail: { from: wf.current_state, to: row.current_state, version: row.version },
    });
  }
  return { plan, plan_hash: planHash(plan), workflow: row };
}

async function cancelResearchRun(pool, tenantId, runId) {
  const run = await loadRun(pool, tenantId, runId);
  if (!run) fail('not_found');
  if (run.state === 'cancelled') return run;
  if (TERMINAL_RUN.has(run.state) && run.state !== 'running') {
    if (run.state === 'completed' || run.state === 'failed') fail('invalid_transition');
  }
  const prior = run.continuation_state || {};
  const row = await updateRun(pool, tenantId, runId, {
    state: 'cancelled',
    error_code: 'cancelled',
    error_message: 'cancelled',
    completed_at: new Date().toISOString(),
    continuation_state: buildContinuation({
      pages: Number(prior.pages || 0),
      records: Number(prior.records || 0),
      cursor: prior.cursor || null,
      connector: prior.connector || null,
      planHashValue: prior.plan_hash || null,
      progress: prior.platform_progress || {},
      outcome: 'cancelled',
      reservationId: prior.reservation_id || null,
      honesty: honestyFieldsFromPage({ continuation_state: prior }),
    }),
  });
  if (!row) fail('not_found');
  try { await releaseLease(pool, tenantId, run.workflow_id, null); } catch (_) { /* ignore */ }
  await settleResearchCredits(pool, tenantId, run, { commit: false });
  return row;
}

module.exports = {
  publicRun,
  loadRun,
  startResearchRun,
  executeResearchRun,
  continueResearchRun,
  putResearchPlan,
  getResearchRun,
  cancelResearchRun,
  persistPage,
  stillWritable,
  getLease,
  MAX_CONCURRENCY,
};
