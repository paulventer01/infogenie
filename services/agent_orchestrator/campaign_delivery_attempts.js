'use strict';

const crypto = require('crypto');
const { newId } = require('./runner');
const D = require('./campaign_delivery_contracts');

const OBJECT_KIND = 'campaign_delivery_attempt';
const ERROR_CODE_RE = /^[a-z0-9_]{1,40}$/;

function one(c, sql, p) { return c.query(sql, p).then((r) => r.rows[0] || null); }

function newClaimToken() {
  return crypto.randomBytes(32).toString('hex');
}

function publicAttempt(row) {
  if (!row) return null;
  return {
    object_kind: OBJECT_KIND,
    id: row.id,
    tenant_id: row.tenant_id,
    intent_id: row.intent_id,
    outbox_id: row.outbox_id,
    draft_id: row.draft_id,
    publishing_request_id: row.publishing_request_id,
    attempt_number: Number(row.attempt_number),
    generation: Number(row.generation),
    lease_holder: row.lease_holder,
    lease_expires_at: row.lease_expires_at,
    platform: row.platform,
    contract_version: row.contract_version,
    operation: row.operation,
    connector: row.connector,
    status: row.status,
    scenario: row.scenario,
    error_code: row.error_code,
    retryable: row.retryable,
    simulated: row.simulated === true,
    published: row.published === true,
    external_action_taken: row.external_action_taken === true,
    started_at: row.started_at,
    settled_at: row.settled_at,
  };
}

async function nextAttemptNumber(client, { tenantId, outboxId }) {
  const r = await one(client,
    `SELECT COALESCE(MAX(attempt_number), 0) + 1 AS n
       FROM orchestrator_campaign_delivery_attempts
      WHERE tenant_id=$1 AND outbox_id=$2`,
    [tenantId, outboxId]);
  return Number(r.n);
}

async function insertStartedAttempt(client, o) {
  const attemptNumber = Number(o.attemptNumber);
  const generation = o.generation == null ? attemptNumber : Number(o.generation);
  const claimToken = o.claimToken || newClaimToken();
  const id = o.id || newId('cda');
  const row = (await client.query(
    `INSERT INTO orchestrator_campaign_delivery_attempts
       (id, tenant_id, intent_id, outbox_id, draft_id, publishing_request_id,
        attempt_number, generation, claim_token, lease_holder, lease_expires_at,
        platform, intent_hash, contract_version, operation, connector, status,
        simulated, published, external_action_taken, started_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'started',
             TRUE, FALSE, FALSE, COALESCE($17::timestamptz, now()))
     RETURNING *`,
    [
      id, o.tenantId, o.intentId, o.outboxId, o.draftId, o.publishingRequestId,
      attemptNumber, generation, claimToken, o.leaseHolder, o.leaseExpiresAt,
      o.platform, o.intentHash, D.CONTRACT_VERSION, D.OPERATION, D.CONNECTOR,
      o.startedAt || null,
    ]
  )).rows[0];
  return row;
}

function normalizeErrorCode(code) {
  if (code == null || code === '') return null;
  const s = String(code);
  return ERROR_CODE_RE.test(s) ? s : null;
}

async function terminalizeAttempt(client, o) {
  const settledAt = o.settledAt || new Date();
  const errorCode = normalizeErrorCode(o.errorCode);
  const row = await one(client,
    `UPDATE orchestrator_campaign_delivery_attempts
        SET status=$3, scenario=$4, error_code=$5, retryable=$6, settled_at=$7
      WHERE tenant_id=$1 AND id=$2 AND status='started'
      RETURNING *`,
    [
      o.tenantId, o.attemptId, o.status,
      o.scenario == null ? null : String(o.scenario),
      errorCode,
      o.retryable === true,
      settledAt,
    ]);
  return row;
}

async function abandonExpiredLease(client, o) {
  return terminalizeAttempt(client, {
    tenantId: o.tenantId,
    attemptId: o.attemptId,
    status: 'abandoned_lease',
    scenario: o.scenario == null ? 'lease' : o.scenario,
    errorCode: 'simulated_lease_expired',
    retryable: true,
    settledAt: o.settledAt || new Date(),
  });
}

async function latestAttemptForOutbox(client, { tenantId, outboxId }) {
  return one(client,
    `SELECT * FROM orchestrator_campaign_delivery_attempts
      WHERE tenant_id=$1 AND outbox_id=$2
      ORDER BY attempt_number DESC
      LIMIT 1
      FOR UPDATE`,
    [tenantId, outboxId]);
}

async function lockAttempt(client, { tenantId, attemptId }) {
  return one(client,
    `SELECT * FROM orchestrator_campaign_delivery_attempts
      WHERE tenant_id=$1 AND id=$2
      FOR UPDATE`,
    [tenantId, attemptId]);
}

async function listAttemptsForOutbox(poolOrClient, { tenantId, outboxId }) {
  const r = await poolOrClient.query(
    `SELECT * FROM orchestrator_campaign_delivery_attempts
      WHERE tenant_id=$1 AND outbox_id=$2
      ORDER BY attempt_number ASC`,
    [tenantId, outboxId]
  );
  return r.rows.map(publicAttempt);
}

module.exports = {
  OBJECT_KIND,
  publicAttempt,
  newClaimToken,
  nextAttemptNumber,
  insertStartedAttempt,
  terminalizeAttempt,
  abandonExpiredLease,
  latestAttemptForOutbox,
  lockAttempt,
  listAttemptsForOutbox,
};
