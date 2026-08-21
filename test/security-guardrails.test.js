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

  // The factory is built on express-rate-limit so the query can see it. A
  // reader must not come away thinking that is a second policy engine, and an
  // operator must know UI dismissal is now the fallback rather than the answer.
  assert.match(flat, /\*\*`js\/missing-rate-limiting` fires on a control it cannot see\.\*\*/);
  assert.match(flat, /Inline `\/\/ codeql\[\.\.\.\]` comments do \*\*not\*\* clear default setup/);
  assert.match(flat, /\*\*implemented with `express-rate-limit`\*\* and returns that instance directly/);
  assert.match(flat, /This is \*\*not a second policy\*\*/);
  assert.match(flat, /\*\*UI dismissal is no longer the primary answer\*\*/);
  // Claims that stopped being true when the factory changed.
  assert.doesNotMatch(flat, /without pulling in `express-rate-limit`/);
  assert.doesNotMatch(flat, /the query still does not model `createRateLimiter`/);
  assert.doesNotMatch(flat, /both playbooks limiters pass `serialize: true`/);

  // authAbuseLimiter shares the factory; the doc has to keep saying it is intact.
  assert.match(flat, /`authAbuseLimiter\(\)` is unchanged: still 30 attempts \/ 15 minutes keyed on IP \+ path/);

  // Residuals.
  assert.match(flat, /Per-tenant AI \*spend\* caps are still not implemented/);
  assert.match(flat, /Without Redis the limit is process-local/);
  assert.match(flat, /A Redis outage degrades the limit rather than denying/);
  assert.match(flat, /`failClosed` in `createRateLimiter` covers only the \*missing key\* case/);
});

