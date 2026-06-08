'use strict';
// test/portal-auth-gate.test.js — Server-side app-shell lockdown contract.
//
// The whole portal is gated behind a real login at the SERVER: the app shell
// (index.html) and all app code (app.js, data.js, public/js/*, ig_field_enhancer
// .js, ig_diag.js, script.js) are delivered ONLY to an authenticated session.
// Anonymous requests for those assets must be redirected to the standalone
// /login page so the app's HTML/JS is never sent to logged-out visitors — there
// is no content flash and nothing to reveal by deleting an overlay in dev tools.
//
// Strategy:
//   1. Exercise the SHIPPED gate (services/auth_gate) directly over real HTTP by
//      mounting it on a tiny Express app with a switchable fake session, exactly
//      as server.js wires it (gate BEFORE the asset handlers).
//   2. Assert anonymous GETs for the shell + a sample bundle file 302 → /login
//      and never return app code; authenticated GETs pass through.
//   3. Assert genuinely-public surfaces (the login page, password-reset page,
//      CSS, public renders) are NOT gated.
//   4. Source-level guards: server.js mounts the gate before express.static /
//      the index route, and login.html ships no app bundle reference.
//
// Run: node --test   (or: npm test)

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');

const authGate = require('../services/auth_gate');

const APP_ROOT = path.join(__dirname, '..');

let server;
let baseUrl;
let authed = false; // toggled per request group to simulate a session

before(async () => {
  const app = express();
  // Simulated session middleware: populate req.user only when `authed` is set,
  // mirroring services/auth/loadUserFromSession populating req.user upstream.
  app.use((req, _res, next) => { if (authed) req.user = { id: 1, email: 'a@b.co' }; next(); });
  // Public login route registered BEFORE the gate, like server.js.
  app.get(['/login', '/login.html'], (_req, res) => res.status(200).type('html').send('<!doctype html>LOGIN PAGE'));
  // The shipped gate.
  app.use(authGate.appShellGate);
  // Stand-in asset handlers that return recognisable "app code" so we can prove
  // it is NOT delivered to anonymous callers.
  app.get(['/', '/index.html'], (_req, res) => res.type('html').send('<html>APP SHELL</html>'));
  app.use(express.static(APP_ROOT, { index: false }));
  // Public render stand-ins (these must never be gated).
  app.get('/lp/:slug', (_req, res) => res.type('html').send('PUBLIC LP'));
  app.get('/style.css', (_req, res) => res.type('css').send('body{}'));

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

// Raw GET that does NOT follow redirects, so we can inspect the 302 itself.
function get(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get(baseUrl + pathname, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location, body }));
    });
    req.on('error', reject);
  });
}

const PROTECTED = ['/', '/index.html', '/app.js', '/data.js', '/ig_field_enhancer.js', '/public/js/ig_core_views.js'];
const PUBLIC = ['/login', '/login.html', '/style.css', '/lp/demo', '/reset-password.html', '/accept-invite.html'];

test('unit: isProtectedAppAsset classifies shell + bundle, not public surfaces', () => {
  for (const p of PROTECTED) assert.equal(authGate.isProtectedAppAsset(p), true, `expected protected: ${p}`);
  for (const p of ['/login', '/style.css', '/lp/demo', '/reset-password.html', '/uploads/x.png', '/api/auth/me'])
    assert.equal(authGate.isProtectedAppAsset(p), false, `expected public: ${p}`);
});

test('anonymous: every protected app asset 302-redirects to /login and returns no app code', async () => {
  authed = false;
  for (const p of PROTECTED) {
    const r = await get(p);
    assert.equal(r.status, 302, `expected 302 for ${p}, got ${r.status}`);
    assert.equal(r.location, '/login', `expected redirect to /login for ${p}`);
    assert.ok(!/APP SHELL/.test(r.body), `app shell leaked for anonymous ${p}`);
  }
});

test('authenticated: protected app assets pass through to the real handler', async () => {
  authed = true;
  const shell = await get('/');
  assert.equal(shell.status, 200);
  assert.ok(/APP SHELL/.test(shell.body), 'authenticated user should receive the app shell');
  // A real bundle file should be served (200) rather than redirected.
  const appJs = await get('/app.js');
  assert.equal(appJs.status, 200, 'authenticated user should receive app.js');
  authed = false;
});

test('public surfaces are never gated (reachable while logged out)', async () => {
  authed = false;
  for (const p of PUBLIC) {
    const r = await get(p);
    assert.notEqual(r.status, 302, `public path ${p} should not redirect to login (got ${r.status})`);
  }
});

test('login.html ships NO app bundle reference (self-contained)', () => {
  const html = fs.readFileSync(path.join(APP_ROOT, 'login.html'), 'utf8');
  assert.ok(!/src=["']\/?app\.js/.test(html), 'login.html must not load app.js');
  assert.ok(!/src=["']\/?data\.js/.test(html), 'login.html must not load data.js');
  assert.ok(!/\/public\/js\//.test(html), 'login.html must not load any public/js module');
  assert.ok(!/ig_field_enhancer\.js/.test(html), 'login.html must not load ig_field_enhancer.js');
});

test('source guard: server.js mounts the gate before the static/index serving', () => {
  const src = fs.readFileSync(path.join(APP_ROOT, 'server.js'), 'utf8');
  assert.ok(/require\(['"]\.\/services\/auth_gate['"]\)/.test(src), 'server.js must require services/auth_gate');
  const gateIdx = src.indexOf('appShellGate');
  const staticIdx = src.indexOf('express.static(path.join(__dirname)');
  const indexIdx = src.indexOf("app.get(['/', '/index.html'], _serveIndexHtml)");
  assert.ok(gateIdx > 0, 'server.js must mount appShellGate');
  assert.ok(staticIdx > gateIdx, 'gate must be mounted before express.static');
  assert.ok(indexIdx > gateIdx, 'gate must be mounted before the index.html route');
});
