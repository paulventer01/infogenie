'use strict';

const crypto = require('crypto');
const { fail } = require('./errors');
const { sha256Hex, canonicalize } = require('./hash');
const C = require('./research_contracts');

const FORBIDDEN_SET = new Set([...C.FORBIDDEN_KEYS, ...C.POLLUTION_KEYS]);
const HEX64 = /^[0-9a-f]{64}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const BASE64_BLOB = /^[A-Za-z0-9+/]+=*$/;

function vf(field, reason) {
  fail('validation_failed', { field, reason: reason || 'invalid' });
}

function isPlainObject(v) {
  if (v == null || typeof v !== 'object') return false;
  if (Array.isArray(v)) return false;
  if (Buffer.isBuffer(v)) return false;
  if (ArrayBuffer.isView(v)) return false;
  if (v instanceof Date) return false;
  return true;
}

function utf8Bytes(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch (_) {
    vf('json', 'unserializable');
  }
}

function assertJsonBytes(value, max, field) {
  const n = utf8Bytes(value);
  if (n > max) vf(field, 'oversized');
  return n;
}

function isBinaryValue(v) {
  return Buffer.isBuffer(v) || ArrayBuffer.isView(v) || v instanceof ArrayBuffer;
}

function assertNoBinaryDeep(value, field) {
  if (value == null) return;
  if (isBinaryValue(value)) vf(field || 'value', 'binary');
  if (typeof value === 'string') {
    const t = value.trim();
    if (/^data:/i.test(t)) vf(field, 'data_uri');
    if (t.length > 4096 && BASE64_BLOB.test(t) && t.length % 4 === 0) {
      vf(field, 'base64_blob');
    }
  }
  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        assertNoBinaryDeep(value[i], `${field || 'arr'}[${i}]`);
      }
      return;
    }
    for (const k of Object.keys(value)) {
      assertNoBinaryDeep(value[k], field ? `${field}.${k}` : k);
    }
  }
}

function assertNoForbiddenFields(obj) {
  const seen = new Set();
  function walk(value, path) {
    if (value == null || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    if (isBinaryValue(value)) return;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) walk(value[i], `${path}[${i}]`);
      return;
    }
    for (const k of Object.keys(value)) {
      const lower = String(k).toLowerCase();
      if (FORBIDDEN_SET.has(k) || FORBIDDEN_SET.has(lower)) {
        vf(k, 'forbidden');
      }
      walk(value[k], path ? `${path}.${k}` : k);
    }
  }
  walk(obj, '');
}

function stripUnknown(obj, allowedKeys) {
  if (!isPlainObject(obj)) vf('object', 'not_object');
  const allowed = allowedKeys instanceof Set ? allowedKeys : new Set(allowedKeys);
  const out = {};
  for (const k of Object.keys(obj)) {
    if (allowed.has(k)) out[k] = obj[k];
  }
  return out;
}

function contextTenant(opts) {
  if (!opts || opts.tenantId == null) vf('tenant_id', 'missing_context');
  return assertPositiveInt(opts.tenantId, 'tenant_id');
}

function assertPositiveInt(v, field) {
  let n;
  if (typeof v === 'bigint') {
    n = Number(v);
  } else if (typeof v === 'number') {
    n = v;
  } else if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) {
    n = Number(v.trim());
  } else {
    vf(field, 'not_integer');
  }
  if (!Number.isInteger(n) || n < 1) vf(field, 'not_positive_integer');
  return n;
}

function asNonNegInt(v, field) {
  let n;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) n = Number(v.trim());
  else vf(field, 'not_integer');
  if (!Number.isInteger(n) || n < 0) vf(field, 'not_nonnegative_integer');
  return n;
}

function asBoundedInt(v, min, max, field) {
  let n;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) n = Number(v.trim());
  else vf(field, 'not_integer');
  if (!Number.isInteger(n) || n < min || n > max) vf(field, 'out_of_range');
  return n;
}

function resolveTenant(input, tenantId) {
  const ctx = tenantId;
  if (input && Object.prototype.hasOwnProperty.call(input, 'tenant_id') && input.tenant_id != null) {
    const supplied = assertPositiveInt(input.tenant_id, 'tenant_id');
    if (supplied !== ctx) vf('tenant_id', 'mismatch');
  }
  return ctx;
}

