'use strict';

const crypto = require('crypto');
const { fail } = require('./errors');
const { logger } = require('../infra/logger');

const DESTINATIONS = new Set(['meta', 'google', 'tiktok', 'internal']);
const MAX_ATTEMPTS_DEFAULT = 8;
const CLAIM_TTL_MS = 30_000;

// credential_ref is an opaque handle resolved against the vault at send time,
// and the row is operator-readable. An allowlisted shape is what stops a future
// caller putting the credential itself here: the character class excludes `.`,
// `=`, `/`, `+` and whitespace, so a JWT, a base64 secret, a PEM block, a signed
// URL and a bearer token cannot be spelled as a ref.
const CREDENTIAL_REF_RE = /^[A-Za-z0-9_:-]{1,128}$/;
// Defence in depth, and knowingly incomplete: an opaque provider token is
// shaped exactly like an opaque vault handle, so the class above cannot tell
// them apart. These are the prefixes real leaked keys carry. A denylist is the
// wrong primary control — the shape rule above is the primary control — but a
// literal `sk-…` reaching an operator-readable row is worth catching.
const KNOWN_SECRET_PREFIX_RE = /^(sk[-_]|xox[abps]-|xapp-|gh[posur]_|github_pat_|glpat-|shp(at|ss)_|npm_|dop_v1_|AKIA|ASIA|AIza)/i;
// Error codes are written to the row and to a log line, so only a token-shaped
// code survives. Provider error text collapses to the generic code rather than
// being truncated into either — a message can quote the offending value.
const ERROR_CODE_RE = /^[a-z0-9_]{1,40}$/;

function newOutboxId() {
  return `obx_${crypto.randomBytes(8).toString('hex')}`;
}

function normalizeCredentialRef(credentialRef) {
  if (credentialRef == null || credentialRef === '') return null;
  const s = String(credentialRef);
  if (!CREDENTIAL_REF_RE.test(s)) return null;
  if (KNOWN_SECRET_PREFIX_RE.test(s)) return null;
  return s;
}

function normalizeErrorCode(errorCode) {
  const s = String(errorCode == null ? '' : errorCode);
  return ERROR_CODE_RE.test(s) ? s : 'outbox_failed';
}

function sanitizePayload({ workflowId, operation, credentialRef }) {
  return {
    workflow_id: workflowId || null,
    operation: String(operation || ''),
    credential_ref: normalizeCredentialRef(credentialRef),
  };
}

function backoffSeconds(attemptCount) {
  const n = Math.max(1, Number(attemptCount) || 1);
  const exp = 2 ** Math.min(n, 16);
  return Math.min(300, exp);
}

async function enqueue(client, {
  tenantId,
  workflowId = null,
  destination,
  operation,
  credentialRef = null,
  idempotencyKey,
  maxAttempts = MAX_ATTEMPTS_DEFAULT,
}) {
  if (!DESTINATIONS.has(String(destination || ''))) fail('validation_failed');
  if (!operation || !idempotencyKey) fail('validation_failed');
  // Refuse rather than silently drop: a caller that meant to pass a vault
  // handle and passed a secret must see the write fail, not send with no
  // credential.
  if (credentialRef != null && credentialRef !== '' && normalizeCredentialRef(credentialRef) == null) {
    fail('validation_failed');
  }
  if (workflowId) {
    const wf = await client.query(
      `SELECT id FROM orchestrator_workflows WHERE id=$1 AND tenant_id=$2`,
      [workflowId, tenantId]
    );
    if (!wf.rowCount) fail('not_found');
  }
  const payload = sanitizePayload({ workflowId, operation, credentialRef });
  const ref = payload.credential_ref;
  const id = newOutboxId();
  const inserted = await client.query(
    `INSERT INTO orchestrator_outbox
       (id, tenant_id, workflow_id, destination, operation, payload, credential_ref,
        state, max_attempts, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,'pending',$8,$9)
     ON CONFLICT (tenant_id, destination, operation, idempotency_key) DO NOTHING
     RETURNING *`,
    [
      id, tenantId, workflowId || null, destination, String(operation),
      JSON.stringify(payload), ref,
      Math.max(1, Number(maxAttempts) || MAX_ATTEMPTS_DEFAULT),
      String(idempotencyKey),
    ]
  );
  if (inserted.rowCount) return inserted.rows[0];
  const existing = await client.query(
    `SELECT * FROM orchestrator_outbox
      WHERE tenant_id=$1 AND destination=$2 AND operation=$3 AND idempotency_key=$4`,
    [tenantId, destination, String(operation), String(idempotencyKey)]
  );
  return existing.rows[0];
}

