'use strict';

/**
 * Versioned research-connector interface (contract freeze v1).
 *
 * Data shapes + runtime asserts only. No network I/O, no HTTP clients, no SDKs.
 * PR3B/C/D own connector implementations and must not modify this module.
 * PR3E owns persistence, HTTP, credential-vault wiring, and SSRF-safe URL sinks
 * (`services/security/safe_url.js`). This layer only checks HTTPS syntax.
 */

const { fail } = require('./errors');
const C = require('./research_contracts');
const { failConnector, retryClassFor } = require('./research_errors');
const {
  assertCompetitor,
  assertEvidenceItem,
  assertEvidenceAsset,
  assertSearchParameters,
  assertContinuationState,
  assertRequestedPlatforms,
  assertContractVersion,
  contextTenant,
  resolveTenant,
  stripUnknown,
  assertNoForbiddenFields,
  assertNoBinaryDeep,
  assertNoCredentialMaterial,
  boundedText,
  sanitizeEvidenceText,
  deepFreeze,
} = require('./research_validate');

/**
 * @typedef {'meta_research'|'google_research'|'tiktok_research'} ConnectorId
 *
 * @typedef {Object} ConnectorRequest
 * @property {ConnectorId} connector_id
 * @property {string} connector_version
 * @property {'v1'} contract_version
 * @property {number} tenant_id
 * @property {string} research_run_id
 * @property {string} workflow_id
 * @property {number} approval_id
 * @property {number} approval_object_version
 * @property {Array<'meta'|'google'|'tiktok'>} requested_platforms
 * @property {string} [research_brief]
 * @property {Object} [search_parameters]
 * @property {string|null} [cursor]
 * @property {Object} [continuation_state]
 * @property {string} idempotency_key
 *
 * @typedef {Object} ConnectorPageInfo
 * @property {string|null} next_cursor
 * @property {boolean} has_more
 *
 * @typedef {Object} ConnectorRateLimit
 * @property {number} limit
 * @property {number} remaining
 * @property {string} reset_at
 *
 * @typedef {Object} ConnectorSuccessPage
 * @property {true} ok
 * @property {'v1'} contract_version
 * @property {ConnectorId} connector_id
 * @property {string} connector_version
 * @property {Object[]} competitors
 * @property {Object[]} evidence
 * @property {Object[]} assets
 * @property {ConnectorPageInfo} page
 * @property {Object} continuation_state
 * @property {ConnectorRateLimit|null} rate_limit
 * @property {'none'} retry_class
 *
 * @typedef {Object} ConnectorErrorPage
 * @property {false} ok
 * @property {string} error
 * @property {'retryable'|'terminal'} retry_class
 * @property {number|null} retry_after_ms
 * @property {ConnectorRateLimit|null} rate_limit
 * @property {Object} continuation_state
 * @property {string} message
 */

function vf(field, reason) {
  fail('validation_failed', { field, reason: reason || 'invalid' });
}

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v) && !Buffer.isBuffer(v);
}

function asPositiveInt(v, field) {
  let n;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) n = Number(v.trim());
  else vf(field, 'not_integer');
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

function requiredId(v, field) {
  if (v == null || v === '') vf(field, 'required');
  if (typeof v !== 'string' && typeof v !== 'number') vf(field, 'not_text');
  const s = String(v).trim();
  if (s.length < C.LIMITS.id.min || s.length > C.LIMITS.id.max) vf(field, 'length');
  return s;
}

function optionalCursor(v) {
  if (v == null || v === '') return null;
  if (typeof v !== 'string') vf('cursor', 'not_text');
  const s = v.trim();
  if (s.length === 0) return null;
  if (s.length > C.LIMITS.cursor.max) vf('cursor', 'oversized');
  assertNoCredentialMaterial(s, 'cursor');
  return s;
}

function assertRateLimit(raw, field) {
  if (raw == null) return null;
  if (!isPlainObject(raw)) vf(field, 'not_object');
  assertNoForbiddenFields(raw);
  assertNoBinaryDeep(raw, field);
  const o = stripUnknown(raw, C.RATE_LIMIT_ALLOWED);
  const limit = asNonNegInt(o.limit, `${field}.limit`);
  const remaining = asNonNegInt(o.remaining, `${field}.remaining`);
  if (o.reset_at == null || o.reset_at === '') vf(`${field}.reset_at`, 'required');
  const d = new Date(o.reset_at);
  if (Number.isNaN(d.getTime())) vf(`${field}.reset_at`, 'invalid_time');
  return Object.freeze({
    limit,
    remaining,
    reset_at: d.toISOString(),
  });
}

