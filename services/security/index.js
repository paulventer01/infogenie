// services/security — Guardrails scaffolding entrypoint.
'use strict';

const { securityHeaders, buildCsp } = require('./headers');
const { createRateLimiter, authAbuseLimiter } = require('./rate_limit');
const { csrfGuard, originAllowed } = require('./csrf');
const { safeEqualString, resolveSessionSecret } = require('./secrets');
const { validatePassword, MIN_LENGTH } = require('./password');
const { validate, authSchemas } = require('./validate');

module.exports = {
  securityHeaders,
  buildCsp,
  createRateLimiter,
  authAbuseLimiter,
  csrfGuard,
  originAllowed,
  safeEqualString,
  resolveSessionSecret,
  validatePassword,
  MIN_LENGTH,
  validate,
  authSchemas,
};
