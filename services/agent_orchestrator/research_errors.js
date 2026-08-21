'use strict';

// Connector error taxonomy for research evidence collection.
// NOT an HTTP API contract. Codes match schema failure_class CHECKs.
// Never attach provider bodies, tokens, cookies, or PII.

const { FAILURE_CLASSES } = require('./research_contracts');

const RETRY_CLASS_BY_FAILURE = Object.freeze({
  rate_limit: 'retryable',
  auth_failure: 'terminal',
  transient: 'retryable',
  invalid_response: 'terminal',
  policy_rejection: 'terminal',
  terminal: 'terminal',
});

const MESSAGE_MAX = 512;

// Credential shapes that must never reach a stored error message, an evidence
// text column or a JSON blob. Named patterns require a value-bearing separator
// so a message that merely says "credentials rejected" still survives; the
// header, bearer, JWT, PEM and userinfo-URL forms match on their own because
// nothing legitimate emits them. Rejecting is the whole point: a scrubber that
// truncated or masked would put a clipped secret in the row instead.
const CREDENTIAL_PATTERNS = Object.freeze([
  /access_token/i,
  /refresh_token/i,
  /authorization/i,
  /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{12,}/i,
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\./,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bset-?cookie\b/i,
  /\bcookies?\s*[:=]/i,
  /\b(?:x-)?api[-_. ]?key\s*[:=]/i,
  /\bclient[-_. ]?secret\s*[:=]/i,
  /\b(?:id|session|access|refresh)[-_. ]?token\s*[:=]/i,
  /\b(?:secret|token|credential|credentials|password|passwd|pwd|passphrase)\s*[:=]\s*\S/i,
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /infogenie\.sid/i,
  /[a-z][a-z0-9+.-]*:\/\/[^/\s@]+@/i,
]);

function containsCredentialMaterial(value) {
  if (typeof value !== 'string' || value === '') return false;
  for (const re of CREDENTIAL_PATTERNS) {
    if (re.test(value)) return true;
  }
  return false;
}

class ConnectorError extends Error {
  constructor(code, message, extra) {
    super(message || code);
    this.name = 'ConnectorError';
    this.code = code;
    this.retry_class = RETRY_CLASS_BY_FAILURE[code] || 'terminal';
    this.retry_after_ms = extra && extra.retry_after_ms != null ? extra.retry_after_ms : null;
    this.rate_limit = extra && extra.rate_limit != null ? extra.rate_limit : null;
    this.continuation_state = extra && extra.continuation_state != null ? extra.continuation_state : {};
  }
}

function retryClassFor(code) {
  const mapped = RETRY_CLASS_BY_FAILURE[String(code || '')];
  return mapped || null;
}

function sanitizeConnectorMessage(message) {
  if (message == null || message === '') return '';
  if (typeof message !== 'string' && typeof message !== 'number') {
    const err = new ConnectorError('invalid_response', 'error message is not sanitizable text');
    throw err;
  }
  const s = String(message).trim();
  if (s.length > MESSAGE_MAX) {
    throw new ConnectorError('invalid_response', 'error message exceeds 512 characters');
  }
  if (containsCredentialMaterial(s)) {
    throw new ConnectorError('invalid_response', 'error message contains credential material');
  }
  return s;
}

function failConnector(code, message, extra) {
  const c = String(code || '');
  if (!FAILURE_CLASSES.includes(c)) {
    throw new ConnectorError('terminal', 'unknown connector failure_class');
  }
  const msg = sanitizeConnectorMessage(message == null ? c : message);
  throw new ConnectorError(c, msg, extra);
}

function connectorErrorPage(code, message, extra) {
  const c = String(code || '');
  const retry = retryClassFor(c);
  if (!retry) {
    throw new ConnectorError('terminal', 'unknown connector failure_class');
  }
  const msg = sanitizeConnectorMessage(message == null ? c : message);
  const page = {
    ok: false,
    error: c,
    retry_class: retry,
    retry_after_ms: extra && extra.retry_after_ms != null ? extra.retry_after_ms : null,
    rate_limit: extra && extra.rate_limit !== undefined ? extra.rate_limit : null,
    continuation_state: extra && extra.continuation_state != null ? extra.continuation_state : {},
    message: msg,
  };
  if (extra && extra.contract_version != null) page.contract_version = extra.contract_version;
  if (extra && extra.connector_id != null) page.connector_id = extra.connector_id;
  if (extra && extra.connector_version != null) page.connector_version = extra.connector_version;
  return page;
}

module.exports = {
  ConnectorError,
  RETRY_CLASS_BY_FAILURE,
  CREDENTIAL_PATTERNS,
  MESSAGE_MAX,
  containsCredentialMaterial,
  retryClassFor,
  sanitizeConnectorMessage,
  failConnector,
  connectorErrorPage,
};
