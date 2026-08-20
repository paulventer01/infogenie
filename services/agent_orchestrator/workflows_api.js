'use strict';

const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { requirePermission } = require('../tenants/permission_enforce');
const { OrchError, fail, sendError, sendOrchError, HTTP_FOR_CODE } = require('./errors');
const {
  GATES, GATE_PERMISSION, PERMS, FAILED_STATES, GATE_FOR_APPROVED,
  applyTransition, retryStateFor,
} = require('./states');
const {
  asNumber, asPlatforms, platformsAllowlisted,
  contentHash, validateApproveScope, materialChanged,
} = require('./approvals');
const {
  extractIdempotencyKey, requestHashFrom, endpointOf, runIdempotent,
} = require('./idempotency');
const { forceReleaseLease, getLease, isLeaseExpired } = require('./leases');
const {
  newId, actorId, loadWorkflow, persistWorkflow, insertAudit, latestApproval, advanceWorkflow,
} = require('./runner');
const { isPlatformAdmin } = require('../tenants/permission_enforce');

const MAX_BYTES = 64 * 1024;
const BUDGET_CAP = 1e9;
// Free-text brief fields are hashed into every approval and copied into the
// idempotency response body, so they are capped per field rather than relying
// on the 64kb whole-body cap alone.
const MAX_TEXT = 4000;
const APPROVAL_OBJECT_TYPES = Object.freeze(['workflow']);

// execution_in_progress: a live unexpired execution lease exists for this
// tenant+workflow. Material PATCH and other mutations that change bound
// fields or current_state (except pause/cancel/recover, which may
// force-release) must refuse rather than race the in-flight runner.
// Distinct from lease_conflict, which is "this caller lost the lease".
async function assertNoLiveExecution(pool, tenantId, workflowId) {
  const lease = await getLease(pool, tenantId, workflowId);
  if (!isLeaseExpired(lease)) fail('execution_in_progress');
}

function capPayload(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const cl = Number(req.headers['content-length']);
  if (Number.isFinite(cl) && cl > MAX_BYTES) return sendError(res, 413, 'payload_too_large');
  if (req.rawBody != null) {
    const n = Buffer.byteLength(typeof req.rawBody === 'string' ? req.rawBody : String(req.rawBody), 'utf8');
    if (n > MAX_BYTES) return sendError(res, 413, 'payload_too_large');
  }
  next();
}

function validateHttpsUrl(raw) {
  const s = String(raw || '').trim();
  if (!s || s.length > 2048) return false;
  let u;
  try { u = new URL(s); } catch (_) { return false; }
  if (u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  if (!u.hostname) return false;
  return true;
}

function strArr(v, maxItems, maxLen) {
  if (v == null) return [];
  if (!Array.isArray(v)) fail('validation_failed');
  if (v.length > maxItems) fail('validation_failed');
  return v.map((x) => {
    const s = String(x == null ? '' : x).trim();
    if (s.length > maxLen) fail('validation_failed');
    return s;
  }).filter(Boolean);
}

function text(v, max = MAX_TEXT) {
  const s = String(v == null ? '' : v);
  if (s.length > max) fail('validation_failed');
  return s;
}

function uniquePlatforms(list) {
  const seen = new Set();
  const out = [];
  for (const p of list) {
    if (!seen.has(p)) { seen.add(p); out.push(p); }
  }
  return out;
}

function optionalTime(v) {
  if (v == null || v === '') return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) fail('validation_failed');
  return d.toISOString();
}

function parseCreate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('validation_failed');
  const name = String(body.name || '').trim();
  if (!name || name.length > 200) fail('validation_failed');
  const landing = String(body.landing_page_url || '').trim();
  if (!validateHttpsUrl(landing)) fail('validation_failed');
  const selected = uniquePlatforms(asPlatforms(body.selected_platforms));
  if (!platformsAllowlisted(selected)) fail('validation_failed');
  const budget = asNumber(body.advertising_budget);
  if (budget == null || budget < 0 || budget > BUDGET_CAP) fail('validation_failed');
  const currency = String(body.currency || 'USD').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) fail('validation_failed');
  return {
    name,
    objective: text(body.objective),
    product_or_service: text(body.product_or_service),
    offer: text(body.offer),
    landing_page_url: landing,
    target_markets: strArr(body.target_markets, 50, 200),
    target_audiences: strArr(body.target_audiences, 50, 200),
    selected_platforms: selected,
    advertising_budget: budget,
    currency,
    planned_start: optionalTime(body.planned_start),
    planned_end: optionalTime(body.planned_end),
  };
}

