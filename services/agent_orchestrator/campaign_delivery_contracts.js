'use strict';

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
const AUDIT_EVENT = 'campaign_delivery_requested';
const GATE = 'campaign_publishing';

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

module.exports = {
  CONTRACT_VERSION, OPERATION, STATUS, DESTINATION, OBJECT_KIND, AUDIT_EVENT, GATE,
  KEYS, FORBIDDEN, INTENT_HASH_KEYS,
  parseDeliveryBody, safeReference, intentHashOf,
};
