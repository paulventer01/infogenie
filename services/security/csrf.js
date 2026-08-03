// services/security/csrf.js — Origin/Referer check on cookie-authenticated mutations.
'use strict';

const { csrfMode } = require('./prod_defaults');

function _originOk(req) {
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  // Bearer / API-key callers are not CSRF-vulnerable the same way.
  const auth = req.headers.authorization || '';
  if (/^Bearer\s+/i.test(auth)) return true;
  if (req.headers['x-api-key']) return true;

  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';
  const host = req.headers.host || '';
  if (!origin && !referer) return false;

  const allowed = [];
  if (process.env.PUBLIC_URL) {
    try { allowed.push(new URL(process.env.PUBLIC_URL).host); } catch { /* ignore */ }
  }
  if (host) allowed.push(host);

  const check = (urlStr) => {
    try {
      const u = new URL(urlStr);
      return allowed.some((h) => u.host === h);
    } catch { return false; }
  };

  if (origin && check(origin)) return true;
  if (referer && check(referer)) return true;
  return false;
}

function csrfGuard() {
  return function _csrfGuard(req, res, next) {
    const mode = csrfMode();
    if (mode === 'off') return next();
    if (_originOk(req)) return next();

    if (mode === 'shadow') {
      console.warn('[csrf] shadow would-block', req.method, req.path, {
        origin: req.headers.origin,
        referer: req.headers.referer,
      });
      return next();
    }
    return res.status(403).json({ ok: false, error: 'csrf_rejected' });
  };
}

module.exports = { csrfGuard, csrfMode };
