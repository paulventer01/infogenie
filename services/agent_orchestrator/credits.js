'use strict';

const crypto = require('crypto');
const _db = require('../../db');
const { fail } = require('./errors');
const {
  fromPg, toSql, requirePositiveMicros, requireNonNegativeMicros,
} = require('./money');
const { preflight, ensureLimits, releaseInflight } = require('./limits');
const { seedCatalog } = require('./pricing');
const { appendUsage } = require('./usage');
const { logger } = require('../infra/logger');

function poolOf(pool) {
  return pool || _db.getPool();
}

function newReservationId(tenantId) {
  return `ocr_${tenantId}_${crypto.randomBytes(8).toString('hex')}`;
}

async function withTx({ pool, client }, fn) {
  if (client) return fn(client);
  const c = await poolOf(pool).connect();
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

async function ensureAccount(client, tenantId) {
  await client.query(
    `INSERT INTO orchestrator_credit_accounts (tenant_id)
     VALUES ($1)
     ON CONFLICT (tenant_id) DO NOTHING`,
    [tenantId]
  );
  await ensureLimits(client, tenantId);
  await seedCatalog(client, tenantId);
  const r = await client.query(
    `SELECT * FROM orchestrator_credit_accounts WHERE tenant_id=$1 FOR UPDATE`,
    [tenantId]
  );
  return r.rows[0];
}

async function reloadAccount(client, tenantId) {
  const r = await client.query(
    `SELECT * FROM orchestrator_credit_accounts WHERE tenant_id=$1`,
    [tenantId]
  );
  return r.rows[0];
}

async function findLedgerByKey(client, tenantId, idempotencyKey) {
  if (!idempotencyKey) return null;
  const r = await client.query(
    `SELECT * FROM orchestrator_credit_ledger
      WHERE tenant_id=$1 AND idempotency_key=$2`,
    [tenantId, idempotencyKey]
  );
  return r.rows[0] || null;
}

async function insertLedger(client, {
  tenantId, entryType, amountMicros, reservationId, workflowId, stepId,
  provider, operation, model, actorUserId, idempotencyKey, reasonCode,
}) {
  const existing = await findLedgerByKey(client, tenantId, idempotencyKey);
  if (existing) return existing;
  try {
    const r = await client.query(
      `INSERT INTO orchestrator_credit_ledger
         (tenant_id, entry_type, amount_micros, reservation_id, workflow_id, step_id,
          provider, operation, model_or_service, actor_user_id, idempotency_key, reason_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        tenantId, entryType, toSql(amountMicros),
        reservationId || null, workflowId || null, stepId || null,
        provider || null, operation || null, model || null,
        actorUserId || null, idempotencyKey || null, reasonCode || null,
      ]
    );
    return r.rows[0];
  } catch (err) {
    if (err && err.code === '23505' && idempotencyKey) {
      const row = await findLedgerByKey(client, tenantId, idempotencyKey);
      if (row) return row;
    }
    throw err;
  }
}

function loadReservation(client, tenantId, reservationId) {
  return client.query(
    `SELECT * FROM orchestrator_credit_reservations
      WHERE id=$1 AND tenant_id=$2`,
    [reservationId, tenantId]
  ).then((r) => r.rows[0] || null);
}

async function grant(opts) {
  const {
    pool, client, tenantId, amountMicros, actorUserId, idempotencyKey, reasonCode,
  } = opts;
  const amount = requirePositiveMicros(amountMicros);
  if (!idempotencyKey) fail('validation_failed');
  return withTx({ pool, client }, async (c) => {
    const account = await ensureAccount(c, tenantId);
    const prior = await findLedgerByKey(c, tenantId, idempotencyKey);
    if (prior) {
      return { account: await reloadAccount(c, tenantId), ledger: prior, replay: true };
    }
    const next = fromPg(account.available_micros) + amount;
    await c.query(
      `UPDATE orchestrator_credit_accounts
          SET available_micros=$1, updated_at=now()
        WHERE tenant_id=$2`,
      [toSql(next), tenantId]
    );
    const ledger = await insertLedger(c, {
      tenantId, entryType: 'grant', amountMicros: amount,
      actorUserId, idempotencyKey, reasonCode: reasonCode || 'grant',
    });
    logger.info('credit_grant', {
      tenant_id: tenantId,
      actor_user_id: actorUserId || null,
      error_code: null,
    });
    return { account: await reloadAccount(c, tenantId), ledger, replay: false };
  });
}

async function reserve(opts) {
  const {
    pool, client, tenantId, amountMicros, workflowId, stepId, provider, operation,
    model, pricingVersion, estimatedMicros, actorUserId, idempotencyKey, expiresAt,
    runPreflight = true, recordStart = false,
  } = opts;
  const amount = requirePositiveMicros(amountMicros);
  if (!idempotencyKey) fail('validation_failed');
  if (workflowId) {
    // Isolation: never trust a workflow id without the tenant predicate.
    // load happens inside preflight / explicit SELECT.
  }
  return withTx({ pool, client }, async (c) => {
    if (workflowId) {
      const wf = await c.query(
        `SELECT id FROM orchestrator_workflows WHERE id=$1 AND tenant_id=$2`,
        [workflowId, tenantId]
      );
      if (!wf.rowCount) fail('not_found');
    }
    const account = await ensureAccount(c, tenantId);
    const existing = (await c.query(
      `SELECT * FROM orchestrator_credit_reservations
        WHERE tenant_id=$1 AND idempotency_key=$2`,
      [tenantId, idempotencyKey]
    )).rows[0];
    if (existing) {
      return { account: await reloadAccount(c, tenantId), reservation: existing, replay: true };
    }

    const estimate = estimatedMicros != null ? requireNonNegativeMicros(estimatedMicros) : amount;
    if (runPreflight && estimate > 0n) {
      await preflight(c, {
        tenantId,
        workflowId,
        provider,
        model,
        estimatedMicros: estimate,
        recordStart,
        accountRow: account,
      });
    }

    const available = fromPg(account.available_micros);
    if (available < amount) fail('insufficient_credits');

    const nextAvail = available - amount;
    const nextReserved = fromPg(account.reserved_micros) + amount;
    await c.query(
      `UPDATE orchestrator_credit_accounts
          SET available_micros=$1, reserved_micros=$2, updated_at=now()
        WHERE tenant_id=$3`,
      [toSql(nextAvail), toSql(nextReserved), tenantId]
    );

    const id = newReservationId(tenantId);
    let reservation;
    try {
      reservation = (await c.query(
        `INSERT INTO orchestrator_credit_reservations
           (id, tenant_id, workflow_id, step_id, amount_micros, status,
            estimated_cost_micros, provider, operation, model_or_service,
            pricing_version, idempotency_key, actor_user_id, expires_at)
         VALUES ($1,$2,$3,$4,$5,'reserved',$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          id, tenantId, workflowId || null, stepId || null, toSql(amount),
          toSql(estimate), String(provider || ''), String(operation || ''),
          String(model || ''), pricingVersion == null ? null : Number(pricingVersion),
          idempotencyKey, actorUserId || null, expiresAt || null,
        ]
      )).rows[0];
    } catch (err) {
      if (err && err.code === '23505') {
        const row = (await c.query(
          `SELECT * FROM orchestrator_credit_reservations
            WHERE tenant_id=$1 AND idempotency_key=$2`,
          [tenantId, idempotencyKey]
        )).rows[0];
        if (row) {
          return { account: await reloadAccount(c, tenantId), reservation: row, replay: true };
        }
      }
      throw err;
    }

    await insertLedger(c, {
      tenantId, entryType: 'reservation', amountMicros: amount,
      reservationId: reservation.id, workflowId, stepId, provider, operation, model,
      actorUserId, idempotencyKey, reasonCode: 'reservation',
    });
    logger.info('credit_reserve', {
      tenant_id: tenantId,
      workflow_id: workflowId || null,
      actor_user_id: actorUserId || null,
    });
    return { account: await reloadAccount(c, tenantId), reservation, replay: false };
  });
}