function assertPageInfo(raw) {
  if (!isPlainObject(raw)) vf('page', 'not_object');
  assertNoForbiddenFields(raw);
  const o = stripUnknown(raw, C.PAGE_ALLOWED);
  if (typeof o.has_more !== 'boolean') vf('page.has_more', 'not_boolean');
  let next_cursor = null;
  if (o.next_cursor != null && o.next_cursor !== '') {
    if (typeof o.next_cursor !== 'string') vf('page.next_cursor', 'not_text');
    next_cursor = o.next_cursor.trim();
    if (next_cursor.length > C.LIMITS.cursor.max) vf('page.next_cursor', 'oversized');
    if (next_cursor.length === 0) next_cursor = null;
    assertNoCredentialMaterial(next_cursor, 'page.next_cursor');
  }
  if (o.has_more === false && next_cursor != null) vf('page.next_cursor', 'must_be_null_when_done');
  if (o.has_more === true && next_cursor == null) vf('page.next_cursor', 'required_when_has_more');
  return Object.freeze({ next_cursor, has_more: o.has_more });
}

function assertConnectorIdentity(input) {
  if (!isPlainObject(input)) vf('connector', 'not_object');
  assertNoForbiddenFields(input);
  const connector_id = String(input.connector_id || '').trim();
  if (!C.CONNECTOR_IDS.includes(connector_id)) vf('connector_id', 'invalid_enum');
  // The version string is stored on every evidence row, so it gets the same
  // credential + NUL scan as the other stored strings rather than a bare
  // length check.
  const connector_version = boundedText(
    input.connector_version,
    C.LIMITS.connector_version.min,
    C.LIMITS.connector_version.max,
    'connector_version',
    { allowEmpty: false }
  );
  const contract_version = assertContractVersion(input.contract_version);
  return Object.freeze({ connector_id, connector_version, contract_version });
}

function assertConnectorRequest(input, opts) {
  const tenantId = contextTenant(opts);
  if (!isPlainObject(input)) vf('connector_request', 'not_object');
  assertNoForbiddenFields(input);
  assertNoBinaryDeep(input, 'connector_request');
  const raw = stripUnknown(input, C.CONNECTOR_REQUEST_ALLOWED);
  const ident = assertConnectorIdentity(raw);
  const tenant_id = resolveTenant(input, tenantId);
  const requested_platforms = assertRequestedPlatforms(raw.requested_platforms);
  const expectedPlatform = C.CONNECTOR_PLATFORM[ident.connector_id];
  if (!requested_platforms.includes(expectedPlatform)) {
    vf('requested_platforms', 'connector_platform_missing');
  }
  const out = {
    connector_id: ident.connector_id,
    connector_version: ident.connector_version,
    contract_version: ident.contract_version,
    tenant_id,
    research_run_id: requiredId(raw.research_run_id, 'research_run_id'),
    workflow_id: requiredId(raw.workflow_id, 'workflow_id'),
    approval_id: asPositiveInt(raw.approval_id, 'approval_id'),
    approval_object_version: asPositiveInt(raw.approval_object_version, 'approval_object_version'),
    requested_platforms,
    research_brief: sanitizeEvidenceText(
      raw.research_brief == null ? '' : raw.research_brief,
      C.LIMITS.research_brief.max
    ),
    search_parameters: assertSearchParameters(raw.search_parameters),
    cursor: optionalCursor(raw.cursor),
    continuation_state: assertContinuationState(raw.continuation_state),
    idempotency_key: sanitizeEvidenceText(raw.idempotency_key, C.LIMITS.idempotency_key.max),
  };
  if (!out.idempotency_key) vf('idempotency_key', 'required');
  return deepFreeze(out);
}

function assertItemArray(raw, field) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) vf(field, 'not_array');
  return raw;
}

