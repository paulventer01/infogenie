'use strict';

const crypto = require('crypto');
const { fail } = require('./errors');
const { fromPg, toBigInt, toSql } = require('./money');

const INFLIGHT_TTL_MS = 30_000;

function utcDayStart() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function utcMonthStart() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

async function ensureLimits(client, tenantId) {
  await client.query(
    `INSERT INTO orchestrator_tenant_limits (tenant_id)
     VALUES ($1)
     ON CONFLICT (tenant_id) DO NOTHING`,
    [tenantId]
  );
  const r = await client.query(
    `SELECT * FROM orchestrator_tenant_limits WHERE tenant_id=$1`,
    [tenantId]
  );
  return r.rows[0];
}

function providerSlice(limits, provider) {
  const raw = limits && limits.provider_limits;
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const key = String(provider || '');
  if (!key || obj[key] == null || typeof obj[key] !== 'object') return null;
  return obj[key];
}

function modelSlice(pLimits, model) {
  if (!pLimits || !pLimits.models || typeof pLimits.models !== 'object') return null;
  const key = String(model || '');
  if (!key || pLimits.models[key] == null || typeof pLimits.models[key] !== 'object') return null;
  return pLimits.models[key];
}

async function expireInflight(client, tenantId) {
  await client.query(
    `DELETE FROM orchestrator_ai_inflight
      WHERE tenant_id=$1 AND lease_expires_at < now()`,
    [tenantId]
  );
}

async function countTicks(client, tenantId, { provider, since }) {
  const conds = ['tenant_id=$1', 'created_at >= $2'];
  const vals = [tenantId, since];
  if (provider) {
    conds.push('provider=$3');
    vals.push(provider);
  }
  const r = await client.query(
    `SELECT COUNT(*)::int AS n FROM orchestrator_ai_request_ticks WHERE ${conds.join(' AND ')}`,
    vals
  );
  return Number(r.rows[0].n) || 0;
}

async function countInflight(client, tenantId, { provider } = {}) {
  const conds = ['tenant_id=$1', 'lease_expires_at > now()'];
  const vals = [tenantId];
  if (provider) {
    conds.push('provider=$2');
    vals.push(provider);
  }
  const r = await client.query(
    `SELECT COUNT(*)::int AS n FROM orchestrator_ai_inflight WHERE ${conds.join(' AND ')}`,
    vals
  );
  return Number(r.rows[0].n) || 0;
}

async function sumFinalUsage(client, {
  tenantId, workflowId, provider, model, since,
}) {
  const conds = ['tenant_id=$1', "cost_status='final'"];
  const vals = [tenantId];
  let i = 2;
  if (workflowId) { conds.push(`workflow_id=$${i++}`); vals.push(workflowId); }
  if (provider) { conds.push(`provider=$${i++}`); vals.push(provider); }
  if (model) { conds.push(`model_or_service=$${i++}`); vals.push(model); }
  if (since) { conds.push(`created_at >= $${i++}`); vals.push(since); }
  const r = await client.query(
    `SELECT COALESCE(SUM(COALESCE(actual_cost_micros, 0)), 0) AS total
       FROM orchestrator_usage_records
      WHERE ${conds.join(' AND ')}`,
    vals
  );
  return fromPg(r.rows[0].total);
}

async function sumWorkflowSpend(client, tenantId, workflowId) {
  const r = await client.query(
    `SELECT
        COALESCE(SUM(CASE WHEN status='reserved' THEN amount_micros ELSE 0 END), 0) AS reserved,
        COALESCE(SUM(CASE WHEN status='committed' THEN committed_micros ELSE 0 END), 0) AS consumed
       FROM orchestrator_credit_reservations
      WHERE tenant_id=$1 AND workflow_id=$2`,
    [tenantId, workflowId]
  );
  return {
    reserved: fromPg(r.rows[0].reserved),
    consumed: fromPg(r.rows[0].consumed),
  };
}

async function loadWorkflowOr404(client, tenantId, workflowId) {
  const r = await client.query(
    `SELECT id, tenant_id, credit_ceiling_micros, current_state
       FROM orchestrator_workflows
      WHERE id=$1 AND tenant_id=$2`,
    [workflowId, tenantId]
  );
  if (!r.rowCount) fail('not_found');
  return r.rows[0];
}

