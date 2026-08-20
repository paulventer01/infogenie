'use strict';

const os = require('os');
const crypto = require('crypto');
const { fail } = require('./errors');
const { logger } = require('../infra/logger');

const DEFAULT_TTL_MS = 30_000;

function newHolder() {
  return `${os.hostname()}:${process.pid}:${crypto.randomBytes(6).toString('hex')}`;
}

async function acquireLease(pool, tenantId, workflowId, {
  ttlMs = DEFAULT_TTL_MS,
  actorUserId = null,
  requestId = null,
} = {}) {
  const holder = newHolder();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const wf = await client.query(
      `SELECT * FROM orchestrator_workflows WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
      [workflowId, tenantId]
    );
    if (!wf.rows[0]) {
      await client.query('ROLLBACK');
      fail('not_found');
    }
    const existing = await client.query(
      `SELECT * FROM orchestrator_execution_leases
        WHERE tenant_id=$1 AND workflow_id=$2 FOR UPDATE`,
      [tenantId, workflowId]
    );
    const now = Date.now();
    if (existing.rows[0] && new Date(existing.rows[0].expires_at).getTime() > now) {
      await client.query('ROLLBACK');
      logger.info('lease_conflict', {
        tenant_id: tenantId,
        workflow_id: workflowId,
        actor_user_id: actorUserId,
        request_id: requestId,
        error_code: 'lease_conflict',
      });
      fail('lease_conflict');
    }
    const expires = new Date(now + ttlMs);
    let row;
    if (existing.rows[0]) {
      row = (await client.query(
        `UPDATE orchestrator_execution_leases
            SET holder=$1, expires_at=$2, heartbeat_at=now(), step_id=NULL
          WHERE tenant_id=$3 AND workflow_id=$4
          RETURNING *`,
        [holder, expires, tenantId, workflowId]
      )).rows[0];
    } else {
      row = (await client.query(
        `INSERT INTO orchestrator_execution_leases
           (tenant_id, workflow_id, holder, expires_at, heartbeat_at)
         VALUES ($1,$2,$3,$4,now())
         RETURNING *`,
        [tenantId, workflowId, holder, expires]
      )).rows[0];
    }
    await client.query('COMMIT');
    return { lease: row, holder, workflow: wf.rows[0] };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

async function heartbeatLease(pool, tenantId, workflowId, holder, { ttlMs = DEFAULT_TTL_MS } = {}) {
  const expires = new Date(Date.now() + ttlMs);
  const r = await pool.query(
    `UPDATE orchestrator_execution_leases
        SET heartbeat_at=now(), expires_at=$1
      WHERE tenant_id=$2 AND workflow_id=$3 AND holder=$4
      RETURNING *`,
    [expires, tenantId, workflowId, holder]
  );
  return r.rows[0] || null;
}

async function releaseLease(pool, tenantId, workflowId, holder) {
  await pool.query(
    `DELETE FROM orchestrator_execution_leases
      WHERE tenant_id=$1 AND workflow_id=$2 AND ($3::text IS NULL OR holder=$3)`,
    [tenantId, workflowId, holder || null]
  );
}

async function forceReleaseLease(pool, tenantId, workflowId) {
  await pool.query(
    `DELETE FROM orchestrator_execution_leases WHERE tenant_id=$1 AND workflow_id=$2`,
    [tenantId, workflowId]
  );
}

async function getLease(pool, tenantId, workflowId) {
  const r = await pool.query(
    `SELECT * FROM orchestrator_execution_leases WHERE tenant_id=$1 AND workflow_id=$2`,
    [tenantId, workflowId]
  );
  return r.rows[0] || null;
}

function isLeaseExpired(lease) {
  if (!lease) return true;
  return new Date(lease.expires_at).getTime() <= Date.now();
}

module.exports = {
  DEFAULT_TTL_MS,
  newHolder,
  acquireLease,
  heartbeatLease,
  releaseLease,
  forceReleaseLease,
  getLease,
  isLeaseExpired,
};