function publicWorkflow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    objective: row.objective,
    product_or_service: row.product_or_service,
    offer: row.offer,
    landing_page_url: row.landing_page_url,
    target_markets: row.target_markets,
    target_audiences: row.target_audiences,
    selected_platforms: row.selected_platforms,
    advertising_budget: asNumber(row.advertising_budget),
    currency: row.currency,
    planned_start: row.planned_start,
    planned_end: row.planned_end,
    current_state: row.current_state,
    previous_state: row.previous_state,
    current_phase: row.current_phase,
    next_approval_gate: row.next_approval_gate,
    version: Number(row.version) || 1,
    created_by_user_id: row.created_by_user_id,
    paused_at: row.paused_at,
    cancelled_at: row.cancelled_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function publicApproval(row) {
  return {
    id: row.id,
    workflow_id: row.workflow_id,
    gate: row.gate,
    object_type: row.object_type,
    object_id: row.object_id,
    object_version: Number(row.object_version),
    content_hash: row.content_hash,
    approved_platforms: row.approved_platforms,
    approved_advertising_budget: asNumber(row.approved_advertising_budget),
    approved_credit_ceiling: asNumber(row.approved_credit_ceiling),
    actor_user_id: row.actor_user_id,
    decision: row.decision,
    comment: row.comment,
    created_at: row.created_at,
  };
}

async function mustLoad(pool, tid, id) {
  const wf = await loadWorkflow(pool, tid, id);
  if (!wf) fail('not_found');
  return wf;
}

function assertMutable(workflow, { resume = false, cancel = false } = {}) {
  if (workflow.current_state === 'cancelled' && !cancel) fail('workflow_cancelled');
  if (workflow.current_state === 'completed' && !cancel) fail('invalid_transition');
  if (workflow.current_state === 'paused' && !resume && !cancel) fail('workflow_paused');
}

function guardPerm(req, res, key) {
  if (!key) {
    sendError(res, 400, 'validation_failed');
    return false;
  }
  let allowed = false;
  requirePermission(key)(req, res, () => { allowed = true; });
  return allowed;
}

// Approvals are the spend-authorisation record, so the trail has to say which
// authority was exercised. Platform owners/admins bypass req.can(), which would
// otherwise store an empty snapshot for the most privileged approver there is.
function permissionSnapshot(req, requiredKey) {
  const keys = new Set(Array.from(req.permissions || []).map(String));
  if (isPlatformAdmin(req)) {
    keys.add('platform_admin_bypass');
    if (requiredKey) keys.add(String(requiredKey));
  }
  return Array.from(keys).sort();
}

function mutation(action, permissionFn, handler) {
  return async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ ok: false, error: 'auth_required' });
      const tid = await _tenantCtx.resolveTenantId(req, { label: `orch-wf:${action}` });
      if (!tid) return sendError(res, 400, 'validation_failed');
      const perm = typeof permissionFn === 'function' ? permissionFn(req) : permissionFn;
      if (!guardPerm(req, res, perm)) return;
      const key = extractIdempotencyKey(req);
      if (!key) return sendError(res, 400, 'validation_failed');
      if (!_db.hasDb()) return sendError(res, 503, 'validation_failed');
      const pool = _db.getPool();
      // Every mutation writes actor_user_id into an immutable audit row. An
      // unattributable principal (no session user id) must not move a workflow.
      const userId = actorId(req);
      if (!userId) return sendError(res, 400, 'validation_failed');
      const result = await runIdempotent(pool, {
        tenantId: tid,
        key,
        endpoint: endpointOf(req),
        action,
        requestHash: requestHashFrom(req),
        actorUserId: userId,
        requestId: req.requestId,
        async fn() {
          return handler(req, tid, userId, pool);
        },
      });
      if (result.replay) {
        const wfId = result.body && result.body.workflow && result.body.workflow.id;
        if (wfId) {
          try {
            await insertAudit(pool, {
              tenantId: tid,
              workflowId: wfId,
              event: 'idempotent_replay',
              actorUserId: userId,
              requestId: req.requestId,
              detail: { action },
            });
          } catch (_) { /* replay audit is best-effort */ }
        }
      }
      if (res.headersSent) return;
      return res.status(result.status).json(result.body);
    } catch (err) {
      return sendCaught(res, err);
    }
  };
}

