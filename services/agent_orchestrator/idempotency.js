'use strict';

const crypto = require('crypto');
const { fail } = require('./errors');
const { sha256Hex } = require('./hash');
const { logger } = require('../infra/logger');

const MAX_KEY_LEN = 256;
const LEASE_MS = 30_000;

function extractIdempotencyKey(req) {
  const header = req.headers && (req.headers['idempotency-key'] || req.headers['Idempotency-Key']);
  if (header != null && String(header).trim()) return String(header).trim();
  const body = req.body && req.body.idempotency_key;
  if (body != null && String(body).trim()) return String(body).trim();
  return null;
}

function requestHashFrom(req) {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? { ...req.body }
    : {};
  delete body.tenant_id;
  delete body.user_id;
  delete body.idempotency_key;
  return sha256Hex(body);
}

function endpointOf(req) {
  const base = req.baseUrl || '';
  const path = req.path || '';
  return `${base}${path}`.replace(/\/+$/, '') || '/';
}

function newOwnerToken() {
  return crypto.randomBytes(16).toString('hex');
}

function leaseExpiry(fromMs) {
  return new Date((fromMs || Date.now()) + LEASE_MS);
}

function isLeaseLive(row) {
  if (!row || !row.lease_expires_at) return false;
  return new Date(row.lease_expires_at).getTime() > Date.now();
}

function replayOf(existing, { tenantId, workflowId, actorUserId, requestId }) {
  logger.info('idempotent_replay', {
    tenant_id: tenantId,
    workflow_id: workflowId || (existing.response_body && existing.response_body.workflow && existing.response_body.workflow.id) || null,
    actor_user_id: actorUserId || null,
    request_id: requestId || null,
  });
  return {
    replay: true,
    status: existing.response_status,
    body: existing.response_body,
  };
}

async function loadKey(pool, tenantId, key) {
  const r = await pool.query(
    `SELECT endpoint, action, request_hash, response_status, response_body,
            status, owner_token, lease_expires_at
       FROM orchestrator_idempotency_keys
      WHERE tenant_id=$1 AND key=$2`,
    [tenantId, key]
  );
  return r.rows[0] || null;
}

async function tryReclaim(pool, tenantId, key, ownerToken) {
  const r = await pool.query(
    `UPDATE orchestrator_idempotency_keys
        SET owner_token=$1, lease_expires_at=$2, updated_at=now()
      WHERE tenant_id=$3 AND key=$4 AND status='pending'
        AND (lease_expires_at IS NULL OR lease_expires_at < now())
      RETURNING id`,
    [ownerToken, leaseExpiry(), tenantId, key]
  );
  return r.rowCount > 0;
}

async function persistCompleted(pool, { tenantId, key, status, body }) {
  await pool.query(
    `UPDATE orchestrator_idempotency_keys
        SET status='completed', response_status=$1, response_body=$2::jsonb, updated_at=now()
      WHERE tenant_id=$3 AND key=$4`,
    [status, JSON.stringify(body), tenantId, key]
  );
}

async function executeOwned(pool, {
  tenantId, key, fn, actorUserId, workflowId, requestId,
}) {
  try {
    const result = await fn();
    await persistCompleted(pool, {
      tenantId, key, status: result.status, body: result.body,
    });
    return { replay: false, status: result.status, body: result.body };
  } catch (err) {
    const status = err && err.httpStatus ? err.httpStatus : 500;
    const body = { ok: false, error: (err && err.code) || 'internal_error' };
    if (err && err.extra) Object.assign(body, err.extra);
    if (status >= 400 && status < 500) {
      try {
        await persistCompleted(pool, { tenantId, key, status, body });
      } catch (_) { /* keep pending rather than throwing a second error */ }
    }
    // 5xx / unexpected: leave pending so an expired lease can reclaim.
    throw err;
  }
}

async function runIdempotent(pool, {
  tenantId, key, endpoint, action, requestHash, actorUserId, workflowId, requestId, fn,
}) {
  if (!key || key.length > MAX_KEY_LEN) fail('validation_failed');

  const ownerToken = newOwnerToken();
  const inserted = await pool.query(
    `INSERT INTO orchestrator_idempotency_keys
       (tenant_id, key, endpoint, action, request_hash, response_status, response_body,
        status, owner_token, lease_expires_at)
     VALUES ($1,$2,$3,$4,$5,0,'{}'::jsonb,'pending',$6,$7)
     ON CONFLICT (tenant_id, key) DO NOTHING
     RETURNING id`,
    [tenantId, key, endpoint, action, requestHash, ownerToken, leaseExpiry()]
  );

  if (!inserted.rowCount) {
    const existing = await loadKey(pool, tenantId, key);
    if (!existing) fail('idempotency_conflict');
    if (
      existing.request_hash !== requestHash
      || existing.endpoint !== endpoint
      || existing.action !== action
    ) {
      fail('idempotency_conflict');
    }
    const completed = existing.status === 'completed' || Number(existing.response_status) !== 0;
    if (completed) {
      return replayOf(existing, { tenantId, workflowId, actorUserId, requestId });
    }
    if (existing.status === 'pending' && isLeaseLive(existing)) {
      fail('execution_in_progress');
    }
    const won = await tryReclaim(pool, tenantId, key, ownerToken);
    if (!won) fail('execution_in_progress');
  }

  return executeOwned(pool, {
    tenantId, key, fn, actorUserId, workflowId, requestId,
  });
}

module.exports = {
  extractIdempotencyKey,
  requestHashFrom,
  endpointOf,
  runIdempotent,
  LEASE_MS,
};
