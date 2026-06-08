'use strict';
// test/oauth-next-redirect.test.js — Social sign-in returns the user to their page.
//
// When a session expires the app sends the user to /login?next=<view>. For the
// email login/signup flow login.html honors that on success. The social
// (Google/Facebook/Microsoft) flow does a round-trip out to the provider and
// back, dropping any client-side `next`. To survive that round-trip the OAuth
// `start` handler stashes a *validated* `next` in the session, and the callback
// redirects there (keeping the `social=` marker) instead of always landing on /.
//
// This test pins:
//   1. The open-redirect guard (safeNext) — only same-origin relative paths.
//   2. The /oauth/:provider/start handler stores the validated next in session.
//   3. login.html forwards the validated next onto the start URL.
//   4. The callback's final redirect uses the stashed next, not a hard '/'.
//
// Run: node --test   (or: npm test)

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');

const auth = require('../services/auth/api');

const APP_ROOT = path.join(__dirname, '..');

// ── 1. Open-redirect guard ──────────────────────────────────────────────────
test('safeNext: accepts same-origin relative paths only', () => {
  // Allowed — same-origin relative paths.
  assert.equal(auth.safeNext('/?view=competitors'), '/?view=competitors');
  assert.equal(auth.safeNext('/grow/optimizer'), '/grow/optimizer');
  assert.equal(auth.safeNext('/'), '/');
  // Rejected — falls back to home dashboard.
  for (const bad of [
    '', null, undefined, 42, {},
    'https://evil.com',            // absolute URL
    'http://evil.com',
    '//evil.com',                  // protocol-relative
    '/\\evil.com',                 // backslash trick
    'evil.com',                    // no leading slash
    'javascript:alert(1)',
  ]) {
    assert.equal(auth.safeNext(bad), '/', `expected fallback for: ${JSON.stringify(bad)}`);
  }
});

// ── 2. start handler stashes a validated next in session ─────────────────────
let server, baseUrl;
let sessionStore;

before(async () => {
  const app = express();
  // Minimal fake session that persists for the life of one request object.
  app.use((req, _res, next) => { req.session = sessionStore; next(); });
  app.use('/api/auth', auth.router);
  await new Promise((resolve) => {
    server = http.createServer(app).listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => { if (server) await new Promise((r) => server.close(r)); });

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

test('start: stores a safe next in session and redirects to the provider', async () => {
  process.env.AUTH_GOOGLE_CLIENT_ID = process.env.AUTH_GOOGLE_CLIENT_ID || 'test-client-id';
  process.env.AUTH_GOOGLE_CLIENT_SECRET = process.env.AUTH_GOOGLE_CLIENT_SECRET || 'test-client-secret';

  sessionStore = {};
  const r = await get('/api/auth/oauth/google/start?next=' + encodeURIComponent('/?view=competitors'));
  assert.equal(r.status, 302, 'start should redirect to the provider');
  assert.ok(/accounts\.google\.com/.test(r.location || ''), 'should redirect to Google');
  assert.equal(sessionStore.oauthNext, '/?view=competitors', 'safe next persisted to session');
  assert.ok(sessionStore.oauthState, 'oauth state persisted to session');
});

test('start: an unsafe next is neutralised to the home dashboard', async () => {
  sessionStore = {};
  const r = await get('/api/auth/oauth/google/start?next=' + encodeURIComponent('https://evil.com'));
  assert.equal(r.status, 302);
  assert.equal(sessionStore.oauthNext, '/', 'open-redirect target rejected');
});

// ── 3 + 4. Source-level guards on the wiring ─────────────────────────────────
test('login.html forwards the validated next onto the OAuth start URL', () => {
  const html = fs.readFileSync(path.join(APP_ROOT, 'login.html'), 'utf8');
  // The social-button click handler must append next (from nextDest()) to /start.
  assert.ok(/\/api\/auth\/oauth\//.test(html), 'login.html wires the OAuth start URL');
  assert.ok(/next=['"]?\s*\+\s*encodeURIComponent\(\s*dest\s*\)/.test(html)
    || /\?next='\s*\+\s*encodeURIComponent\(dest\)/.test(html),
    'login.html must forward the validated next onto the start URL');
});

test('callback redirects to the stashed next (not a hard root) keeping the social marker', () => {
  const src = fs.readFileSync(path.join(APP_ROOT, 'services/auth/api.js'), 'utf8');
  // The callback must read oauthNext through the safeNext guard and redirect to it.
  assert.ok(/_safeNext\(\s*req\.session\s*&&\s*req\.session\.oauthNext\s*\)/.test(src),
    'callback must resolve the stashed next via _safeNext');
  assert.ok(/res\.redirect\(\s*nextDest\s*\+/.test(src),
    'callback must redirect to the resolved next, not a hard "/"');
  assert.ok(/social=/.test(src), 'callback must keep the social= marker');
});
