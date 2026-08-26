'use strict';

const { fail } = require('./errors');
const { newId } = require('./runner');
const { sha256Hex } = require('./hash');
const D = require('./campaign_delivery_contracts');
const { assertPublishAuthorizedOnClient } = require('./campaign_drafts');
const { lockPublishRequest } = require('./campaign_publish_requests');
const { latestAttemptForOutbox } = require('./campaign_delivery_attempts');
const { lockByTenantAndId } = require('./outbox');
const { assertActiveMember, boundActorId, assertRequestMatchesAuthorized } = require('./campaign_delivery_intents');
const { resolveTenantMetaCredentialRefForProviderDraft } = require('../credentials/vault');

const UNIQUE_VIOLATION = '23505';
const CHALLENGE_SAVEPOINT = 'sp_campaign_provider_challenge';
const CONFIRM_SAVEPOINT = 'sp_campaign_provider_confirm';
const CHALLENGE_TABLE = 'orchestrator_campaign_provider_challenges';
const CONFIRM_TABLE = 'orchestrator_campaign_provider_confirmations';

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

function lockIntent(c, tenantId, intentId) {
  if (!intentId) return Promise.resolve(null);
  return one(c,
    `SELECT * FROM orchestrator_campaign_delivery_intents
      WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
    [tenantId, intentId]);
}

function lockChallenge(c, tenantId, challengeId) {
  if (!challengeId) return Promise.resolve(null);
  return one(c,
    `SELECT * FROM ${CHALLENGE_TABLE} WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
    [tenantId, challengeId]);
}

function loadChallengeByKey(c, tenantId, key) {
  return one(c, `SELECT * FROM ${CHALLENGE_TABLE} WHERE tenant_id=$1 AND idempotency_key=$2`, [tenantId, key]);
}

function loadChallengeByAttempt(c, tenantId, attemptId) {
  return one(c, `SELECT * FROM ${CHALLENGE_TABLE} WHERE tenant_id=$1 AND attempt_id=$2`, [tenantId, attemptId]);
}

function loadConfirmByKey(c, tenantId, key) {
  return one(c, `SELECT * FROM ${CONFIRM_TABLE} WHERE tenant_id=$1 AND idempotency_key=$2`, [tenantId, key]);
}

function loadConfirmByChallenge(c, tenantId, challengeId) {
  return one(c, `SELECT * FROM ${CONFIRM_TABLE} WHERE tenant_id=$1 AND challenge_id=$2`, [tenantId, challengeId]);
}

function parseOutboxPayload(value) {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (_) { return null; }
  }
  if (v == null || typeof v !== 'object' || Array.isArray(v) || Buffer.isBuffer(v)) return null;
  return v;
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

async function resolveBoundCredentialRef(c, tenantId, userId) {
  let resolved;
  try {
    resolved = await resolveTenantMetaCredentialRefForProviderDraft(c, {
      tenantId,
      ownerUserId: userId,
    });
  } catch (err) {
    const code = err && err.code;
    if (code === 'missing_credentials' || code === 'permission_denied' || code === 'validation_failed') {
      fail(code);
    }
    throw err;
  }
  const id = resolved && resolved.credential_ref_id;
  if (!id) fail('missing_credentials');
  return { id: String(id) };
}

