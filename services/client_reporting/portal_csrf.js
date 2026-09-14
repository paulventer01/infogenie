'use strict';

const { csrfMode, requestOrigin, originAllowed } = require('../security/csrf');

function portalCsrfGuard(req, res, next) {
  const mode = csrfMode();
  if (mode === 'off') return next();
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (/^\/redeem\/[a-f0-9]+$/i.test(req.path)) return next();

  const origin = requestOrigin(req);
  if (originAllowed(req, origin)) return next();

  console.warn('[security/portal-csrf] would-deny', JSON.stringify({
    path: req.path, method: req.method, origin: origin || null,
  }));

  if (mode === 'shadow') return next();
  return res.status(403).json({
    ok: false,
    error: 'csrf_rejected',
    hint: 'Missing or mismatched Origin/Referer for a portal session mutation.',
  });
}

module.exports = { portalCsrfGuard };
