'use strict';

const { fail } = require('./errors');
const { newId } = require('./runner');
const { sha256Hex } = require('./hash');
const D = require('./campaign_delivery_contracts');
const { assertPublishAuthorizedOnClient } = require('./campaign_drafts');
const { lockPublishRequest } = require('./campaign_publish_requests');
const { latestAttemptForOutbox, lockAttempt } = require('./campaign_delivery_attempts');
const { lockByTenantAndId } = require('./outbox');
const {
  assertActiveMember, boundActorId, assertRequestMatchesAuthorized,
} = require('./campaign_delivery_intents');
const caps = require('../security/advertising_provider_capabilities');
const vault = require('../credentials/vault');
const metaPausedDraft = require('./connectors/meta_paused_draft');
const { createPausedDraftGraph } = metaPausedDraft;

const UNIQUE_VIOLATION = '23505';
const EXEC_SAVEPOINT = 'sp_campaign_provider_draft_execute';
const CONFIRM_TABLE = 'orchestrator_campaign_provider_confirmations';
const EXEC_TABLE = 'orchestrator_campaign_provider_draft_executions';
const OBJECT_TABLE = 'orchestrator_campaign_provider_objects';
const PARK_DAYS = D.PARK_INTERVAL_DAYS;

function one(c, sql, p) { return c.query(sql, p).then((r) => r.rows[0] || null); }

async function withTx(pool, fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally { c.release(); }
}

function assertSame(actual, expected, code) {
  if (String(actual) !== String(expected)) fail(code || 'approval_stale');
}

function assertSameNum(actual, expected, code) {
  if (Number(actual) !== Number(expected)) fail(code || 'approval_stale');
}

function isExpired(row, nowMs) {
  if (!row || !row.expires_at) return true;
  return new Date(row.expires_at).getTime() <= nowMs;
}

async function currentDbTimeMs(c) {
  const row = await one(c, 'SELECT clock_timestamp() AS now');
  const value = row && row.now ? new Date(row.now).getTime() : NaN;
  if (!Number.isFinite(value)) fail('internal_error');
  return value;
}

function assertAttemptLeaseLiveAt(attempt, nowMs) {
  const leaseMs = attempt && attempt.lease_expires_at
    ? new Date(attempt.lease_expires_at).getTime()
    : NaN;
  if (!Number.isFinite(leaseMs) || leaseMs <= nowMs) fail('lease_conflict');
}

function lockIntent(c, tenantId, intentId) {
  return one(c,
    `SELECT * FROM orchestrator_campaign_delivery_intents
      WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
    [tenantId, intentId]);
}

function lockConfirmation(c, tenantId, confirmationId) {
  return one(c,
    `SELECT * FROM ${CONFIRM_TABLE} WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
    [tenantId, confirmationId]);
}

function loadExecutionByKey(c, tenantId, key) {
  return one(c, `SELECT * FROM ${EXEC_TABLE} WHERE tenant_id=$1 AND idempotency_key=$2`, [tenantId, key]);
}

function loadExecutionByConfirmation(c, tenantId, confirmationId) {
  return one(c, `SELECT * FROM ${EXEC_TABLE} WHERE tenant_id=$1 AND confirmation_id=$2`, [tenantId, confirmationId]);
}

function parseOutboxPayload(value) {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (_) { return null; }
  }
  if (v == null || typeof v !== 'object' || Array.isArray(v) || Buffer.isBuffer(v)) return null;
  return v;
}