async function loadAuthoritativeGraph(c, o) {
  const draftId = String(o.draftId || '');
  const publishingRequestId = String(o.publishingRequestId || '');
  const intentId = String(o.intentId || '');
  if (!draftId || !publishingRequestId || !intentId) fail('not_found');

  const intent = await lockIntent(c, o.tenantId, intentId);
  if (!intent) fail('not_found');
  assertSame(intent.draft_id, draftId, 'not_found');
  assertSame(intent.publishing_request_id, publishingRequestId, 'not_found');
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
  if (payload.operation !== D.OPERATION) fail('validation_failed', { field: 'operation' });
  if (payload.contract_version !== D.CONTRACT_VERSION) fail('validation_failed', { field: 'contract_version' });

  const attempt = await latestAttemptForOutbox(c, { tenantId: o.tenantId, outboxId: intent.outbox_id });
  if (!attempt) fail('not_found');
  assertSame(attempt.draft_id, draftId, 'not_found');
  assertSame(attempt.publishing_request_id, publishingRequestId, 'not_found');
  assertSame(attempt.intent_id, intentId, 'not_found');
  assertSame(outbox.id, attempt.outbox_id, 'approval_stale');
  assertSame(intent.outbox_id, attempt.outbox_id, 'approval_stale');
  assertSame(intent.intent_hash, attempt.intent_hash, 'approval_stale');
  if (attempt.status !== 'started') fail('invalid_transition');
  if (attempt.platform !== D.PLATFORM_META) fail('validation_failed', { field: 'platform' });
  if (attempt.operation !== D.OPERATION) fail('validation_failed', { field: 'operation' });
  if (attempt.contract_version !== D.CONTRACT_VERSION) fail('validation_failed', { field: 'contract_version' });
  if (attempt.connector !== D.CONNECTOR) fail('invalid_transition');
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
  assertSameNum(intent.workflow_approval_id, pub.workflow_approval_id, 'approval_stale');
  assertSameNum(intent.revision, pub.revision, 'approval_stale');

  const actor = boundActorId(pub);
  if (Number(o.userId) !== actor) fail('permission_denied');
  if (Number(reqRow.requested_by) !== Number(o.userId)) fail('permission_denied');
  if (Number(intent.requested_by) !== Number(o.userId)) fail('permission_denied');
  await assertActiveMember(c, o.tenantId, o.userId);

  const cred = await resolveBoundCredentialRef(c, o.tenantId, o.userId);
  const claimTokenHash = D.claimTokenHashOf(attempt.claim_token);
  assertAttemptLeaseLiveAt(attempt, await currentDbTimeMs(c));

  return {
    draft,
    pub,
    request: reqRow,
    intent,
    outbox,
    attempt,
    cred,
    snapshotHash,
    claimTokenHash,
    workflowId: draft.workflow_id,
  };
}

function publicChallenge(row) {
  return {
    object_kind: D.OBJECT_KIND_CHALLENGE,
    id: row.id,
    tenant_id: row.tenant_id,
    draft_id: row.draft_id,
    publishing_request_id: row.publishing_request_id,
    intent_id: row.intent_id,
    attempt_id: row.attempt_id,
    status: row.status,
    contract_version: row.contract_version,
    operation: row.operation,
    requested_by: row.requested_by,
    expires_at: row.expires_at,
    created_at: row.created_at,
  };
}

function publicConfirmation(row) {
  return {
    object_kind: D.OBJECT_KIND_CONFIRMATION,
    id: row.id,
    tenant_id: row.tenant_id,
    challenge_id: row.challenge_id,
    draft_id: row.draft_id,
    publishing_request_id: row.publishing_request_id,
    intent_id: row.intent_id,
    attempt_id: row.attempt_id,
    status: row.status,
    contract_version: row.contract_version,
    operation: row.operation,
    requested_by: row.requested_by,
    expires_at: row.expires_at,
    created_at: row.created_at,
  };
}

function challengeMatchesGraph(row, graph, userId) {
  if (!row) return;
  assertSame(row.draft_id, graph.draft.id, 'idempotency_conflict');
  assertSame(row.publishing_request_id, graph.request.id, 'idempotency_conflict');
  assertSame(row.intent_id, graph.intent.id, 'idempotency_conflict');
  assertSame(row.attempt_id, graph.attempt.id, 'idempotency_conflict');
  assertSame(row.outbox_id, graph.outbox.id, 'idempotency_conflict');
  assertSame(row.publish_approval_id, graph.pub.id, 'idempotency_conflict');
  assertSameNum(row.workflow_approval_id, graph.pub.workflow_approval_id, 'idempotency_conflict');
  assertSameNum(row.revision, graph.pub.revision, 'approval_stale');
  assertSame(row.contract_hash, graph.pub.contract_hash, 'approval_stale');
  assertSame(row.snapshot_hash, graph.snapshotHash, 'approval_stale');
  assertSame(row.intent_hash, graph.intent.intent_hash, 'approval_stale');
  assertSame(row.request_hash, graph.request.request_hash, 'approval_stale');
  assertSame(row.claim_token_hash, graph.claimTokenHash, 'approval_stale');
  assertSame(row.credential_ref_id, graph.cred.id, 'idempotency_conflict');
  assertSameNum(row.generation, graph.attempt.generation, 'approval_stale');
  if (Number(row.requested_by) !== Number(userId)) fail('permission_denied');
  if (row.contract_version !== D.CONTRACT_VERSION) fail('validation_failed');
  if (row.operation !== D.OPERATION) fail('validation_failed');
  if (row.platform !== D.PLATFORM_META) fail('validation_failed');
}