function rejectIfZeroOrExceeded(limit, used, estimate, code) {
  const cap = toBigInt(limit);
  if (cap <= 0n) fail(code);
  if (used + estimate > cap) fail(code);
}

async function insertTickAndInflight(client, {
  tenantId, workflowId, provider, model,
}) {
  await client.query(
    `INSERT INTO orchestrator_ai_request_ticks (tenant_id, provider, model_or_service)
     VALUES ($1,$2,$3)`,
    [tenantId, String(provider || ''), String(model || '')]
  );
  const id = `inf_${tenantId}_${crypto.randomBytes(8).toString('hex')}`;
  const expires = new Date(Date.now() + INFLIGHT_TTL_MS);
  const row = (await client.query(
    `INSERT INTO orchestrator_ai_inflight
       (id, tenant_id, workflow_id, provider, model_or_service, lease_expires_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [id, tenantId, workflowId || null, String(provider || ''), String(model || ''), expires]
  )).rows[0];
  return row;
}

async function releaseInflight(client, { tenantId, inflightId }) {
  if (!inflightId) return;
  await client.query(
    `DELETE FROM orchestrator_ai_inflight WHERE id=$1 AND tenant_id=$2`,
    [inflightId, tenantId]
  );
}

async function preflight(client, {
  tenantId,
  workflowId,
  provider = '',
  model = '',
  estimatedMicros,
  recordStart = false,
  accountRow = null,
}) {
  const estimate = toBigInt(estimatedMicros);
  if (estimate === 0n) return { skipped: true, chargeable: false };

  const limits = await ensureLimits(client, tenantId);
  await client.query(
    `INSERT INTO orchestrator_credit_accounts (tenant_id)
     VALUES ($1)
     ON CONFLICT (tenant_id) DO NOTHING`,
    [tenantId]
  );
  const account = accountRow || (await client.query(
    `SELECT * FROM orchestrator_credit_accounts WHERE tenant_id=$1 FOR UPDATE`,
    [tenantId]
  )).rows[0];

  let workflow = null;
  if (workflowId) {
    workflow = await loadWorkflowOr404(client, tenantId, workflowId);
  }

  const tenantCeiling = fromPg(limits.credit_ceiling_micros);
  const wfCeiling = workflow ? fromPg(workflow.credit_ceiling_micros) : 0n;
  if (!workflow || wfCeiling === 0n || tenantCeiling === 0n) {
    fail('credit_ceiling_exceeded');
  }

  const available = account ? fromPg(account.available_micros) : 0n;
  const reserved = account ? fromPg(account.reserved_micros) : 0n;
  const consumed = account ? fromPg(account.consumed_micros) : 0n;
  if (consumed + reserved + estimate > tenantCeiling) fail('credit_ceiling_exceeded');

  const wfSpend = await sumWorkflowSpend(client, tenantId, workflowId);
  if (wfSpend.consumed + wfSpend.reserved + estimate > wfCeiling) {
    fail('credit_ceiling_exceeded');
  }

  if (available < estimate) fail('insufficient_credits');

  await expireInflight(client, tenantId);

  const rpm = Number(limits.requests_per_minute) || 0;
  if (rpm <= 0) fail('rate_limit_exceeded');
  const ticks = await countTicks(client, tenantId, {
    since: new Date(Date.now() - 60_000),
  });
  if (ticks >= rpm) fail('rate_limit_exceeded');

  const maxConc = Number(limits.max_concurrent_ai) || 0;
  if (maxConc <= 0) fail('concurrency_limit_exceeded');
  const live = await countInflight(client, tenantId);
  if (live >= maxConc) fail('concurrency_limit_exceeded');

  const dailyCap = fromPg(limits.daily_ai_cost_micros);
  const monthlyCap = fromPg(limits.monthly_ai_cost_micros);
  const perWfCap = fromPg(limits.per_workflow_cost_micros);
  const dailyUsed = await sumFinalUsage(client, { tenantId, since: utcDayStart() });
  const monthlyUsed = await sumFinalUsage(client, { tenantId, since: utcMonthStart() });
  rejectIfZeroOrExceeded(dailyCap, dailyUsed, estimate, 'tenant_cost_limit_exceeded');
  rejectIfZeroOrExceeded(monthlyCap, monthlyUsed, estimate, 'tenant_cost_limit_exceeded');
  rejectIfZeroOrExceeded(perWfCap, wfSpend.consumed + wfSpend.reserved, estimate, 'tenant_cost_limit_exceeded');

  const pLimits = providerSlice(limits, provider);
  if (pLimits) {
    const pRpm = pLimits.requests_per_minute;
    if (pRpm != null) {
      const n = Number(pRpm) || 0;
      if (n <= 0) fail('rate_limit_exceeded');
      const pTicks = await countTicks(client, tenantId, {
        provider, since: new Date(Date.now() - 60_000),
      });
      if (pTicks >= n) fail('rate_limit_exceeded');
    }
    const pConc = pLimits.max_concurrent_ai;
    if (pConc != null) {
      const n = Number(pConc) || 0;
      if (n <= 0) fail('concurrency_limit_exceeded');
      const pLive = await countInflight(client, tenantId, { provider });
      if (pLive >= n) fail('concurrency_limit_exceeded');
    }
    if (pLimits.daily_ai_cost_micros != null) {
      const pDaily = await sumFinalUsage(client, {
        tenantId, provider, since: utcDayStart(),
      });
      rejectIfZeroOrExceeded(pLimits.daily_ai_cost_micros, pDaily, estimate, 'tenant_cost_limit_exceeded');
    }
    if (pLimits.monthly_ai_cost_micros != null) {
      const pMonthly = await sumFinalUsage(client, {
        tenantId, provider, since: utcMonthStart(),
      });
      rejectIfZeroOrExceeded(pLimits.monthly_ai_cost_micros, pMonthly, estimate, 'tenant_cost_limit_exceeded');
    }
    const mLimits = modelSlice(pLimits, model);
    if (mLimits && mLimits.daily_ai_cost_micros != null) {
      const mDaily = await sumFinalUsage(client, {
        tenantId, provider, model, since: utcDayStart(),
      });
      rejectIfZeroOrExceeded(mLimits.daily_ai_cost_micros, mDaily, estimate, 'tenant_cost_limit_exceeded');
    }
  }

  let inflight = null;
  if (recordStart) {
    inflight = await insertTickAndInflight(client, {
      tenantId, workflowId, provider, model,
    });
  }
  return {
    skipped: false,
    chargeable: true,
    limits,
    account,
    workflow,
    inflight,
    estimatedMicros: estimate,
  };
}

async function updateLimits(client, tenantId, patch, actorUserId) {
  await ensureLimits(client, tenantId);
  const allowed = [
    'credit_ceiling_micros',
    'requests_per_minute',
    'max_concurrent_ai',
    'daily_ai_cost_micros',
    'monthly_ai_cost_micros',
    'per_workflow_cost_micros',
    'provider_limits',
  ];
  const sets = [];
  const vals = [];
  let i = 1;
  for (const k of allowed) {
    if (patch[k] === undefined) continue;
    if (k === 'provider_limits') {
      const v = patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k]) ? patch[k] : {};
      sets.push(`${k}=$${i++}::jsonb`);
      vals.push(JSON.stringify(v));
      continue;
    }
    if (k === 'requests_per_minute' || k === 'max_concurrent_ai') {
      const n = Number(patch[k]);
      if (!Number.isInteger(n) || n < 0) fail('validation_failed');
      sets.push(`${k}=$${i++}`);
      vals.push(n);
      continue;
    }
    const micros = toBigInt(patch[k]);
    if (micros < 0n) fail('validation_failed');
    sets.push(`${k}=$${i++}`);
    vals.push(toSql(micros));
  }
  if (!sets.length) {
    return (await client.query(
      `SELECT * FROM orchestrator_tenant_limits WHERE tenant_id=$1`, [tenantId]
    )).rows[0];
  }
  sets.push('updated_at=now()');
  if (actorUserId) {
    sets.push(`updated_by_user_id=$${i++}`);
    vals.push(actorUserId);
  }
  vals.push(tenantId);
  const r = await client.query(
    `UPDATE orchestrator_tenant_limits SET ${sets.join(', ')}
      WHERE tenant_id=$${i}
      RETURNING *`,
    vals
  );
  return r.rows[0];
}

module.exports = {
  INFLIGHT_TTL_MS,
  ensureLimits,
  preflight,
  insertTickAndInflight,
  releaseInflight,
  expireInflight,
  updateLimits,
  loadWorkflowOr404,
  utcDayStart,
  utcMonthStart,
  sumFinalUsage,
};
