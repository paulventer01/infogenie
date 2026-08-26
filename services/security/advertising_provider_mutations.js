// Default-deny guard for advertising-provider mutations.
// Lowest-level gate: every provider write (campaign create/update/pause,
// budget mutate, creative upload, audience create/upload/sync, CAPI event
// send) must call assert/deny here BEFORE credential lookup, vault access,
// or network I/O.
// There is no env escape hatch — provider mutations stay closed until a
// future, reviewed delivery path re-opens them deliberately.
//
// PR 6F-0 note: ./advertising_provider_capabilities.js mints a narrow, frozen,
// single-use Meta create_provider_draft capability. That capability is NOT a
// bypass of this gate — it is asserted separately, inside an execution
// transaction that PR 6F-0 never opens, and it must never travel through this
// module. Capability-branded values are therefore stripped out of the deny
// payload and the guard context below, so a capability can never be serialized
// into an HTTP body, an outbox payload or a log line via a denial.
'use strict';

const CODE = 'advertising_provider_mutation_disabled';
const MESSAGE =
  'Advertising provider mutations are disabled. Use campaign drafting, human approval, and guarded publishing requests.';

// Read via Symbol.for so this lowest-level gate keeps zero imports.
const CAPABILITY_BRAND = Symbol.for('infogenie.advertising_provider_capability');

function _isCapabilityLike(value) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
  try { return value[CAPABILITY_BRAND] === true; } catch (_e) { return true; }
}

// Keep only values that are safe to serialize into a 403 body or an error.
// Capability-branded values and anything non-primitive are dropped.
function _safeDetail(source) {
  const out = {};
  if (!source || typeof source !== 'object') return out;
  for (const k of Object.keys(source)) {
    const v = source[k];
    if (_isCapabilityLike(v)) continue;
    if (v === null) { out[k] = null; continue; }
    const t = typeof v;
    if (t === 'string' || t === 'number' || t === 'boolean') out[k] = v;
  }
  return out;
}

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
    err.context = _safeDetail(context);
  }
  throw err;
}

/**
 * Non-throwing deny payload for HTTP handlers and soft call sites.
 * Mandatory deny fields always win over caller extras.
 * @param {object} [extra]
 */
function denyAdvertisingProviderMutation(extra = {}) {
  const safeExtra = _safeDetail(extra);
  delete safeExtra.ok;
  delete safeExtra.success;
  delete safeExtra.blocked;
  delete safeExtra.code;
  delete safeExtra.error;
  delete safeExtra.published;
  delete safeExtra.external_action_taken;
  return {
    ...safeExtra,
    ok: false,
    success: false,
    blocked: true,
    code: CODE,
    error: MESSAGE,
    published: false,
    external_action_taken: false,
  };
}

module.exports = {
  CODE,
  MESSAGE,
  isAdvertisingProviderMutationAllowed,
  assertAdvertisingProviderMutationAllowed,
  denyAdvertisingProviderMutation,
};