function confirmMatchesChallenge(row, challenge, graph, userId, digest) {
  if (!row) return;
  assertSame(row.challenge_id, challenge.id, 'idempotency_conflict');
  assertSame(row.draft_id, challenge.draft_id, 'idempotency_conflict');
  assertSame(row.attempt_id, challenge.attempt_id, 'idempotency_conflict');
  assertSame(row.intent_id, challenge.intent_id, 'idempotency_conflict');
  assertSame(row.outbox_id, challenge.outbox_id, 'idempotency_conflict');
  assertSame(row.publishing_request_id, challenge.publishing_request_id, 'idempotency_conflict');
  assertSame(row.phrase_salt, challenge.phrase_salt, 'idempotency_conflict');
  assertSame(row.phrase_digest, digest, 'idempotency_conflict');
  assertSame(row.claim_token_hash, challenge.claim_token_hash, 'approval_stale');
  assertSame(row.contract_hash, challenge.contract_hash, 'approval_stale');
  assertSame(row.snapshot_hash, challenge.snapshot_hash, 'approval_stale');
  assertSame(row.intent_hash, challenge.intent_hash, 'approval_stale');
  assertSame(row.request_hash, challenge.request_hash, 'approval_stale');
  assertSame(row.credential_ref_id, graph.cred.id, 'idempotency_conflict');
  if (Number(row.requested_by) !== Number(userId)) fail('permission_denied');
  if (row.contract_version !== D.CONTRACT_VERSION) fail('validation_failed');
  if (row.operation !== D.OPERATION) fail('validation_failed');
  if (row.platform !== D.PLATFORM_META) fail('validation_failed');
}

async function insertChallengeAudit(c, { tenantId, workflowId, actorUserId, row, replay }) {
  const detail = D.sanitizeConfirmAuditDetail({
    action: 'challenge',
    from: 'none',
    to: D.CHALLENGE_STATUS,
    state: row.status,
    status: row.status,
    gate: D.GATE,
    operation: row.operation,
    contract_version: row.contract_version,
    platform: D.PLATFORM_META,
    challenge_id: row.id,
    draft_id: row.draft_id,
    intent_id: row.intent_id,
    attempt_id: row.attempt_id,
    publishing_request_id: row.publishing_request_id,
    revision: Number(row.revision),
    generation: Number(row.generation),
    requested_by: Number(row.requested_by),
    replay: replay === true,
  });
  await c.query(
    `INSERT INTO orchestrator_audit_events
       (tenant_id, workflow_id, event, actor_user_id, detail)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [tenantId, workflowId, D.AUDIT_EVENT_CHALLENGE, actorUserId || null, JSON.stringify(detail)]
  );
}

async function insertConfirmAudit(c, { tenantId, workflowId, actorUserId, row, replay }) {
  const detail = D.sanitizeConfirmAuditDetail({
    action: 'confirm',
    from: D.CHALLENGE_STATUS,
    to: D.CONFIRMATION_STATUS,
    state: row.status,
    status: row.status,
    gate: D.GATE,
    operation: row.operation,
    contract_version: row.contract_version,
    platform: D.PLATFORM_META,
    challenge_id: row.challenge_id,
    confirmation_id: row.id,
    draft_id: row.draft_id,
    intent_id: row.intent_id,
    attempt_id: row.attempt_id,
    publishing_request_id: row.publishing_request_id,
    revision: Number(row.revision),
    generation: Number(row.generation),
    requested_by: Number(row.requested_by),
    replay: replay === true,
  });
  await c.query(
    `INSERT INTO orchestrator_audit_events
       (tenant_id, workflow_id, event, actor_user_id, detail)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [tenantId, workflowId, D.AUDIT_EVENT_CONFIRMATION, actorUserId || null, JSON.stringify(detail)]
  );
}

async function insertChallengeRow(c, graph, userId, idempotencyKey) {
  const id = newId('cpc');
  const salt = D.newPhraseSalt();
  return (await c.query(
    `INSERT INTO ${CHALLENGE_TABLE}
       (id, tenant_id, draft_id, revision, publish_approval_id, workflow_approval_id,
        publishing_request_id, intent_id, outbox_id, attempt_id, credential_ref_id,
        generation, contract_hash, snapshot_hash, intent_hash, request_hash, claim_token_hash,
        contract_version, operation, platform, phrase_salt, status, idempotency_key,
        requested_by, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
             $18,$19,$20,$21,$22,$23,$24, now() + interval '5 minutes')
     RETURNING *`,
    [
      id, graph.draft.tenant_id || graph.attempt.tenant_id, graph.draft.id, Number(graph.pub.revision), graph.pub.id,
      graph.pub.workflow_approval_id, graph.request.id, graph.intent.id, graph.outbox.id,
      graph.attempt.id, graph.cred.id, Number(graph.attempt.generation),
      graph.pub.contract_hash, graph.snapshotHash, graph.intent.intent_hash,
      graph.request.request_hash, graph.claimTokenHash,
      D.CONTRACT_VERSION, D.OPERATION, D.PLATFORM_META, salt, D.CHALLENGE_STATUS,
      idempotencyKey, userId,
    ]
  )).rows[0];
}

