'use strict';
// ── App-shell auth gate ──────────────────────────────────────────────────────
// The app shell (index.html) and ALL app code (app.js, data.js, public/js/*,
// ig_field_enhancer.js, ig_diag.js, script.js) are delivered ONLY to an
// authenticated session. Anonymous GET/HEAD requests for these paths are
// redirected to the standalone /login page, so logged-out visitors never
// receive the app's HTML or JavaScript — there is no content flash and nothing
// to reveal by deleting an overlay in dev tools (the code was never sent).
//
// This is a DENY-list: only the app's own shell + bundle are gated. Genuinely
// public surfaces stay reachable because they don't match these patterns:
//   • the /login page (and login.html), reset-password.html, accept-invite.html
//   • public renders: /lp/*, /bio/*, /book/* and the embed loaders
//   • static design assets (style.css), fonts, favicon, /uploads/*
//   • /api/* — gated separately by the API-key/session middleware in server.js
//
// The gate must be mounted AFTER the session middleware (so req.user is
// populated) and BEFORE the index.html route + express.static (so it wins over
// raw file serving). It only acts on GET/HEAD; other verbs fall straight
// through.

const PROTECTED_APP_ASSETS = [
  /^\/$/,                       // app root (Next front door; standalone Express serves a retirement notice)
  /^\/index\.html$/,
  /^\/app\.js$/,
  /^\/data\.js$/,
  /^\/ig_field_enhancer\.js$/,
  /^\/ig_diag\.js$/,
  /^\/script\.js$/,
  /^\/public\/js\/.+\.js$/,     // every extracted per-feature module
];

// True when `p` (a URL pathname, no query string) is an app-shell asset that
// must never be served to an unauthenticated visitor.
function isProtectedAppAsset(p) {
  return PROTECTED_APP_ASSETS.some((rx) => rx.test(p));
}

// Express middleware enforcing the gate. Requires req.user (populated upstream
// from the session) for any protected app asset; otherwise 302 → /login.
function appShellGate(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (!isProtectedAppAsset(req.path)) return next();
  if (req.user) return next();
  return res.redirect(302, '/login');
}

module.exports = { PROTECTED_APP_ASSETS, isProtectedAppAsset, appShellGate };
