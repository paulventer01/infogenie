'use strict';

const crypto = require('crypto');
const { fail } = require('./errors');
const { logger } = require('../infra/logger');
const { canTransition, resolveAdvanceChain, failTargetFor } = require('./states');
const { assertApprovalFresh } = require('./approvals');
const { acquireLease, heartbeatLease, releaseLease } = require('./leases');
const { HANDLERS } = require('./stubs');

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function actorId(req) {
  const n = Number(req && req.user && req.user.id);
  return Number.isInteger(n) ? n : null;
}

function isTestFail(req) {
  return process.env.NODE_ENV === 'test'
    && req
    && String((req.headers && req.headers['x-orch-test-fail']) || '') === '1';
}

function testHoldMs(req) {
  if (process.env.NODE_ENV !== 'test' || !req) return 0;
  const n = Number(req.headers && req.headers['x-orch-test-hold']);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), 5000);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function latestApproval(pool, tenantId, workflowId, gate) {
  const r = await pool.query(
    `SELECT * FROM orchestrator_approvals
      WHERE tenant_id=$1 AND workflow_id=$2 AND gate=$3 AND decision='approved'
      ORDER BY created_at DESC LIMIT 1`,
    [tenantId, workflowId, gate]
  );
  return r.rows[0] || null;
}

