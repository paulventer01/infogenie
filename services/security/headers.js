// services/security/headers.js — Baseline security headers + optional CSP enforce.
'use strict';

function securityHeaders() {
  return function _securityHeaders(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=()'
    );
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
    const csp = "default-src 'self'; img-src 'self' data: https: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; connect-src 'self' https: wss:; frame-ancestors 'self'";
    if (process.env.SECURITY_CSP_ENFORCE === '1') {
      res.setHeader('Content-Security-Policy', csp);
    } else {
      res.setHeader('Content-Security-Policy-Report-Only', csp);
    }
    next();
  };
}

module.exports = { securityHeaders };
