'use strict';

const crypto = require('crypto');
const { fail } = require('./errors');
const C = require('./research_contracts');
const { assertResearchRun, assertContinuationState } = require('./research_validate');
const { insertCompetitor, insertEvidenceItem } = require('./research_store');
const { assertPageHonesty, honestyFieldsFromPage } = require('./research_honesty');
const { acquireLease, heartbeatLease, releaseLease, getLease, isLeaseExpired } = require('./leases');
const { latestApproval } = require('./runner');
const { createResearchRuntime } = require('./research_runtime');
const { safeRef } = require('./research_auth');
const { sanitizeConnectorMessage } = require('./research_errors');
const { logger } = require('../infra/logger');

const TERMINAL_RUN = new Set(['completed', 'failed', 'cancelled']);
const STALE_WORKFLOW_STATES = new Set([
  'cancelled', 'paused', 'completed', 'failed', 'stopped', 'research_failed',
]);

function newRunId() {
  return `rr_${crypto.randomBytes(8).toString('hex')}`;
}

function isUnique(err) {
  return err && (err.code === '23505' || /duplicate key/i.test(String(err.message || '')));
}

function publicRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    workflow_id: row.workflow_id,
    state: row.state,
    requested_platforms: row.requested_platforms,
    continuation_state: row.continuation_state || {},
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

async function executeResearchRun(pool, {
  tenantId, runId, userId, holder, runtime, credentialRefs, operations, signal,
  betweenPages,
}) {
  const run = await loadRun(pool, tenantId, runId);
  if (!run) fail('not_found');
  if (run.state === 'cancelled') return run;
  if (run.state === 'completed') return run;
  const rt = runtime || createResearchRuntime({ mode: 'fixture' });
  let records = Number((run.continuation_state && run.continuation_state.records) || 0);
  let pages = Number((run.continuation_state && run.continuation_state.pages) || 0);
  let honesty = honestyFieldsFromPage({ continuation_state: run.continuation_state });
  const platforms = run.requested_platforms || [];
  const maxPages = Math.min(
    C.LIMITS.max_pages.max,
    Number((run.search_parameters && run.search_parameters.max_pages) || C.LIMITS.max_pages.max)
  );

  for (const platform of platforms) {
    const connectorId = connectorIdFor(platform);
    const credRef = credentialRefs && (credentialRefs[connectorId] || credentialRefs[platform]);
    let cursor = null;
    let pageNo = 0;
    while (pageNo < maxPages) {
      if (signal && signal.aborted) {
        await updateRun(pool, tenantId, runId, {
          state: 'cancelled',
          error_code: 'cancelled',
          error_message: sanitizeConnectorMessage('cancelled'),
          continuation_state: { pages, records, cursor, connector: connectorId },
        }, { requireState: 'running' });
        return loadRun(pool, tenantId, runId);
      }
      const writable = await stillWritable(pool, {
        tenantId, runId, workflowId: run.workflow_id, holder,
        version: run.approval_object_version,
        approval_object_version: run.approval_object_version,
      });
      if (!writable) return loadRun(pool, tenantId, runId);

      const page = await rt.fetchPage({
        connector_id: connectorId,
        connector_version: (rt.connectors[connectorId] && rt.connectors[connectorId].version) || '1.0.0',
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
        const failed = await updateRun(pool, tenantId, runId, {
          state: 'failed',
          failure_class: page.error,
          error_code: code,
          error_message: sanitizeConnectorMessage(page.message || page.error),
          failed_at: new Date().toISOString(),
          continuation_state: { pages, records, cursor, connector: connectorId },
        }, { requireState: 'running', holder, workflowId: run.workflow_id });
        logger.info('research_run_failed', {
          tenant_id: tenantId, workflow_id: run.workflow_id, error_code: code,
        });
        return failed || loadRun(pool, tenantId, runId);
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
      cursor = page.page && page.page.has_more ? page.page.next_cursor : null;
      honesty = { ...honesty, ...honestyFieldsFromPage(page) };
      const cont = assertContinuationState({
        pages, records, cursor, connector: connectorId, ...honesty,
      });
      const moved = await updateRun(pool, tenantId, runId, { continuation_state: cont }, {
        requireState: 'running', holder, workflowId: run.workflow_id,
      });
      if (!moved) return loadRun(pool, tenantId, runId);
      if (!cursor) break;
      if (betweenPages) await betweenPages();
    }
  }

  const done = await updateRun(pool, tenantId, runId, {
    state: 'completed',
    completed_at: new Date().toISOString(),
    continuation_state: { pages, records, cursor: null, ...honesty },
  }, { requireState: 'running', holder, workflowId: run.workflow_id });
  return done || loadRun(pool, tenantId, runId);
}

async function startResearchRun(pool, {
  tenantId, userId, workflowId, requestedPlatforms, researchBrief,
  searchParameters, idempotencyKey, credentialRefs, operations, runtime, signal,
  execute = true,
}) {
  const wf = (await pool.query(
    `SELECT * FROM orchestrator_workflows WHERE tenant_id=$1 AND id=$2`,
    [tenantId, workflowId]
  )).rows[0];
  if (!wf) fail('not_found');
  if (wf.current_state === 'cancelled') fail('workflow_cancelled');
  if (wf.current_state === 'paused') fail('workflow_paused');

  const approval = await latestApproval(pool, tenantId, workflowId, 'research_execution');
  if (!approval) fail('approval_required');

  const platforms = requestedPlatforms && requestedPlatforms.length
    ? requestedPlatforms
    : (wf.selected_platforms || []);
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
    requested_platforms: platforms,
    research_brief: researchBrief || '',
    search_parameters: searchParameters || {},
    idempotency_key: idempotencyKey,
    state: 'pending',
    continuation_state: {},
  }, { tenantId });

  const inserted = await pool.query(
    `INSERT INTO orchestrator_research_runs
       (id, tenant_id, workflow_id, approval_id, approval_object_version,
        requested_platforms, research_brief, search_parameters, idempotency_key, state)
     VALUES ($1,$2,$3,$4,$5,$6::text[],$7,$8::jsonb,$9,'pending')
     ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
     RETURNING *`,
    [
      draft.id, tenantId, workflowId, draft.approval_id, draft.approval_object_version,
      draft.requested_platforms, draft.research_brief, JSON.stringify(draft.search_parameters),
      draft.idempotency_key,
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

async function cancelResearchRun(pool, tenantId, runId) {
  const run = await loadRun(pool, tenantId, runId);
  if (!run) fail('not_found');
  if (run.state === 'cancelled') return run;
  if (TERMINAL_RUN.has(run.state) && run.state !== 'running') {
    if (run.state === 'completed' || run.state === 'failed') fail('invalid_transition');
  }
  const row = await updateRun(pool, tenantId, runId, {
    state: 'cancelled',
    error_code: 'cancelled',
    error_message: 'cancelled',
    completed_at: new Date().toISOString(),
  });
  if (!row) fail('not_found');
  try { await releaseLease(pool, tenantId, run.workflow_id, null); } catch (_) { /* ignore */ }
  return row;
}

module.exports = {
  publicRun,
  loadRun,
  startResearchRun,
  executeResearchRun,
  getResearchRun,
  cancelResearchRun,
  persistPage,
  stillWritable,
  getLease,
};
