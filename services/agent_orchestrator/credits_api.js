'use strict';

const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { requirePermission } = require('../tenants/permission_enforce');
const { OrchError, fail, sendError, sendOrchError, HTTP_FOR_CODE } = require('./errors');
const {
  extractIdempotencyKey, requestHashFrom, endpointOf, runIdempotent,
} = require('./idempotency');
const { actorId } = require('./runner');
const {
  fromPg, microsToJson, requirePositiveMicros, dollarsToMicros, toBigInt, toSql,
} = require('./money');
const credits = require('./credits');
const { ensureLimits, updateLimits, utcDayStart, utcMonthStart, sumFinalUsage } = require('./limits');
const { listCatalog } = require('./pricing');

const PERMS = Object.freeze({
  view: 'orchestrator.credits.view',
  grant: 'orchestrator.credits.grant',
  adjust: 'orchestrator.credits.adjust',
  limitsView: 'orchestrator.credits.limits.view',
  limitsEdit: 'orchestrator.credits.limits.edit',
});

function guardPerm(req, res, key) {
  if (!key) {
    sendError(res, 400, 'validation_failed');
    return false;
  }
  let allowed = false;
  requirePermission(key)(req, res, () => { allowed = true; });
  return allowed;
}

function sendCaught(res, err) {
  if (res.headersSent) return;
  if (err instanceof OrchError || (err && err.code && HTTP_FOR_CODE[err.code])) {
    return sendOrchError(res, err);
  }
  console.error('[orch-credits] unhandled', (err && err.name) || 'Error', (err && err.code) || '');
  return sendError(res, 500, 'internal_error');
}

function publicAccount(row) {
  if (!row) {
    return {
      available_micros: 0,
      reserved_micros: 0,
      consumed_micros: 0,
      currency: 'USD',
    };
  }
  return {
    available_micros: microsToJson(row.available_micros),
    reserved_micros: microsToJson(row.reserved_micros),
    consumed_micros: microsToJson(row.consumed_micros),
    currency: row.currency || 'USD',
  };
}

function publicLimits(row) {
  if (!row) {
    return {
      credit_ceiling_micros: 0,
      requests_per_minute: 0,
      max_concurrent_ai: 0,
      daily_ai_cost_micros: 0,
      monthly_ai_cost_micros: 0,
      per_workflow_cost_micros: 0,
      provider_limits: {},
    };
  }
  return {
    credit_ceiling_micros: microsToJson(row.credit_ceiling_micros),
    requests_per_minute: Number(row.requests_per_minute) || 0,
    max_concurrent_ai: Number(row.max_concurrent_ai) || 0,
    daily_ai_cost_micros: microsToJson(row.daily_ai_cost_micros),
    monthly_ai_cost_micros: microsToJson(row.monthly_ai_cost_micros),
    per_workflow_cost_micros: microsToJson(row.per_workflow_cost_micros),
    provider_limits: row.provider_limits && typeof row.provider_limits === 'object' ? row.provider_limits : {},
  };
}

function publicReservation(row) {
  return {
    id: row.id,
    workflow_id: row.workflow_id,
    step_id: row.step_id,
    amount_micros: microsToJson(row.amount_micros),
    committed_micros: microsToJson(row.committed_micros),
    status: row.status,
    estimated_cost_micros: microsToJson(row.estimated_cost_micros),
    actual_cost_micros: row.actual_cost_micros == null ? null : microsToJson(row.actual_cost_micros),
    cost_status: row.cost_status,
    provider: row.provider,
    operation: row.operation,
    model_or_service: row.model_or_service,
    created_at: row.created_at,
    updated_at: row.updated_at,
    expires_at: row.expires_at,
  };
}

function publicLedger(row) {
  return {
    id: row.id,
    entry_type: row.entry_type,
    amount_micros: microsToJson(row.amount_micros),
    reservation_id: row.reservation_id,
    workflow_id: row.workflow_id,
    provider: row.provider,
    operation: row.operation,
    model_or_service: row.model_or_service,
    reason_code: row.reason_code,
    created_at: row.created_at,
  };
}

