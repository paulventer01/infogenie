'use strict';
// test/verify-email-next-redirect.test.js — Email-verification links return the
// user to their page.
//
// The session-expiry "return to your page" experience already works for email
// login/signup and social sign-in. This pins the remaining gap: the verify-email
// round-trip. A same-origin `next` destination is captured when the verification
// token is issued (signup / resend-verification), persisted on the token record,
// validated server-side with the shared open-redirect guard (safeNext), and
// replayed onto the post-verification redirect so the user lands back on their
// view instead of the default dashboard.
//
// This test pins (source-level — no DB required):
//   1. createToken persists a *validated* next_dest on the token row.
//   2. consumeToken returns the row (user_id + next_dest), not a bare user id.
//   3. The verify-email route appends a safeNext-validated next to its redirect.
//   4. signup + resend-verification forward the caller's next into createToken.
//   5. server.js bounces an already-logged-in /login visitor to a safe next.
//   6. The frontend (app.js + login.html) sends the current view as next.
//   7. The email_tokens schema declares the next_dest column.
//
// Run: node --test   (or: npm test)

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const APP_ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(APP_ROOT, p), 'utf8');

// ── 1 + 2. Token helpers carry next_dest through the round-trip ───────────────
test('createToken accepts a next destination and validates it via _safeNext', () => {
  const src = read('services/auth/api.js');
  assert.ok(/function createToken\(userId, purpose, ttlMin, nextDest\)/.test(src),
    'createToken must accept a nextDest argument');
  assert.ok(/_safeNext\(nextDest\)/.test(src),
    'createToken must validate the caller-supplied next via _safeNext');
  assert.ok(/INSERT INTO email_tokens[^;]*next_dest/.test(src),
    'createToken must persist next_dest on the token row');
});

test('consumeToken returns the row (user_id + next_dest), not a bare id', () => {
  const src = read('services/auth/api.js');
  assert.ok(/RETURNING user_id, next_dest/.test(src),
    'consumeToken must return next_dest alongside user_id');
});

// ── 3. verify-email redirect honors the remembered destination ───────────────
test('verify-email replays a safeNext-validated next onto its redirect', () => {
  const src = read('services/auth/api.js');
  const route = src.slice(src.indexOf("router.get('/verify-email/:token'"));
  const body = route.slice(0, route.indexOf('router.', 1));
  assert.ok(/const row = await consumeToken\(req\.params\.token, 'verify'\)/.test(body),
    'verify-email must consume the token into a row');
  assert.ok(/markEmailVerified\(row\.user_id\)/.test(body),
    'verify-email must mark the row.user_id verified');
  assert.ok(/_safeNext\(row\.next_dest\)/.test(body),
    'verify-email must validate the stored next via _safeNext');
  assert.ok(/verified=1.*&next=.*encodeURIComponent/s.test(body),
    'verify-email must append the validated next to the /login?verified=1 redirect');
});

// ── 4. Issuers forward the caller-supplied next ──────────────────────────────
test('signup + resend-verification forward next into createToken', () => {
  const src = read('services/auth/api.js');
  const issuers = src.split('\n').filter(
    (l) => /createToken\(/.test(l) && /'verify',\s*VERIFY_TTL_MIN/.test(l));
  assert.ok(issuers.length >= 2, 'expected both verify-token issuers (signup + resend)');
  for (const call of issuers) {
    assert.ok(/\.next\b/.test(call),
      `verify-token issuer must pass the request next: ${call.trim()}`);
  }
});

// ── 5. server.js bounce honors next for already-authenticated visitors ───────
test('server.js bounces an authenticated /login visitor to a safe next', () => {
  const src = read('server.js');
  const route = src.slice(src.indexOf("app.get(['/login'"));
  const body = route.slice(0, route.indexOf('});') + 3);
  assert.ok(/safeNext\(req\.query/.test(body),
    'the /login bounce must validate req.query.next via safeNext');
  assert.ok(/res\.redirect\(302, next/.test(body),
    'the /login bounce must redirect to the validated next, not a hard "/"');
});

// ── 6. Frontend captures the current view as next ────────────────────────────
test('app.js sends the current view as next on signup + resend-verification', () => {
  const src = read('app.js');
  assert.ok(/_currentDest\(\)\s*\{/.test(src),
    'app.js must expose a _currentDest() helper');
  assert.ok(/resend-verification'[\s\S]{0,160}\bnext\b/.test(src),
    'resendVerification must include a next in its body');
});

test('login.html forwards the validated next on signup', () => {
  const html = read('login.html');
  assert.ok(/body\.next\s*=\s*dest/.test(html),
    'login.html signup must attach the validated next to the request body');
});

// ── 7. Schema declares the persistence column ────────────────────────────────
test('email_tokens schema declares next_dest', () => {
  const src = read('services/auth/schema.js');
  assert.ok(/next_dest\s+TEXT/.test(src),
    'email_tokens must declare a next_dest column');
  assert.ok(/ALTER TABLE email_tokens ADD COLUMN IF NOT EXISTS next_dest/.test(src),
    'schema must backfill next_dest for existing deployments');
});
