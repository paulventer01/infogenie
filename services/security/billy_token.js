'use strict';

/**
 * Bearer gate for the public `/v1/billy` mount only.
 * `/api/billy` stays on the existing session / INFOGENIE_API_KEY gate + matrix.
 *
 * Contract:
 *   - INFOGENIE_API_TOKEN set → require `Authorization: Bearer`, timing-safe compare
 *   - unset + NODE_ENV=production → 401 (do not open /v1/billy in production)
 *   - unset + non-production → allow, one-time warning
 * Never log the token. Never treat client `userId` as auth.
 */

const { safeEqualString } = require('./secrets');

let _devOpenWarned = false;

function expectedToken() {
  return String(process.env.INFOGENIE_API_TOKEN || '').trim();
}

function presentedBearer(req) {
  const raw = req && req.headers && req.headers.authorization;
  const header = Array.isArray(raw) ? String(raw[0] || '') : String(raw || '');
  const m = header.match(/^Bearer\s+(\S+)\s*$/i);
  return m ? m[1] : '';
}

function tokenGate(req, res, next) {
  const expected = expectedToken();
  if (!expected) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(401).json({ ok: false, error: 'token_required' });
    }
    if (!_devOpenWarned) {
      _devOpenWarned = true;
      console.warn('[billy] INFOGENIE_API_TOKEN unset — /v1/billy is open in non-production');
    }
    return next();
  }

  if (!safeEqualString(presentedBearer(req), expected)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  return next();
}

function _resetDevOpenWarned() {
  _devOpenWarned = false;
}

module.exports = tokenGate;
module.exports.tokenGate = tokenGate;
module.exports._resetDevOpenWarned = _resetDevOpenWarned;
