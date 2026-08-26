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
// PR 6F-0: only the read-only half of the provider-draft capability surface is
// re-exported here. Minting, the execution-transaction scope opener and the
// exact assertion are deliberately NOT on this index — a caller that needs them
// must require ./advertising_provider_capabilities directly, which keeps the
// mint path out of every `require('../security')` consumer.
const {
  CAPABILITY_OPERATION: ADVERTISING_PROVIDER_CAPABILITY_OPERATION,
  CAPABILITY_PLATFORM: ADVERTISING_PROVIDER_CAPABILITY_PLATFORM,
  CODES: ADVERTISING_PROVIDER_CAPABILITY_CODES,
  isAdvertisingProviderCapability,
} = require('./advertising_provider_capabilities');

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
  ADVERTISING_PROVIDER_CAPABILITY_OPERATION,
  ADVERTISING_PROVIDER_CAPABILITY_PLATFORM,
  ADVERTISING_PROVIDER_CAPABILITY_CODES,
  isAdvertisingProviderCapability,
};