function sendCaught(res, err) {
  if (res.headersSent) return;
  if (err instanceof OrchError || (err && err.code && HTTP_FOR_CODE[err.code])) {
    return sendOrchError(res, err);
  }
  // Postgres error text can quote the offending value (a brief, an offer), so
  // only the driver's error class is logged — never err.message.
  console.error('[orch-wf] unhandled', (err && err.name) || 'Error', (err && err.code) || '');
  return sendError(res, 500, 'internal_error');
}

async function readHandler(req, res, { permission = PERMS.view, offline = null } = {}, fn) {
  try {
    if (!req.user) return res.status(401).json({ ok: false, error: 'auth_required' });
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'orch-wf:read' });
    if (!tid) return sendError(res, 400, 'validation_failed');
    if (!guardPerm(req, res, permission)) return;
    if (!_db.hasDb()) {
      return offline ? res.json(offline) : sendError(res, 404, 'not_found');
    }
    return await fn(req, res, tid, _db.getPool());
  } catch (err) {
    return sendCaught(res, err);
  }
}

function jsonb(v) {
  return JSON.stringify(v == null ? [] : v);
}

router.use(capPayload);

router.post('/', mutation('create', PERMS.create, async (req, tid, userId, pool) => {
  if (!userId) fail('validation_failed');
  const data = parseCreate(req.body || {});
  const id = newId('ow');
  const row = (await pool.query(
    `INSERT INTO orchestrator_workflows (
       id, tenant_id, name, objective, product_or_service, offer, landing_page_url,
       target_markets, target_audiences, selected_platforms, advertising_budget, currency,
       planned_start, planned_end, current_state, current_phase, next_approval_gate,
       version, created_by_user_id
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13,$14,
       'draft','research','research_execution',1,$15
     ) RETURNING *`,
    [
      id, tid, data.name, data.objective, data.product_or_service, data.offer, data.landing_page_url,
      jsonb(data.target_markets), jsonb(data.target_audiences), jsonb(data.selected_platforms),
      data.advertising_budget, data.currency, data.planned_start, data.planned_end, userId,
    ]
  )).rows[0];
  await insertAudit(pool, {
    tenantId: tid,
    workflowId: id,
    event: 'workflow_created',
    actorUserId: userId,
    requestId: req.requestId,
    state: 'draft',
    gate: 'research_execution',
    detail: { state: 'draft', gate: 'research_execution' },
  });
  return { status: 201, body: { ok: true, workflow: publicWorkflow(row) } };
}));

router.get('/', (req, res) => readHandler(req, res, {
  offline: { ok: true, workflows: [] },
}, async (_req, res2, tid, pool) => {
  const r = await pool.query(
    `SELECT * FROM orchestrator_workflows WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100`,
    [tid]
  );
  return res2.json({ ok: true, workflows: r.rows.map(publicWorkflow) });
}));

// The audit trail is a separate read authority from the workflow itself: it
// names who approved which gate, so it is gated on orchestrator.workflows
// .audit.view rather than the coarse .view that covers state and approvals.
router.get('/:id/timeline', (req, res) => readHandler(req, res, {
  permission: PERMS.auditView,
}, async (req2, res2, tid, pool) => {
  await mustLoad(pool, tid, req2.params.id);
  const r = await pool.query(
    `SELECT id, event, actor_user_id, detail, created_at
       FROM orchestrator_audit_events
      WHERE tenant_id=$1 AND workflow_id=$2
      ORDER BY created_at ASC, id ASC`,
    [tid, req2.params.id]
  );
  return res2.json({ ok: true, events: r.rows });
}));

router.get('/:id/approvals', (req, res) => readHandler(req, res, {}, async (req2, res2, tid, pool) => {
  await mustLoad(pool, tid, req2.params.id);
  const r = await pool.query(
    `SELECT * FROM orchestrator_approvals
      WHERE tenant_id=$1 AND workflow_id=$2
      ORDER BY created_at ASC, id ASC`,
    [tid, req2.params.id]
  );
  return res2.json({ ok: true, approvals: r.rows.map(publicApproval) });
}));

