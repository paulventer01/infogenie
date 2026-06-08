'use strict';
// test/static-source-leak.test.js — Backend source must never be served over HTTP.
//
// express.static is mounted on the project ROOT, so without a guard every file
// in the repo (server.js, db.js, services/**, package.json, docs/**, test/**,
// working .txt notes, …) is web-reachable by path and returns its raw contents
// to any anonymous visitor — a real security/privacy leak.
//
// services/static_guard restricts express.static to an explicit allow-list of
// genuinely browser-facing assets; every other path falls through to a 404.
//
// Strategy:
//   1. Unit-test the SHIPPED allow-list (isPublicStaticAsset) classifies server
//      source as private and browser assets as public.
//   2. Exercise the guard wired exactly as server.js does (guard wraps a real
//      express.static on the project root) over real HTTP: assert a
//      representative server-source path returns 404 while a representative
//      public asset returns 200 with its real bytes.
//   3. Source guard: server.js requires services/static_guard and gates
//      express.static through it (never an unguarded root mount).
//
// Run: node --test   (or: npm test)

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');

const staticGuard = require('../services/static_guard');

const APP_ROOT = path.join(__dirname, '..');

let server;
let baseUrl;

before(async () => {
  const app = express();
  // Wire the guard exactly as server.js does: only allow-listed paths reach the
  // real express.static mounted on the project root.
  const serveStatic = express.static(APP_ROOT, { etag: false, lastModified: false });
  app.use((req, res, next) => {
    if ((req.method === 'GET' || req.method === 'HEAD') && staticGuard.isPublicStaticAsset(req.path)) {
      return serveStatic(req, res, next);
    }
    return next();
  });
  // /uploads has its own dedicated mount (after the guard) — mirror it so the
  // test proves uploaded files still serve and aren't 404'd as "private files".
  app.use('/uploads', express.static(path.join(APP_ROOT, 'uploads'), { etag: false, lastModified: false }));
  // SPA fallback, mirroring services/drips/routes.js: serve the app shell for
  // extension-less client routes, but 404 any file-looking path that fell
  // through (backend source / missing files) so source never leaks via the
  // catch-all. API + public renderers are exempt.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    if (/^\/(book|lp|bio)\/[^\/]+$/.test(req.path)) return next();
    const lastSeg = req.path.split('/').pop() || '';
    if (/\.[a-z0-9]+$/i.test(lastSeg)) return res.status(404).type('txt').send('Not found');
    res.type('html').send('<html>APP SHELL</html>');
  });

  await new Promise((resolve) => {
    server = http.createServer(app).listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
});

function get(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get(baseUrl + pathname, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
  });
}

// Recursively collect on-disk files under `absDir`, returning their URL paths
// (relative to the project root, leading slash). Skips node_modules / VCS dirs.
function collectFiles(absDir, urlPrefix, exts) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(absDir, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.git')) continue;
    const abs = path.join(absDir, e.name);
    const url = `${urlPrefix}/${e.name}`;
    if (e.isDirectory()) out.push(...collectFiles(abs, url, exts));
    else if (exts.some((x) => e.name.endsWith(x))) out.push(url);
  }
  return out;
}

