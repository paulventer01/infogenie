'use strict';
// test/security-guardrails.test.js — unit coverage for services/security scaffolding.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildCsp,
  safeEqualString,
  validatePassword,
  MIN_LENGTH,
  createRateLimiter,
  originAllowed,
} = require('../services/security');

test('buildCsp includes frame-ancestors self and no object-src', () => {
  const csp = buildCsp();
  assert.match(csp, /frame-ancestors 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /default-src 'self'/);
});

test('safeEqualString is true for equal secrets and false otherwise', () => {
  assert.equal(safeEqualString('abc', 'abc'), true);
  assert.equal(safeEqualString('abc', 'abd'), false);
  assert.equal(safeEqualString('', 'abc'), false);
  assert.equal(safeEqualString('abc', ''), false);
  assert.equal(safeEqualString(null, 'abc'), false);
});

test('validatePassword enforces length and complexity', () => {
  assert.equal(validatePassword('short').ok, false);
  assert.equal(validatePassword('allletters').ok, false);
  assert.equal(validatePassword('1234567890').ok, false);
  const ok = validatePassword('preview123');
  assert.equal(ok.ok, true);
  assert.ok(MIN_LENGTH >= 10);
});

// The limiter resolves its verdict through a promise (Redis first, process-local
// window as the fallback), so each call has to be awaited. Asserting
// synchronously reads the counters before any verdict has landed.
test('createRateLimiter returns 429 after max', async () => {
  const lim = createRateLimiter({ name: 't', windowMs: 60_000, max: 2, keyFn: () => 'k' });
  const calls = [];
  let nextCount = 0;
  const hit = () => new Promise((resolve, reject) => {
    const headers = {};
    const res = {
      setHeader: (k, v) => { headers[k] = v; },
      status(code) {
        return {
          json(body) {
            calls.push({ code, body, headers: { ...headers } });
            resolve();
          },
        };
      },
    };
    try {
      lim({ path: '/x' }, res, () => { nextCount += 1; resolve(); });
    } catch (err) { reject(err); }
  });

  await hit();
  await hit();
  await hit();
  assert.equal(nextCount, 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].code, 429);
  assert.equal(calls[0].body.error, 'rate_limited');
  assert.equal(calls[0].headers['Retry-After'], '60');
  lim.reset();
});

// serialize/failClosed are opt-in additions used by the playbooks limiter. The
// assertions below are what stops them from quietly becoming the default and
// changing authAbuseLimiter, whose fail-open Redis path keeps /api/auth/login
// reachable during a Redis outage.
test('createRateLimiter denies an unidentifiable key only when failClosed is set', async () => {
  const hit = (lim) => new Promise((resolve, reject) => {
    const res = {
      setHeader: () => {},
      status: (code) => ({ json: (body) => { resolve({ code, body }); } }),
    };
    try { lim({ path: '/x' }, res, () => resolve({ code: null, body: null })); }
    catch (err) { reject(err); }
  });

  const closed = createRateLimiter({ name: 'fc', max: 5, keyFn: () => null, failClosed: true });
  const denied = await hit(closed);
  assert.equal(denied.code, 429);
  assert.equal(denied.body.error, 'rate_limited');
  closed.reset();

  // Default (what authAbuseLimiter gets): behaviour is unchanged.
  const open = createRateLimiter({ name: 'fo', max: 5, keyFn: () => 'k' });
  assert.equal((await hit(open)).code, null);
  open.reset();
});

// The meeting-notes summarize route ships before transcript redaction exists.
// The disclosure below is the only thing standing between an operator and the
// assumption that transcripts are scrubbed, so it must survive edits to the rest
// of the section until the AI/LLM redaction PR actually lands.
test('the guardrails doc still discloses unredacted transcript egress', () => {
  const doc = fs.readFileSync(path.join(__dirname, '../docs/security-guardrails.md'), 'utf8');
  const flat = doc.replace(/\s+/g, ' ');
  assert.match(flat, /`POST \/api\/meeting-notes\/summarize` still sends \*\*up to 12,000 transcript characters unredacted\*\* to `api\.openai\.com`/);
  assert.match(flat, /No PII detection or masking runs on the transcript body today/);
  assert.match(flat, /Pre-transmission transcript redaction is a \*\*separate follow-up PR owned by AI\/LLM\*\*; per-tenant AI rate\/cost limiting is the PR after that\. Neither is implemented here\./);
});