router.get('/:id/steps', (req, res) => readHandler(req, res, {}, async (req2, res2, tid, pool) => {
  await mustLoad(pool, tid, req2.params.id);
  const r = await pool.query(
    `SELECT id, phase, agent_type, state, attempt_number, object_version,
            output_ref, error_code, retry_class, started_at, completed_at, created_at
       FROM orchestrator_steps
      WHERE tenant_id=$1 AND workflow_id=$2
      ORDER BY created_at ASC`,
    [tid, req2.params.id]
  );
  return res2.json({ ok: true, steps: r.rows });
}));

router.get('/:id', (req, res) => readHandler(req, res, {}, async (req2, res2, tid, pool) => {
  const wf = await mustLoad(pool, tid, req2.params.id);
  return res2.json({ ok: true, workflow: publicWorkflow(wf) });
}));

router.patch('/:id', mutation('edit', PERMS.edit, async (req, tid, userId, pool) => {
  const wf = await mustLoad(pool, tid, req.params.id);
  assertMutable(wf);
  const body = req.body || {};
  const next = {
    name: body.name != null ? String(body.name).trim() : wf.name,
    objective: body.objective != null ? text(body.objective) : wf.objective,
    product_or_service: body.product_or_service != null ? text(body.product_or_service) : wf.product_or_service,
    offer: body.offer != null ? text(body.offer) : wf.offer,
    landing_page_url: body.landing_page_url != null ? String(body.landing_page_url).trim() : wf.landing_page_url,
    target_markets: body.target_markets != null ? strArr(body.target_markets, 50, 200) : wf.target_markets,
    target_audiences: body.target_audiences != null ? strArr(body.target_audiences, 50, 200) : wf.target_audiences,
    selected_platforms: body.selected_platforms != null
      ? uniquePlatforms(asPlatforms(body.selected_platforms))
      : asPlatforms(wf.selected_platforms),
    advertising_budget: body.advertising_budget != null ? asNumber(body.advertising_budget) : asNumber(wf.advertising_budget),
    currency: body.currency != null ? String(body.currency).trim().toUpperCase() : wf.currency,
    planned_start: body.planned_start !== undefined ? optionalTime(body.planned_start) : wf.planned_start,
    planned_end: body.planned_end !== undefined ? optionalTime(body.planned_end) : wf.planned_end,
  };
  if (!next.name || next.name.length > 200) fail('validation_failed');
  if (!validateHttpsUrl(next.landing_page_url)) fail('validation_failed');
  if (!platformsAllowlisted(next.selected_platforms)) fail('validation_failed');
  if (next.advertising_budget == null || next.advertising_budget < 0 || next.advertising_budget > BUDGET_CAP) {
    fail('validation_failed');
  }
  if (!/^[A-Z]{3}$/.test(String(next.currency || ''))) fail('validation_failed');

  const material = materialChanged(wf, next);
  if (material) await assertNoLiveExecution(pool, tid, wf.id);
  const hadApprovals = (await pool.query(
    `SELECT 1 FROM orchestrator_approvals WHERE tenant_id=$1 AND workflow_id=$2 LIMIT 1`,
    [tid, wf.id]
  )).rowCount > 0;

  const fields = {
    name: next.name,
    objective: next.objective,
    product_or_service: next.product_or_service,
    offer: next.offer,
    landing_page_url: next.landing_page_url,
    target_markets: next.target_markets,
    target_audiences: next.target_audiences,
    selected_platforms: next.selected_platforms,
    advertising_budget: next.advertising_budget,
    currency: next.currency,
    planned_start: next.planned_start,
    planned_end: next.planned_end,
  };

  if (material && (hadApprovals || wf.current_state !== 'draft')) {
    fields.version = Number(wf.version) + 1;
    fields.current_state = 'research_approval_required';
    fields.previous_state = wf.current_state;
    fields.current_phase = 'research';
    fields.next_approval_gate = 'research_execution';
  } else if (material && hadApprovals) {
    fields.version = Number(wf.version) + 1;
    fields.current_state = 'research_approval_required';
    fields.next_approval_gate = 'research_execution';
  }

  // Guarded on the row this handler validated. Without it a cancel or pause that
  // lands between the read above and this write is silently reverted, and two
  // concurrent edits both settle on the same `version`.
  const row = await persistWorkflow(pool, tid, wf.id, fields, {
    expectedVersion: Number(wf.version),
    expectedState: wf.current_state,
  });
  if (material && (hadApprovals || wf.current_state !== 'draft')) {
    await insertAudit(pool, {
      tenantId: tid,
      workflowId: wf.id,
      event: 'approval_invalidated',
      actorUserId: userId,
      requestId: req.requestId,
      state: row.current_state,
      gate: 'research_execution',
      detail: { from: wf.current_state, to: row.current_state, version: row.version },
    });
  }
  return { status: 200, body: { ok: true, workflow: publicWorkflow(row) } };
}));

