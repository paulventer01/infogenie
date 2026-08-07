// services/security/headers.js — Baseline HTTP security headers for InfoGenie.
//
// Applied early in the Express stack. Intentionally softer on framing so the
// Replit/Cursor preview iframe still works in development; production opts
// into SAMEORIGIN unless IG_ALLOW_EMBED=1. CSP starts in report-only so we can
// scaffold without breaking the legacy SPA scripts — flip to enforce via
// SECURITY_CSP_ENFORCE=1 once violations are clean.
'use strict';

const isProd = () => process.env.NODE_ENV === 'production';

/** Build the Content-Security-Policy value. Kept as a function so tests can assert. */
function buildCsp({ enforce = false } = {}) {
  // Legacy SPA loads Chart.js CDN + inline handlers; keep script-src permissive
  // while scaffolding. Tighten after the Next migration retires inline scripts.
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://www.clarity.ms",
    "connect-src 'self' https: wss:",
    "worker-src 'self' blob:",
  ];
  if (isProd()) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

/**
 * Express middleware that sets security headers on every response.
 * Preserves Cache-Control no-store for API/auth surfaces (set elsewhere).
 */
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  );
  res.setHeader('X-DNS-Prefetch-Control', 'off');

  // Framing: allow embed in non-prod preview panes; lock down in production
  // unless an operator explicitly opts into embedding (IG_ALLOW_EMBED=1).
  const allowEmbed = !isProd() || process.env.IG_ALLOW_EMBED === '1';
  if (allowEmbed) {
    res.removeHeader('X-Frame-Options');
  } else {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  }

  if (isProd()) {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains; preload',
    );
  }

  const csp = buildCsp();
  if (process.env.SECURITY_CSP_ENFORCE === '1') {
    res.setHeader('Content-Security-Policy', csp);
  } else {
    res.setHeader('Content-Security-Policy-Report-Only', csp);
  }

  next();
}

module.exports = { securityHeaders, buildCsp };
