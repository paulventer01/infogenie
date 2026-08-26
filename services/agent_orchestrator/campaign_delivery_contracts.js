'use strict';

const crypto = require('crypto');
const { FORBIDDEN_KEYS, POLLUTION_KEYS } = require('./research_contracts');
const C = require('./campaign_contracts');
const { fail } = require('./errors');
const { sha256Hex } = require('./hash');
const { normalizeKey } = require('./research_validate');
const { normalizeCredentialRef } = require('./outbox');

const CONTRACT_VERSION = 'campaign_delivery_v1';
const OPERATION = 'create_provider_draft';
const STATUS = 'pending';
const DESTINATION = 'internal';
const OBJECT_KIND = 'campaign_delivery_intent';
const AUDIT_EVENT = 'campaign_delivery_intent_created';
const GATE = 'campaign_publishing';

const OUTBOX_PAYLOAD_KEYS = Object.freeze([
  'contract_version', 'credential_ref', 'draft_id', 'intent_id',
  'operation', 'platform', 'publishing_request_id', 'workflow_id',
]);

const KEYS = Object.freeze([
  'contract_version', 'operation', 'platform', 'idempotency_key',
]);

const EXTRA_FORBIDDEN = Object.freeze([
  'credentials', 'tokens', 'access_token', 'refresh_token', 'authorization', 'api_key',
  'credential_ref', 'provider', 'provider_data', 'provider_campaign_id',
  'external_campaign_id', 'external_id', 'snapshot', 'snapshot_json', 'snapshot_hash',
  'confirmation', 'confirmation_phrase', 'approval_id', 'draft_id',
  'publishing_request_id', 'outbox_id', 'payload', 'body', 'request_body', 'raw_body',
]);

const FORBIDDEN = Object.freeze([...new Set([...FORBIDDEN_KEYS, ...POLLUTION_KEYS, ...EXTRA_FORBIDDEN])]);
const FORBIDDEN_SET = new Set(FORBIDDEN.map(normalizeKey));
const ALLOW = new Set(KEYS);

const INTENT_HASH_KEYS = Object.freeze([
  'tenant_id', 'publishing_request_id', 'draft_id', 'publish_approval_id',
  'workflow_approval_id', 'revision', 'contract_hash', 'snapshot_hash',
  'contract_version', 'operation', 'platform',
]);

function isPlain(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v) && !Buffer.isBuffer(v);
}

function walkForbidden(value) {
  if (value == null || typeof value !== 'object') return;
  if (Buffer.isBuffer(value)) fail('validation_failed', { field: 'value' });
  if (Array.isArray(value)) { value.forEach(walkForbidden); return; }
  for (const k of Object.keys(value)) {
    if (FORBIDDEN_SET.has(normalizeKey(k))) fail('validation_failed', { field: k });
    walkForbidden(value[k]);
  }
}

function parseDeliveryBody(body, opts) {
  const raw = isPlain(body) ? { ...body } : null;
  if (!raw) fail('validation_failed');
  if ((!raw.idempotency_key || !String(raw.idempotency_key).trim()) && opts && opts.idempotencyKey) {
    raw.idempotency_key = opts.idempotencyKey;
  }
  walkForbidden(raw);
  for (const k of Object.keys(raw)) {
    if (!ALLOW.has(k)) fail('validation_failed', { field: k });
  }
  if (raw.contract_version !== CONTRACT_VERSION) fail('validation_failed', { field: 'contract_version' });
  if (raw.operation !== OPERATION) fail('validation_failed', { field: 'operation' });
  if (typeof raw.platform !== 'string' || !C.PLATFORMS.includes(raw.platform)) {
    fail('validation_failed', { field: 'platform' });
  }
  const key = String(raw.idempotency_key || '').trim();
  if (!key || key.length > 256) fail('validation_failed', { field: 'idempotency_key' });
  return {
    contract_version: CONTRACT_VERSION,
    operation: OPERATION,
    platform: raw.platform,
    idempotency_key: key,
  };
}

