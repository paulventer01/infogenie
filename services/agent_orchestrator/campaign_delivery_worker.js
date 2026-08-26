'use strict';

const _db = require('../../db');
const _runtimeFlags = require('../runtime_flags');
const { logger } = require('../infra/logger');
const { fail, OrchError } = require('./errors');
const { sha256Hex } = require('./hash');
const C = require('./campaign_contracts');
const D = require('./campaign_delivery_contracts');
const { assertPublishAuthorizedOnClient } = require('./campaign_drafts');
const { lockPublishRequest } = require('./campaign_publish_requests');
const {
  assertActiveMember, assertRequestMatchesAuthorized, boundActorId, platformAccount,
  publicOutbox,
} = require('./campaign_delivery_intents');
const { simulateDelivery } = require('./campaign_delivery_fake_connector');
const attempts = require('./campaign_delivery_attempts');
const sandboxOutcomes = require('./campaign_delivery_sandbox_outcomes');

const PER_TENANT_CAP = 20;
const PARK_SET = new Set(D.TERMINAL_PARK_STATUSES);
const ERROR_CODE_RE = /^[a-z0-9_]{1,40}$/;
const AUDIT_DETAIL_KEYS = Object.freeze([
  'attempt_id', 'attempt_number', 'generation',
  'intent_id', 'outbox_id', 'draft_id', 'request_id',
  'platform', 'status', 'scenario', 'retryable', 'error_code',
  'simulated', 'published', 'external_action_taken', 'lease_holder',
  'source',
]);

let tickActive = false;
let workerTimer = null;

function sanitizeCode(c) {
  return ERROR_CODE_RE.test(String(c || '')) ? String(c) : 'internal_error';
}

function defaultWorkerId() {
  return `cda-fake:${process.pid}`;
}

function instant(now) {
  if (now == null) return new Date();
  const d = now instanceof Date ? now : new Date(now);
  return Number.isFinite(d.getTime()) ? d : new Date();
}

function tsMs(v) {
  if (v == null) return null;
  const n = new Date(v).getTime();
  return Number.isFinite(n) ? n : null;
}

function sameTs(a, b) {
  const x = tsMs(a);
  const y = tsMs(b);
  return x != null && y != null && x === y;
}

function parsePlainObject(value) {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (_) { return null; }
  }
  if (v == null || typeof v !== 'object' || Array.isArray(v) || Buffer.isBuffer(v)) return null;
  return v;
}

function payloadExact(raw) {
  const payload = parsePlainObject(raw);
  if (!payload) return null;
  const keys = Object.keys(payload).sort();
  const expected = [...D.OUTBOX_PAYLOAD_KEYS].sort();
  if (keys.length !== expected.length || keys.some((k, i) => k !== expected[i])) return null;
  if (payload.contract_version !== D.CONTRACT_VERSION) return null;
  if (payload.operation !== D.OPERATION) return null;
  if (typeof payload.platform !== 'string' || !C.PLATFORMS.includes(payload.platform)) return null;
  if (typeof payload.credential_ref !== 'string' || !payload.credential_ref) return null;
  if (typeof payload.draft_id !== 'string' || !payload.draft_id) return null;
  if (typeof payload.intent_id !== 'string' || !payload.intent_id) return null;
  if (typeof payload.publishing_request_id !== 'string' || !payload.publishing_request_id) return null;
  if (typeof payload.workflow_id !== 'string' || !payload.workflow_id) return null;
  return payload;
}