async function insertConfirmRow(c, challenge, userId, idempotencyKey, digest) {
  const id = newId('cpcf');
  return (await c.query(
    `INSERT INTO ${CONFIRM_TABLE}
       (id, tenant_id, challenge_id, draft_id, revision, publish_approval_id, workflow_approval_id,
        publishing_request_id, intent_id, outbox_id, attempt_id, credential_ref_id,
        generation, contract_hash, snapshot_hash, intent_hash, request_hash, claim_token_hash,
        contract_version, operation, platform, phrase_salt, phrase_digest, status,
        idempotency_key, requested_by, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
             $19,$20,$21,$22,$23,$24,$25,$26, now() + interval '2 minutes')
     RETURNING *`,
    [
      id, challenge.tenant_id, challenge.id, challenge.draft_id, Number(challenge.revision),
      challenge.publish_approval_id, challenge.workflow_approval_id, challenge.publishing_request_id,
      challenge.intent_id, challenge.outbox_id, challenge.attempt_id, challenge.credential_ref_id,
      Number(challenge.generation), challenge.contract_hash, challenge.snapshot_hash,
      challenge.intent_hash, challenge.request_hash, challenge.claim_token_hash,
      D.CONTRACT_VERSION, D.OPERATION, D.PLATFORM_META, challenge.phrase_salt, digest,
      D.CONFIRMATION_STATUS, idempotencyKey, userId,
    ]
  )).rows[0];
}

async function consumeChallenge(c, challenge, confirmation) {
  await c.query(
    `UPDATE ${CHALLENGE_TABLE}
        SET status='consumed', consumed_at=now(), consumed_confirmation_id=$3
      WHERE tenant_id=$1 AND id=$2 AND status='open' AND consumed_at IS NULL`,
    [challenge.tenant_id, challenge.id, confirmation.id]
  );
}

function replayChallenge(existing, graph, userId, nowMs) {
  challengeMatchesGraph(existing, graph, userId);
  if (existing.status !== D.CHALLENGE_STATUS && existing.status !== 'consumed') {
    fail('invalid_transition');
  }
  if (existing.status === D.CHALLENGE_STATUS && isExpired(existing, nowMs)) fail('approval_expired');
  return { row: existing, replay: true };
}

function replayConfirm(existing, challenge, graph, userId, digest) {
  confirmMatchesChallenge(existing, challenge, graph, userId, digest);
  return { row: existing, replay: true };
}

async function createChallenge(pool, o) {
  if (o.bodyTenantId != null && Number(o.bodyTenantId) !== Number(o.tenantId)) fail('validation_failed');
  const parsed = D.parseChallengeBody(o.body, { idempotencyKey: o.idempotencyKey });

  return withTx(pool, async (c) => {
    const graph = await loadAuthoritativeGraph(c, o);
    const byKey = await loadChallengeByKey(c, o.tenantId, parsed.idempotency_key);
    if (byKey) {
      if (String(byKey.attempt_id) !== String(graph.attempt.id)) {
        fail('idempotency_conflict', { field: 'idempotency_key' });
      }
      const nowMs = await currentDbTimeMs(c);
      assertAttemptLeaseLiveAt(graph.attempt, nowMs);
      return replayChallenge(byKey, graph, o.userId, nowMs);
    }
    const byAttempt = await loadChallengeByAttempt(c, o.tenantId, graph.attempt.id);
    if (byAttempt) {
      if (String(byAttempt.idempotency_key) !== parsed.idempotency_key) {
        fail('idempotency_conflict', { field: 'idempotency_key' });
      }
      const nowMs = await currentDbTimeMs(c);
      assertAttemptLeaseLiveAt(graph.attempt, nowMs);
      return replayChallenge(byAttempt, graph, o.userId, nowMs);
    }

    let row;
    try {
      assertAttemptLeaseLiveAt(graph.attempt, await currentDbTimeMs(c));
      await c.query(`SAVEPOINT ${CHALLENGE_SAVEPOINT}`);
      row = await insertChallengeRow(c, graph, o.userId, parsed.idempotency_key);
      await insertChallengeAudit(c, {
        tenantId: o.tenantId, workflowId: graph.workflowId, actorUserId: o.userId, row, replay: false,
      });
      await c.query(`RELEASE SAVEPOINT ${CHALLENGE_SAVEPOINT}`);
    } catch (err) {
      try { await c.query(`ROLLBACK TO SAVEPOINT ${CHALLENGE_SAVEPOINT}`); } catch (_) { /* ignore */ }
      if (!err || err.code !== UNIQUE_VIOLATION) throw err;
      const raced = await loadChallengeByKey(c, o.tenantId, parsed.idempotency_key)
        || await loadChallengeByAttempt(c, o.tenantId, graph.attempt.id);
      if (raced) {
        const nowMs = await currentDbTimeMs(c);
        assertAttemptLeaseLiveAt(graph.attempt, nowMs);
        return replayChallenge(raced, graph, o.userId, nowMs);
      }
      fail('idempotency_conflict', { field: 'idempotency_key' });
    }
    return { row, replay: false };
  });
}