function safeReference({ platform, credentialRef }) {
  if (typeof platform !== 'string' || !C.PLATFORMS.includes(platform)) {
    fail('validation_failed', { field: 'platform' });
  }
  const opaque = normalizeCredentialRef(credentialRef);
  if (!opaque) fail('validation_failed', { field: 'credential_ref' });
  return Object.freeze({
    contract_version: CONTRACT_VERSION,
    operation: OPERATION,
    platform,
    credential_ref: opaque,
  });
}

function intentHashOf(envelope) {
  const out = {};
  for (const k of INTENT_HASH_KEYS) {
    let v = envelope[k];
    if (typeof v === 'string' && (k === 'contract_hash' || k === 'snapshot_hash')) {
      v = v.toLowerCase();
    }
    out[k] = v;
  }
  return sha256Hex(out);
}

const CONNECTOR = 'fake';
const FLAG_ENV = 'INFOGENIE_CAMPAIGN_DELIVERY_WORKER';
const AUDIT_EVENT_SIMULATED = 'campaign_delivery_attempt_simulated';
const OUTCOME_SOURCE_SANDBOX = 'sandbox';
const OUTCOME_SOURCE_TEST_OPTS = 'test_opts';
const ALLOWED_OUTCOME_SOURCES = Object.freeze([
  OUTCOME_SOURCE_SANDBOX,
  OUTCOME_SOURCE_TEST_OPTS,
]);
const ALLOWED_OUTCOME_SOURCE_SET = new Set(ALLOWED_OUTCOME_SOURCES);
const SKIP_REASON_NO_OUTCOME = 'no_outcome_source';
const MAX_ATTEMPTS = 8;
const LEASE_MS = 30000;
const PARK_INTERVAL_DAYS = 36500;
const WORKER_INTERVAL_MS = 2000;

function isAllowedOutcomeSource(raw) {
  return ALLOWED_OUTCOME_SOURCE_SET.has(String(raw));
}

/** Exact allowlist: sandbox | test_opts. Fail closed on anything else. */
function assertAllowedOutcomeSource(raw, opts = {}) {
  if ((raw == null || raw === '') && opts.allowEmptyDefault) {
    return OUTCOME_SOURCE_SANDBOX;
  }
  const source = String(raw);
  if (!ALLOWED_OUTCOME_SOURCE_SET.has(source)) {
    fail('validation_failed', { field: 'source' });
  }
  return source;
}

const ATTEMPT_STATUSES = Object.freeze([
  'started', 'simulated_ok', 'simulated_duplicate',
  'retry_transient', 'retry_rate_limit', 'retry_timeout',
  'dead_letter_permanent', 'dead_letter_malformed', 'dead_letter_blocked',
  'authorization_rejected', 'abandoned_lease',
]);

const SCENARIOS = Object.freeze([
  'success', 'duplicate', 'transient', 'rate_limit', 'timeout',
  'permanent', 'malformed', 'blocked',
]);

const SCENARIO_MAP = Object.freeze({
  success: Object.freeze({
    outcome: 'ok', retryable: false, errorCode: null, status: 'simulated_ok',
  }),
  duplicate: Object.freeze({
    outcome: 'duplicate', retryable: false, errorCode: null, status: 'simulated_duplicate',
  }),
  transient: Object.freeze({
    outcome: 'error', retryable: true, errorCode: 'simulated_transient', status: 'retry_transient',
  }),
  rate_limit: Object.freeze({
    outcome: 'error', retryable: true, errorCode: 'simulated_rate_limited', status: 'retry_rate_limit',
  }),
  timeout: Object.freeze({
    outcome: 'error', retryable: true, errorCode: 'simulated_timeout', status: 'retry_timeout',
  }),
  permanent: Object.freeze({
    outcome: 'error', retryable: false, errorCode: 'simulated_permanent', status: 'dead_letter_permanent',
  }),
  malformed: Object.freeze({
    outcome: 'error', retryable: false, errorCode: 'simulated_malformed', status: 'dead_letter_malformed',
  }),
  blocked: Object.freeze({
    outcome: 'error', retryable: false, errorCode: 'simulated_blocked', status: 'dead_letter_blocked',
  }),
});

const KNOWN_SCENARIO_SET = new Set(SCENARIOS);

/** Exact own-key allowlist of the eight SCENARIOS — never truthy prototype lookups. */
function isKnownScenario(raw) {
  return typeof raw === 'string' && KNOWN_SCENARIO_SET.has(raw);
}