async function restorePending(c, { tenantId, outboxId, now, days, seconds }) {
  if (days != null) {
    return (await c.query(
      `UPDATE orchestrator_outbox
          SET state='pending', claimed_by=NULL, claimed_until=NULL,
              next_attempt_at=COALESCE($3::timestamptz, now()) + ($4::int * interval '1 day'),
              updated_at=now()
        WHERE tenant_id=$1 AND id=$2
        RETURNING *`,
      [tenantId, outboxId, now ? instant(now).toISOString() : null, Number(days)]
    )).rows[0];
  }
  return (await c.query(
    `UPDATE orchestrator_outbox
        SET state='pending', claimed_by=NULL, claimed_until=NULL,
            next_attempt_at=COALESCE($3::timestamptz, now()) + ($4::int * interval '1 second'),
            updated_at=now()
      WHERE tenant_id=$1 AND id=$2
      RETURNING *`,
    [tenantId, outboxId, now ? instant(now).toISOString() : null, Number(seconds)]
  )).rows[0];
}

function sanitizeAuditDetail(detail) {
  const out = {};
  if (!detail || typeof detail !== 'object') return out;
  for (const k of AUDIT_DETAIL_KEYS) {
    const v = detail[k];
    if (v === undefined || v === null) continue;
    if (typeof v === 'boolean' || typeof v === 'number') { out[k] = v; continue; }
    if (typeof v === 'string') { out[k] = v.slice(0, 120); continue; }
  }
  return out;
}