function parseAmountMicros(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('validation_failed');
  if (body.amount_micros != null && body.amount_micros !== '') {
    return requirePositiveMicros(body.amount_micros);
  }
  if (body.amount != null && body.amount !== '') {
    const n = dollarsToMicros(body.amount);
    if (n <= 0n) fail('validation_failed');
    return n;
  }
  fail('validation_failed');
}

async function readHandler(req, res, permission, fn) {
  try {
    if (!req.user) return res.status(401).json({ ok: false, error: 'auth_required' });
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'orch-credits:read' });
    if (!tid) return sendError(res, 400, 'validation_failed');
    if (!guardPerm(req, res, permission)) return;
    if (!_db.hasDb()) return sendError(res, 503, 'validation_failed');
    return await fn(req, res, tid, _db.getPool());
  } catch (err) {
    return sendCaught(res, err);
  }
}

function mutation(action, permission, handler) {
  return async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ ok: false, error: 'auth_required' });
      const tid = await _tenantCtx.resolveTenantId(req, { label: `orch-credits:${action}` });
      if (!tid) return sendError(res, 400, 'validation_failed');
      if (!guardPerm(req, res, permission)) return;
      const key = extractIdempotencyKey(req);
      if (!key) return sendError(res, 400, 'validation_failed');
      if (!_db.hasDb()) return sendError(res, 503, 'validation_failed');
      const pool = _db.getPool();
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
          return handler(req, tid, userId, pool, key);
        },
      });
      if (res.headersSent) return;
      return res.status(result.status).json(result.body);
    } catch (err) {
      return sendCaught(res, err);
    }
  };
}

router.get('/', (req, res) => readHandler(req, res, PERMS.view, async (_req, res2, tid, pool) => {
  const snap = await credits.withTx({ pool }, async (c) => {
    const account = await credits.ensureAccount(c, tid);
    const limits = await ensureLimits(c, tid);
    const reservations = (await c.query(
      `SELECT * FROM orchestrator_credit_reservations
        WHERE tenant_id=$1
        ORDER BY created_at DESC
        LIMIT 50`,
      [tid]
    )).rows;
    const daily = await sumFinalUsage(c, { tenantId: tid, since: utcDayStart() });
    const monthly = await sumFinalUsage(c, { tenantId: tid, since: utcMonthStart() });
    const workflows = (await c.query(
      `SELECT id, name, current_state, credit_ceiling_micros, block_reason, blocked_at
         FROM orchestrator_workflows
        WHERE tenant_id=$1
        ORDER BY updated_at DESC
        LIMIT 20`,
      [tid]
    )).rows;
    return { account, limits, reservations, daily, monthly, workflows };
  });
  return res2.json({
    ok: true,
    account: publicAccount(snap.account),
    limits: publicLimits(snap.limits),
    usage: {
      daily_micros: microsToJson(snap.daily),
      monthly_micros: microsToJson(snap.monthly),
    },
    reservations: snap.reservations.map(publicReservation),
    workflows: snap.workflows.map((w) => ({
      id: w.id,
      name: w.name,
      current_state: w.current_state,
      credit_ceiling_micros: microsToJson(w.credit_ceiling_micros),
      block_reason: w.block_reason,
      blocked_at: w.blocked_at,
    })),
  });
}));

router.get('/ledger', (req, res) => readHandler(req, res, PERMS.view, async (_req, res2, tid, pool) => {
  const r = await pool.query(
    `SELECT id, entry_type, amount_micros, reservation_id, workflow_id,
            provider, operation, model_or_service, reason_code, created_at
       FROM orchestrator_credit_ledger
      WHERE tenant_id=$1
      ORDER BY created_at DESC, id DESC
      LIMIT 200`,
    [tid]
  );
  return res2.json({ ok: true, ledger: r.rows.map(publicLedger) });
}));