function scenarioSpecOf(raw) {
  if (!isKnownScenario(raw)) return null;
  return SCENARIO_MAP[raw];
}

function assertKnownScenario(raw) {
  if (!isKnownScenario(raw)) fail('validation_failed', { field: 'scenario' });
  return raw;
}

const TERMINAL_PARK_STATUSES = Object.freeze([
  'simulated_ok', 'simulated_duplicate',
  'dead_letter_permanent', 'dead_letter_malformed', 'dead_letter_blocked',
  'authorization_rejected',
]);

function delaySeconds(attemptNumber) {
  return Math.min(300, 2 ** Math.min(attemptNumber, 8));
}

// PR6F-0 confirmation shapes. Do not unfreeze OUTBOX_PAYLOAD_KEYS / KEYS or
// invent a provider object ledger — these are additive constants only.
const CONFIRM_PHRASE = 'CONFIRM CREATE PROVIDER DRAFT';
const PERMISSION_PROVIDER_DRAFTS_CREATE = 'advertising.provider_drafts.create';
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const CONFIRMATION_TTL_MS = 2 * 60 * 1000;
const CHALLENGE_STATUS = 'open';
const CONFIRMATION_STATUS = 'confirmed';
const OBJECT_KIND_CHALLENGE = 'campaign_provider_challenge';
const OBJECT_KIND_CONFIRMATION = 'campaign_provider_confirmation';
const AUDIT_EVENT_CHALLENGE = 'campaign_provider_challenge_created';
const AUDIT_EVENT_CONFIRMATION = 'campaign_provider_draft_confirmed';
const PLATFORM_META = 'meta';

const CHALLENGE_KEYS = Object.freeze([
  'contract_version', 'operation', 'platform', 'idempotency_key',
]);
const CONFIRM_KEYS = Object.freeze([
  'contract_version', 'operation', 'platform', 'idempotency_key',
  'confirmation_challenge_id', 'confirmation_phrase',
]);
const CHALLENGE_ALLOW = new Set(CHALLENGE_KEYS);
const CONFIRM_ALLOW = new Set(CONFIRM_KEYS);

const CONFIRM_AUDIT_DETAIL_KEYS = Object.freeze([
  'action', 'from', 'to', 'state', 'status', 'gate', 'operation',
  'contract_version', 'platform', 'challenge_id', 'confirmation_id',
  'draft_id', 'intent_id', 'attempt_id', 'publishing_request_id',
  'revision', 'generation', 'requested_by', 'replay',
]);

function walkForbiddenAllowlisted(value, allow) {
  if (value == null || typeof value !== 'object') return;
  if (Buffer.isBuffer(value)) fail('validation_failed', { field: 'value' });
  if (Array.isArray(value)) { value.forEach((item) => walkForbiddenAllowlisted(item, allow)); return; }
  for (const k of Object.keys(value)) {
    if (!allow.has(k) && FORBIDDEN_SET.has(normalizeKey(k))) fail('validation_failed', { field: k });
    if (!allow.has(k)) fail('validation_failed', { field: k });
    walkForbiddenAllowlisted(value[k], new Set());
  }
}

function parseExactBody(body, allow, opts) {
  const raw = isPlain(body) ? { ...body } : null;
  if (!raw) fail('validation_failed');
  if ((!raw.idempotency_key || !String(raw.idempotency_key).trim()) && opts && opts.idempotencyKey) {
    raw.idempotency_key = opts.idempotencyKey;
  }
  walkForbiddenAllowlisted(raw, allow);
  for (const k of Object.keys(raw)) {
    if (!allow.has(k)) fail('validation_failed', { field: k });
  }
  if (raw.contract_version !== CONTRACT_VERSION) fail('validation_failed', { field: 'contract_version' });
  if (raw.operation !== OPERATION) fail('validation_failed', { field: 'operation' });
  if (typeof raw.platform !== 'string' || raw.platform !== PLATFORM_META) {
    fail('validation_failed', { field: 'platform' });
  }
  const key = String(raw.idempotency_key || '').trim();
  if (!key || key.length > 256) fail('validation_failed', { field: 'idempotency_key' });
  return { raw, key };
}