function boundedText(v, min, max, field, { allowEmpty = true, optional = false } = {}) {
  if (v == null) {
    if (optional) return null;
    if (min <= 0 && allowEmpty) return '';
    vf(field, 'required');
  }
  if (typeof v !== 'string' && typeof v !== 'number') vf(field, 'not_text');
  const s = String(v).trim();
  if (s.length > max) vf(field, 'oversized');
  if (s.length < min) {
    if (optional && s.length === 0) return null;
    vf(field, 'too_short');
  }
  if (s.includes('\u0000')) vf(field, 'nul');
  return s;
}

function sanitizeEvidenceText(s, max) {
  if (max == null || !Number.isInteger(max) || max < 0) vf('max', 'invalid');
  if (s == null) return '';
  if (typeof s !== 'string' && typeof s !== 'number') vf('text', 'not_text');
  const out = String(s).trim();
  if (out.length > max) vf('text', 'oversized');
  if (out.includes('\u0000')) vf('text', 'nul');
  return out;
}

function optionalText(v, max, field) {
  if (v == null || v === '') return null;
  return boundedText(v, 1, max, field, { optional: true });
}

function requiredId(v, field, limit = C.LIMITS.id) {
  return boundedText(v, limit.min, limit.max, field, { allowEmpty: false });
}

function assertContractVersion(v) {
  const s = v == null || v === '' ? C.CONTRACT_VERSION : String(v).trim();
  if (s !== C.CONTRACT_VERSION) vf('contract_version', 'unsupported');
  return C.CONTRACT_VERSION;
}

function assertEnum(v, allowed, field, { optional = false } = {}) {
  if (v == null || v === '') {
    if (optional) return null;
    vf(field, 'required');
  }
  const s = String(v).trim();
  if (!allowed.includes(s)) vf(field, 'invalid_enum');
  return s;
}

function requiredTime(v, field) {
  if (v == null || v === '') vf(field, 'required');
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) vf(field, 'invalid_time');
    return v.toISOString();
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) vf(field, 'invalid_time');
  return d.toISOString();
}

function optionalTime(v, field) {
  if (v == null || v === '') return null;
  return requiredTime(v, field);
}

function optionalDate(v, field) {
  if (v == null || v === '') return null;
  if (typeof v === 'string' && DATE_ONLY.test(v.trim())) return v.trim();
  const iso = requiredTime(v, field);
  return iso.slice(0, 10);
}

function assertHttpsUrl(v, field, { optional = true } = {}) {
  if (v == null || v === '') {
    if (optional) return null;
    vf(field, 'required');
  }
  if (typeof v !== 'string') vf(field, 'not_text');
  const url = v.trim();
  if (url.length > C.LIMITS.url.max) vf(field, 'oversized');
  if (url.length < 1) {
    if (optional) return null;
    vf(field, 'required');
  }
  const lower = url.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('http:')) {
    vf(field, 'unsafe_scheme');
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    vf(field, 'invalid_url');
  }
  if (parsed.protocol !== 'https:') vf(field, 'unsafe_scheme');
  if (parsed.username || parsed.password) vf(field, 'credentials_in_url');
  if (parsed.href.length > C.LIMITS.url.max) vf(field, 'oversized');
  return url;
}

function assertSha256Hex(v, field) {
  if (v == null || v === '') vf(field, 'required');
  const s = String(v).trim().toLowerCase();
  if (!HEX64.test(s)) vf(field, 'not_sha256_hex');
  return s;
}

function assertRequestedPlatforms(v) {
  if (!Array.isArray(v)) vf('requested_platforms', 'not_array');
  if (v.length < C.LIMITS.requested_platforms.min || v.length > C.LIMITS.requested_platforms.max) {
    vf('requested_platforms', 'count');
  }
  const out = [];
  const seen = new Set();
  for (const p of v) {
    const s = String(p || '').toLowerCase().trim();
    if (!C.PLATFORMS.includes(s)) vf('requested_platforms', 'invalid_enum');
    if (seen.has(s)) vf('requested_platforms', 'duplicate');
    seen.add(s);
    out.push(s);
  }
  return out;
}