async function confirmProviderDraft(pool, o) {
  if (o.bodyTenantId != null && Number(o.bodyTenantId) !== Number(o.tenantId)) fail('validation_failed');
  const parsed = D.parseConfirmBody(o.body, { idempotencyKey: o.idempotencyKey });

  return withTx(pool, async (c) => {
    const graph = await loadAuthoritativeGraph(c, o);
    const byKey = await loadConfirmByKey(c, o.tenantId, parsed.idempotency_key);
    if (byKey) {
      if (String(byKey.challenge_id) !== parsed.confirmation_challenge_id
          || String(byKey.attempt_id) !== String(graph.attempt.id)) {
        fail('idempotency_conflict', { field: 'idempotency_key' });
      }
      const existingChallenge = await lockChallenge(c, o.tenantId, byKey.challenge_id);
      if (!existingChallenge) fail('idempotency_conflict', { field: 'idempotency_key' });
      challengeMatchesGraph(existingChallenge, graph, o.userId);
      const digest = D.phraseDigestOf(existingChallenge.phrase_salt, parsed.confirmation_phrase);
      if (String(byKey.phrase_digest) !== String(digest)) {
        fail('idempotency_conflict', { field: 'idempotency_key' });
      }
      return replayConfirm(byKey, existingChallenge, graph, o.userId, digest);
    }

    const challenge = await lockChallenge(c, o.tenantId, parsed.confirmation_challenge_id);
    if (!challenge) fail('not_found');
    challengeMatchesGraph(challenge, graph, o.userId);
    const digest = D.phraseDigestOf(challenge.phrase_salt, parsed.confirmation_phrase);

    if (challenge.status !== D.CHALLENGE_STATUS) fail('invalid_transition');
    if (challenge.consumed_at || challenge.consumed_confirmation_id) fail('invalid_transition');
    const nowMs = await currentDbTimeMs(c);
    assertAttemptLeaseLiveAt(graph.attempt, nowMs);
    if (isExpired(challenge, nowMs)) fail('approval_expired');

    const byChallenge = await loadConfirmByChallenge(c, o.tenantId, challenge.id);
    if (byChallenge) {
      if (String(byChallenge.idempotency_key) !== parsed.idempotency_key) {
        fail('idempotency_conflict', { field: 'idempotency_key' });
      }
      return replayConfirm(byChallenge, challenge, graph, o.userId, digest);
    }

    let row;
    try {
      const finalNowMs = await currentDbTimeMs(c);
      assertAttemptLeaseLiveAt(graph.attempt, finalNowMs);
      if (isExpired(challenge, finalNowMs)) fail('approval_expired');
      await c.query(`SAVEPOINT ${CONFIRM_SAVEPOINT}`);
      row = await insertConfirmRow(c, challenge, o.userId, parsed.idempotency_key, digest);
      await consumeChallenge(c, challenge, row);
      await insertConfirmAudit(c, {
        tenantId: o.tenantId, workflowId: graph.workflowId, actorUserId: o.userId, row, replay: false,
      });
      await c.query(`RELEASE SAVEPOINT ${CONFIRM_SAVEPOINT}`);
    } catch (err) {
      try { await c.query(`ROLLBACK TO SAVEPOINT ${CONFIRM_SAVEPOINT}`); } catch (_) { /* ignore */ }
      if (!err || err.code !== UNIQUE_VIOLATION) throw err;
      const raced = await loadConfirmByKey(c, o.tenantId, parsed.idempotency_key)
        || await loadConfirmByChallenge(c, o.tenantId, challenge.id);
      if (raced) return replayConfirm(raced, challenge, graph, o.userId, digest);
      fail('idempotency_conflict', { field: 'idempotency_key' });
    }
    return { row, replay: false };
  });
}

module.exports = {
  createChallenge,
  confirmProviderDraft,
  publicChallenge,
  publicConfirmation,
};