function parseChallengeBody(body, opts) {
  const { key } = parseExactBody(body, CHALLENGE_ALLOW, opts);
  return {
    contract_version: CONTRACT_VERSION,
    operation: OPERATION,
    platform: PLATFORM_META,
    idempotency_key: key,
  };
}

function parseConfirmBody(body, opts) {
  const { raw, key } = parseExactBody(body, CONFIRM_ALLOW, opts);
  const challengeId = String(raw.confirmation_challenge_id || '').trim();
  if (!challengeId || challengeId.length > 128) {
    fail('validation_failed', { field: 'confirmation_challenge_id' });
  }
  if (raw.confirmation_phrase !== CONFIRM_PHRASE) {
    fail('validation_failed', { field: 'confirmation_phrase' });
  }
  return {
    contract_version: CONTRACT_VERSION,
    operation: OPERATION,
    platform: PLATFORM_META,
    idempotency_key: key,
    confirmation_challenge_id: challengeId,
    confirmation_phrase: CONFIRM_PHRASE,
  };
}

function newPhraseSalt() {
  return crypto.randomBytes(32).toString('hex');
}

function phraseDigestOf(salt, phrase) {
  if (typeof salt !== 'string' || !/^[0-9a-f]{64}$/.test(salt)) {
    fail('validation_failed', { field: 'phrase_salt' });
  }
  if (typeof phrase !== 'string' || phrase !== CONFIRM_PHRASE) {
    fail('validation_failed', { field: 'confirmation_phrase' });
  }
  return crypto.createHmac('sha256', Buffer.from(salt, 'hex')).update(phrase, 'utf8').digest('hex');
}

function claimTokenHashOf(token) {
  if (typeof token !== 'string' || !token) fail('validation_failed', { field: 'claim_token' });
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function sanitizeConfirmAuditDetail(detail) {
  const out = {};
  if (!detail || typeof detail !== 'object') return out;
  for (const k of CONFIRM_AUDIT_DETAIL_KEYS) {
    const v = detail[k];
    if (v === undefined || v === null) continue;
    if (typeof v === 'boolean' || typeof v === 'number') { out[k] = v; continue; }
    if (typeof v === 'string') { out[k] = v.slice(0, 120); continue; }
  }
  return out;
}

module.exports = {
  CONTRACT_VERSION, OPERATION, STATUS, DESTINATION, OBJECT_KIND, AUDIT_EVENT, GATE,
  KEYS, FORBIDDEN, INTENT_HASH_KEYS, OUTBOX_PAYLOAD_KEYS,
  parseDeliveryBody, safeReference, intentHashOf,
  CONNECTOR, FLAG_ENV, AUDIT_EVENT_SIMULATED,
  OUTCOME_SOURCE_SANDBOX, OUTCOME_SOURCE_TEST_OPTS, ALLOWED_OUTCOME_SOURCES,
  SKIP_REASON_NO_OUTCOME,
  isAllowedOutcomeSource, assertAllowedOutcomeSource,
  isKnownScenario, scenarioSpecOf, assertKnownScenario,
  MAX_ATTEMPTS, LEASE_MS,
  PARK_INTERVAL_DAYS, WORKER_INTERVAL_MS, ATTEMPT_STATUSES, SCENARIOS,
  SCENARIO_MAP, TERMINAL_PARK_STATUSES, delaySeconds,
  CONFIRM_PHRASE, PERMISSION_PROVIDER_DRAFTS_CREATE,
  CHALLENGE_TTL_MS, CONFIRMATION_TTL_MS,
  CHALLENGE_STATUS, CONFIRMATION_STATUS,
  OBJECT_KIND_CHALLENGE, OBJECT_KIND_CONFIRMATION,
  AUDIT_EVENT_CHALLENGE, AUDIT_EVENT_CONFIRMATION, PLATFORM_META,
  CHALLENGE_KEYS, CONFIRM_KEYS, CONFIRM_AUDIT_DETAIL_KEYS,
  parseChallengeBody, parseConfirmBody,
  newPhraseSalt, phraseDigestOf, claimTokenHashOf, sanitizeConfirmAuditDetail,
};