router.post('/:id/request-approval', mutation('request_approval', PERMS.request, async (req, tid, userId, pool) => {
  const wf = await mustLoad(pool, tid, req.params.id);
  assertMutable(wf);
  await assertNoLiveExecution(pool, tid, wf.id);
  const gate = String((req.body && req.body.gate) || '').trim();
  if (!GATES.includes(gate)) fail('validation_failed');
  if (wf.current_state === 'draft') {
    if (gate !== 'research_execution') fail('approval_scope_mismatch');
  } else if (wf.next_approval_gate && wf.next_approval_gate !== gate) {
    fail('approval_scope_mismatch');
  }
  const applied = applyTransition(wf.current_state, 'request_approval', { gate });
  const row = await persistWorkflow(pool, tid, wf.id, {
    current_state: applied.to,
    previous_state: wf.current_state,
    next_approval_gate: applied.nextGate || gate,
    current_phase: applied.phase || wf.current_phase,
  }, { expectedState: wf.current_state });
  await insertAudit(pool, {
    tenantId: tid,
    workflowId: wf.id,
    event: 'approval_requested',
    actorUserId: userId,
    requestId: req.requestId,
    state: row.current_state,
    gate,
    detail: { from: wf.current_state, to: row.current_state, gate },
  });
  return { status: 200, body: { ok: true, workflow: publicWorkflow(row) } };
}));

function gatePermFromBody(req) {
  const gate = String((req.body && req.body.gate) || '').trim();
  return GATE_PERMISSION[gate] || null;
}

async function decide(req, tid, userId, pool, decision) {
  const wf = await mustLoad(pool, tid, req.params.id);
  assertMutable(wf);
  if (decision === 'approved') await assertNoLiveExecution(pool, tid, wf.id);
  const body = req.body || {};
  const gate = String(body.gate || '').trim();
  if (!GATES.includes(gate)) fail('validation_failed');
  const applied = applyTransition(wf.current_state, decision === 'approved' ? 'approve' : 'reject', { gate });

  if (decision === 'approved') {
    // object_version is mandatory on approve: it is the approver's statement of
    // WHICH revision they read. Treating it as optional would let a client
    // approve blind and skip the stale check entirely.
    const claimedVersion = Number(body.object_version);
    if (!Number.isInteger(claimedVersion)) fail('validation_failed');
    if (claimedVersion !== Number(wf.version)) fail('approval_stale');
    if (body.object_id && String(body.object_id) !== String(wf.id)) fail('approval_scope_mismatch');
    if (body.object_type != null && !APPROVAL_OBJECT_TYPES.includes(String(body.object_type))) {
      fail('validation_failed');
    }
    const scope = validateApproveScope(wf, {
      platforms: body.platforms || body.approved_platforms,
      advertising_budget: body.advertising_budget,
      credit_ceiling: body.credit_ceiling,
      gate,
    });
    const hash = contentHash(wf, gate);
    const comment = body.comment != null ? String(body.comment).slice(0, 500) : null;
    const snapshot = permissionSnapshot(req, GATE_PERMISSION[gate]);
    const approval = (await pool.query(
      `INSERT INTO orchestrator_approvals (
         tenant_id, workflow_id, gate, object_type, object_id, object_version,
         content_hash, approved_platforms, approved_advertising_budget, approved_credit_ceiling,
         actor_user_id, decision, comment, permission_snapshot
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14::jsonb
       ) RETURNING *`,
      [
        tid, wf.id, gate,
        'workflow',
        String(body.object_id || wf.id),
        wf.version,
        hash,
        JSON.stringify(scope.approved),
        scope.approvedBudget,
        scope.ceiling,
        userId,
        'approved',
        comment,
        JSON.stringify(snapshot),
      ]
    )).rows[0];
    // The approval row above records what this approver decided; the state only
    // moves if the row is still the revision they approved. A cancel, pause or
    // version-bumping edit that landed in between refuses here instead of being
    // overwritten, and the stored approval cannot release the phase on its own
    // (advance re-checks gate, version and content_hash).
    const row = await persistWorkflow(pool, tid, wf.id, {
      current_state: applied.to,
      previous_state: wf.current_state,
      next_approval_gate: applied.nextGate || gate,
      current_phase: applied.phase || wf.current_phase,
    }, { expectedVersion: Number(wf.version), expectedState: wf.current_state });
    await insertAudit(pool, {
      tenantId: tid,
      workflowId: wf.id,
      event: 'approval_granted',
      actorUserId: userId,
      requestId: req.requestId,
      state: row.current_state,
      gate,
      detail: { from: wf.current_state, to: row.current_state, gate, version: wf.version },
    });
    return { status: 200, body: { ok: true, workflow: publicWorkflow(row), approval: publicApproval(approval) } };
  }

  const comment = body.comment != null ? String(body.comment).slice(0, 500) : null;
  const hash = contentHash(wf, gate);
  const approval = (await pool.query(
    `INSERT INTO orchestrator_approvals (
       tenant_id, workflow_id, gate, object_type, object_id, object_version,
       content_hash, approved_platforms, approved_advertising_budget,
       actor_user_id, decision, comment, permission_snapshot
     ) VALUES (
       $1,$2,$3,'workflow',$4,$5,$6,'[]'::jsonb,NULL,$7,'rejected',$8,$9::jsonb
     ) RETURNING *`,
    [tid, wf.id, gate, wf.id, wf.version, hash, userId, comment,
      JSON.stringify(permissionSnapshot(req, GATE_PERMISSION[gate]))]
  )).rows[0];
  await insertAudit(pool, {
    tenantId: tid,
    workflowId: wf.id,
    event: 'approval_rejected',
    actorUserId: userId,
    requestId: req.requestId,
    state: wf.current_state,
    gate,
    detail: { from: wf.current_state, to: applied.to, gate },
  });
  return { status: 200, body: { ok: true, workflow: publicWorkflow(wf), approval: publicApproval(approval) } };
}

