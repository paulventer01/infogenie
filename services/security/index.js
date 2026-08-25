// services/security — Guardrails scaffolding entrypoint.
'use strict';

const { securityHeaders, buildCsp } = require('./headers');
const { createRateLimiter, authAbuseLimiter } = require('./rate_limit');
const { csrfGuard, originAllowed } = require('./csrf');
const { safeEqualString, resolveSessionSecret } = require('./secrets');
const { validatePassword, MIN_LENGTH } = require('./password');
const { validate, authSchemas } = require('./validate');
const {
  assertSafeHttpsUrl, assertSafeRedirect, assertPinnedAddresses, isBlockedIp,
} = require('./safe_url');
const {
  CODE: ADVERTISING_PROVIDER_MUTATION_DISABLED,
  MESSAGE: ADVERTISING_PROVIDER_MUTATION_MESSAGE,
  isAdvertisingProviderMutationAllowed,
  assertAdvertisingProviderMutationAllowed,
  denyAdvertisingProviderMutation,
} = require('./advertising_provider_mutations');

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
  assertSafeHttpsUrl,
  assertSafeRedirect,
  assertPinnedAddresses,
  isBlockedIp,
  ADVERTISING_PROVIDER_MUTATION_DISABLED,
  ADVERTISING_PROVIDER_MUTATION_MESSAGE,
  isAdvertisingProviderMutationAllowed,
  assertAdvertisingProviderMutationAllowed,
  denyAdvertisingProviderMutation,
};