async function commit(opts) {
  const {
    pool, client, tenantId, reservationId, actualMicros, usage, actorUserId, idempotencyKey,
  } = opts;
  const actual = requireNonNegativeMicros(actualMicros);
  if (!reservationId || !idempotencyKey) fail('validation_failed');
  return withTx({ pool, client }, async (c) => {
    await ensureAccount(c, tenantId);
    const row = (await c.query(
      `SELECT * FROM orchestrator_credit_reservations
        WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
      [reservationId, tenantId]
    )).rows[0];
    if (!row) fail('not_found');

    const prior = await findLedgerByKey(c, tenantId, idempotencyKey);
    if (row.status === 'committed' || prior) {
      return {
        account: await reloadAccount(c, tenantId),
        reservation: row,
        replay: true,
      };
    }
    if (row.status !== 'reserved') {
      return { account: await reloadAccount(c, tenantId), reservation: row, replay: true };
    }

    const reservedAmt = fromPg(row.amount_micros);
    if (actual > reservedAmt) fail('validation_failed');

    const leftover = reservedAmt - actual;
    const account = await c.query(
      `SELECT * FROM orchestrator_credit_accounts WHERE tenant_id=$1 FOR UPDATE`,
      [tenantId]
    ).then((r) => r.rows[0]);

    const nextReserved = fromPg(account.reserved_micros) - reservedAmt;
    const nextAvail = fromPg(account.available_micros) + leftover;
    const nextConsumed = fromPg(account.consumed_micros) + actual;
    if (nextReserved < 0n || nextAvail < 0n) fail('insufficient_credits');

    await c.query(
      `UPDATE orchestrator_credit_accounts
          SET available_micros=$1, reserved_micros=$2, consumed_micros=$3, updated_at=now()
        WHERE tenant_id=$4`,
      [toSql(nextAvail), toSql(nextReserved), toSql(nextConsumed), tenantId]
    );

    const reservation = (await c.query(
      `UPDATE orchestrator_credit_reservations
          SET status='committed', committed_micros=$1, actual_cost_micros=$1,
              cost_status='final', updated_at=now()
        WHERE id=$2 AND tenant_id=$3
        RETURNING *`,
      [toSql(actual), reservationId, tenantId]
    )).rows[0];

    if (actual > 0n) {
      await insertLedger(c, {
        tenantId, entryType: 'commit', amountMicros: actual,
        reservationId, workflowId: row.workflow_id, stepId: row.step_id,
        provider: row.provider, operation: row.operation, model: row.model_or_service,
        actorUserId, idempotencyKey, reasonCode: 'commit',
      });
    }
    if (leftover > 0n) {
      await insertLedger(c, {
        tenantId, entryType: 'release', amountMicros: leftover,
        reservationId, workflowId: row.workflow_id, stepId: row.step_id,
        provider: row.provider, operation: row.operation, model: row.model_or_service,
        actorUserId, idempotencyKey: `${idempotencyKey}:leftover`, reasonCode: 'commit_leftover',
      });
    }

    let usageSource = 'estimated';
    let computedActual = actual;
    if (usage && usage.providerUnits) {
      usageSource = 'provider';
      if (usage.computedMicros != null) computedActual = requireNonNegativeMicros(usage.computedMicros);
    } else if (usage && usage.usageSource === 'provider') {
      usageSource = 'provider';
    }

    await appendUsage(c, {
      tenantId,
      reservationId,
      workflowId: row.workflow_id,
      stepId: row.step_id,
      provider: row.provider,
      model: row.model_or_service,
      unitType: (usage && usage.unitType) || 'request',
      inputUnits: (usage && usage.inputUnits) || 0n,
      outputUnits: (usage && usage.outputUnits) || 0n,
      estimatedMicros: fromPg(row.estimated_cost_micros),
      actualMicros: computedActual,
      costStatus: 'final',
      pricingVersion: row.pricing_version,
      usageSource,
    });

    logger.info('credit_commit', {
      tenant_id: tenantId,
      workflow_id: row.workflow_id || null,
      actor_user_id: actorUserId || null,
    });
    return { account: await reloadAccount(c, tenantId), reservation, replay: false };
  });
}

async function release(opts) {
  const {
    pool, client, tenantId, reservationId, reasonCode, idempotencyKey, inflightId,
  } = opts;
  if (!reservationId) fail('validation_failed');
  const key = idempotencyKey || `release:${reservationId}`;
  return withTx({ pool, client }, async (c) => {
    await ensureAccount(c, tenantId);
    const row = (await c.query(
      `SELECT * FROM orchestrator_credit_reservations
        WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
      [reservationId, tenantId]
    )).rows[0];
    if (!row) fail('not_found');
    if (row.status === 'released' || row.status === 'committed' || row.status === 'expired') {
      if (inflightId) await releaseInflight(c, { tenantId, inflightId });
      return { account: await reloadAccount(c, tenantId), reservation: row, replay: true };
    }

    const remaining = fromPg(row.amount_micros) - fromPg(row.committed_micros);
    const account = (await c.query(
      `SELECT * FROM orchestrator_credit_accounts WHERE tenant_id=$1 FOR UPDATE`,
      [tenantId]
    )).rows[0];
    const nextAvail = fromPg(account.available_micros) + remaining;
    const nextReserved = fromPg(account.reserved_micros) - remaining;
    if (nextReserved < 0n) fail('insufficient_credits');

    await c.query(
      `UPDATE orchestrator_credit_accounts
          SET available_micros=$1, reserved_micros=$2, updated_at=now()
        WHERE tenant_id=$3`,
      [toSql(nextAvail), toSql(nextReserved), tenantId]
    );

    const reservation = (await c.query(
      `UPDATE orchestrator_credit_reservations
          SET status='released', updated_at=now()
        WHERE id=$1 AND tenant_id=$2
        RETURNING *`,
      [reservationId, tenantId]
    )).rows[0];

    if (remaining > 0n) {
      await insertLedger(c, {
        tenantId, entryType: 'release', amountMicros: remaining,
        reservationId, workflowId: row.workflow_id, stepId: row.step_id,
        provider: row.provider, operation: row.operation, model: row.model_or_service,
        actorUserId: row.actor_user_id, idempotencyKey: key, reasonCode: reasonCode || 'release',
      });
    }
    if (inflightId) await releaseInflight(c, { tenantId, inflightId });
    logger.info('credit_release', {
      tenant_id: tenantId,
      workflow_id: row.workflow_id || null,
    });
    return { account: await reloadAccount(c, tenantId), reservation, replay: false };
  });
}

