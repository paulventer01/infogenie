'use strict';

const { fail } = require('./errors');
const { canonicalize, sha256Hex } = require('./hash');
const { assertSearchParameters, assertRequestedPlatforms, resolveTenant } = require('./research_validate');
const C = require('./research_contracts');

const PLAN_KEYS = Object.freeze([
  'contract_version',
  'requested_platforms',
  'competitor_identifiers',
  'search_parameters',
  'credit_ceiling_micros',
  'connector_versions',
  'evidence_contract_version',
]);
const PLAN_KEY_SET = new Set(PLAN_KEYS);
const IDENTITY_KEYS = Object.freeze(['tenant_id', 'workflow_id']);
const CONNECTOR_VERSION_KEYS = Object.freeze(['meta_research', 'google_research', 'tiktok_research']);
const CONNECTOR_VERSION_SET = new Set(CONNECTOR_VERSION_KEYS);
const MAX_COMPETITOR_IDS = 20;
const MAX_COMPETITOR_ID_LEN = 128;

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v) && !Buffer.isBuffer(v);
}

function isEmptyPlan(plan) {
  if (plan == null) return true;
  if (!isPlainObject(plan)) return false;
  return Object.keys(plan).length === 0;
}

function planHash(plan) {
  return sha256Hex(canonicalize(isEmptyPlan(plan) ? {} : plan));
}

function asNonNegInt(v, field) {
  let n;
  if (typeof v === 'bigint') n = Number(v);
  else if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) n = Number(v.trim());
  else fail('validation_failed', { field, reason: 'not_integer' });
  if (!Number.isInteger(n) || n < 0) fail('validation_failed', { field, reason: 'not_nonnegative_integer' });
  return n;
}

function assertCompetitorIdentifiers(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) fail('validation_failed', { field: 'competitor_identifiers', reason: 'not_array' });
  if (raw.length > MAX_COMPETITOR_IDS) {
    fail('validation_failed', { field: 'competitor_identifiers', reason: 'too_many' });
  }
  return raw.map((id, i) => {
    if (typeof id !== 'string' && typeof id !== 'number') {
      fail('validation_failed', { field: `competitor_identifiers[${i}]`, reason: 'not_text' });
    }
    const s = String(id).trim();
    if (!s || s.length > MAX_COMPETITOR_ID_LEN) {
      fail('validation_failed', { field: `competitor_identifiers[${i}]`, reason: 'length' });
    }
    return s;
  });
}

function assertConnectorVersions(raw) {
  if (raw == null || raw === '') return {};
  if (!isPlainObject(raw)) fail('validation_failed', { field: 'connector_versions', reason: 'not_object' });
  const out = {};
  for (const k of Object.keys(raw)) {
    if (!CONNECTOR_VERSION_SET.has(k)) {
      fail('validation_failed', { field: 'connector_versions', reason: 'unknown_key' });
    }
    const s = String(raw[k] == null ? '' : raw[k]).trim();
    if (s.length < C.LIMITS.connector_version.min || s.length > C.LIMITS.connector_version.max) {
      fail('validation_failed', { field: `connector_versions.${k}`, reason: 'length' });
    }
    out[k] = s;
  }
  return out;
}

function intersectPlatforms(requested, approved) {
  const allow = new Set((approved || []).map((p) => String(p || '').toLowerCase().trim()).filter(Boolean));
  return (requested || []).filter((p) => allow.has(p));
}

function validatePlan(input, opts = {}) {
  const raw = input == null ? {} : input;
  if (!isPlainObject(raw)) fail('validation_failed', { field: 'research_plan', reason: 'not_object' });
  for (const k of Object.keys(raw)) {
    if (k === 'tenant_id' || k === 'workflow_id') continue;
    if (!PLAN_KEY_SET.has(k)) fail('validation_failed', { field: k, reason: 'unknown_key' });
  }
  if (opts.tenantId != null && Object.prototype.hasOwnProperty.call(raw, 'tenant_id') && raw.tenant_id != null) {
    resolveTenant(raw, opts.tenantId);
  }
  const contract_version = raw.contract_version == null || raw.contract_version === ''
    ? C.CONTRACT_VERSION
    : String(raw.contract_version).trim();
  if (contract_version !== C.CONTRACT_VERSION) {
    fail('validation_failed', { field: 'contract_version', reason: 'unsupported' });
  }
  const evidence_contract_version = raw.evidence_contract_version == null || raw.evidence_contract_version === ''
    ? C.CONTRACT_VERSION
    : String(raw.evidence_contract_version).trim();
  if (evidence_contract_version !== C.CONTRACT_VERSION) {
    fail('validation_failed', { field: 'evidence_contract_version', reason: 'unsupported' });
  }
  const requested_platforms = assertRequestedPlatforms(raw.requested_platforms).slice().sort();
  const competitor_identifiers = assertCompetitorIdentifiers(raw.competitor_identifiers);
  const search_parameters = assertSearchParameters(raw.search_parameters);
  let credit_ceiling_micros;
  if (raw.credit_ceiling_micros == null || raw.credit_ceiling_micros === '') {
    credit_ceiling_micros = asNonNegInt(opts.creditCeilingMicros == null ? 0 : opts.creditCeilingMicros, 'credit_ceiling_micros');
  } else {
    credit_ceiling_micros = asNonNegInt(raw.credit_ceiling_micros, 'credit_ceiling_micros');
  }
  if (opts.creditCeilingMicros != null && opts.creditCeilingMicros !== '') {
    const wfCeiling = asNonNegInt(opts.creditCeilingMicros, 'credit_ceiling_micros');
    if (credit_ceiling_micros > wfCeiling) {
      fail('validation_failed', { field: 'credit_ceiling_micros', reason: 'exceeds_workflow' });
    }
  }
  const connector_versions = assertConnectorVersions(raw.connector_versions);
  const plan = canonicalize({
    contract_version,
    requested_platforms,
    competitor_identifiers,
    search_parameters,
    credit_ceiling_micros,
    connector_versions,
    evidence_contract_version,
  });
  return plan;
}

function previewPlan(input, opts = {}) {
  const plan = validatePlan(input, opts);
  return { plan, plan_hash: planHash(plan) };
}

module.exports = {
  PLAN_KEYS,
  IDENTITY_KEYS,
  CONNECTOR_VERSION_KEYS,
  MAX_CONCURRENCY: 1,
  isEmptyPlan,
  planHash,
  validatePlan,
  previewPlan,
  intersectPlatforms,
};