// Pick up to `n` evenly-spread items so the HTTP sweep stays quick but covers
// the whole tree (not just the first N alphabetical files).
function sampleEvenly(arr, n) {
  if (arr.length <= n) return arr.slice();
  const step = arr.length / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

// Backend source / configs / docs / tests / working notes — must be private.
const PRIVATE = [
  '/server.js',
  '/db.js',
  '/services/auth/api.js',
  '/services/static_guard/index.js',
  '/package.json',
  '/package-lock.json',
  '/replit.md',
  '/docs/tiers.md',
  '/test/static-source-leak.test.js',
  '/.agents/memory/MEMORY.md',
  '/batch1.txt',
  '/audit_index.txt',
];

// Genuinely public browser assets — must stay reachable.
const PUBLIC = [
  '/app.js',
  '/data.js',
  '/style.css',
  '/ig_field_enhancer.js',
  '/ig_diag.js',
  '/login.html',
  '/reset-password.html',
  '/accept-invite.html',
  '/public/js/ig_core_views.js',
];

test('unit: isPublicStaticAsset marks server source private and browser assets public', () => {
  for (const p of PRIVATE) assert.equal(staticGuard.isPublicStaticAsset(p), false, `expected private: ${p}`);
  for (const p of PUBLIC) assert.equal(staticGuard.isPublicStaticAsset(p), true, `expected public: ${p}`);
  // Path-traversal attempts are refused outright.
  assert.equal(staticGuard.isPublicStaticAsset('/public/../server.js'), false);
});

test('http: representative server-source path returns 404 and leaks no source', async () => {
  for (const p of PRIVATE) {
    const r = await get(p);
    assert.equal(r.status, 404, `expected 404 for ${p}, got ${r.status}`);
  }
  // Spot-check the body genuinely does not contain server source markers.
  const srv = await get('/server.js');
  assert.ok(!/express\.static/.test(srv.body), 'server.js source leaked over HTTP');
});

test('http: representative public asset returns 200 with its real bytes', async () => {
  const r = await get('/public/js/ig_core_views.js');
  assert.equal(r.status, 200, 'public bundle module should be served');
  assert.ok(r.body.length > 0, 'public asset should return its contents');
  const css = await get('/style.css');
  assert.equal(css.status, 200, 'style.css should be served');
});

test('http: extension-less SPA client routes still receive the app shell', async () => {
  const r = await get('/some-client-route');
  assert.equal(r.status, 200, 'SPA client route should serve the shell');
  assert.ok(/APP SHELL/.test(r.body), 'SPA client route should receive the app shell HTML');
});

test('http: /uploads/* is reachable (served by its dedicated mount, not 404d)', async () => {
  // A missing upload returns 404 from the uploads mount itself, NOT from the
  // SPA file-404 path — the key point is the guard does not pre-empt /uploads.
  const r = await get('/uploads/does-not-exist.png');
  assert.equal(r.status, 404, 'missing upload returns 404 from the uploads mount');
});

test('source guard: server.js gates express.static through services/static_guard', () => {
  const src = fs.readFileSync(path.join(APP_ROOT, 'server.js'), 'utf8');
  assert.ok(/require\(['"]\.\/services\/static_guard['"]\)/.test(src), 'server.js must require services/static_guard');
  // The root express.static must be referenced through the guard, not mounted raw.
  assert.ok(/isPublicStaticAsset/.test(src), 'server.js must consult isPublicStaticAsset before serving static files');
  // There must be no bare `app.use(express.static(path.join(__dirname), ...))`
  // mount on the project root (that would bypass the guard entirely).
  assert.ok(!/app\.use\(express\.static\(path\.join\(__dirname\),/.test(src),
    'server.js must not mount express.static on the project root directly (bypasses the guard)');
});

test('source guard: the SPA catch-all 404s file-looking paths instead of serving the shell', () => {
  const src = fs.readFileSync(path.join(APP_ROOT, 'services', 'drips', 'routes.js'), 'utf8');
  const catchAll = src.slice(src.indexOf("app.get('*'"));
  assert.ok(/status\(404\)/.test(catchAll), 'catch-all must return 404 for unmatched file requests');
  assert.ok(/\\\.\[a-z0-9\]\+\$/i.test(catchAll) || /\.\[a-z0-9\]\+\$/.test(catchAll),
    'catch-all must detect a file extension on the last path segment');
});

// ── Guard against NEW server files silently becoming downloadable ─────────────
// The two checks above use fixed representative paths. This one enumerates REAL
// backend files off disk (services/**, docs/**, test/**, root configs) so the
// moment someone lands a new server file it is checked automatically — without
// anyone remembering to extend a hardcoded list. Every discovered file must be
// (a) classified private by the shipped allow-list and (b) actually 404 over
// HTTP through the guard + SPA catch-all wired exactly as production.
test('fs-scan: real on-disk backend files are private and 404 through the wired guard', async () => {
  const backend = [
    ...collectFiles(path.join(APP_ROOT, 'services'), '/services', ['.js', '.json']),
    ...collectFiles(path.join(APP_ROOT, 'docs'), '/docs', ['.md']),
    ...collectFiles(path.join(APP_ROOT, 'test'), '/test', ['.js']),
    ...collectFiles(path.join(APP_ROOT, 'scripts'), '/scripts', ['.js']),
  ];
  // Root-level source/config that must never stream off disk.
  const rootBackend = ['/package.json', '/package-lock.json', '/db.js', '/server.js', '/replit.md']
    .filter((p) => fs.existsSync(path.join(APP_ROOT, p.slice(1))));

  const all = [...backend, ...rootBackend];
  assert.ok(backend.length > 5, `expected to discover backend source under services/ (found ${backend.length})`);

  // None of the discovered backend files may be classified public. This is the
  // check that fires if a future change widens PUBLIC_PREFIXES / PUBLIC_FILES to
  // accidentally cover server source.
  for (const p of all) {
    assert.equal(staticGuard.isPublicStaticAsset(p), false, `backend file must be private: ${p}`);
  }

  // Exercise a representative spread over real HTTP: each must 404, never stream
  // its bytes. Catches middleware reordering / a new bare static mount.
  const sample = sampleEvenly(all, 30);
  for (const p of sample) {
    const r = await get(p);
    assert.equal(r.status, 404, `backend file must 404 over HTTP: ${p} (got ${r.status})`);
  }
  // And confirm a sampled backend file truly leaks no source bytes.
  const probe = await get('/services/static_guard/index.js');
  assert.equal(probe.status, 404, 'static_guard source must not be served');
  assert.ok(!/isPublicStaticAsset/.test(probe.body), 'static_guard source leaked over HTTP');
});

// Regression guard: the ROOT express.static must stay wrapped by the guard.
// Someone re-adding a bare `app.use(express.static(__dirname))`, or invoking the
// root static mount without first consulting isPublicStaticAsset, would silently
// re-expose all server source — this test fails the moment that wiring breaks.
test('source guard: every root express.static stays wrapped by isPublicStaticAsset', () => {
  const src = fs.readFileSync(path.join(APP_ROOT, 'server.js'), 'utf8');
  const ROOT = '(?:path\\.join\\(__dirname\\)|__dirname)';

  // 1. No root express.static may be mounted directly via app.use(...) — with or
  //    without a path prefix — because that serves files with no allow-list in
  //    front of them. (e.g. `app.use(express.static(__dirname))` or
  //    `app.use('/x', express.static(path.join(__dirname)))`.)
  assert.ok(!new RegExp('app\\.use\\([^)]*express\\.static\\(\\s*' + ROOT + '\\s*[,)]').test(src),
    'server.js must not app.use(express.static(<root>)) directly — that bypasses the guard');

  // 2. Collect EVERY root express.static assigned to a variable. There must be at
  //    least one (the guarded mount), and exactly one is expected — a second
  //    parallel root mount is a red flag even before we check how it is used.
  const declRe = new RegExp('(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*express\\.static\\(\\s*' + ROOT, 'g');
  const rootVars = [];
  let mm;
  while ((mm = declRe.exec(src))) rootVars.push(mm[1]);
  assert.ok(rootVars.length >= 1, 'server.js must declare a root express.static (assigned to a guarded var)');
  assert.equal(rootVars.length, 1,
    `expected exactly one root express.static declaration, found ${rootVars.length}: ${rootVars.join(', ')}`);

  const gateIdx = src.indexOf('isPublicStaticAsset(req.path)');
  assert.ok(gateIdx !== -1, 'guard must check isPublicStaticAsset(req.path) before serving');

  // 3. For EACH root-static variable (catches the variable-indirection regression
  //    `const leaked = express.static(__dirname); app.use(leaked);`):
  //    - it must never be handed to app.use(...) directly, and
  //    - it must be invoked to serve a request only AFTER the gate runs.
  for (const v of rootVars) {
    const esc = v.replace(/[$]/g, '\\$');
    assert.ok(!new RegExp('app\\.use\\([^)]*\\b' + esc + '\\b').test(src),
      `root static var ${v} must not be passed to app.use(...) directly — it must be invoked from inside the guard`);
    const serveIdx = src.search(new RegExp('\\b' + esc + '\\s*\\(\\s*req'));
    assert.ok(serveIdx !== -1, `root static var ${v} must be invoked as ${v}(req, res, next) inside the guard`);
    assert.ok(gateIdx < serveIdx, `isPublicStaticAsset gate must run BEFORE ${v} serves the file`);
  }
});