async function loadAuthoritativeGraph(c, o, confirmation) {
  const draftId = String(o.draftId || confirmation.draft_id || '');
  const publishingRequestId = String(o.publishingRequestId || confirmation.publishing_request_id || '');
  const intentId = String(o.intentId || confirmation.intent_id || '');
  if (!draftId || !publishingRequestId || !intentId) fail('not_found');

  const intent = await lockIntent(c, o.tenantId, intentId);
  if (!intent) fail('not_found');
  assertSame(intent.draft_id, draftId, 'not_found');
  assertSame(intent.publishing_request_id, publishingRequestId, 'not_found');
  assertSame(intent.id, confirmation.intent_id, 'approval_stale');
  assertSame(intent.outbox_id, confirmation.outbox_id, 'approval_stale');
  if (intent.status !== D.STATUS) fail('invalid_transition');
  if (intent.operation !== D.OPERATION) fail('validation_failed', { field: 'operation' });
  if (intent.contract_version !== D.CONTRACT_VERSION) fail('validation_failed', { field: 'contract_version' });

  const outbox = await lockByTenantAndId(c, { tenantId: o.tenantId, id: intent.outbox_id });
  if (!outbox) fail('not_found');
  if (outbox.destination !== D.DESTINATION) fail('invalid_transition');
  if (outbox.operation !== D.OPERATION) fail('validation_failed', { field: 'operation' });
  if (outbox.state !== D.STATUS) fail('invalid_transition');
  const payload = parseOutboxPayload(outbox.payload);
  if (!payload) fail('invalid_transition');
  assertSame(payload.draft_id, draftId, 'approval_stale');
  assertSame(payload.publishing_request_id, publishingRequestId, 'approval_stale');
  assertSame(payload.intent_id, intentId, 'approval_stale');
  if (payload.platform !== D.PLATFORM_META) fail('validation_failed', { field: 'platform' });

  const attempt = await lockAttempt(c, {
    tenantId: o.tenantId,
    attemptId: confirmation.attempt_id,
  });
  if (!attempt) fail('not_found');
  assertSame(attempt.id, confirmation.attempt_id, 'approval_stale');
  assertSame(attempt.draft_id, draftId, 'not_found');
  assertSame(attempt.publishing_request_id, publishingRequestId, 'not_found');
  assertSame(attempt.intent_id, intentId, 'not_found');
  assertSame(intent.intent_hash, attempt.intent_hash, 'approval_stale');
  if (attempt.status !== 'started') fail('invalid_transition');
  if (attempt.platform !== D.PLATFORM_META) fail('validation_failed', { field: 'platform' });
  if (attempt.published === true || attempt.external_action_taken === true) fail('invalid_transition');

  const reqRow = await lockPublishRequest(c, o.tenantId, draftId, publishingRequestId);
  if (!reqRow) fail('not_found');

  const authorized = await assertPublishAuthorizedOnClient(c, o.tenantId, draftId);
  const draft = authorized.draft;
  const pub = authorized.approval;
  if (draft.status !== 'approved_for_publish') fail('approval_required');
  const snapshotHash = sha256Hex(pub.snapshot_json);
  assertRequestMatchesAuthorized(reqRow, draft, pub, snapshotHash);
  assertSame(intent.snapshot_hash, snapshotHash, 'approval_stale');
  assertSame(intent.contract_hash, pub.contract_hash, 'approval_stale');
  assertSame(intent.publish_approval_id, pub.id, 'approval_stale');
  assertSameNum(intent.revision, pub.revision, 'approval_stale');
  assertSame(confirmation.snapshot_hash, snapshotHash, 'approval_stale');
  assertSame(confirmation.contract_hash, pub.contract_hash, 'approval_stale');
  assertSame(confirmation.intent_hash, intent.intent_hash, 'approval_stale');
  assertSame(confirmation.request_hash, reqRow.request_hash, 'approval_stale');
  assertSame(confirmation.claim_token_hash, D.claimTokenHashOf(attempt.claim_token), 'approval_stale');

  const credRef = await vault.resolveTenantMetaCredentialRefForProviderDraft(c, {
    tenantId: o.tenantId,
    ownerUserId: o.userId,
    credentialRefId: confirmation.credential_ref_id,
  });
  assertSame(credRef.credential_ref_id, confirmation.credential_ref_id, 'approval_stale');

  const actor = boundActorId(pub);
  if (Number(o.userId) !== actor) fail('permission_denied');
  if (Number(reqRow.requested_by) !== Number(o.userId)) fail('permission_denied');
  if (Number(intent.requested_by) !== Number(o.userId)) fail('permission_denied');
  if (Number(confirmation.requested_by) !== Number(o.userId)) fail('permission_denied');
  await assertActiveMember(c, o.tenantId, o.userId);

  const nowMs = await currentDbTimeMs(c);
  assertAttemptLeaseLiveAt(attempt, nowMs);
  if (isExpired(confirmation, nowMs)) fail('approval_expired');
  if (confirmation.status !== D.CONFIRMATION_STATUS) fail('invalid_transition');
  if (confirmation.spent_at) fail('invalid_transition');

  return {
    draft,
    pub,
    request: reqRow,
    intent,
    outbox,
    attempt,
    credRef,
    snapshotHash,
    workflowId: draft.workflow_id,
    nowMs,
  };
}

