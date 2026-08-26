// Meta `create_provider_draft` capability (PR 6F-0).
//
// This module is the ONLY narrow exception path to the default-deny gate in
// ./advertising_provider_mutations.js. It does not open that gate: the generic
// guard still denies every provider mutation, and nothing here reads an
// environment variable, a request, a header or a settings row.
//
// A capability is:
//   • unforgeable — identity is a module-private WeakSet, so a structurally
//     identical plain object, a JSON round-trip or a Proxy is not a capability;
//   • frozen — null-prototype, non-extensible, no writable field;
//   • single-use — the first successful consume() marks it spent forever;
//   • short-lived — CAPABILITY_TTL_MS, validated against a caller-supplied now;
//   • transaction-live — mint and use each perform an authoritative Postgres
//     SAVEPOINT probe, so COMMIT/ROLLBACK immediately closes the capability path;
//   • exact-bound — every field in BINDING_FIELDS must match the locked
//     execution context with no missing and no extra keys;
//   • non-serializable — toJSON() throws and inspection is redacted, so a
//     capability cannot be written into the outbox, an audit row, a log line or
//     an HTTP response even by accident.
//
// A capability can only be minted INSIDE withAdvertisingProviderExecutionTransaction(),
// whose handle is created after an in-transaction probe and revoked when the
// callback returns. PR 6F-0 ships no execution worker and no provider call, so
// there is no mint site in product code at all — the runner-denial and
// capabilities tests assert that.
'use strict';

const crypto = require('crypto');

// Stable cross-module brand. ./advertising_provider_mutations.js checks this via
// Symbol.for() so the lowest-level kill switch can strip capability-shaped
// values out of deny payloads without importing this module.
const CAPABILITY_BRAND = Symbol.for('infogenie.advertising_provider_capability');
const CAPABILITY_KIND = 'advertising_provider_capability';
const CAPABILITY_VERSION = 'v1';
const CAPABILITY_PLATFORM = 'meta';
const CAPABILITY_OPERATION = 'create_provider_draft';
const CAPABILITY_CONTRACT_VERSION = 'campaign_delivery_v1';

// Deliberately short. A capability is minted and consumed inside one
// authoritative execution transaction; it is never carried across a request.
const CAPABILITY_TTL_MS = 60 * 1000;

const CODE_MINT_DENIED = 'advertising_provider_capability_mint_denied';
const CODE_INVALID = 'advertising_provider_capability_invalid';
const CODE_SPENT = 'advertising_provider_capability_spent';
const CODE_EXPIRED = 'advertising_provider_capability_expired';
const CODE_CONTEXT_MISMATCH = 'advertising_provider_capability_context_mismatch';

const CODES = Object.freeze({
  MINT_DENIED: CODE_MINT_DENIED,
  INVALID: CODE_INVALID,
  SPENT: CODE_SPENT,
  EXPIRED: CODE_EXPIRED,
  CONTEXT_MISMATCH: CODE_CONTEXT_MISMATCH,
});

// Frozen constants. Present on every capability, never caller-chosen.
const FROZEN_FIELDS = Object.freeze([
  'object_kind', 'capability_version', 'platform', 'operation', 'contract_version',
]);

// Exact binding. Every one of these must be supplied at mint time and must match
// the locked execution context at assert time.
const ID_FIELDS = Object.freeze([
  'draft_id', 'publish_approval_id', 'publishing_request_id', 'intent_id',
  'outbox_id', 'attempt_id', 'challenge_id', 'confirmation_id',
  'credential_ref_id',
]);
const HASH_FIELDS = Object.freeze([
  'claim_token_hash', 'intent_hash', 'snapshot_hash', 'contract_hash',
  'request_hash', 'phrase_digest', 'account_fingerprint',
]);
const INT_FIELDS = Object.freeze([
  'tenant_id', 'revision', 'workflow_approval_id', 'generation',
  'credential_ref_version', 'requested_by',
]);
const TIME_FIELDS = Object.freeze(['issued_at_ms', 'expires_at_ms']);