function assertSearchParameters(raw) {
  const input = raw == null || raw === '' ? {} : raw;
  if (!isPlainObject(input)) vf('search_parameters', 'not_object');
  assertNoForbiddenFields(input);
  assertNoBinaryDeep(input, 'search_parameters');
  assertJsonBytes(input, C.LIMITS.search_parameters_bytes, 'search_parameters');
  const stripped = stripUnknown(input, C.SEARCH_PARAMETER_KEYS);
  const out = {};
  if (stripped.countries != null) {
    if (!Array.isArray(stripped.countries)) vf('search_parameters.countries', 'not_array');
    if (stripped.countries.length > C.LIMITS.search_countries.maxItems) {
      vf('search_parameters.countries', 'too_many');
    }
    out.countries = stripped.countries.map((c, i) => (
      boundedText(c, 1, C.LIMITS.search_countries.itemMax, `search_parameters.countries[${i}]`, { allowEmpty: false })
    ));
  }
  if (stripped.languages != null) {
    if (!Array.isArray(stripped.languages)) vf('search_parameters.languages', 'not_array');
    if (stripped.languages.length > C.LIMITS.search_languages.maxItems) {
      vf('search_parameters.languages', 'too_many');
    }
    out.languages = stripped.languages.map((c, i) => (
      boundedText(c, 1, C.LIMITS.search_languages.itemMax, `search_parameters.languages[${i}]`, { allowEmpty: false })
    ));
  }
  if (stripped.query != null && stripped.query !== '') {
    out.query = boundedText(stripped.query, 0, C.LIMITS.search_query.max, 'search_parameters.query');
  }
  if (stripped.lookback_days != null && stripped.lookback_days !== '') {
    out.lookback_days = asBoundedInt(
      stripped.lookback_days,
      C.LIMITS.lookback_days.min,
      C.LIMITS.lookback_days.max,
      'search_parameters.lookback_days'
    );
  }
  if (stripped.max_pages != null && stripped.max_pages !== '') {
    out.max_pages = asBoundedInt(
      stripped.max_pages,
      C.LIMITS.max_pages.min,
      C.LIMITS.max_pages.max,
      'search_parameters.max_pages'
    );
  }
  if (stripped.max_results_per_page != null && stripped.max_results_per_page !== '') {
    out.max_results_per_page = asBoundedInt(
      stripped.max_results_per_page,
      C.LIMITS.max_results_per_page.min,
      C.LIMITS.max_results_per_page.max,
      'search_parameters.max_results_per_page'
    );
  }
  assertJsonBytes(out, C.LIMITS.search_parameters_bytes, 'search_parameters');
  return out;
}

function assertContinuationState(raw) {
  const input = raw == null || raw === '' ? {} : raw;
  if (!isPlainObject(input)) vf('continuation_state', 'not_object');
  assertNoForbiddenFields(input);
  assertNoBinaryDeep(input, 'continuation_state');
  assertJsonBytes(input, C.LIMITS.continuation_state_bytes, 'continuation_state');
  return input;
}

function assertProviderMetrics(raw) {
  const input = raw == null || raw === '' ? {} : raw;
  if (!isPlainObject(input)) vf('provider_metrics', 'not_object');
  assertNoForbiddenFields(input);
  assertNoBinaryDeep(input, 'provider_metrics');
  if (Object.prototype.hasOwnProperty.call(input, 'verified')
    || Object.prototype.hasOwnProperty.call(input, 'independently_verified')
    || Object.prototype.hasOwnProperty.call(input, 'fact')) {
    vf('provider_metrics', 'verified_flag_forbidden');
  }
  assertJsonBytes(input, C.LIMITS.provider_metrics_bytes, 'provider_metrics');
  return input;
}

function assertStorageRef(v) {
  const s = boundedText(v, C.LIMITS.storage_ref.min, C.LIMITS.storage_ref.max, 'storage_ref', { allowEmpty: false });
  const lower = s.toLowerCase();
  if (lower.startsWith('data:') || lower.startsWith('javascript:') || lower.startsWith('http:')) {
    vf('storage_ref', 'unsafe_scheme');
  }
  if (/^https?:\/\/[^/\s]+:[^/\s]+@/i.test(s)) vf('storage_ref', 'credentials_in_url');
  return s;
}