function assertConnectorPage(input, opts) {
  const tenantId = contextTenant(opts);
  if (!isPlainObject(input)) vf('connector_page', 'not_object');
  assertNoForbiddenFields(input);
  assertNoBinaryDeep(input, 'connector_page');
  if (input.ok !== true) vf('ok', 'not_true');
  const raw = stripUnknown(input, C.CONNECTOR_PAGE_ALLOWED);
  const ident = assertConnectorIdentity(raw);
  const tenant_id = resolveTenant(input, tenantId);
  if (raw.retry_class !== 'none') vf('retry_class', 'must_be_none');
  const competitors = assertItemArray(raw.competitors, 'competitors').map((item, i) => {
    try {
      return assertCompetitor(item, { tenantId });
    } catch (err) {
      if (err && err.code === 'validation_failed') {
        fail('validation_failed', { field: `competitors[${i}]`, reason: err.extra && err.extra.reason, nested: err.extra });
      }
      throw err;
    }
  });
  const evidence = assertItemArray(raw.evidence, 'evidence').map((item, i) => {
    try {
      const ev = assertEvidenceItem(item, { tenantId });
      if (ev.connector_id !== ident.connector_id) vf(`evidence[${i}].connector_id`, 'identity_mismatch');
      if (ev.connector_version !== ident.connector_version) vf(`evidence[${i}].connector_version`, 'identity_mismatch');
      if (ev.contract_version !== ident.contract_version) vf(`evidence[${i}].contract_version`, 'identity_mismatch');
      return ev;
    } catch (err) {
      if (err && err.code === 'validation_failed') {
        fail('validation_failed', { field: `evidence[${i}]`, reason: err.extra && err.extra.reason, nested: err.extra });
      }
      throw err;
    }
  });
  const assets = assertItemArray(raw.assets, 'assets').map((item, i) => {
    try {
      return assertEvidenceAsset(item, { tenantId });
    } catch (err) {
      if (err && err.code === 'validation_failed') {
        fail('validation_failed', { field: `assets[${i}]`, reason: err.extra && err.extra.reason, nested: err.extra });
      }
      throw err;
    }
  });
  const out = {
    ok: true,
    contract_version: ident.contract_version,
    connector_id: ident.connector_id,
    connector_version: ident.connector_version,
    competitors,
    evidence,
    assets,
    page: assertPageInfo(raw.page),
    continuation_state: assertContinuationState(raw.continuation_state),
    rate_limit: assertRateLimit(raw.rate_limit, 'rate_limit'),
    retry_class: 'none',
    tenant_id,
  };
  return deepFreeze(out);
}

function assertConnectorError(input) {
  if (!isPlainObject(input)) vf('connector_error', 'not_object');
  assertNoForbiddenFields(input);
  assertNoBinaryDeep(input, 'connector_error');
  if (input.ok !== false) vf('ok', 'not_false');
  const raw = stripUnknown(input, C.CONNECTOR_ERROR_ALLOWED);
  const error = String(raw.error || '').trim();
  const expectedRetry = retryClassFor(error);
  if (!expectedRetry) vf('error', 'invalid_enum');
  const retry_class = String(raw.retry_class || '').trim();
  if (retry_class !== expectedRetry) vf('retry_class', 'mismatch');
  let retry_after_ms = null;
  if (raw.retry_after_ms != null && raw.retry_after_ms !== '') {
    retry_after_ms = asNonNegInt(raw.retry_after_ms, 'retry_after_ms');
  }
  const message = sanitizeEvidenceText(raw.message == null ? error : raw.message, C.LIMITS.error_message.max);
  const out = {
    ok: false,
    error,
    retry_class,
    retry_after_ms,
    rate_limit: assertRateLimit(raw.rate_limit, 'rate_limit'),
    continuation_state: assertContinuationState(raw.continuation_state),
    message,
  };
  if (raw.contract_version != null) out.contract_version = assertContractVersion(raw.contract_version);
  if (raw.connector_id != null) {
    if (!C.CONNECTOR_IDS.includes(String(raw.connector_id))) vf('connector_id', 'invalid_enum');
    out.connector_id = String(raw.connector_id);
  }
  if (raw.connector_version != null && raw.connector_version !== '') {
    out.connector_version = sanitizeEvidenceText(raw.connector_version, C.LIMITS.connector_version.max);
  }
  return Object.freeze(out);
}

function assertConnectorResult(input, opts) {
  if (!isPlainObject(input)) vf('connector_result', 'not_object');
  if (input.ok === true) return assertConnectorPage(input, opts);
  if (input.ok === false) return assertConnectorError(input);
  vf('ok', 'required_boolean');
}

function notImplemented(connector_id) {
  const id = String(connector_id || '').trim();
  if (!C.CONNECTOR_IDS.includes(id)) vf('connector_id', 'invalid_enum');
  failConnector('terminal', `connector ${id} is not implemented`);
}

module.exports = {
  CONNECTOR_IDS: C.CONNECTOR_IDS,
  assertConnectorIdentity,
  assertConnectorRequest,
  assertConnectorPage,
  assertConnectorError,
  assertConnectorResult,
  notImplemented,
};