test('the guardrails doc documents fail-closed backfill and observable retention', () => {
  const doc = fs.readFileSync(path.join(__dirname, '../docs/security-guardrails.md'), 'utf8');
  const flat = doc.replace(/\s+/g, ' ');
  assert.match(flat, /process\.exit\(1\)/);
  assert.match(flat, /meeting_notes_excerpt_retention_overdue/);
  assert.match(flat, /verifyMeetingNotesEncryption/);
  // Residuals an operator has to keep in mind stay written down.
  assert.match(flat, /`transcript_sha256` is retained after the excerpt is purged/);
  assert.match(flat, /A JSONB `null` `contact` stays `null` at rest/);
});

// The orchestrator control plane is the first hub surface a non-owner role can
// reach, and it ships with a stub runner. The two disclosures below are what an
// operator (and the PR that finally fetches a landing page) needs to see.
test('the guardrails doc discloses the orchestrator residuals', () => {
  const doc = fs.readFileSync(path.join(__dirname, '../docs/security-guardrails.md'), 'utf8');
  const flat = doc.replace(/\s+/g, ' ');
  // PR 1 owed a host denylist before anything dereferenced the landing page.
  // PR 2 supplied and wired it, so the doc must say the screening is in place
  // rather than still required — and must still say nothing fetches the URL.
  assert.match(flat, /calls `assertSafeHttpsUrl` \(see the outbound URL policy below\) on both write paths/);
  assert.match(flat, /there remains no SSRF sink/);
  assert.doesNotMatch(flat, /A host denylist is required/);
  assert.match(flat, /`POST \/:id\/advance` requires `orchestrator\.workflows\.edit`, not an approve key/);
  assert.match(flat, /`GET \/:id\/timeline` requires `orchestrator\.workflows\.audit\.view`/);
  assert.match(flat, /`object_version` is \*\*required\*\* on approve/);
});

// PR 2 ships the credit accounting DDL, the credit engines, the HTTP surface and
// an SSRF policy module. An operator reading this doc has to see what is
// enforced and what is still owed — and the two claims that were true when the
// module landed with no caller are now false, so they must not survive.
test('the guardrails doc discloses the PR 2 credit and outbound-URL boundary', () => {
  const doc = fs.readFileSync(path.join(__dirname, '../docs/security-guardrails.md'), 'utf8');
  const flat = doc.replace(/\s+/g, ' ');
  assert.match(flat, /A \*\*Marketer holds the two `\.view` keys only\*\*/);
  assert.match(flat, /\*\*A ceiling of 0 blocks, it does not mean unlimited\.\*\*/);
  assert.match(flat, /`orchestrator_outbox\.payload` is JSONB and carries \*\*no credentials\*\*/);
  assert.match(flat, /There is \*\*no fetch sink\*\* in the module/);
  // The approval hash now binds both, and the module is wired into both write
  // paths. Leaving the old "still owed" wording in place would tell an operator
  // that raising a ceiling does not invalidate an approval.
  assert.match(flat, /folds both `credit_ceiling_micros` and `advertising_budget` into the `content_hash`/);
  assert.doesNotMatch(flat, /nothing yet folds the ceiling and the advertising budget/);
  assert.match(flat, /The module is now \*\*wired\*\*/);
  assert.doesNotMatch(flat, /no caller wires it yet/);
  assert.doesNotMatch(flat, /Route group — still owed by Backend/);
});