function computeCompetitorDedupKey({ platform, provider_advertiser_id }) {
  const p = String(platform || '').trim();
  const id = String(provider_advertiser_id || '').trim();
  if (!p || !id) vf('dedup_key', 'missing_identity');
  return crypto.createHash('sha256').update(`${p}:${id}`, 'utf8').digest('hex');
}

function computeEvidenceHash(sanitizedCanonicalObject) {
  if (!isPlainObject(sanitizedCanonicalObject)) vf('evidence_hash', 'not_object');
  const subset = {};
  for (const k of C.EVIDENCE_HASH_FIELDS) {
    const v = sanitizedCanonicalObject[k];
    if (v === undefined) subset[k] = null;
    else subset[k] = v;
  }
  return sha256Hex(canonicalize(subset));
}

function prepareInput(input, allowed, label) {
  if (!isPlainObject(input)) vf(label || 'object', 'not_object');
  assertNoForbiddenFields(input);
  assertNoBinaryDeep(input, label || 'object');
  return stripUnknown(input, allowed);
}

function assertResearchRun(input, opts) {
  const tenantId = contextTenant(opts);
  const raw = prepareInput(input, C.RESEARCH_RUN_ALLOWED, 'research_run');
  const tenant_id = resolveTenant(input, tenantId);
  const id = requiredId(raw.id, 'id');
  const workflow_id = requiredId(raw.workflow_id, 'workflow_id', C.LIMITS.workflow_id);
  const approval_id = assertPositiveInt(raw.approval_id, 'approval_id');
  const approval_object_version = assertPositiveInt(raw.approval_object_version, 'approval_object_version');
  const requested_platforms = assertRequestedPlatforms(raw.requested_platforms);
  const idempotency_key = boundedText(
    raw.idempotency_key, C.LIMITS.idempotency_key.min, C.LIMITS.idempotency_key.max, 'idempotency_key', { allowEmpty: false }
  );
  const contract_version = assertContractVersion(raw.contract_version);
  const research_brief = sanitizeEvidenceText(
    raw.research_brief == null ? C.RESEARCH_RUN_DEFAULTS.research_brief : raw.research_brief,
    C.LIMITS.research_brief.max
  );
  const search_parameters = assertSearchParameters(raw.search_parameters);
  const state = assertEnum(raw.state == null ? C.RESEARCH_RUN_DEFAULTS.state : raw.state, C.RUN_STATES, 'state');
  const continuation_state = assertContinuationState(raw.continuation_state);
  const failure_class = assertEnum(raw.failure_class, C.FAILURE_CLASSES, 'failure_class', { optional: true });
  const error_code = optionalText(raw.error_code, C.LIMITS.error_code.max, 'error_code');
  const error_message = raw.error_message == null || raw.error_message === ''
    ? null
    : sanitizeEvidenceText(raw.error_message, C.LIMITS.error_message.max);
  const out = {
    id,
    tenant_id,
    workflow_id,
    approval_id,
    approval_object_version,
    contract_version,
    requested_platforms,
    research_brief,
    search_parameters,
    state,
    idempotency_key,
    continuation_state,
    failure_class,
    error_code,
    error_message,
    created_at: optionalTime(raw.created_at, 'created_at'),
    started_at: optionalTime(raw.started_at, 'started_at'),
    completed_at: optionalTime(raw.completed_at, 'completed_at'),
    failed_at: optionalTime(raw.failed_at, 'failed_at'),
  };
  return Object.freeze(out);
}