const BINDING_FIELDS = Object.freeze([
  ...INT_FIELDS, ...ID_FIELDS, ...HASH_FIELDS, ...TIME_FIELDS,
]);
const CAPABILITY_FIELDS = Object.freeze([...FROZEN_FIELDS, ...BINDING_FIELDS]);

const BINDING_SET = new Set(BINDING_FIELDS);
const ID_SET = new Set(ID_FIELDS);
const HASH_SET = new Set(HASH_FIELDS);
const INT_SET = new Set(INT_FIELDS);

// Audit-safe projection. Credentials, account fingerprints, claim tokens,
// confirmation phrases, digests, hashes and payloads are NOT on this list and
// must never reach an audit row or a log line.
const AUDIT_DETAIL_KEYS = Object.freeze([
  'object_kind', 'capability_version', 'platform', 'operation', 'contract_version',
  'tenant_id', 'draft_id', 'publishing_request_id', 'intent_id', 'attempt_id',
  'challenge_id', 'confirmation_id', 'revision', 'generation', 'requested_by',
]);
const AUDIT_FORBIDDEN_KEYS = Object.freeze([
  'credential_ref_id', 'credential_ref_version', 'account_fingerprint',
  'claim_token_hash', 'intent_hash', 'snapshot_hash', 'contract_hash',
  'request_hash', 'phrase_digest', 'outbox_id', 'publish_approval_id',
  'workflow_approval_id', 'issued_at_ms', 'expires_at_ms',
]);

