// services/security/password.js — Shared password policy for signup / reset / invite.
'use strict';

const MIN_LENGTH = 10;

/**
 * Validate a candidate password. Returns { ok:true } or { ok:false, error }.
 * Policy (scaffolding — tighten further with breach checks later):
 *   - at least 10 characters
 *   - at least one letter and one number
 */
function validatePassword(password) {
  const p = String(password || '');
  if (p.length < MIN_LENGTH) {
    return {
      ok: false,
      error: `Password must be at least ${MIN_LENGTH} characters.`,
    };
  }
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) {
    return {
      ok: false,
      error: 'Password must include at least one letter and one number.',
    };
  }
  return { ok: true };
}

module.exports = { validatePassword, MIN_LENGTH };
