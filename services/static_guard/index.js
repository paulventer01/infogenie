'use strict';
// ── Static-asset allow-list ──────────────────────────────────────────────────
// express.static is mounted on the project ROOT (path.join(__dirname)), so by
// default EVERY file in the repo is web-reachable by path. That leaks the app's
// raw backend source to any anonymous visitor:
//   GET /server.js · /db.js · /services/**.js · /package.json · /docs/** ·
//   /test/** · /.agents/** · the working *.txt notes, etc. (all HTTP 200).
//
// This guard restricts express.static to an explicit allow-list of genuinely
// browser-facing assets. Any path NOT on the list never reaches express.static
// and falls through to Express's default 404 instead of streaming source off
// disk.
//
// NOTE: This is a different, broader guard than services/auth_gate. The auth
// gate hides the app SHELL + bundle (index.html, app.js, data.js, public/js/*,
// ig_*.js) behind a login session. THIS allow-list stops NON-app files (server
// source, configs, docs, tests) from being served to anyone at all. The auth
// gate runs first; this guard wraps express.static.

// Exact root-level files that are part of the browser experience.
const PUBLIC_FILES = new Set([
  '/app.js',                // app bundle (auth-gated)
  '/data.js',               // industry/competitor data (auth-gated)
  '/style.css',             // all styling
  '/ig_field_enhancer.js',  // global AI-Suggest field decorator (auth-gated)
  '/ig_diag.js',            // client diagnostics (auth-gated)
  '/script.js',             // legacy stub (auth-gated)
  '/login.html',            // standalone login page (also served via /login route)
  '/reset-password.html',   // standalone password-reset page
  '/accept-invite.html',    // standalone invite-acceptance page
  // Conventional root assets browsers/crawlers request directly. Listed so they
  // serve if present; harmless when absent (express.static just 404s).
  '/favicon.ico',
  '/manifest.json',
  '/robots.txt',
]);

// Path PREFIXES whose contents are all public (the extracted per-feature
// view-builder modules and any fonts/images dropped under /public). /uploads/*
// is intentionally NOT here — it has its own dedicated express.static mount.
const PUBLIC_PREFIXES = [
  '/public/',
];

// True when `p` (a URL pathname, no query string) is a genuinely public static
// asset that express.static is allowed to serve. Everything else (server
// source, configs, docs, tests, working notes) returns false → 404.
function isPublicStaticAsset(p) {
  if (typeof p !== 'string' || !p.startsWith('/')) return false;
  if (p.includes('..')) return false; // defensive: never serve traversal paths
  if (PUBLIC_FILES.has(p)) return true;
  return PUBLIC_PREFIXES.some((pre) => p.startsWith(pre));
}

module.exports = { PUBLIC_FILES, PUBLIC_PREFIXES, isPublicStaticAsset };
