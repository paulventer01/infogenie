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

// PR 3A contract modules still have no fetch sink. PR3B-1 adds fixture-backed
// adapter shells and a research route group; Security must review that add.
test('PR 3A research modules add no fetch sink; PR3B-1 adds reviewed connectors and a route group', () => {
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
      true,
      `${connector} is the PR3B-1 fixture-backed adapter shell`
    );
  }
  const matrix = fs.readFileSync(path.join(root, 'services/tenants/permission_matrix.js'), 'utf8');
  assert.match(matrix, /\/api\/agent-orchestrator\/research/, 'PR3B adds a research route group');
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
    'a client whose ensure failed may still sit in an aborted transaction and must be destroyed, not pooled'
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
  // In-copy PII is redacted now, so the doc must state both the control and the
  // heuristic limits of the regexes rather than the old "we do not redact" line.
  assert.match(flat, /In-copy emails and phone numbers are redacted before persist/);
  assert.match(flat, /Redaction happens \*\*before\*\* `content_fingerprint` is computed/);
  assert.match(flat, /an address obfuscated as `name \(at\) example\.com` is not matched/);
  // Rewritten once Backend and Database closed the first two. The claims are
  // pinned so a later change cannot quietly reopen them in the code and leave
  // the doc asserting a property the runtime no longer has.
  assert.match(flat, /`SKIP LOCKED` and the `DELETE` are now one statement/);
  assert.match(flat, /`55P03` still joins `40P01`\/`40001` in the bounded retry/);
  // The sweeper's 2s timeout was removed. The doc must say so, and must not
  // describe a batch that still opens with one.
  assert.match(flat, /\*\*The sweeper sets no `lock_timeout` at all\*\*/);
  assert.doesNotMatch(flat, /`BEGIN` → `SET LOCAL lock_timeout = '2s'` → a single CTE/);
  assert.doesNotMatch(flat, /the session-level `lock_timeout` the sweeper sets is reset to `DEFAULT`/);
  // Boot and interval treat holds differently on purpose; collapsing the two
  // either deletes un-previewed rows at boot or pins expired rows forever.
  assert.match(flat, /A held row is skipped at boot and purged on the interval/);
  assert.match(flat, /`server\.js` calls the sweep with `\{ skipHolds: true \}`/);
  assert.match(flat, /is purged \*\*even when a hold row names it\*\*/);
  assert.match(flat, /`expires_at IS NULL` fails the `IS NOT NULL` predicate/);
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
  // Rewritten once the ensure became its own boot task and the backfill TTLs
  // split. The old entry claimed a fail-closed exit the tier28-32 wiring did
  // not actually give it, so both the mechanism and its cost are pinned.
  assert.match(flat, /The orchestrator schema ensure fails closed on its own/);
  assert.match(flat, /logs the static key `agent_orchestrator_schema_init_failed` with no fields/);
  // Rewritten again once the replica-role backfills were deleted. The doc used
  // to say boot repaired legacy rows behind
  // `SET LOCAL session_replication_role = replica` and that the next sweep then
  // purged them; boot now only identifies holds, so both claims are inverted
  // here and the old strings must stay out of the doc.
  assert.match(flat, /Boot no longer needs a replica-role or trigger-disabling privilege/);
  assert.match(flat, /Boot identifies legacy rows; it never deletes them/);
  assert.doesNotMatch(flat, /The boot backfills need a DB role that may set `session_replication_role`/);
  assert.doesNotMatch(flat, /Tightening `short` to 7 days purges legacy short-class rows on the next boot/);
  // The GUC was removed entirely. The doc used to argue that the GUC was a
  // switch rather than a secret and that the hold row carried the boundary;
  // that argument must not survive the code it described, and the approval
  // record is now the whole gate.
  assert.match(flat, /The cleanup GUC `infogenie\.research_cleanup` is gone/);
  assert.doesNotMatch(flat, /is a switch, not a secret, and it is not sufficient on its own/);
  assert.match(flat, /in state `approved` or `running` \*\*and\*\* an `orchestrator_research_cleanup_targets` row for that op names that exact `target_kind`\/`target_id`/);
  assert.match(flat, /A hold row on its own no longer authorises anything/);
  // ensure() bounds its DDL waits now, and the honest limit of that bound has
  // to travel with the claim.
  assert.match(flat, /`ensure\(\)` now bounds its DDL lock waits at 30s/);
  assert.match(flat, /`SET lock_timeout = '30s'` on its dedicated client immediately after `pool\.connect\(\)` and \*\*before\*\* `pg_advisory_lock\(87231402\)`/);
  assert.match(flat, /Advisory lock 87231402 is \*\*not\*\* shared with the sweeper/);
  assert.match(flat, /What `lock_timeout` does not bound is the `pg_advisory_lock\(87231402\)` call itself/);
  assert.doesNotMatch(flat, /The boot DDL takes `AccessExclusiveLock` with no `lock_timeout`/);
  // The suite failure took three passes to close. None of the three "still
  // open" headings may survive in the doc, and the closed entry has to name
  // both halves of the fix — the AccessExclusiveLock takers AND the victim
  // side — because closing only one of them is what failed the last two times.
  assert.match(flat, /### The live-PostgreSQL suite is now stable in parallel \(closed\)/);
  assert.doesNotMatch(flat, /### Open BLOCK \(PR 3A\)/);
  assert.doesNotMatch(flat, /the live-PostgreSQL suite still hangs in parallel/);
  assert.doesNotMatch(flat, /the live-PostgreSQL suite still fails in parallel/);
  assert.doesNotMatch(flat, /The `87231402` gate as currently placed cannot cover this/);
  assert.doesNotMatch(flat, /It takes no advisory lock, sets no `lock_timeout`, and runs on the admin pool/);
  assert.match(flat, /routes its DDL through one helper, `withEnsureDdlGate`/);
  assert.match(flat, /The work client never holds 87231402 itself/);
  assert.match(flat, /`dropLoginRole` \(`REASSIGN OWNED BY` \/ `DROP OWNED BY` \/ `DROP ROLE`\) and `grantOrchestratorMigrator`/);
  assert.match(flat, /now takes 87231402 \*\*before\*\* it seeds/);
  assert.match(flat, /it takes no `AccessExclusiveLock` at all and no lock of any mode on any `orchestrator_%` relation/);
  // The evidence has to be default-parallel and has to include the server-log
  // check, because a green suite alone can be the sweeper's retry masking a
  // deadlock rather than a clean lock order.
  assert.match(flat, /sixteen consecutive default-parallel `node --test` runs of the complete eight-file research suite/);
  assert.match(flat, /recorded \*\*zero\*\* `deadlock detected` lines/);
  assert.match(flat, /rather than merely masked by the sweeper's bounded `40P01` retry/);
  assert.match(flat, /No production file changed to close this/);
  // The cluster-wide latch has no tenant_id by design; say so, and say why that
  // is not a tenant-isolation hole.
  assert.match(flat, /`legacy_short_due` is a one-shot cluster snapshot/);
  assert.match(flat, /It holds no tenant data, no evidence ids and no foreign keys/);
  // Residuals that must survive the rewrite.
  assert.match(flat, /The evidence quota is recomputed from the table, not trusted from a counter/);
  assert.match(flat, /`max_records <= 0 OR max_bytes <= 0` raises before any write/);
  // Execute is snapshot-bound and hash-bound now, and the actor is no longer
  // caller-supplied. The residuals underneath that must not be closed with it:
  // the actor is still unverified against the tenant, and the digest is not
  // held under a lock across the delete.
  assert.match(flat, /Execute is bound to the previewed snapshot and to a hash of it; the actor is read from the session rather than supplied, and tenant membership of that actor is still unchecked/);
  assert.match(flat, /\*\*only while the op is in state `previewed`\*\*/);
  assert.match(flat, /canonicalised as `target_kind` \+ NUL \+ `target_id` lines, sorted and newline-joined, derived from the table and never from a caller-supplied list/);
  assert.match(flat, /compare it with `crypto\.timingSafeEqual` \*\*before\*\* they change state or delete anything/);
  assert.match(flat, /refuses a caller-supplied `actorUserId` outright/);
  assert.match(flat, /reads the actor from `req\.user\.id`/);
  assert.match(flat, /An op already in `completed` returns `\{ purged: 0, idempotent: true \}`/);
  assert.match(flat, /the actor is not checked for membership of that tenant/);
  assert.match(flat, /there is no DB-level guard that refuses a `cleanup_targets` write once the op has left `previewed`/);
  // The old claim was that the caller supplied the actor. It no longer does, so
  // the doc must not keep asserting a weakness the code closed.
  assert.doesNotMatch(flat, /`actor_user_id` is still self-asserted/);
  assert.doesNotMatch(flat, /is supplied by the caller and is not checked for membership of that tenant/);
  assert.doesNotMatch(flat, /Operator approval is scoped to the tenant, not to the previewed row set/);
  // Locked leftovers are retried in-sweep. The bound, the tenant scope, the
  // boot skipHolds carry-through and the fact that exhaustion is not a failure
  // all have to travel together, or the entry reads as a stronger guarantee
  // than the sweeper gives.
  assert.match(flat, /A batch that empties while expired rows are still locked is retried inside the same sweep, and exhausting those retries is not a failure/);
  assert.match(flat, /same predicates as the CTE\*\* and no `SKIP LOCKED`/);
  assert.match(flat, /up to `LOCKED_RETRY_MAX = 5` attempts, for that tenant only/);
  assert.match(flat, /boot `skipHolds` flag is carried into every retry pass/);
  assert.match(flat, /`failures` is \*\*not\*\* incremented/);
  assert.match(flat, /`orchestrator_research_competitors` still have no `expires_at`/);
  // Residuals that predate this pass and are still true.
  assert.match(flat, /The migrator role must own the orchestrator tables, and the preflight does not prove that/);
  assert.match(flat, /JSON and text byte limits are measured before redaction, and the DDL CHECKs after it/);
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