const HEX64 = /^[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

// Module-private registries. Nothing outside this file can reach them, which is
// what makes a capability unforgeable rather than merely well-shaped.
const MINTED = new WeakSet();
const STATE = new WeakMap();
const LIVE_TX = new WeakMap();

const TX_PROBE_SAVEPOINT = 'sp_advertising_provider_capability_tx_probe';
const TX_ID_SQL = 'SELECT pg_current_xact_id()::text AS transaction_id';

function denied(code, message, detail) {
  const err = new Error(message);
  err.code = code;
  err.blocked = true;
  err.published = false;
  err.external_action_taken = false;
  // Only non-sensitive field names travel on the error.
  if (detail && typeof detail === 'string') err.field = detail;
  return err;
}

async function requireOpenTransaction(client, expectedTransactionId, code, message) {
  try {
    await client.query(`SAVEPOINT ${TX_PROBE_SAVEPOINT}`);
    await client.query(`RELEASE SAVEPOINT ${TX_PROBE_SAVEPOINT}`);
    const result = await client.query(TX_ID_SQL);
    const transactionId = result && result.rows && result.rows[0]
      ? String(result.rows[0].transaction_id || '')
      : '';
    if (!transactionId || (expectedTransactionId && transactionId !== expectedTransactionId)) {
      throw new Error('execution transaction identity changed');
    }
    return transactionId;
  } catch (_err) {
    throw denied(code, message);
  }
}

function isPlainRecord(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  if (Buffer.isBuffer(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function positiveInt(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

function normalizedBinding(input) {
  if (!isPlainRecord(input)) {
    throw denied(CODE_MINT_DENIED, 'capability binding must be a plain record');
  }
  const keys = Object.keys(input);
  for (const k of keys) {
    if (!BINDING_SET.has(k)) throw denied(CODE_MINT_DENIED, 'unexpected capability binding field', k);
  }
  const out = Object.create(null);
  for (const field of BINDING_FIELDS) {
    const raw = input[field];
    if (INT_SET.has(field)) {
      const n = positiveInt(raw);
      if (n === null) throw denied(CODE_MINT_DENIED, 'capability binding field must be a positive integer', field);
      out[field] = n;
      continue;
    }
    if (ID_SET.has(field)) {
      if (typeof raw !== 'string' || !SAFE_ID.test(raw)) {
        throw denied(CODE_MINT_DENIED, 'capability binding field must be a bounded identifier', field);
      }
      out[field] = raw;
      continue;
    }
    if (HASH_SET.has(field)) {
      if (typeof raw !== 'string' || !HEX64.test(raw)) {
        throw denied(CODE_MINT_DENIED, 'capability binding field must be a sha256 hex digest', field);
      }
      out[field] = raw;
      continue;
    }
    // TIME_FIELDS
    const t = positiveInt(raw);
    if (t === null) throw denied(CODE_MINT_DENIED, 'capability binding field must be an epoch millisecond integer', field);
    out[field] = t;
  }
  const ttl = out.expires_at_ms - out.issued_at_ms;
  if (ttl <= 0 || ttl > CAPABILITY_TTL_MS) {
    throw denied(CODE_MINT_DENIED, 'capability lifetime is outside the permitted window', 'expires_at_ms');
  }
  return out;
}

function throwOnSerialize() {
  throw denied(CODE_INVALID, 'a provider-draft capability is not serializable');
}

function buildCapability(binding) {
  const cap = Object.create(null);
  const define = (key, value) => Object.defineProperty(cap, key, {
    value, enumerable: true, writable: false, configurable: false,
  });
  define('object_kind', CAPABILITY_KIND);
  define('capability_version', CAPABILITY_VERSION);
  define('platform', CAPABILITY_PLATFORM);
  define('operation', CAPABILITY_OPERATION);
  define('contract_version', CAPABILITY_CONTRACT_VERSION);
  for (const field of BINDING_FIELDS) define(field, binding[field]);

  const hidden = (key, value) => Object.defineProperty(cap, key, {
    value, enumerable: false, writable: false, configurable: false,
  });
  hidden(CAPABILITY_BRAND, true);
  hidden('toJSON', throwOnSerialize);
  hidden(Symbol.for('nodejs.util.inspect.custom'), () => '[AdvertisingProviderCapability redacted]');
  hidden(Symbol.toPrimitive, throwOnSerialize);
  return Object.freeze(cap);
}

/**
 * Open the authoritative execution transaction scope that may mint a capability.
 *
 * `client` must already be inside an explicit transaction: the SAVEPOINT probe
 * fails with 25P01 outside a transaction block, so an autocommit connection —
 * and therefore any HTTP handler that never opened one — cannot get a handle.
 * The handle is revoked when `fn` settles, so no mint can outlive the scope.
 *
 * Not exported from services/security/index.js on purpose.
 */
async function withAdvertisingProviderExecutionTransaction(client, fn) {
  if (!client || typeof client.query !== 'function') {
    throw denied(CODE_MINT_DENIED, 'an execution transaction client is required');
  }
  if (typeof fn !== 'function') {
    throw denied(CODE_MINT_DENIED, 'an execution scope callback is required');
  }
  // Postgres raises 25P01 for a SAVEPOINT outside a transaction block, so an
  // autocommit connection cannot get past this probe. Fail closed on any error,
  // including a failed RELEASE, rather than surfacing a raw driver error.
  const transactionId = await requireOpenTransaction(
    client,
    null,
    CODE_MINT_DENIED,
    'capability minting requires an open execution transaction'
  );

  const handle = Object.freeze(Object.create(null));
  LIVE_TX.set(handle, { client, transactionId });
  try {
    return await fn(handle);
  } finally {
    LIVE_TX.delete(handle);
  }
}

/**
 * Mint the single-use Meta create_provider_draft capability.
 * Only reachable with a live handle from the function above.
 */
async function mintMetaCreateProviderDraftCapability(txHandle, binding) {
  const scope = txHandle && typeof txHandle === 'object' ? LIVE_TX.get(txHandle) : null;
  if (!scope) {
    throw denied(CODE_MINT_DENIED, 'capability minting requires a live execution transaction scope');
  }
  await requireOpenTransaction(
    scope.client,
    scope.transactionId,
    CODE_MINT_DENIED,
    'capability minting requires an open execution transaction'
  );
  if (LIVE_TX.get(txHandle) !== scope) {
    throw denied(CODE_MINT_DENIED, 'capability minting requires a live execution transaction scope');
  }
  const normalized = normalizedBinding(binding);
  const cap = buildCapability(normalized);
  MINTED.add(cap);
  STATE.set(cap, {
    consumed: false,
    asserting: false,
    binding: normalized,
    client: scope.client,
    transactionId: scope.transactionId,
  });
  return cap;
}

function isAdvertisingProviderCapability(value) {
  return !!value && typeof value === 'object' && MINTED.has(value);
}

function lockedContextMismatch(cap, lockedContext) {
  if (!isPlainRecord(lockedContext)) return 'locked_context';
  const keys = Object.keys(lockedContext);
  if (keys.length !== BINDING_FIELDS.length) return 'locked_context';
  for (const k of keys) if (!BINDING_SET.has(k)) return k;
  for (const field of BINDING_FIELDS) {
    const expected = cap[field];
    const actual = lockedContext[field];
    if (typeof expected !== typeof actual) return field;
    if (typeof expected === 'string') {
      const a = Buffer.from(expected, 'utf8');
      const b = Buffer.from(actual, 'utf8');
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return field;
      continue;
    }
    if (expected !== actual) return field;
  }
  return null;
}

async function verifyCapability(capability, lockedContext, opts) {
  if (!isAdvertisingProviderCapability(capability)) {
    throw denied(CODE_INVALID, 'a minted provider-draft capability is required');
  }
  const state = STATE.get(capability);
  if (!state) throw denied(CODE_INVALID, 'a minted provider-draft capability is required');
  if (state.consumed) throw denied(CODE_SPENT, 'this provider-draft capability has already been used');
  await requireOpenTransaction(
    state.client,
    state.transactionId,
    CODE_INVALID,
    'the capability execution transaction is no longer open'
  );

  const now = opts && Number.isSafeInteger(opts.now) ? opts.now : Date.now();
  if (!(capability.expires_at_ms > now)) {
    throw denied(CODE_EXPIRED, 'this provider-draft capability has expired');
  }
  const bad = lockedContextMismatch(capability, lockedContext);
  if (bad) throw denied(CODE_CONTEXT_MISMATCH, 'provider-draft capability does not match the locked execution context', bad);
  return state;
}

/**
 * Non-consuming exact verification. Used by boundaries that must prove a
 * capability before doing narrow work (e.g. the vault credential-reference
 * boundary) without spending the single use.
 */
async function verifyMetaCreateProviderDraftCapability(capability, lockedContext, opts) {
  await verifyCapability(capability, lockedContext, opts);
  return true;
}

/**
 * Exact verification plus the single-use spend. This is the assertion an
 * execution path must pass immediately before a provider draft create.
 * There is no env, options or generic bypass: a mismatch throws.
 */
async function assertMetaCreateProviderDraftCapability(capability, lockedContext, opts) {
  const state = STATE.get(capability);
  if (!state || !isAdvertisingProviderCapability(capability)) {
    throw denied(CODE_INVALID, 'a minted provider-draft capability is required');
  }
  if (state.consumed || state.asserting) {
    throw denied(CODE_SPENT, 'this provider-draft capability has already been used');
  }
  state.asserting = true;
  try {
    await verifyCapability(capability, lockedContext, opts);
    state.consumed = true;
    return auditDetailForCapability(capability);
  } finally {
    state.asserting = false;
  }
}

/** Audit-safe projection — never includes secrets, hashes or account material. */
function auditDetailForCapability(capability) {
  if (!isAdvertisingProviderCapability(capability)) {
    throw denied(CODE_INVALID, 'a minted provider-draft capability is required');
  }
  const out = {};
  for (const k of AUDIT_DETAIL_KEYS) out[k] = capability[k];
  return Object.freeze(out);
}

module.exports = {
  CAPABILITY_BRAND,
  CAPABILITY_KIND,
  CAPABILITY_VERSION,
  CAPABILITY_PLATFORM,
  CAPABILITY_OPERATION,
  CAPABILITY_CONTRACT_VERSION,
  CAPABILITY_TTL_MS,
  CODES,
  FROZEN_FIELDS,
  BINDING_FIELDS,
  CAPABILITY_FIELDS,
  AUDIT_DETAIL_KEYS,
  AUDIT_FORBIDDEN_KEYS,
  withAdvertisingProviderExecutionTransaction,
  mintMetaCreateProviderDraftCapability,
  verifyMetaCreateProviderDraftCapability,
  assertMetaCreateProviderDraftCapability,
  auditDetailForCapability,
  isAdvertisingProviderCapability,
};