async function claim(client, {
  tenantId, workerId, limit = 1,
} = {}) {
  const holder = String(workerId || `orch:${process.pid}`);
  const until = new Date(Date.now() + CLAIM_TTL_MS);
  const picked = await client.query(
    `SELECT id FROM orchestrator_outbox
      WHERE tenant_id=$1
        AND state IN ('pending','failed')
        AND next_attempt_at <= now()
      ORDER BY next_attempt_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT $2`,
    [tenantId, Math.max(1, Number(limit) || 1)]
  );
  if (!picked.rowCount) return [];
  const ids = picked.rows.map((r) => r.id);
  const updated = await client.query(
    `UPDATE orchestrator_outbox
        SET state='processing', claimed_by=$3, claimed_until=$4, updated_at=now()
      WHERE tenant_id=$1 AND id = ANY($2::text[])
      RETURNING *`,
    [tenantId, ids, holder, until]
  );
  return updated.rows;
}

async function complete(client, { tenantId, id }) {
  const row = (await client.query(
    `SELECT * FROM orchestrator_outbox WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
    [tenantId, id]
  )).rows[0];
  if (!row) fail('not_found');
  if (row.state === 'completed') return row;
  const r = await client.query(
    `UPDATE orchestrator_outbox
        SET state='completed', completed_at=now(), updated_at=now(),
            claimed_by=NULL, claimed_until=NULL
      WHERE tenant_id=$1 AND id=$2
      RETURNING *`,
    [tenantId, id]
  );
  return r.rows[0];
}

async function failRow(client, { tenantId, id, errorCode }) {
  const code = normalizeErrorCode(errorCode);
  const row = (await client.query(
    `SELECT * FROM orchestrator_outbox WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
    [tenantId, id]
  )).rows[0];
  if (!row) fail('not_found');
  if (row.state === 'completed') return row;
  const attempts = Number(row.attempt_count) + 1;
  const max = Number(row.max_attempts) || MAX_ATTEMPTS_DEFAULT;
  const dead = attempts >= max;
  const delay = backoffSeconds(attempts);
  const r = await client.query(
    `UPDATE orchestrator_outbox
        SET attempt_count=$3,
            last_error_code=$4,
            state=$5,
            next_attempt_at=now() + ($6 * interval '1 second'),
            claimed_by=NULL,
            claimed_until=NULL,
            updated_at=now()
      WHERE tenant_id=$1 AND id=$2
      RETURNING *`,
    [tenantId, id, attempts, code, dead ? 'dead_letter' : 'failed', delay]
  );
  logger.info(dead ? 'outbox_dead_letter' : 'outbox_failed', {
    tenant_id: tenantId,
    workflow_id: row.workflow_id || null,
    error_code: code,
  });
  return r.rows[0];
}

// Test-only: claim due rows and complete them with no network / no vendor call.
async function processOnce(pool, { tenantId, workerId, failCode } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const claimed = await claim(client, { tenantId, workerId, limit: 1 });
    if (!claimed.length) {
      await client.query('COMMIT');
      return null;
    }
    const row = claimed[0];
    const next = failCode
      ? await failRow(client, { tenantId, id: row.id, errorCode: failCode })
      : await complete(client, { tenantId, id: row.id });
    await client.query('COMMIT');
    return next;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  enqueue,
  claim,
  complete,
  fail: failRow,
  processOnce,
  sanitizePayload,
  normalizeCredentialRef,
  normalizeErrorCode,
  backoffSeconds,
  DESTINATIONS,
};