function bindingFromGraph(graph, confirmation) {
  return {
    tenant_id: Number(graph.intent.tenant_id),
    revision: Number(graph.pub.revision),
    workflow_approval_id: Number(graph.pub.workflow_approval_id),
    generation: Number(graph.attempt.generation),
    credential_ref_version: Number(graph.credRef.credential_ref_version),
    requested_by: Number(graph.intent.requested_by),
    draft_id: String(graph.draft.id),
    publish_approval_id: String(graph.pub.id),
    publishing_request_id: String(graph.request.id),
    intent_id: String(graph.intent.id),
    outbox_id: String(graph.outbox.id),
    attempt_id: String(graph.attempt.id),
    challenge_id: String(confirmation.challenge_id),
    confirmation_id: String(confirmation.id),
    credential_ref_id: String(graph.credRef.credential_ref_id),
    claim_token_hash: String(confirmation.claim_token_hash),
    intent_hash: String(graph.intent.intent_hash),
    snapshot_hash: String(graph.snapshotHash),
    contract_hash: String(graph.pub.contract_hash),
    request_hash: String(graph.request.request_hash),
    phrase_digest: String(confirmation.phrase_digest),
    account_fingerprint: String(graph.credRef.account_fingerprint),
    issued_at_ms: graph.nowMs,
    expires_at_ms: graph.nowMs + caps.CAPABILITY_TTL_MS,
  };
}

async function spendConfirmation(c, confirmation) {
  const row = (await c.query(
    `UPDATE ${CONFIRM_TABLE}
        SET status='spent', spent_at=now()
      WHERE tenant_id=$1 AND id=$2 AND status='confirmed' AND spent_at IS NULL
      RETURNING *`,
    [confirmation.tenant_id, confirmation.id]
  )).rows[0];
  if (!row) fail('invalid_transition');
  return row;
}

async function insertExecutionRow(c, graph, confirmation, userId, idempotencyKey) {
  const id = newId('cpdex');
  return (await c.query(
    `INSERT INTO ${EXEC_TABLE}
       (id, tenant_id, confirmation_id, challenge_id, draft_id, revision,
        publish_approval_id, workflow_approval_id, publishing_request_id,
        intent_id, outbox_id, attempt_id, credential_ref_id, generation,
        contract_hash, snapshot_hash, intent_hash, request_hash, claim_token_hash,
        contract_version, operation, platform, connector, status, idempotency_key,
        requested_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
             $20,$21,$22,$23,'started',$24,$25)
     RETURNING *`,
    [
      id, graph.intent.tenant_id, confirmation.id, confirmation.challenge_id,
      graph.draft.id, Number(graph.pub.revision), graph.pub.id, graph.pub.workflow_approval_id,
      graph.request.id, graph.intent.id, graph.outbox.id, graph.attempt.id,
      graph.credRef.credential_ref_id, Number(graph.attempt.generation),
      graph.pub.contract_hash, graph.snapshotHash, graph.intent.intent_hash,
      graph.request.request_hash, confirmation.claim_token_hash,
      D.CONTRACT_VERSION, D.OPERATION, D.PLATFORM_META, D.EXEC_CONNECTOR,
      idempotencyKey, userId,
    ]
  )).rows[0];
}

