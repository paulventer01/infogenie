// Default-deny guard for advertising-provider mutations.
// Lowest-level gate: every provider write (campaign create/update/pause,
// budget mutate, creative upload, audience create/upload/sync) must call
// assert/deny here BEFORE credential lookup, vault access, or network I/O.
// There is no env escape hatch — provider mutations stay closed until a
// future, reviewed delivery path re-opens them deliberately.
'use strict';

const CODE = 'advertising_provider_mutation_disabled';
const MESSAGE =
  'Advertising provider mutations are disabled. Use campaign drafting, human approval, and guarded publishing requests.';

/**
 * @returns {false} Always — hard default-deny.
 */
function isAdvertisingProviderMutationAllowed() {
  return false;
}

/**
 * Throw before any credential / vault / network work.
 * @param {object} [context]
 */
function assertAdvertisingProviderMutationAllowed(context = {}) {
  const err = new Error(MESSAGE);
  err.code = CODE;
  err.blocked = true;
  err.published = false;
  err.external_action_taken = false;
  if (context && typeof context === 'object') {
    err.context = context;
  }
  throw err;
}

/**
 * Non-throwing deny payload for HTTP handlers and soft call sites.
 * @param {object} [extra]
 */
function denyAdvertisingProviderMutation(extra = {}) {
  return {
    ok: false,
    success: false,
    blocked: true,
    code: CODE,
    error: MESSAGE,
    published: false,
    external_action_taken: false,
    ...extra,
  };
}

module.exports = {
  CODE,
  MESSAGE,
  isAdvertisingProviderMutationAllowed,
  assertAdvertisingProviderMutationAllowed,
  denyAdvertisingProviderMutation,
};