async function insertSimulatedAudit(c, { tenantId, workflowId, actorUserId, detail }) {
  const sanitized = sanitizeAuditDetail(detail);
  await c.query(
    `INSERT INTO orchestrator_audit_events
       (tenant_id, workflow_id, event, actor_user_id, detail)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [tenantId, workflowId, D.AUDIT_EVENT_SIMULATED, actorUserId || null, JSON.stringify(sanitized)]
  );
}

function freezeEnvelope(row) {
  return Object.freeze({
    tenantId: Number(row.tenantId),
    outboxId: String(row.outboxId),
    intentId: String(row.intentId),
    attemptId: String(row.attemptId),
    attemptNumber: Number(row.attemptNumber),
    generation: Number(row.generation),
    claimToken: String(row.claimToken),
    leaseHolder: String(row.leaseHolder),
    leaseExpiresAt: row.leaseExpiresAt,
    platform: String(row.platform),
    scenario: String(row.scenario),
    outcomeSource: String(row.outcomeSource),
  });
}

function logWorkerFail(tenantId, err) {
  logger.info('campaign_delivery_worker_failed', {
    tenant_id: tenantId == null ? null : tenantId,
    error_code: sanitizeCode(err && err.code),
  });
}

async function lockIntent(c, tenantId, intentId) {
  if (!intentId) return null;
  return (await c.query(
    `SELECT * FROM orchestrator_campaign_delivery_intents
      WHERE tenant_id=$1 AND id=$2
      FOR UPDATE`,
    [tenantId, intentId]
  )).rows[0] || null;
}

async function lockOutbox(c, tenantId, outboxId) {
  if (!outboxId) return null;
  return (await c.query(
    `SELECT * FROM orchestrator_outbox
      WHERE tenant_id=$1 AND id=$2
      FOR UPDATE`,
    [tenantId, outboxId]
  )).rows[0] || null;
}

function intentMatchesOutbox(intent, outbox, payload) {
  if (!intent || !outbox || !payload) return false;
  if (String(intent.outbox_id) !== String(outbox.id)) return false;
  if (String(intent.id) !== String(payload.intent_id)) return false;
  if (String(intent.draft_id) !== String(payload.draft_id)) return false;
  if (String(intent.publishing_request_id) !== String(payload.publishing_request_id)) return false;
  if (String(outbox.workflow_id) !== String(payload.workflow_id)) return false;
  if (intent.status !== D.STATUS) return false;
  if (intent.operation !== D.OPERATION) return false;
  if (outbox.operation !== D.OPERATION) return false;
  if (outbox.destination !== D.DESTINATION) return false;
  if (String(outbox.credential_ref) !== String(payload.credential_ref)) return false;
  return true;
}

async function resolveOutcomeSource(c, { tenantId, outboxId, intentId, opts }) {
  if (opts && D.isKnownScenario(opts.scenario)) {
    return {
      scenario: opts.scenario,
      source: D.OUTCOME_SOURCE_TEST_OPTS,
      sandboxRow: null,
    };
  }
  const row = await sandboxOutcomes.lockUnconsumedOutcome(c, { tenantId, outboxId });
  if (!row) return null;
  if (String(row.intent_id) !== String(intentId)) return { corrupt: true };
  if (!D.isKnownScenario(row.scenario)) return { corrupt: true };
  return {
    scenario: row.scenario,
    source: D.OUTCOME_SOURCE_SANDBOX,
    sandboxRow: row,
  };
}

function isTestOptsScenario(opts) {
  return !!(opts && D.isKnownScenario(opts.scenario));
}

async function claimCampaignDeliveryAttempt(opts = {}) {
  const pool = opts.pool || (_db.hasDb() ? _db.getPool() : null);
  if (!pool || opts.tenantId == null) return { skip: true };
  const tenantId = Number(opts.tenantId);
  const now = instant(opts.now);
  const nowIso = now.toISOString();
  const workerId = String(opts.workerId || defaultWorkerId());
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const vals = [tenantId, nowIso];
    let extra = '';
    if (opts.outboxId) {
      vals.push(String(opts.outboxId));
      extra = `AND id=$${vals.length}`;
    }
    if (Array.isArray(opts.excludeOutboxIds) && opts.excludeOutboxIds.length) {
      vals.push(opts.excludeOutboxIds.map(String));
      extra += ` AND NOT (id = ANY($${vals.length}::text[]))`;
    }
    // Production / no opts.scenario: only claim outboxes that already have an
    // unconsumed sandbox outcome so older no-source rows cannot starve later
    // seeded work. Explicit outboxId keeps the no_outcome_source path.
    if (!opts.outboxId && !isTestOptsScenario(opts)) {
      extra += ` AND EXISTS (
        SELECT 1 FROM orchestrator_campaign_delivery_sandbox_outcomes so
         WHERE so.tenant_id = orchestrator_outbox.tenant_id
           AND so.outbox_id = orchestrator_outbox.id
           AND so.consumed_at IS NULL
      )`;
    }
    const picked = await c.query(
      `SELECT * FROM orchestrator_outbox
        WHERE tenant_id=$1
          AND operation='create_provider_draft'
          AND destination='internal'
          AND (
            (state='pending' AND next_attempt_at <= $2::timestamptz)
            OR (state='processing' AND (claimed_until IS NULL OR claimed_until < $2::timestamptz))
          )
          ${extra}
        ORDER BY next_attempt_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1`,
      vals
    );
    if (!picked.rowCount) {
      await c.query('COMMIT');
      return { skip: true };
    }
    const outbox = picked.rows[0];
    const payload = payloadExact(outbox.payload);
    if (!payload) {
      await restorePending(c, {
        tenantId, outboxId: outbox.id, now, days: D.PARK_INTERVAL_DAYS,
      });
      await c.query('COMMIT');
      return { skip: true, reason: 'parked' };
    }
    const intent = await lockIntent(c, tenantId, payload.intent_id);
    if (!intentMatchesOutbox(intent, outbox, payload)) {
      await restorePending(c, {
        tenantId, outboxId: outbox.id, now, days: D.PARK_INTERVAL_DAYS,
      });
      await c.query('COMMIT');
      return { skip: true, reason: 'parked' };
    }
    const latest = await attempts.latestAttemptForOutbox(c, { tenantId, outboxId: outbox.id });
    if (latest && PARK_SET.has(latest.status)) {
      await restorePending(c, {
        tenantId, outboxId: outbox.id, now, days: D.PARK_INTERVAL_DAYS,
      });
      await c.query('COMMIT');
      return { skip: true, reason: 'parked' };
    }

    // Abandon an expired started attempt before parking corrupt outcomes so
    // no started attempt remains after a corrupt park.
    if (latest && latest.status === 'started') {
      if (tsMs(latest.lease_expires_at) > tsMs(now)) {
        await c.query('COMMIT');
        return { skip: true, reason: 'leased' };
      }
      await attempts.abandonExpiredLease(c, {
        tenantId, attemptId: latest.id, settledAt: now,
      });
    }

    const resolved = await resolveOutcomeSource(c, {
      tenantId, outboxId: outbox.id, intentId: intent.id, opts,
    });
    if (resolved && resolved.corrupt) {
      await restorePending(c, {
        tenantId, outboxId: outbox.id, now, days: D.PARK_INTERVAL_DAYS,
      });
      await c.query('COMMIT');
      return { skip: true, reason: 'parked' };
    }

    if (!resolved) {
      await c.query('COMMIT');
      return { skip: true, reason: D.SKIP_REASON_NO_OUTCOME, outboxId: String(outbox.id) };
    }

    const attemptNumber = await attempts.nextAttemptNumber(c, { tenantId, outboxId: outbox.id });
    const generation = attemptNumber;
    const leaseExpiresAt = new Date(now.getTime() + D.LEASE_MS);
    const started = await attempts.insertStartedAttempt(c, {
      tenantId,
      intentId: intent.id,
      outboxId: outbox.id,
      draftId: intent.draft_id,
      publishingRequestId: intent.publishing_request_id,
      attemptNumber,
      generation,
      leaseHolder: workerId,
      leaseExpiresAt,
      platform: payload.platform,
      intentHash: intent.intent_hash,
      startedAt: now,
    });
    await c.query(
      `UPDATE orchestrator_outbox
          SET state='processing', claimed_by=$3, claimed_until=$4, updated_at=now()
        WHERE tenant_id=$1 AND id=$2`,
      [tenantId, outbox.id, workerId, leaseExpiresAt]
    );
    if (resolved.sandboxRow) {
      const consumed = await sandboxOutcomes.consumeOutcome(c, {
        tenantId,
        outcomeId: resolved.sandboxRow.id,
        attemptId: started.id,
        consumedAt: now,
      });
      if (!consumed) {
        await c.query('ROLLBACK');
        return { skip: true, reason: D.SKIP_REASON_NO_OUTCOME };
      }
    }
    await c.query('COMMIT');
    return freezeEnvelope({
      tenantId,
      outboxId: outbox.id,
      intentId: intent.id,
      attemptId: started.id,
      attemptNumber,
      generation,
      claimToken: started.claim_token,
      leaseHolder: workerId,
      leaseExpiresAt: started.lease_expires_at,
      platform: payload.platform,
      scenario: resolved.scenario,
      outcomeSource: resolved.source,
    });
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    c.release();
  }
}

async function executeFake(envelope, opts = {}) {
  const fn = typeof opts.simulate === 'function' ? opts.simulate : simulateDelivery;
  const scenario = opts.scenario != null ? opts.scenario : (envelope && envelope.scenario);
  const source = (envelope && envelope.outcomeSource) || D.OUTCOME_SOURCE_SANDBOX;
  return fn({
    scenario,
    source,
    platform: envelope.platform,
    intentId: envelope.intentId,
    outboxId: envelope.outboxId,
    attemptId: envelope.attemptId,
    attemptNumber: envelope.attemptNumber,
    generation: envelope.generation,
  });
}

function fenceOk(envelope, attempt, outbox, now) {
  if (!envelope || !attempt || !outbox) return false;
  if (!D.isAllowedOutcomeSource(envelope.outcomeSource)) return false;
  if (Number(attempt.tenant_id) !== Number(envelope.tenantId)) return false;
  if (String(attempt.id) !== String(envelope.attemptId)) return false;
  if (String(attempt.outbox_id) !== String(envelope.outboxId)) return false;
  if (Number(attempt.attempt_number) !== Number(envelope.attemptNumber)) return false;
  if (Number(attempt.generation) !== Number(envelope.generation)) return false;
  if (String(attempt.claim_token) !== String(envelope.claimToken)) return false;
  if (String(attempt.lease_holder) !== String(envelope.leaseHolder)) return false;
  if (attempt.status !== 'started') return false;
  if (outbox.state !== 'processing') return false;
  if (String(outbox.claimed_by) !== String(attempt.lease_holder)) return false;
  if (!sameTs(outbox.claimed_until, attempt.lease_expires_at)) return false;
  if (!(tsMs(attempt.lease_expires_at) > tsMs(now))) return false;
  if (String(outbox.id) !== String(envelope.outboxId)) return false;
  if (Number(outbox.tenant_id) !== Number(envelope.tenantId)) return false;
  return true;
}

async function revalidateOnClient(c, { tenantId, attempt, outbox, now }) {
  const payload = payloadExact(outbox.payload);
  if (!payload) fail('validation_failed');
  if (payload.platform !== attempt.platform) fail('approval_stale');
  const intent = await lockIntent(c, tenantId, attempt.intent_id);
  if (!intent) fail('not_found');
  if (String(intent.outbox_id) !== String(outbox.id)) fail('approval_stale');
  if (String(intent.draft_id) !== String(attempt.draft_id)) fail('approval_stale');
  if (String(intent.publishing_request_id) !== String(attempt.publishing_request_id)) fail('approval_stale');
  if (String(intent.intent_hash) !== String(attempt.intent_hash)) fail('approval_stale');
  if (intent.operation !== D.OPERATION) fail('validation_failed');
  if (intent.status !== D.STATUS) fail('invalid_transition');
  if (String(payload.intent_id) !== String(intent.id)) fail('approval_stale');
  if (String(payload.draft_id) !== String(intent.draft_id)) fail('approval_stale');
  if (String(payload.publishing_request_id) !== String(intent.publishing_request_id)) fail('approval_stale');
  if (String(outbox.credential_ref) !== String(payload.credential_ref)) fail('approval_stale');

  const reqRow = await lockPublishRequest(c, tenantId, intent.draft_id, intent.publishing_request_id);
  if (!reqRow) fail('not_found');
  const authorized = await assertPublishAuthorizedOnClient(c, tenantId, intent.draft_id);
  const draft = authorized.draft;
  const pub = authorized.approval;
  const rev = authorized.revision;
  if (!draft || draft.status !== 'approved_for_publish') fail('approval_required');
  const snapshotHash = sha256Hex(pub.snapshot_json);
  assertRequestMatchesAuthorized(reqRow, draft, pub, snapshotHash);
  const actor = boundActorId(pub);
  if (Number(reqRow.requested_by) !== actor) fail('permission_denied');
  if (Number(intent.requested_by) !== actor) fail('permission_denied');
  await assertActiveMember(c, tenantId, actor);
  const bound = D.safeReference(platformAccount(rev && rev.contract_json, payload.platform));
  if (bound.platform !== payload.platform || bound.platform !== attempt.platform) fail('approval_stale');
  if (String(bound.credential_ref) !== String(outbox.credential_ref)) fail('approval_stale');
  if (String(bound.credential_ref) !== String(payload.credential_ref)) fail('approval_stale');
  const recomputed = D.intentHashOf({
    tenant_id: Number(tenantId),
    publishing_request_id: String(reqRow.id),
    draft_id: String(draft.id),
    publish_approval_id: String(pub.id),
    workflow_approval_id: Number(pub.workflow_approval_id),
    revision: Number(pub.revision),
    contract_hash: String(pub.contract_hash),
    snapshot_hash: snapshotHash,
    contract_version: D.CONTRACT_VERSION,
    operation: D.OPERATION,
    platform: bound.platform,
  });
  if (String(recomputed) !== String(intent.intent_hash)) fail('approval_stale');
  if (String(recomputed) !== String(attempt.intent_hash)) fail('approval_stale');
  return { intent, draft, pub, reqRow, actor, platform: bound.platform, now };
}

function mapFakeResult(fakeResult, attemptNumber) {
  const scenario = fakeResult && fakeResult.scenario;
  const spec = D.scenarioSpecOf(scenario);
  if (!spec) {
    return {
      status: 'dead_letter_malformed',
      scenario: scenario == null ? 'malformed' : String(scenario).slice(0, 128),
      errorCode: 'simulated_malformed',
      retryable: false,
      park: true,
    };
  }
  let retryable = spec.retryable === true;
  let status = spec.status;
  let errorCode = spec.errorCode;
  if (retryable && Number(attemptNumber) >= D.MAX_ATTEMPTS) {
    return {
      status: 'dead_letter_permanent',
      scenario,
      errorCode: 'simulated_retry_exhausted',
      retryable: false,
      park: true,
    };
  }
  return {
    status,
    scenario,
    errorCode,
    retryable,
    park: !retryable,
  };
}

async function settleCampaignDeliveryAttempt(envelope, fakeResult, opts = {}) {
  const pool = opts.pool || (_db.hasDb() ? _db.getPool() : null);
  if (!pool || !envelope) return { fenced_out: true };
  const tenantId = Number(envelope.tenantId);
  const now = instant(opts.now);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const attempt = await attempts.lockAttempt(c, { tenantId, attemptId: envelope.attemptId });
    const outbox = await lockOutbox(c, tenantId, envelope.outboxId);
    if (!fenceOk(envelope, attempt, outbox, now)) {
      await c.query('ROLLBACK');
      return { fenced_out: true };
    }

    let mapped;
    let actorUserId = null;
    let workflowId = outbox.workflow_id;
    let revalidated = null;
    try {
      revalidated = await revalidateOnClient(c, { tenantId, attempt, outbox, now });
      actorUserId = revalidated.actor;
      mapped = mapFakeResult(fakeResult, envelope.attemptNumber);
    } catch (err) {
      if (!(err instanceof OrchError)) throw err;
      mapped = {
        status: 'authorization_rejected',
        scenario: fakeResult && fakeResult.scenario ? String(fakeResult.scenario).slice(0, 128) : null,
        errorCode: sanitizeCode(err.code),
        retryable: false,
        park: true,
      };
    }

    const terminal = await attempts.terminalizeAttempt(c, {
      tenantId,
      attemptId: attempt.id,
      status: mapped.status,
      scenario: mapped.scenario,
      errorCode: mapped.errorCode,
      retryable: mapped.retryable,
      settledAt: now,
    });
    if (!terminal) {
      await c.query('ROLLBACK');
      return { fenced_out: true };
    }

    let box;
    if (mapped.retryable) {
      box = await restorePending(c, {
        tenantId, outboxId: outbox.id, now, seconds: D.delaySeconds(envelope.attemptNumber),
      });
    } else {
      box = await restorePending(c, {
        tenantId, outboxId: outbox.id, now, days: D.PARK_INTERVAL_DAYS,
      });
    }

    await insertSimulatedAudit(c, {
      tenantId,
      workflowId,
      actorUserId,
      detail: {
        attempt_id: attempt.id,
        attempt_number: Number(attempt.attempt_number),
        generation: Number(attempt.generation),
        intent_id: attempt.intent_id,
        outbox_id: attempt.outbox_id,
        draft_id: attempt.draft_id,
        request_id: attempt.publishing_request_id,
        platform: attempt.platform,
        status: mapped.status,
        scenario: mapped.scenario,
        retryable: mapped.retryable,
        error_code: mapped.errorCode,
        simulated: true,
        published: false,
        external_action_taken: false,
        lease_holder: attempt.lease_holder,
        source: D.assertAllowedOutcomeSource(envelope.outcomeSource),
      },
    });
    await c.query('COMMIT');
    return {
      fenced_out: false,
      status: mapped.status,
      retryable: mapped.retryable,
      parked: mapped.park === true,
      attempt: attempts.publicAttempt(terminal),
      outbox: publicOutbox(box),
    };
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    c.release();
  }
}

async function processOne(opts = {}) {
  const claimed = await claimCampaignDeliveryAttempt(opts);
  if (!claimed || claimed.skip) return claimed;
  const fake = await executeFake(claimed, opts);
  return settleCampaignDeliveryAttempt(claimed, fake, opts);
}

async function processTenant(pool, tenantId, opts = {}) {
  let n = 0;
  const excludeOutboxIds = [];
  for (;;) {
    if (n >= PER_TENANT_CAP) break;
    const claimed = await claimCampaignDeliveryAttempt({
      ...opts, pool, tenantId, excludeOutboxIds,
    });
    n += 1;
    if (!claimed || claimed.skip) {
      if (!claimed || !claimed.reason) break;
      if (claimed.reason === D.SKIP_REASON_NO_OUTCOME) {
        if (claimed.outboxId) excludeOutboxIds.push(claimed.outboxId);
        if (opts.outboxId) break;
        continue;
      }
      continue;
    }
    try {
      const fake = await executeFake(claimed, opts);
      await settleCampaignDeliveryAttempt(claimed, fake, { ...opts, pool });
    } catch (err) {
      logWorkerFail(tenantId, err);
    }
  }
  return n;
}

async function tickCampaignDeliveryWorker(opts = {}) {
  if (tickActive) return;
  tickActive = true;
  try {
    if (!_db.hasDb()) return;
    const pool = opts.pool || _db.getPool();
    const now = instant(opts.now);
    if (opts.tenantId != null) {
      try {
        await processTenant(pool, opts.tenantId, { ...opts, now });
      } catch (err) {
        logWorkerFail(opts.tenantId, err);
      }
      return;
    }
    const dueSql = isTestOptsScenario(opts)
      ? `SELECT DISTINCT tenant_id FROM orchestrator_outbox
          WHERE operation='create_provider_draft'
            AND destination='internal'
            AND (
              (state='pending' AND next_attempt_at <= $1::timestamptz)
              OR (state='processing' AND (claimed_until IS NULL OR claimed_until < $1::timestamptz))
            )`
      : `SELECT DISTINCT o.tenant_id FROM orchestrator_outbox o
          WHERE o.operation='create_provider_draft'
            AND o.destination='internal'
            AND (
              (o.state='pending' AND o.next_attempt_at <= $1::timestamptz)
              OR (o.state='processing' AND (o.claimed_until IS NULL OR o.claimed_until < $1::timestamptz))
            )
            AND EXISTS (
              SELECT 1 FROM orchestrator_campaign_delivery_sandbox_outcomes so
               WHERE so.tenant_id = o.tenant_id
                 AND so.outbox_id = o.id
                 AND so.consumed_at IS NULL
            )`;
    const due = await pool.query(dueSql, [now.toISOString()]);
    for (const row of due.rows) {
      try {
        await processTenant(pool, row.tenant_id, { ...opts, now });
      } catch (err) {
        logWorkerFail(row.tenant_id, err);
      }
    }
  } finally {
    tickActive = false;
  }
}

function startCampaignDeliveryWorker() {
  if (!_runtimeFlags.backgroundEnabled()) return null;
  if (process.env[D.FLAG_ENV] !== '1') return null;
  if (workerTimer) return workerTimer;
  workerTimer = setInterval(() => {
    tickCampaignDeliveryWorker().catch((err) => {
      logWorkerFail(null, err);
    });
  }, D.WORKER_INTERVAL_MS);
  return workerTimer;
}

function stopCampaignDeliveryWorker() {
  if (!workerTimer) return;
  clearInterval(workerTimer);
  workerTimer = null;
}

startCampaignDeliveryWorker();

module.exports = {
  startCampaignDeliveryWorker,
  stopCampaignDeliveryWorker,
  tickCampaignDeliveryWorker,
  claimCampaignDeliveryAttempt,
  settleCampaignDeliveryAttempt,
  executeFake,
  processOne,
  processTenant,
};