async function appendProviderObjects(c, execution, objects) {
  const rows = [];
  for (const obj of objects) {
    const id = newId('cpo');
    const row = (await c.query(
      `INSERT INTO ${OBJECT_TABLE}
         (id, tenant_id, execution_id, confirmation_id, attempt_id,
          object_kind, provider_object_id, provider_status, sequence_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        id, execution.tenant_id, execution.id, execution.confirmation_id,
        execution.attempt_id, obj.object_kind, obj.provider_object_id,
        obj.provider_status, obj.sequence_number,
      ]
    )).rows[0];
    rows.push(row);
  }
  return rows;
}

async function markObjectsCompensated(c, tenantId, executionId, objects) {
  let count = 0;
  for (const obj of objects) {
    if (!obj.compensated) continue;
    await c.query(
      `UPDATE ${OBJECT_TABLE}
          SET compensated=TRUE, compensated_at=now()
        WHERE tenant_id=$1 AND execution_id=$2 AND sequence_number=$3
          AND compensated=FALSE`,
      [tenantId, executionId, obj.sequence_number]
    );
    count += 1;
  }
  return count;
}

async function settleExecution(c, execution, outcome) {
  return (await c.query(
    `UPDATE ${EXEC_TABLE}
        SET status=$3, outcome=$4, error_code=$5, objects_created=$6,
            objects_compensated=$7, external_action_taken=$8, settled_at=now()
      WHERE tenant_id=$1 AND id=$2 AND status='started'
      RETURNING *`,
    [
      execution.tenant_id, execution.id, outcome.status, outcome.outcome,
      outcome.error_code, outcome.objects_created, outcome.objects_compensated,
      outcome.external_action_taken === true,
    ]
  )).rows[0];
}

async function terminalizeAttempt(c, attempt, outcome) {
  const attemptStatus = outcome.outcome === 'complete'
    ? 'provider_draft_complete'
    : (outcome.outcome === 'partial' ? 'provider_draft_partial' : 'provider_draft_failed');
  return (await c.query(
    `UPDATE orchestrator_campaign_delivery_attempts
        SET status=$3, connector='meta', simulated=FALSE,
            external_action_taken=$4, retryable=FALSE, error_code=$5,
            settled_at=now()
      WHERE tenant_id=$1 AND id=$2 AND status='started'
      RETURNING *`,
    [
      attempt.tenant_id, attempt.id, attemptStatus,
      outcome.external_action_taken === true, outcome.error_code,
    ]
  )).rows[0];
}

async function parkOutbox(c, tenantId, outboxId) {
  return (await c.query(
    `UPDATE orchestrator_outbox
        SET state='pending', claimed_by=NULL, claimed_until=NULL,
            next_attempt_at=now() + ($3::int * interval '1 day'), updated_at=now()
      WHERE tenant_id=$1 AND id=$2
      RETURNING *`,
    [tenantId, outboxId, PARK_DAYS]
  )).rows[0];
}

async function insertExecutionAudit(c, { tenantId, workflowId, actorUserId, detail }) {
  const sanitized = D.sanitizeExecAuditDetail(detail);
  await c.query(
    `INSERT INTO orchestrator_audit_events
       (tenant_id, workflow_id, event, actor_user_id, detail)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [tenantId, workflowId, D.AUDIT_EVENT_EXECUTION, actorUserId || null, JSON.stringify(sanitized)]
  );
}

function publicExecution(row, objects) {
  return {
    object_kind: D.OBJECT_KIND_EXECUTION,
    id: row.id,
    tenant_id: row.tenant_id,
    confirmation_id: row.confirmation_id,
    draft_id: row.draft_id,
    publishing_request_id: row.publishing_request_id,
    intent_id: row.intent_id,
    attempt_id: row.attempt_id,
    status: row.status,
    outcome: row.outcome,
    objects_created: Number(row.objects_created),
    objects_compensated: Number(row.objects_compensated),
    published: row.published === true,
    external_action_taken: row.external_action_taken === true,
    simulated: row.simulated === true,
    settled_at: row.settled_at,
    created_at: row.started_at,
    provider_objects: (objects || []).map((o) => ({
      object_kind: D.OBJECT_KIND_PROVIDER_OBJECT,
      sequence_number: Number(o.sequence_number),
      provider_object_kind: o.object_kind,
      provider_status: o.provider_status,
      compensated: o.compensated === true,
    })),
  };
}

function mapProviderResult(result) {
  const complete = result.ok === true && result.partial !== true;
  const partial = result.partial === true;
  return {
    status: complete ? 'complete' : (partial ? 'partial' : 'failed'),
    outcome: complete ? 'complete' : (partial ? 'partial' : 'failed'),
    error_code: result.error_code || (complete ? null : 'provider_create_failed'),
    objects_created: Number(result.objects_created || 0),
    objects_compensated: Number(result.objects_compensated || 0),
    external_action_taken: result.external_action_taken === true,
    objects: result.objects || [],
  };
}

function assertExecutionReplayAllowed(execution, o, parsed) {
  assertSame(execution.draft_id, o.draftId, 'not_found');
  assertSame(execution.publishing_request_id, o.publishingRequestId, 'not_found');
  assertSame(execution.intent_id, o.intentId, 'not_found');
  assertSame(execution.confirmation_id, parsed.confirmation_id, 'not_found');
  assertSameNum(execution.requested_by, o.userId, 'permission_denied');
}

async function loadExecutionObjects(c, execution) {
  return (await c.query(
    `SELECT object_kind, provider_status, sequence_number, compensated
       FROM ${OBJECT_TABLE} WHERE tenant_id=$1 AND execution_id=$2 ORDER BY sequence_number`,
    [execution.tenant_id, execution.id]
  )).rows;
}

async function reserveProviderDraftExecution(pool, o) {
  const parsed = D.parseExecuteBody(o.body, { idempotencyKey: o.idempotencyKey });

  return withTx(pool, async (c) => {
    const byKey = await loadExecutionByKey(c, o.tenantId, parsed.idempotency_key);
    if (byKey) {
      if (String(byKey.confirmation_id) !== parsed.confirmation_id) {
        fail('idempotency_conflict', { field: 'idempotency_key' });
      }
      assertExecutionReplayAllowed(byKey, o, parsed);
      const objects = await loadExecutionObjects(c, byKey);
      return { replay: true, row: byKey, objects };
    }

    const confirmation = await lockConfirmation(c, o.tenantId, parsed.confirmation_id);
    if (!confirmation) fail('not_found');
    if (String(confirmation.draft_id) !== String(o.draftId)
        || String(confirmation.publishing_request_id) !== String(o.publishingRequestId)
        || String(confirmation.intent_id) !== String(o.intentId)) {
      fail('not_found');
    }

    const raced = await loadExecutionByConfirmation(c, o.tenantId, confirmation.id);
    if (raced) {
      if (String(raced.idempotency_key) !== parsed.idempotency_key) {
        fail('idempotency_conflict', { field: 'confirmation_id' });
      }
      assertExecutionReplayAllowed(raced, o, parsed);
      const objects = await loadExecutionObjects(c, raced);
      return { replay: true, row: raced, objects };
    }

    const graph = await loadAuthoritativeGraph(c, o, confirmation);
    const binding = bindingFromGraph(graph, confirmation);
    let capability;
    let execution;

    await caps.withAdvertisingProviderExecutionTransaction(c, async (txHandle) => {
      capability = await caps.mintMetaCreateProviderDraftCapability(txHandle, binding);
      await spendConfirmation(c, confirmation);
      await caps.assertMetaCreateProviderDraftCapability(capability, binding, { now: graph.nowMs });
      execution = await insertExecutionRow(c, graph, confirmation, o.userId, parsed.idempotency_key);
    });

    return {
      replay: false,
      row: execution,
      objects: [],
      graph,
      confirmation,
      capability,
    };
  });
}

function transportFailureOutcome() {
  return Object.freeze({
    ok: false,
    partial: false,
    objects: Object.freeze([]),
    objects_created: 0,
    objects_compensated: 0,
    error_code: 'provider_transport_failed',
    published: false,
    external_action_taken: false,
    activated: false,
  });
}

async function invokeProviderDraftGraph(pool, reserve, o) {
  try {
    return await vault.withTenantMetaCredentialSecretForConsumedProviderDraft(pool, {
      capability: reserve.capability,
    }, async (credentials) => createPausedDraftGraph({
      capability: reserve.capability,
      credentials,
      snapshot: reserve.graph.pub.snapshot_json,
      inject: o.inject,
    }));
  } catch (_err) {
    return transportFailureOutcome();
  }
}

async function finalizeProviderDraftExecution(pool, reserve, providerOutcome, userId) {
  const mapped = mapProviderResult(providerOutcome);
  return withTx(pool, async (c) => {
    let execution = reserve.row;
    const providerObjects = mapped.objects || [];

    if (providerObjects.length) {
      await appendProviderObjects(c, execution, providerObjects);
      await markObjectsCompensated(c, execution.tenant_id, execution.id, providerObjects);
    }

    execution = await settleExecution(c, execution, mapped);
    await terminalizeAttempt(c, reserve.graph.attempt, mapped);
    await parkOutbox(c, reserve.graph.outbox.tenant_id, reserve.graph.outbox.id);
    await insertExecutionAudit(c, {
      tenantId: reserve.graph.intent.tenant_id,
      workflowId: reserve.graph.workflowId,
      actorUserId: userId,
      detail: {
        action: 'execute',
        state: mapped.status,
        status: mapped.status,
        outcome: mapped.outcome,
        gate: D.GATE,
        operation: D.OPERATION,
        contract_version: D.CONTRACT_VERSION,
        platform: D.PLATFORM_META,
        confirmation_id: reserve.confirmation.id,
        execution_id: execution.id,
        draft_id: reserve.graph.draft.id,
        intent_id: reserve.graph.intent.id,
        attempt_id: reserve.graph.attempt.id,
        publishing_request_id: reserve.graph.request.id,
        revision: Number(reserve.graph.pub.revision),
        generation: Number(reserve.graph.attempt.generation),
        requested_by: Number(userId),
        objects_created: mapped.objects_created,
        objects_compensated: mapped.objects_compensated,
        published: false,
        external_action_taken: mapped.external_action_taken,
        replay: false,
      },
    });

    return { row: execution, objects: providerObjects, replay: false };
  });
}

async function executeProviderDraft(pool, o) {
  if (o.bodyTenantId != null && Number(o.bodyTenantId) !== Number(o.tenantId)) {
    fail('validation_failed');
  }

  const reserve = await reserveProviderDraftExecution(pool, o);
  if (reserve.replay) {
    return { row: reserve.row, objects: reserve.objects, replay: true };
  }

  const providerOutcome = await invokeProviderDraftGraph(pool, reserve, o);
  return finalizeProviderDraftExecution(pool, reserve, providerOutcome, o.userId);
}

module.exports = {
  executeProviderDraft,
  publicExecution,
};
