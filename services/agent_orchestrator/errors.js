'use strict';

const HTTP_FOR_CODE = Object.freeze({
  invalid_transition: 409,
  approval_required: 409,
  approval_stale: 409,
  approval_scope_mismatch: 409,
  permission_denied: 403,
  idempotency_conflict: 409,
  workflow_paused: 409,
  workflow_cancelled: 409,
  execution_in_progress: 409,
  lease_conflict: 409,
  recovery_not_allowed: 409,
  validation_failed: 400,
  payload_too_large: 413,
  not_found: 404,
  unsafe_url: 400,
  credit_ceiling_exceeded: 409,
  insufficient_credits: 409,
  rate_limit_exceeded: 429,
  concurrency_limit_exceeded: 429,
  tenant_cost_limit_exceeded: 409,
  research_evidence_limit_exceeded: 409,
  capability_not_supported: 409,
  connector_unavailable: 409,
  missing_credentials: 409,
  provider_timeout: 503,
  provider_malformed: 503,
  provider_transient: 503,
  provider_not_configured: 409,
});

class OrchError extends Error {
  constructor(httpStatus, code, extra) {
    super(code);
    this.name = 'OrchError';
    this.httpStatus = httpStatus;
    this.code = code;
    this.extra = extra && typeof extra === 'object' ? extra : {};
  }
}

function fail(code, extra) {
  const httpStatus = HTTP_FOR_CODE[code] || 400;
  throw new OrchError(httpStatus, code, extra);
}

function sendError(res, httpStatus, code, extra) {
  if (!res || res.headersSent) return res;
  const body = { ok: false, error: code };
  if (extra && typeof extra === 'object') Object.assign(body, extra);
  return res.status(httpStatus).json(body);
}

function sendOrchError(res, err) {
  if (err instanceof OrchError) {
    return sendError(res, err.httpStatus, err.code, err.extra);
  }
  const code = err && err.code;
  if (code && HTTP_FOR_CODE[code]) {
    return sendError(res, HTTP_FOR_CODE[code], code, err.extra);
  }
  return sendError(res, 500, 'internal_error');
}

module.exports = {
  HTTP_FOR_CODE,
  OrchError,
  fail,
  sendError,
  sendOrchError,
};