// PR 3A ships research evidence DDL and contracts with no route, no connector
// and no fetch. Those three absences are the reason the PR carries no SSRF or
// permission surface, so each one is asserted rather than described: a later
// PR that adds a live connector or a router here has to change this test, and
// changing it is what puts the review back in front of Security.
test('PR 3A research modules add no fetch sink, no live connector and no route group', () => {
  const root = path.join(__dirname, '..');
  const modules = [
    'services/agent_orchestrator/research_contracts.js',
    'services/agent_orchestrator/research_errors.js',
    'services/agent_orchestrator/research_validate.js',
    'services/agent_orchestrator/research_connector.js',
    'services/agent_orchestrator/research_retention.js',
    'services/agent_orchestrator/research_store.js',
  ];
  for (const rel of modules) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    assert.doesNotMatch(src, /\bfetch\s*\(/, `${rel} must not call fetch`);
    assert.doesNotMatch(
      src,
      /require\(\s*['"](?:https?|node:https?|node-fetch|undici|axios|got)['"]\s*\)/,
      `${rel} must not load an HTTP client`
    );
    assert.doesNotMatch(src, /express|router/i, `${rel} must not expose an HTTP surface`);
  }
  for (const connector of ['meta_research.js', 'google_research.js', 'tiktok_research.js']) {
    assert.equal(
      fs.existsSync(path.join(root, 'services/agent_orchestrator/connectors', connector)),
      false,
      `${connector} belongs to PR3B/C/D, not PR3A`
    );
  }
  const matrix = fs.readFileSync(path.join(root, 'services/tenants/permission_matrix.js'), 'utf8');
  assert.doesNotMatch(matrix, /research/i, 'PR 3A adds no /api prefix, so it needs no ROUTE_GROUPS entry');
});

// A named constraint is redefined by dropping it and adding it back. Split
// across two autocommit statements that leaves the table unconstrained between
// them, and unconstrained for good when the add fails validation. Asserted on
// the source rather than against Postgres because the behavioural version has
// to leave a violating row in place across an ensure() call, which fails
// ensureAgentOrchestratorSchema for every DB test file running beside it.
test('orchestrator constraint redefinition is transactional, and a failed ensure destroys its client', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../services/agent_orchestrator/schema.js'),
    'utf8'
  );
  const bodyOf = (name) => {
    const start = src.indexOf(`async function ${name}(`);
    assert.ok(start >= 0, `${name} must exist`);
    const next = src.indexOf('\nasync function ', start + 1);
    return src.slice(start, next > 0 ? next : undefined);
  };

  for (const name of ['_ensureNamedCheck', '_ensureNamedFk']) {
    const body = bodyOf(name);
    assert.match(body, /DROP CONSTRAINT IF EXISTS/, `${name} still redefines by dropping`);
    const begin = body.indexOf("query('BEGIN')");
    const drop = body.indexOf('DROP CONSTRAINT IF EXISTS');
    const add = body.indexOf('ADD CONSTRAINT');
    const commit = body.indexOf("query('COMMIT')");
    assert.ok(begin >= 0, `${name} must open a transaction before dropping`);
    assert.ok(begin < drop, `${name} must drop inside the transaction`);
    assert.ok(drop < add && add < commit, `${name} must add and commit after the drop`);
    assert.match(body, /ROLLBACK/, `${name} must roll back to the previous definition on failure`);
  }

  const run = bodyOf('_runEnsureAgentOrchestratorSchema');
  assert.match(
    run,
    /p\.release\(\s*failed/,
    'a client whose backfill failed may still hold session_replication_role=replica and must be destroyed, not pooled'
  );
});

// The forbidden-key list, the credential scanner and the URL/locator shape
// checks are the only thing standing between a provider payload and an
// append-only evidence row that cannot be edited afterwards. Each assertion
// below is a hole that was open when the contracts landed.
test('PR 3A validators reject credential material, normalized forbidden keys and unsafe locators', () => {
  const { containsCredentialMaterial } = require('../services/agent_orchestrator/research_errors');
  const {
    assertNoForbiddenFields,
    assertHttpsUrl,
    assertEvidenceAsset,
  } = require('../services/agent_orchestrator/research_validate');

  // Separator and case variants of a forbidden key are the same key.
  for (const key of ['access-token', 'Access Token', 'accessToken', 'API_KEY', 'Set-Cookie']) {
    assert.throws(() => assertNoForbiddenFields({ provider: { [key]: 'x' } }), /validation_failed/);
  }

  // Credential shapes, including the ones a provider error body carries.
  for (const s of [
    'Authorization: Bearer abc',
    'set-cookie: sid=1',
    'api_key=sk-live-000000',
    'client_secret: abcdef',
    'Basic YWRtaW46cGFzc3dvcmQ=',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
    'https://user:pass@example.com/x',
    'infogenie.sid=s%3Aabc',
  ]) {
    assert.equal(containsCredentialMaterial(s), true, `must flag: ${s}`);
  }
  // A message that only mentions credentials is still storable.
  assert.equal(
    containsCredentialMaterial('connector credentials rejected; do not retry with the same credentials'),
    false
  );

  // URLs are stored raw, so a string the URL parser would rewrite is refused.
  assert.throws(() => assertHttpsUrl('https://evil.example\t/x', 'u', { optional: false }), /validation_failed/);
  assert.throws(() => assertHttpsUrl('https:\\\\evil.example/x', 'u', { optional: false }), /validation_failed/);
  assert.throws(() => assertHttpsUrl('http://evil.example/x', 'u', { optional: false }), /validation_failed/);
  assert.equal(assertHttpsUrl('https://library.tiktok.com/ads?id=1', 'u'), 'https://library.tiktok.com/ads?id=1');

  const asset = (storage_ref) => assertEvidenceAsset({
    id: 'a1',
    tenant_id: 7,
    evidence_id: 'e1',
    media_type: 'other',
    storage_ref,
    checksum_sha256: 'a'.repeat(64),
    captured_at: '2026-08-21T12:00:00.000Z',
  }, { tenantId: 7 });
  for (const bad of ['file:///etc/passwd', 'ftp://host/x', '//evil.example/x', 's3://bucket/key', 'https://user@host/x']) {
    assert.throws(() => asset(bad), /validation_failed/, `locator must be refused: ${bad}`);
  }
  assert.equal(asset('research://meta/ext-1/creative.jpg').storage_ref, 'research://meta/ext-1/creative.jpg');
});

test('the guardrails doc discloses the PR 3A research evidence boundary', () => {
  const doc = fs.readFileSync(path.join(__dirname, '../docs/security-guardrails.md'), 'utf8');
  const flat = doc.replace(/\s+/g, ' ');
  assert.match(flat, /## Advertising orchestrator — research evidence contracts \(PR 3A\)/);
  assert.match(flat, /\*\*No DDL change was required\.\*\*/);
  assert.match(flat, /There is \*\*no HTTP route, no `ROUTE_GROUPS` entry and no fetch sink\*\* in PR 3A/);
  assert.match(flat, /a run cannot be inserted without a `research_execution` approval whose `decision` is `approved`/);
  assert.match(flat, /URL checks here are \*\*syntactic\*\*/);
  assert.match(flat, /PR3E must call `services\/security\/safe_url\.js` before any fetch/);
  // Residuals an operator has to plan around.
  assert.match(flat, /A tenant-scoped retention sweeper now exists/);
  assert.match(flat, /`content_fingerprint` is a content fingerprint, not a signature/);
  assert.match(flat, /public ad copy can legitimately contain a business email or phone number/);
  // Rewritten once Backend and Database closed the first two. The claims are
  // pinned so a later change cannot quietly reopen them in the code and leave
  // the doc asserting a property the runtime no longer has.
  assert.match(flat, /`SKIP LOCKED` now holds until the `DELETE`/);
  assert.match(flat, /The sweeper\/boot-DDL deadlock is broken at the source and retried at the edge/);
  assert.match(flat, /`_installInTransaction` now installs one table's functions and triggers per `BEGIN`\/`COMMIT`/);
  assert.match(flat, /retries `40P01`\/`40001` up to `DEADLOCK_RETRY_MAX = 5` times per batch/);
  assert.match(flat, /Exhausted retries still increment `failures`/);
  // The stated limit of that fix has to survive too, so the entry cannot drift
  // into a claim that the schema suite is deadlock-free.
  assert.match(flat, /That is not a proof the schema suite cannot deadlock/);
  assert.match(
    flat,
    /Any other writer that holds an exclusive lock spanning these tables can still form a cycle/
  );
  assert.match(flat, /The 64-zero `content_fingerprint` DEFAULT survives only the `ADD COLUMN` itself/);
  assert.match(flat, /fails `23502` naming `content_fingerprint`/);
  assert.match(flat, /A sweep client whose `ROLLBACK` failed is destroyed, not pooled/);
  // Residuals that must survive the rewrite.
  assert.match(flat, /The boot backfills need a DB role that may set `session_replication_role`/);
  assert.match(flat, /The evidence quota counter is trigger-maintained, not reconciled/);
  assert.match(flat, /`orchestrator_research_competitors` still have no `expires_at`/);
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