router.get('/reservations/:id', (req, res) => readHandler(req, res, PERMS.view, async (req2, res2, tid, pool) => {
  const row = await credits.loadReservation(pool, tid, req2.params.id);
  if (!row) return sendError(res2, 404, 'not_found');
  return res2.json({ ok: true, reservation: publicReservation(row) });
}));

router.post('/grant', mutation('grant', PERMS.grant, async (req, tid, userId, pool, key) => {
  const amount = parseAmountMicros(req.body || {});
  const out = await credits.grant({
    pool,
    tenantId: tid,
    amountMicros: amount,
    actorUserId: userId,
    idempotencyKey: `grant:${key}`,
    reasonCode: (req.body && req.body.reason_code) || 'grant',
  });
  return { status: 200, body: { ok: true, account: publicAccount(out.account), replay: !!out.replay } };
}));

router.post('/adjust', mutation('adjust', PERMS.adjust, async (req, tid, userId, pool, key) => {
  const body = req.body || {};
  const amount = parseAmountMicros(body);
  const direction = String(body.direction || '').toLowerCase();
  if (direction !== 'credit' && direction !== 'debit') fail('validation_failed');
  const reason = String(body.reason_code || '').trim();
  if (!reason) fail('validation_failed');
  const out = await credits.adjust({
    pool,
    tenantId: tid,
    amountMicros: amount,
    direction,
    reasonCode: reason,
    actorUserId: userId,
    idempotencyKey: `adjust:${key}`,
  });
  return { status: 200, body: { ok: true, account: publicAccount(out.account), replay: !!out.replay } };
}));

router.get('/limits', (req, res) => readHandler(req, res, PERMS.limitsView, async (_req, res2, tid, pool) => {
  const limits = await credits.withTx({ pool }, async (c) => ensureLimits(c, tid));
  return res2.json({
    ok: true,
    limits: publicLimits(limits),
    note: 'Raising the tenant credit ceiling does not rewrite historical approvals; workflows keep their own credit_ceiling_micros.',
  });
}));

router.put('/limits', mutation('limits_edit', PERMS.limitsEdit, async (req, tid, userId, pool) => {
  const body = req.body || {};
  const patch = {};
  const microsKeys = [
    'credit_ceiling_micros', 'daily_ai_cost_micros', 'monthly_ai_cost_micros', 'per_workflow_cost_micros',
  ];
  for (const k of microsKeys) {
    if (body[k] != null && body[k] !== '') patch[k] = toSql(toBigInt(body[k]));
  }
  if (body.requests_per_minute != null) patch.requests_per_minute = body.requests_per_minute;
  if (body.max_concurrent_ai != null) patch.max_concurrent_ai = body.max_concurrent_ai;
  if (body.provider_limits !== undefined) patch.provider_limits = body.provider_limits;
  const row = await credits.withTx({ pool }, async (c) => updateLimits(c, tid, patch, userId));
  return {
    status: 200,
    body: {
      ok: true,
      limits: publicLimits(row),
      note: 'Raising the tenant credit ceiling does not rewrite historical approvals; workflows keep their own credit_ceiling_micros.',
    },
  };
}));

router.get('/pricing', (req, res) => readHandler(req, res, PERMS.view, async (_req, res2, tid, pool) => {
  const rows = await credits.withTx({ pool }, async (c) => listCatalog(c, tid));
  return res2.json({
    ok: true,
    catalog: rows.map((r) => ({
      provider: r.provider,
      model_or_service: r.model_or_service,
      unit_type: r.unit_type,
      input_price_micros_per_million: microsToJson(r.input_price_micros_per_million),
      output_price_micros_per_million: microsToJson(r.output_price_micros_per_million),
      currency: r.currency,
      pricing_version: Number(r.pricing_version),
      effective_from: r.effective_from,
    })),
  });
}));

module.exports = router;
module.exports.PERMS = PERMS;