function assertCompetitor(input, opts) {
  const tenantId = contextTenant(opts);
  const raw = prepareInput(input, C.COMPETITOR_ALLOWED, 'competitor');
  const tenant_id = resolveTenant(input, tenantId);
  const platform = assertEnum(raw.platform, C.PLATFORMS, 'platform');
  const provider_advertiser_id = boundedText(
    raw.provider_advertiser_id,
    C.LIMITS.provider_advertiser_id.min,
    C.LIMITS.provider_advertiser_id.max,
    'provider_advertiser_id',
    { allowEmpty: false }
  );
  const computedDedup = computeCompetitorDedupKey({ platform, provider_advertiser_id });
  const dedup_key = raw.dedup_key == null || raw.dedup_key === ''
    ? computedDedup
    : boundedText(raw.dedup_key, C.LIMITS.dedup_key.min, C.LIMITS.dedup_key.max, 'dedup_key', { allowEmpty: false });
  const out = {
    id: requiredId(raw.id, 'id'),
    tenant_id,
    research_run_id: requiredId(raw.research_run_id, 'research_run_id', C.LIMITS.research_run_id),
    platform,
    provider_advertiser_id,
    normalized_name: boundedText(
      raw.normalized_name, C.LIMITS.normalized_name.min, C.LIMITS.normalized_name.max, 'normalized_name', { allowEmpty: false }
    ),
    canonical_url: assertHttpsUrl(raw.canonical_url, 'canonical_url', { optional: true }),
    country: optionalText(raw.country, C.LIMITS.country.max, 'country'),
    market: optionalText(raw.market, C.LIMITS.market.max, 'market'),
    discovery_source: assertEnum(raw.discovery_source, C.DISCOVERY_SOURCES, 'discovery_source'),
    captured_at: requiredTime(raw.captured_at, 'captured_at'),
    dedup_key,
    contract_version: assertContractVersion(raw.contract_version),
    created_at: optionalTime(raw.created_at, 'created_at'),
  };
  return Object.freeze(out);
}

function assertEvidenceItem(input, opts) {
  const tenantId = contextTenant(opts);
  const raw = prepareInput(input, C.EVIDENCE_ALLOWED, 'evidence');
  const tenant_id = resolveTenant(input, tenantId);
  const platform = assertEnum(raw.platform, C.PLATFORMS, 'platform');
  const connector_id = assertEnum(raw.connector_id, C.CONNECTOR_IDS, 'connector_id');
  if (C.CONNECTOR_PLATFORM[connector_id] !== platform) vf('connector_id', 'platform_mismatch');
  const provider_external_id = optionalText(
    raw.provider_external_id, C.LIMITS.provider_external_id.max, 'provider_external_id'
  );
  const canonical_source_url = assertHttpsUrl(raw.canonical_source_url, 'canonical_source_url', { optional: true });
  if (!provider_external_id && !canonical_source_url) {
    vf('canonical_source_url', 'provenance_source_required');
  }
  const headline = sanitizeEvidenceText(raw.headline == null ? '' : raw.headline, C.LIMITS.headline.max);
  const body_text = sanitizeEvidenceText(raw.body_text == null ? '' : raw.body_text, C.LIMITS.body_text.max);
  const excerpt = sanitizeEvidenceText(raw.excerpt == null ? '' : raw.excerpt, C.LIMITS.excerpt.max);
  const advertiser_name = sanitizeEvidenceText(
    raw.advertiser_name == null ? '' : raw.advertiser_name, C.LIMITS.advertiser_name.max
  );
  const creative_format = assertEnum(raw.creative_format, C.CREATIVE_FORMATS, 'creative_format', { optional: true });
  const metrics_kind = assertEnum(raw.metrics_kind, C.METRICS_KINDS, 'metrics_kind');
  const provider_metrics = assertProviderMetrics(raw.provider_metrics);
  const canonicalForHash = {
    platform,
    source_type: assertEnum(raw.source_type, C.SOURCE_TYPES, 'source_type'),
    provider_external_id,
    canonical_source_url,
    headline,
    body_text,
    excerpt,
    advertiser_name,
    creative_format,
  };
  const computedHash = computeEvidenceHash(canonicalForHash);
  const evidence_hash = raw.evidence_hash == null || raw.evidence_hash === ''
    ? computedHash
    : assertSha256Hex(raw.evidence_hash, 'evidence_hash');
  if (evidence_hash !== computedHash) vf('evidence_hash', 'mismatch');
  const dedup_key = raw.dedup_key == null || raw.dedup_key === ''
    ? evidence_hash
    : boundedText(raw.dedup_key, C.LIMITS.dedup_key.min, C.LIMITS.dedup_key.max, 'dedup_key', { allowEmpty: false });
  const out = {
    id: requiredId(raw.id, 'id'),
    tenant_id,
    research_run_id: requiredId(raw.research_run_id, 'research_run_id', C.LIMITS.research_run_id),
    competitor_id: requiredId(raw.competitor_id, 'competitor_id'),
    platform,
    source_type: canonicalForHash.source_type,
    provider_external_id,
    canonical_source_url,
    advertiser_name,
    creative_format,
    headline,
    body_text,
    excerpt,
    provider_started_on: optionalDate(raw.provider_started_on, 'provider_started_on'),
    provider_ended_on: optionalDate(raw.provider_ended_on, 'provider_ended_on'),
    captured_at: requiredTime(raw.captured_at, 'captured_at'),
    market: optionalText(raw.market, C.LIMITS.market.max, 'market'),
    language: optionalText(raw.language, C.LIMITS.language.max, 'language'),
    placement: optionalText(raw.placement, C.LIMITS.placement.max, 'placement'),
    provider_metrics,
    metrics_kind,
    provenance_method: assertEnum(raw.provenance_method, C.PROVENANCE_METHODS, 'provenance_method'),
    connector_id,
    connector_version: boundedText(
      raw.connector_version, C.LIMITS.connector_version.min, C.LIMITS.connector_version.max, 'connector_version', { allowEmpty: false }
    ),
    contract_version: assertContractVersion(raw.contract_version),
    evidence_hash,
    dedup_key,
    expires_at: optionalTime(raw.expires_at, 'expires_at'),
    retention_class: assertEnum(
      raw.retention_class == null || raw.retention_class === '' ? 'standard' : raw.retention_class,
      C.RETENTION_CLASSES,
      'retention_class'
    ),
    supersedes_id: optionalText(raw.supersedes_id, C.LIMITS.id.max, 'supersedes_id'),
    created_at: optionalTime(raw.created_at, 'created_at'),
  };
  return Object.freeze(out);
}

