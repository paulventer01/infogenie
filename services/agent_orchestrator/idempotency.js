'use strict';

const { fail } = require('./errors');
const { sha256Hex } = require('./hash');
const { logger } = require('../infra/logger');

const MAX_KEY_LEN = 256;

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

async function runIdempotent(pool, {
  tenantId, key, endpoint, action, requestHash, actorUserId, workflowId, requestId, fn,
}) {
  if (!key || key.length > MAX_KEY_LEN) fail('validation_failed');

  const inserted = await pool.query(
    `INSERT INTO orchestrator_idempotency_keys
       (tenant_id, key, endpoint, action, request_hash, response_status, response_body)
     VALUES ($1,$2,$3,$4,$5,0,'{}'::jsonb)
     ON CONFLICT (tenant_id, key) DO NOTHING
     RETURNING id`,
    [tenantId, key, endpoint, action, requestHash]
  );

  if (!inserted.rowCount) {
    const existing = (await pool.query(
      `SELECT endpoint, action, request_hash, response_status, response_body
         FROM orchestrator_idempotency_keys
        WHERE tenant_id=$1 AND key=$2`,
      [tenantId, key]
    )).rows[0];
    if (!existing) fail('idempotency_conflict');
    if (
      existing.request_hash !== requestHash
      || existing.endpoint !== endpoint
      || existing.action !== action
    ) {
      fail('idempotency_conflict');
    }
    if (Number(existing.response_status) === 0) fail('execution_in_progress');
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

  try {
    const result = await fn();
    const status = result.status;
    const body = result.body;
    await pool.query(
      `UPDATE orchestrator_idempotency_keys
          SET response_status=$1, response_body=$2::jsonb
        WHERE tenant_id=$3 AND key=$4`,
      [status, JSON.stringify(body), tenantId, key]
    );
    return { replay: false, status, body };
  } catch (err) {
    const status = err && err.httpStatus ? err.httpStatus : 500;
    const body = { ok: false, error: (err && err.code) || 'internal_error' };
    if (err && err.extra) Object.assign(body, err.extra);
    try {
      await pool.query(
        `UPDATE orchestrator_idempotency_keys
            SET response_status=$1, response_body=$2::jsonb
          WHERE tenant_id=$3 AND key=$4`,
        [status, JSON.stringify(body), tenantId, key]
      );
    } catch (_) { /* keep pending rather than throwing a second error */ }
    throw err;
  }
}

module.exports = {
  extractIdempotencyKey,
  requestHashFrom,
  endpointOf,
  runIdempotent,
};