router.post('/:id/approve', mutation('approve', gatePermFromBody, (req, tid, userId, pool) => decide(req, tid, userId, pool, 'approved')));
router.post('/:id/reject', mutation('reject', gatePermFromBody, (req, tid, userId, pool) => decide(req, tid, userId, pool, 'rejected')));

router.post('/:id/advance', mutation('advance', PERMS.edit, async (req, tid, userId, pool) => {
  const wf = await mustLoad(pool, tid, req.params.id);
  assertMutable(wf);
  const next = await advanceWorkflow(pool, { tenantId: tid, workflowId: wf.id, req });
  return { status: 200, body: { ok: true, workflow: publicWorkflow(next) } };
}));

router.post('/:id/pause', mutation('pause', PERMS.pause, async (req, tid, userId, pool) => {
  const wf = await mustLoad(pool, tid, req.params.id);
  if (wf.current_state === 'cancelled') fail('workflow_cancelled');
  applyTransition(wf.current_state, 'pause');
  // Pause is the stop order, so it does not take the lease — but it must not
  // rewind the workflow either. previous_state is copied from the row inside the
  // UPDATE: reading it above and writing it back would let a phase that
  // completed in between be replayed by a later resume on the same approval,
  // which is `recover` authority (owner/admin), not `resume`.
  const reason = req.body && req.body.reason != null ? String(req.body.reason).slice(0, 200) : null;
  const updated = await pool.query(
    `UPDATE orchestrator_workflows
        SET previous_state=current_state, current_state='paused',
            paused_at=now(), paused_by_user_id=$1, pause_reason=$2, updated_at=now()
      WHERE id=$3 AND tenant_id=$4
        AND current_state NOT IN ('paused', 'cancelled', 'completed')
      RETURNING *`,
    [userId, reason, wf.id, tid]
  );
  if (!updated.rowCount) {
    const live = await loadWorkflow(pool, tid, wf.id);
    if (!live) fail('not_found');
    if (live.current_state === 'cancelled') fail('workflow_cancelled');
    fail('invalid_transition');
  }
  const row = updated.rows[0];
  await insertAudit(pool, {
    tenantId: tid,
    workflowId: wf.id,
    event: 'workflow_paused',
    actorUserId: userId,
    requestId: req.requestId,
    state: 'paused',
    detail: { from: row.previous_state, to: 'paused' },
  });
  return { status: 200, body: { ok: true, workflow: publicWorkflow(row) } };
}));