async function insertAudit(pool, {
  tenantId, workflowId, event, actorUserId, detail, requestId, state, gate, errorCode,
}) {
  const safe = detail && typeof detail === 'object' ? { ...detail } : {};
  delete safe.offer;
  delete safe.objective;
  delete safe.product_or_service;
  delete safe.landing_page_url;
  delete safe.comment;
  delete safe.brief;
  delete safe.source;
  delete safe.placeholder;
  delete safe._estimated;
  delete safe._fabricated;
  await pool.query(
    `INSERT INTO orchestrator_audit_events
       (tenant_id, workflow_id, event, actor_user_id, detail)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [tenantId, workflowId, event, actorUserId || null, JSON.stringify(safe)]
  );
  logger.info(event, {
    tenant_id: tenantId,
    workflow_id: workflowId,
    state: state || safe.state || null,
    gate: gate || safe.gate || null,
    actor_user_id: actorUserId || null,
    error_code: errorCode || safe.error_code || null,
    request_id: requestId || null,
  });
}

const WRITABLE = new Set([
  'name', 'objective', 'product_or_service', 'offer', 'landing_page_url',
  'target_markets', 'target_audiences', 'selected_platforms',
  'advertising_budget', 'currency', 'planned_start', 'planned_end',
  'current_state', 'previous_state', 'current_phase', 'next_approval_gate',
  'version', 'paused_at', 'paused_by_user_id', 'pause_reason',
  'cancelled_at', 'cancelled_by_user_id', 'cancel_reason',
]);
const JSONB_COLS = new Set(['target_markets', 'target_audiences', 'selected_platforms']);

async function persistWorkflow(pool, tenantId, id, fields) {
  const sets = [];
  const vals = [];
  let i = 1;
  for (const [k, v] of Object.entries(fields)) {
    if (!WRITABLE.has(k)) continue;
    if (JSONB_COLS.has(k)) {
      sets.push(`${k}=$${i++}::jsonb`);
      vals.push(typeof v === 'string' ? v : JSON.stringify(v == null ? [] : v));
    } else {
      sets.push(`${k}=$${i++}`);
      vals.push(v);
    }
  }
  if (!sets.length) {
    return loadWorkflow(pool, tenantId, id);
  }
  sets.push('updated_at=now()');
  vals.push(id, tenantId);
  const r = await pool.query(
    `UPDATE orchestrator_workflows SET ${sets.join(', ')}
      WHERE id=$${i++} AND tenant_id=$${i}
      RETURNING *`,
    vals
  );
  return r.rows[0];
}

async function loadWorkflow(pool, tenantId, id) {
  const r = await pool.query(
    `SELECT * FROM orchestrator_workflows WHERE id=$1 AND tenant_id=$2`,
    [id, tenantId]
  );
  return r.rows[0] || null;
}

async function markFailed(pool, {
  tenantId, workflow, stepId, holder, actorUserId, requestId, gate, err, failedState,
}) {
  const failedTo = failedState || failTargetFor(workflow.current_state);
  const retryClass = (err && err.retry_class) || 'terminal';
  const errorCode = (err && err.code) || 'phase_failed';
  let next = workflow;
  try {
    next = await persistWorkflow(pool, tenantId, workflow.id, {
      current_state: failedTo,
      previous_state: workflow.current_state,
    });
  } catch (_) { /* keep */ }
  try {
    if (stepId) {
      await pool.query(
        `UPDATE orchestrator_steps
            SET state='failed', error_code=$1, retry_class=$2, completed_at=now()
          WHERE id=$3 AND tenant_id=$4`,
        [errorCode, retryClass, stepId, tenantId]
      );
    }
  } catch (_) { /* ignore */ }
  try {
    await insertAudit(pool, {
      tenantId,
      workflowId: workflow.id,
      event: 'phase_failed',
      actorUserId,
      requestId,
      state: next && next.current_state,
      gate,
      errorCode,
      detail: { error_code: errorCode, retry_class: retryClass, gate },
    });
  } catch (_) { /* ignore */ }
  try { await releaseLease(pool, tenantId, workflow.id, holder); } catch (_) { /* ignore */ }
  return next;
}

async function advanceWorkflow(pool, { tenantId, workflowId, req }) {
  const actorUserId = actorId(req);
  const requestId = req && req.requestId;

  let workflow = await loadWorkflow(pool, tenantId, workflowId);
  if (!workflow) fail('not_found');
  if (workflow.current_state === 'cancelled') fail('workflow_cancelled');
  if (workflow.current_state === 'paused') fail('workflow_paused');

  const check = canTransition(workflow.current_state, 'advance', {
    current_phase: workflow.current_phase,
    phase: workflow.current_phase,
  });
  if (!check.ok) fail(check.code);

  const plan = resolveAdvanceChain(workflow);
  if (!plan || !plan.steps || !plan.steps.length) fail('invalid_transition');

  const gate = plan.requiredGate;
  const approval = await latestApproval(pool, tenantId, workflow.id, gate);
  assertApprovalFresh(workflow, approval, gate);

  const acquired = await acquireLease(pool, tenantId, workflow.id, {
    actorUserId,
    requestId,
  });
  workflow = acquired.workflow;
  const holder = acquired.holder;

  const startIdx = plan.fromIndex + 1;
  const remaining = plan.steps.slice(startIdx);
  if (!remaining.length) {
    await releaseLease(pool, tenantId, workflow.id, holder);
    fail('invalid_transition');
  }

  const stepId = newId('os');
  const first = remaining[0];
  const phase = first.phase || workflow.current_phase;

  try {
    await pool.query(
      `INSERT INTO orchestrator_steps
         (id, tenant_id, workflow_id, phase, agent_type, state, attempt_number,
          object_version, input_ref, lease_id, started_at, heartbeat_at)
       VALUES ($1,$2,$3,$4,$5,'running',1,$6,$7::jsonb,$8,now(),now())`,
      [
        stepId,
        tenantId,
        workflow.id,
        phase,
        plan.name,
        workflow.version,
        JSON.stringify({
          version: workflow.version,
          gate,
          platforms: workflow.selected_platforms,
        }),
        String(acquired.lease.id),
      ]
    );

    await insertAudit(pool, {
      tenantId,
      workflowId: workflow.id,
      event: 'phase_started',
      actorUserId,
      requestId,
      state: first.to,
      gate,
      detail: { from: workflow.current_state, to: first.to, gate, phase, step_id: stepId },
    });

    const hold = testHoldMs(req);
    if (hold) await sleep(hold);
    await heartbeatLease(pool, tenantId, workflow.id, holder);

    if (isTestFail(req)) {
      const forced = new Error('test_forced_failure');
      forced.code = 'phase_failed';
      forced.retry_class = 'terminal';
      return await markFailed(pool, {
        tenantId, workflow, stepId, holder, actorUserId, requestId, gate, err: forced,
        failedState: failTargetFor(first.to),
      });
    }

    const handler = HANDLERS[plan.name] || HANDLERS.research;
    const out = await handler({ workflow, approval, gate });
    const outputRef = {
      stub: true,
      agent_id: (out && (out.output_ref && out.output_ref.agent_id || out.agent_id)) || plan.name,
      note: 'PR 1 stub — not live research/creatives/campaigns/performance',
    };

    let stopAt = remaining[remaining.length - 1];
    for (const step of remaining) {
      stopAt = step;
      if (step.stop) break;
    }

    workflow = await persistWorkflow(pool, tenantId, workflow.id, {
      current_state: stopAt.to,
      previous_state: first.to,
      current_phase: stopAt.phase || phase,
      next_approval_gate: stopAt.nextGate || null,
    });

    await pool.query(
      `UPDATE orchestrator_steps
          SET state='completed', output_ref=$1::jsonb, completed_at=now(), heartbeat_at=now()
        WHERE id=$2 AND tenant_id=$3`,
      [JSON.stringify(outputRef), stepId, tenantId]
    );

    await insertAudit(pool, {
      tenantId,
      workflowId: workflow.id,
      event: 'phase_completed',
      actorUserId,
      requestId,
      state: workflow.current_state,
      gate: workflow.next_approval_gate,
      detail: {
        from: first.to,
        to: workflow.current_state,
        gate: workflow.next_approval_gate,
        phase: workflow.current_phase,
        stub: true,
      },
    });

    await releaseLease(pool, tenantId, workflow.id, holder);
    return workflow;
  } catch (err) {
    await markFailed(pool, {
      tenantId, workflow, stepId, holder, actorUserId, requestId, gate, err,
      failedState: failTargetFor(first.to),
    });
    throw err;
  }
}

module.exports = {
  newId,
  actorId,
  loadWorkflow,
  persistWorkflow,
  insertAudit,
  latestApproval,
  advanceWorkflow,
};