async function releaseAllReservedForWorkflow({ pool, client, tenantId, workflowId, reasonCode }) {
  if (!workflowId) return [];
  return withTx({ pool, client }, async (c) => {
    const wf = await c.query(
      `SELECT id FROM orchestrator_workflows WHERE id=$1 AND tenant_id=$2`,
      [workflowId, tenantId]
    );
    if (!wf.rowCount) fail('not_found');
    await ensureAccount(c, tenantId);
    const rows = (await c.query(
      `SELECT id FROM orchestrator_credit_reservations
        WHERE tenant_id=$1 AND workflow_id=$2 AND status='reserved'
        ORDER BY created_at ASC`,
      [tenantId, workflowId]
    )).rows;
    const out = [];
    for (const r of rows) {
      out.push(await release({
        client: c, tenantId, reservationId: r.id,
        reasonCode: reasonCode || 'workflow_stop',
        idempotencyKey: `release-wf:${workflowId}:${r.id}`,
      }));
    }
    return out;
  });
}

async function adjust(opts) {
  const {
    pool, client, tenantId, amountMicros, direction, reasonCode, actorUserId, idempotencyKey,
  } = opts;
  const amount = requirePositiveMicros(amountMicros);
  if (!idempotencyKey) fail('validation_failed');
  const dir = String(direction || '').toLowerCase();
  if (dir !== 'credit' && dir !== 'debit') fail('validation_failed');
  const isRefund = dir === 'credit' && String(reasonCode || '') === 'refund';
  const entryType = isRefund ? 'refund' : 'adjustment';
  return withTx({ pool, client }, async (c) => {
    const account = await ensureAccount(c, tenantId);
    const prior = await findLedgerByKey(c, tenantId, idempotencyKey);
    if (prior) {
      return { account: await reloadAccount(c, tenantId), ledger: prior, replay: true };
    }
    let nextAvail = fromPg(account.available_micros);
    if (dir === 'credit') {
      nextAvail += amount;
    } else {
      if (nextAvail < amount) fail('insufficient_credits');
      nextAvail -= amount;
    }
    await c.query(
      `UPDATE orchestrator_credit_accounts
          SET available_micros=$1, updated_at=now()
        WHERE tenant_id=$2`,
      [toSql(nextAvail), tenantId]
    );
    const ledger = await insertLedger(c, {
      tenantId, entryType, amountMicros: amount,
      actorUserId, idempotencyKey, reasonCode: reasonCode || entryType,
    });
    logger.info(isRefund ? 'credit_refund' : 'credit_adjust', {
      tenant_id: tenantId,
      actor_user_id: actorUserId || null,
    });
    return { account: await reloadAccount(c, tenantId), ledger, replay: false };
  });
}

async function refund(opts) {
  return adjust({ ...opts, direction: 'credit', reasonCode: opts.reasonCode || 'refund' });
}

async function getSnapshot(clientOrPool, tenantId) {
  return withTx({ pool: clientOrPool, client: clientOrPool && clientOrPool.release ? clientOrPool : null }, async (c) => {
    const account = await ensureAccount(c, tenantId);
    const limits = await ensureLimits(c, tenantId);
    return { account, limits };
  });
}

module.exports = {
  withTx,
  ensureAccount,
  reloadAccount,
  grant,
  reserve,
  commit,
  release,
  releaseAllReservedForWorkflow,
  adjust,
  refund,
  loadReservation,
  findLedgerByKey,
  getSnapshot,
};
