// services/security/secrets.js — Timing-safe compares + boot secret requirements.
'use strict';

const crypto = require('crypto');

/**
 * Constant-time string equality. Returns false if either side is empty or
 * lengths differ (length leak is acceptable vs throwing).
 */
function safeEqualString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (!a || !b) return false;
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) {
    // Still do a compare against self to keep timing flatter for wrong lengths.
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Production boot guard for session signing. Prefer a dedicated SESSION_SECRET
 * so rotating INFOGENIE_API_KEY does not invalidate every session (and so a
 * shared API key is not also the cookie HMAC key).
 *
 * Throws in production when SESSION_SECRET is missing.
 * In development, warns and returns a derived ephemeral fallback.
 */
function resolveSessionSecret() {
  const dedicated = (process.env.SESSION_SECRET || '').trim();
  if (dedicated) return dedicated;

  if (process.env.NODE_ENV === 'production') {
    const err = new Error(
      'SESSION_SECRET is required in production. Generate one with: openssl rand -hex 32',
    );
    err.code = 'missing_session_secret';
    throw err;
  }

  const fallback =
    (process.env.INFOGENIE_API_KEY || '').trim() ||
    crypto.randomBytes(32).toString('hex');
  console.warn(
    '[security] SESSION_SECRET not set — using ephemeral/dev fallback (sessions will not survive restart).',
  );
  return fallback;
}

module.exports = { safeEqualString, resolveSessionSecret };