// The credit path that a reader would assume is live is not: `chargeable` is a
// test-only header. A doc that describes reservations and ceilings without
// saying so would have an operator believe production spend is being metered.
test('the guardrails doc says the orchestrator charging path is test-only', () => {
  const doc = fs.readFileSync(path.join(__dirname, '../docs/security-guardrails.md'), 'utf8');
  const flat = doc.replace(/\s+/g, ' ');
  assert.match(flat, /The runner's charging path is inert outside tests/);
  assert.match(flat, /`X-Orch-Test-Charge` header, honoured only when `NODE_ENV` is exactly `test`/);
  assert.match(flat, /The advance-time credit charge is at-least-once/);
});

// The shared BOOT_TASKS loop is an unawaited IIFE, so the port is bound before
// meeting-notes verification runs. Claiming production "cannot serve traffic"
// until it passes would overstate the control and mislead an incident responder.
test('the guardrails doc does not overstate the boot gate', () => {
  const doc = fs.readFileSync(path.join(__dirname, '../docs/security-guardrails.md'), 'utf8');
  const flat = doc.replace(/\s+/g, ' ');
  assert.doesNotMatch(flat, /cannot serve traffic/);
  assert.match(flat, /`listen` is not gated on boot-task completion/);
});

// The playbooks section used to tell operators that no limiter existed and that
// `POST /generate-custom` was uncapped. Both are now false, so the old wording
// must not survive — and the residuals that replaced it (no spend cap, Redis
// required for multi-instance, deliberate Redis-error fail-open) must stay
// written down, because each one is something an operator has to plan around.
test('the guardrails doc records the playbooks rate limit as remediated', () => {
  const doc = fs.readFileSync(path.join(__dirname, '../docs/security-guardrails.md'), 'utf8');
  const flat = doc.replace(/\s+/g, ' ');
  assert.match(flat, /## CodeQL missing-rate-limiting on `\/api\/playbooks` — remediated/);
  assert.match(flat, /\*\*Status: remediated\.\*\*/);
  assert.doesNotMatch(flat, /No rate limit was added here/);
  assert.doesNotMatch(flat, /`POST \/generate-custom` is a genuinely un-limited cost surface/);

  // Which limiter, and which one it is deliberately not.
  assert.match(flat, /`createRateLimiter` from `services\/security\/rate_limit\.js`/);
  assert.match(flat, /\*\*Not\*\* `server\.js`'s `_RL_PATHS`/);
  assert.match(flat, /\*\*60 requests \/ 60 s\*\* shared across the whole prefix/);
  assert.match(flat, /\*\*5 requests \/ 60 s\*\* on `POST \/generate-custom`/);

  // Fail-closed contract.
  assert.match(flat, /The tenant id comes \*\*only\*\* from `req\.tenant\.id`/);
  assert.match(flat, /There is no fallback to a default tenant, to the client IP, or to an `unknown` bucket/);
  assert.match(flat, /This is the intended fail-closed trade-off, not an auth bypass/);

  // The CodeQL check can stay red after a real control ships. An operator
  // deciding whether to dismiss the alert needs to read why.
  assert.match(flat, /\*\*The control is shipped; the query still does not model `createRateLimiter`\.\*\*/);
  assert.match(flat, /the alert is a \*\*visibility gap, not a missing control\*\*/);
  assert.match(flat, /dismissing the alert in the code-scanning UI remains available and is an operator action/);
  assert.doesNotMatch(flat, /whether it recognises a router-level `use\(\)` limiter is unverified/);

  // Residuals.
  assert.match(flat, /Per-tenant AI \*spend\* caps are still not implemented/);
  assert.match(flat, /Without Redis the limit is process-local/);
  assert.match(flat, /A Redis outage degrades the limit rather than denying/);
  assert.match(flat, /`failClosed` in `createRateLimiter` covers only the \*missing key\* case/);
});

test('originAllowed accepts matching host and localhost in non-prod', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  const req = { get: () => 'example.test' };
  assert.equal(originAllowed(req, 'https://example.test'), true);
  assert.equal(originAllowed(req, 'http://127.0.0.1:5000'), true);
  assert.equal(originAllowed(req, 'https://evil.example'), false);
  process.env.NODE_ENV = prev;
});