router.post('/:id/resume', mutation('resume', PERMS.resume, async (req, tid, userId, pool) => {
  const wf = await mustLoad(pool, tid, req.params.id);
  if (wf.current_state === 'cancelled') fail('workflow_cancelled');
  await assertNoLiveExecution(pool, tid, wf.id);
  const applied = applyTransition(wf.current_state, 'resume', { previousState: wf.previous_state });
  // 'paused' is resume's precondition, so requiring it here is what stops a
  // resume from lifting a cancel that landed after the read above.
  const row = await persistWorkflow(pool, tid, wf.id, {
    current_state: applied.to,
    previous_state: 'paused',
    paused_at: null,
    paused_by_user_id: null,
    pause_reason: null,
  }, { expectedState: 'paused' });
  await insertAudit(pool, {
    tenantId: tid,
    workflowId: wf.id,
    event: 'workflow_resumed',
    actorUserId: userId,
    requestId: req.requestId,
    state: row.current_state,
    gate: row.next_approval_gate,
    detail: { from: 'paused', to: row.current_state },
  });
  return { status: 200, body: { ok: true, workflow: publicWorkflow(row) } };
}));

router.post('/:id/cancel', mutation('cancel', PERMS.cancel, async (req, tid, userId, pool) => {
  const wf = await mustLoad(pool, tid, req.params.id);
  applyTransition(wf.current_state, 'cancel');
  await forceReleaseLease(pool, tid, wf.id);
  const row = await persistWorkflow(pool, tid, wf.id, {
    current_state: 'cancelled',
    previous_state: wf.current_state,
    cancelled_at: new Date().toISOString(),
    cancelled_by_user_id: userId,
    cancel_reason: req.body && req.body.reason != null ? String(req.body.reason).slice(0, 200) : null,
  });
  await insertAudit(pool, {
    tenantId: tid,
    workflowId: wf.id,
    event: 'workflow_cancelled',
    actorUserId: userId,
    requestId: req.requestId,
    state: 'cancelled',
    detail: { from: wf.current_state, to: 'cancelled' },
  });
  return { status: 200, body: { ok: true, workflow: publicWorkflow(row) } };
}));

router.post('/:id/recover', mutation('recover', PERMS.recover, async (req, tid, userId, pool) => {
  const wf = await mustLoad(pool, tid, req.params.id);
  if (wf.current_state === 'cancelled' || wf.current_state === 'completed') fail('recovery_not_allowed');
  await forceReleaseLease(pool, tid, wf.id);

  if (!FAILED_STATES.includes(wf.current_state)) {
    const lease = await getLease(pool, tid, wf.id);
    await insertAudit(pool, {
      tenantId: tid,
      workflowId: wf.id,
      event: 'workflow_recovered',
      actorUserId: userId,
      requestId: req.requestId,
      state: wf.current_state,
      detail: { lease_cleared: true, expired: isLeaseExpired(lease) },
    });
    const fresh = await loadWorkflow(pool, tid, wf.id);
    return { status: 200, body: { ok: true, workflow: publicWorkflow(fresh), lease_cleared: true } };
  }

  const retry = retryStateFor(wf);
  if (!retry) fail('recovery_not_allowed');
  const gate = GATE_FOR_APPROVED[retry];
  if (gate) {
    const approval = await latestApproval(pool, tid, wf.id, gate);
    try {
      const { assertApprovalFresh } = require('./approvals');
      assertApprovalFresh(wf, approval, gate);
    } catch (e) {
      fail('recovery_not_allowed');
    }
  }
  const applied = applyTransition(wf.current_state, 'recover', { previousState: retry, retryState: retry });
  const row = await persistWorkflow(pool, tid, wf.id, {
    current_state: applied.to,
    previous_state: wf.current_state,
  }, { expectedState: wf.current_state });
  await insertAudit(pool, {
    tenantId: tid,
    workflowId: wf.id,
    event: 'workflow_recovered',
    actorUserId: userId,
    requestId: req.requestId,
    state: row.current_state,
    gate,
    detail: { from: wf.current_state, to: row.current_state, gate },
  });
  return { status: 200, body: { ok: true, workflow: publicWorkflow(row) } };
}));

module.exports = router;
