// services/security/csrf.js — Origin/Referer check for cookie-authenticated mutations.
//
// Scaffold: browser session cookies (infogenie.sid) drive most mutating /api/*
// calls. SameSite=Lax mitigates classic CSRF on cross-site POSTs, but an
// Origin check is a cheap second line that also covers same-site subdomain
// confusion. API-key / Bearer clients and public webhooks are exempt.
//
// Production defaults to SECURITY_CSRF=on (via prod_defaults); otherwise shadow.
'use strict';

const { csrfMode } = require('./prod_defaults');

function mode() {
  const m = csrfMode();
  if (m === 'on' || m === 'off' || m === 'shadow') return m;
  return 'shadow';
}

function requestOrigin(req) {
  const origin = (req.headers.origin || '').trim();
  if (origin) return origin;
  const referer = (req.headers.referer || '').trim();
  if (!referer) return '';
  try {
    const u = new URL(referer);
    return u.origin;
  } catch {
    return '';
  }
}

function expectedOrigins(req) {
  const out = new Set();
  const host = req.get('host');
  if (host) {
    out.add(`https://${host}`);
    out.add(`http://${host}`);
  }
  const pub = (process.env.PUBLIC_BASE_URL || process.env.APP_URL || process.env.PUBLIC_URL || '').replace(/\/$/, '');
  if (pub) {
    try {
      out.add(new URL(pub).origin);
    } catch {
      /* ignore */
    }
  }
  return out;
}

function isExempt(req) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS')
    return true;
  // Programmatic clients use API keys, not cookies — skip.
  if (req.viaApiKey) return true;
  const auth = (req.headers.authorization || '').trim();
  if (/^Bearer\s+/i.test(auth)) return true;
  // Signed webhooks / public embeds never carry a session CSRF risk the same way.
  if (!req.user) return true;
  return false;
}

function originAllowed(req, origin) {
  if (!origin) return false;
  const expected = expectedOrigins(req);
  if (expected.has(origin)) return true;
  if (process.env.NODE_ENV !== 'production') {
    try {
      const u = new URL(origin);
      if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
      if (u.hostname.endsWith('.trycloudflare.com')) return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Express middleware. Mount AFTER session + loadUserFromSession so req.user
 * / req.viaApiKey are populated.
 */
function csrfGuard(req, res, next) {
  const m = mode();
  if (m === 'off' || isExempt(req)) return next();

  const origin = requestOrigin(req);
  if (originAllowed(req, origin)) return next();

  const detail = {
    path: req.path,
    method: req.method,
    origin: origin || null,
    userId: req.user?.id ?? null,
  };
  console.warn('[security/csrf] would-deny', JSON.stringify(detail));

  if (m === 'shadow') return next();
  return res.status(403).json({
    ok: false,
    error: 'csrf_rejected',
    hint: 'Missing or mismatched Origin/Referer for a cookie-authenticated mutation.',
  });
}

module.exports = {
  csrfGuard,
  mode,
  csrfMode: mode,
  requestOrigin,
  originAllowed,
  expectedOrigins,
};