function assertEvidenceAsset(input, opts) {
  const tenantId = contextTenant(opts);
  const raw = prepareInput(input, C.ASSET_ALLOWED, 'asset');
  const tenant_id = resolveTenant(input, tenantId);
  const out = {
    id: requiredId(raw.id, 'id'),
    tenant_id,
    evidence_id: requiredId(raw.evidence_id, 'evidence_id'),
    media_type: assertEnum(raw.media_type, C.MEDIA_TYPES, 'media_type'),
    storage_ref: assertStorageRef(raw.storage_ref),
    checksum_sha256: assertSha256Hex(raw.checksum_sha256, 'checksum_sha256'),
    width_px: raw.width_px == null || raw.width_px === '' ? null : asNonNegInt(raw.width_px, 'width_px'),
    height_px: raw.height_px == null || raw.height_px === '' ? null : asNonNegInt(raw.height_px, 'height_px'),
    duration_ms: raw.duration_ms == null || raw.duration_ms === '' ? null : asNonNegInt(raw.duration_ms, 'duration_ms'),
    captured_at: requiredTime(raw.captured_at, 'captured_at'),
    expires_at: optionalTime(raw.expires_at, 'expires_at'),
    retention_class: assertEnum(
      raw.retention_class == null || raw.retention_class === '' ? 'standard' : raw.retention_class,
      C.RETENTION_CLASSES,
      'retention_class'
    ),
    created_at: optionalTime(raw.created_at, 'created_at'),
  };
  return Object.freeze(out);
}

module.exports = {
  assertResearchRun,
  assertCompetitor,
  assertEvidenceItem,
  assertEvidenceAsset,
  computeEvidenceHash,
  computeCompetitorDedupKey,
  sanitizeEvidenceText,
  stripUnknown,
  assertNoForbiddenFields,
  assertNoBinaryDeep,
  assertSearchParameters,
  assertContinuationState,
  assertHttpsUrl,
  assertRequestedPlatforms,
  assertContractVersion,
  contextTenant,
  resolveTenant,
};
