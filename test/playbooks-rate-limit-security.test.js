'use strict';
// test/playbooks-rate-limit-security.test.js — Security pass over the per-tenant
// rate limit on /api/playbooks. Locks the properties an operator is relying on:
// the bucket key comes only from authenticated server-side context, a missing or
// malformed tenant fails closed, admissions are atomic within one process, and
// the 429 contract is stable. No app boot and no Postgres — the HTTP-level
// coverage lives in test/playbooks-rate-limit.test.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// ── Redis stub ───────────────────────────────────────────────────────────────
// createRateLimiter destructures services/infra/redis at load, so the stub has
// to be in require.cache first. Defaults to "not configured" so requiring the
// playbooks router below behaves exactly as it does in production without Redis.
// Individual tests flip `redisStub` to model "REDIS_URL is set but the server is
// unreachable" — the branch that puts a real await in front of the
// check-then-act process-local window.
const redisStub = {
  configured: false,
  inFlight: 0,
  peakInFlight: 0,
  delayMs: 5,
  reset() { this.inFlight = 0; this.peakInFlight = 0; },
};

const _redisPath = require.resolve('../services/infra/redis');
require.cache[_redisPath] = {
  id: _redisPath,
  filename: _redisPath,
  loaded: true,
  exports: {
    isRedisConfigured: () => redisStub.configured,
    async redisIncr() {
      redisStub.inFlight += 1;
      if (redisStub.inFlight > redisStub.peakInFlight) redisStub.peakInFlight = redisStub.inFlight;
      await new Promise((r) => setTimeout(r, redisStub.delayMs));
      redisStub.inFlight -= 1;
      return null; // configured but unreachable → limiter degrades to process-local
    },
  },
};

const { createRateLimiter, authAbuseLimiter } = require('../services/security/rate_limit');
const playbooksApi = require('../services/vertical_playbooks/api');
const { playbooksTenantGuard, tenantIdFromAuthContext, playbooksLimits } = playbooksApi;

const API_SRC_PATH = path.join(__dirname, '../services/vertical_playbooks/api.js');
const API_SRC = fs.readFileSync(API_SRC_PATH, 'utf8');
// Comments in this file legitimately name `_RL_PATHS` and `resolveTenantId` to
// explain why the limiter does not use them, so assertions about what the code
// *does* run against a comment-stripped copy.
const API_CODE = API_SRC
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((line) => line.replace(/(^|\s)\/\/.*$/, '$1'))
  .join('\n');

function fakeRes() {
  const headers = {};
  const state = { statusCode: null, body: null, headers, ended: false };
  const res = {
    setHeader(k, v) { headers[k.toLowerCase()] = v; return res; },
    status(code) { state.statusCode = code; return res; },
    json(body) { state.body = body; state.ended = true; return res; },
  };
  return { res, state };
}

// Drive one limiter invocation to its decision. Resolves 'allowed' or 'denied'.
function hit(limiter, req) {
  return new Promise((resolve, reject) => {
    const headers = {};
    const res = {
      setHeader(k, v) { headers[k.toLowerCase()] = v; return res; },
      status(code) {
        return {
          json(body) { resolve({ verdict: 'denied', code, body, headers }); return res; },
        };
      },
    };
    try {
      limiter(req, res, (err) => (err ? reject(err) : resolve({ verdict: 'allowed' })));
    } catch (err) { reject(err); }
  });
}

// ── Tenant key: authenticated context only ───────────────────────────────────

test('tenantIdFromAuthContext accepts only a positive safe integer from req.tenant', () => {
  assert.equal(tenantIdFromAuthContext({ tenant: { id: 7 } }), 7);
  assert.equal(tenantIdFromAuthContext({ tenant: { id: '7' } }), 7);

  const rejected = [
    { label: 'no req', req: undefined },
    { label: 'no tenant', req: {} },
    { label: 'null tenant', req: { tenant: null } },
    { label: 'no id', req: { tenant: {} } },
    { label: 'zero', req: { tenant: { id: 0 } } },
    { label: 'negative', req: { tenant: { id: -3 } } },
    { label: 'float', req: { tenant: { id: 1.5 } } },
    { label: 'NaN', req: { tenant: { id: Number.NaN } } },
    { label: 'Infinity', req: { tenant: { id: Number.POSITIVE_INFINITY } } },
    { label: 'unsafe integer', req: { tenant: { id: Number.MAX_SAFE_INTEGER + 2 } } },
    { label: 'unsafe integer string', req: { tenant: { id: '90071992547409931' } } },
    { label: 'exponent string', req: { tenant: { id: '1e3' } } },
    { label: 'padded string', req: { tenant: { id: ' 1' } } },
    { label: 'leading-zero string', req: { tenant: { id: '01' } } },
    { label: 'sql-ish string', req: { tenant: { id: "1 OR 1=1" } } },
    { label: 'boolean', req: { tenant: { id: true } } },
    { label: 'array', req: { tenant: { id: [1] } } },
    { label: 'object', req: { tenant: { id: { valueOf: () => 1 } } } },
  ];
  for (const { label, req } of rejected) {
    assert.equal(tenantIdFromAuthContext(req), null, `${label} must not yield a tenant id`);
  }
});

test('tenant key ignores every caller-controlled source', () => {
  const spoof = {
    tenant: null,
    body: { tenant_id: 99, tenantId: 99, tenant: { id: 99 } },
    query: { tenant_id: '99', tenantId: '99' },
    headers: {
      'x-tenant-id': '99',
      'x-test-tid': '99',
      'x-infogenie-tenant': '99',
      tenant_id: '99',
    },
    params: { tenant_id: '99' },
    session: { activeTenantId: 99 },
  };
  assert.equal(tenantIdFromAuthContext(spoof), null);

  // Same spoof, but with a real authenticated tenant: the verified id wins and
  // the spoofed one is never mixed into the key.
  const authed = { ...spoof, tenant: { id: 7 } };
  assert.equal(tenantIdFromAuthContext(authed), 7);
});

test('playbooksTenantGuard fails closed with 400 no_tenant and does not call next', () => {
  for (const bad of [null, {}, { id: 0 }, { id: -1 }, { id: '0' }, { id: 'abc' }]) {
    const { res, state } = fakeRes();
    let nextCount = 0;
    playbooksTenantGuard(
      { tenant: bad, body: { tenant_id: 5 }, query: { tenant_id: '5' }, headers: { 'x-tenant-id': '5' } },
      res,
      () => { nextCount += 1; },
    );
    assert.equal(nextCount, 0, `next must not run for ${JSON.stringify(bad)}`);
    assert.equal(state.statusCode, 400);
    assert.deepEqual(state.body, { ok: false, error: 'no_tenant' });
  }
});

// ── Source-level guardrails ──────────────────────────────────────────────────

test('the playbooks limiter derives its key from req.tenant and nothing else', () => {
  const start = API_CODE.indexOf('function tenantIdFromAuthContext');
  const end = API_CODE.indexOf('const playbooksSharedLimiter');
  assert.ok(start > -1 && end > start, 'key-derivation region must be locatable');
  const keyRegion = API_CODE.slice(start, end);
  assert.match(keyRegion, /req\.tenant/);
  // A key that could be influenced by the caller would defeat the whole control.
  assert.doesNotMatch(keyRegion, /req\.(body|query|headers|params|cookies)/);
  // resolveTenantId can fall back to the default tenant when enforcement is off.
  assert.doesNotMatch(keyRegion, /resolveTenantId/);
  // _RL_PATHS is the IP+path public-POST limiter; it cannot cover these GETs and
  // has no authenticated-caller exemption.
  assert.doesNotMatch(API_CODE, /_RL_PATHS/);
  assert.doesNotMatch(API_CODE, /allowFallback/);
  // Both limiters must carry the fail-closed and atomicity opt-ins.
  assert.equal((API_CODE.match(/serialize:\s*true/g) || []).length, 2);
  assert.equal((API_CODE.match(/failClosed:\s*true/g) || []).length, 2);
});

// CodeQL's js/missing-rate-limiting does not model createRateLimiter and does
// not follow `router.use`, so the check on PR #83 stayed red after the limiter
// shipped. The answer is the limiter passed explicitly on each route plus an
// inline disposition. Both are load-bearing for the check and neither is
// self-evident from reading the handler, so both are asserted here.
test('every playbooks route carries the shared limiter and a CodeQL disposition', () => {
  const lines = API_SRC.split('\n');
  const registrations = [];
  lines.forEach((line, i) => {
    if (/^router\.(get|post|put|patch|delete)\(/.test(line)) registrations.push({ line, i });
  });
  assert.equal(registrations.length, 5, `expected 5 route registrations, found ${registrations.length}`);

  const DISPOSITION = '// codeql[js/missing-rate-limiting]';
  for (const { line, i } of registrations) {
    assert.match(line, /playbooksSharedLimiter/,
      `route must pass the shared limiter explicitly: ${line.trim()}`);
    // The disposition has to sit on the line immediately above the handler for
    // CodeQL to associate it with the alert.
    assert.ok(lines[i - 1] && lines[i - 1].includes(DISPOSITION),
      `missing ${DISPOSITION} directly above: ${line.trim()}`);
    assert.match(lines[i - 1], /createRateLimiter keyed on req\.tenant\.id/,
      `disposition must state the reason: ${lines[i - 1]}`);
  }

  // Suppressions must stay pinned to this one query — never a bare `codeql[...]`
  // that would silence unrelated findings in the same file.
  const suppressions = API_SRC.match(/\/\/\s*(codeql|lgtm)\[[^\]]*\]/g) || [];
  assert.equal(suppressions.length, 5);
  for (const s of suppressions) {
    assert.match(s, /^\/\/ codeql\[js\/missing-rate-limiting\]$/);
  }
});

test('a limiter mounted twice on one chain still spends a single token', async () => {
  // router.use + the explicit per-route argument put the same instance on the
  // chain twice. Double counting here would silently halve the tenant ceiling.
  const lim = createRateLimiter({
    name: 'dedupe', windowMs: 60_000, max: 2, keyFn: () => 'playbooks|9', serialize: true, failClosed: true,
  });
  // Each `req` models one request passing through both mounts.
  const twice = async (req) => {
    const first = await hit(lim, req);
    if (first.verdict === 'denied') return first;
    return hit(lim, req);
  };
  assert.equal((await twice({})).verdict, 'allowed');
  assert.equal((await twice({})).verdict, 'allowed');
  assert.equal((await twice({})).verdict, 'denied', 'third request must be the one denied, not the second');
  lim.reset();
});

test('no production source reads the test-only x-test-tid header', () => {
  const roots = ['services', 'lib', 'app', 'components', 'hooks'];
  const files = ['server.js', 'db.js', 'middleware.ts'];
  const repoRoot = path.join(__dirname, '..');

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        walk(full);
      } else if (/\.(js|ts|tsx|mjs|cjs)$/.test(entry.name)) {
        files.push(path.relative(repoRoot, full));
      }
    }
  };
  for (const r of roots) {
    const dir = path.join(repoRoot, r);
    if (fs.existsSync(dir)) walk(dir);
  }

  const offenders = files.filter((rel) => {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) return false;
    return /x-test-tid/i.test(fs.readFileSync(abs, 'utf8'));
  });
  assert.deepEqual(offenders, [], `x-test-tid must stay confined to test/: ${offenders.join(', ')}`);
});

// ── Shipped defaults and the test-only override gate ─────────────────────────

test('shipped playbooks limits are 60/60s shared and 5/60s generate', () => {
  // This process has NODE_ENV unset (or not 'test' when run directly), and the
  // hostile values below must be ignored either way once NODE_ENV is not 'test'.
  assert.equal(playbooksLimits.windowMs, 60_000);
  if (process.env.NODE_ENV !== 'test') {
    assert.equal(playbooksLimits.sharedMax, 60);
    assert.equal(playbooksLimits.generateMax, 5);
  }
});

test('rate-limit env overrides are inert outside NODE_ENV=test', () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevShared = process.env.PLAYBOOKS_RATE_LIMIT_MAX;
  const prevGenerate = process.env.PLAYBOOKS_GENERATE_RATE_LIMIT_MAX;
  const apiPath = require.resolve('../services/vertical_playbooks/api');
  const cached = require.cache[apiPath];

  try {
    process.env.NODE_ENV = 'production';
    process.env.PLAYBOOKS_RATE_LIMIT_MAX = '999999';
    process.env.PLAYBOOKS_GENERATE_RATE_LIMIT_MAX = '999999';
    delete require.cache[apiPath];
    const reloaded = require('../services/vertical_playbooks/api');
    assert.equal(reloaded.playbooksLimits.sharedMax, 60);
    assert.equal(reloaded.playbooksLimits.generateMax, 5);
  } finally {
    delete require.cache[apiPath];
    if (cached) require.cache[apiPath] = cached;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevNodeEnv;
    if (prevShared === undefined) delete process.env.PLAYBOOKS_RATE_LIMIT_MAX; else process.env.PLAYBOOKS_RATE_LIMIT_MAX = prevShared;
    if (prevGenerate === undefined) delete process.env.PLAYBOOKS_GENERATE_RATE_LIMIT_MAX; else process.env.PLAYBOOKS_GENERATE_RATE_LIMIT_MAX = prevGenerate;
  }
});

// ── Limiter primitive: fail-closed key and atomic admissions ─────────────────

test('failClosed denies when keyFn cannot identify the caller', async () => {
  for (const badKey of [null, undefined, '']) {
    const lim = createRateLimiter({
      name: 'fc', windowMs: 60_000, max: 5, keyFn: () => badKey, failClosed: true,
    });
    const r = await hit(lim, {});
    assert.equal(r.verdict, 'denied', `key ${String(badKey)} must be denied, not bucketed under null`);
    assert.equal(r.code, 429);
    assert.equal(r.body.error, 'rate_limited');
    lim.reset();
  }
});

test('429 contract: rate_limited plus an integer Retry-After matching the body', async () => {
  const lim = createRateLimiter({
    name: 'contract', windowMs: 60_000, max: 1, keyFn: () => 'playbooks|7', serialize: true, failClosed: true,
  });
  assert.equal((await hit(lim, {})).verdict, 'allowed');
  const denied = await hit(lim, {});
  assert.equal(denied.verdict, 'denied');
  assert.equal(denied.code, 429);
  assert.equal(denied.body.ok, false);
  assert.equal(denied.body.error, 'rate_limited');
  const header = denied.headers['retry-after'];
  const parsed = Number.parseInt(String(header), 10);
  assert.equal(Number.isInteger(parsed) && parsed > 0, true, `Retry-After must be positive integer seconds, got ${header}`);
  assert.equal(String(parsed), String(header), 'Retry-After must be bare integer seconds, not a date');
  assert.equal(denied.body.retryAfterSec, parsed);
  lim.reset();
});

test('serialize keeps concurrent admissions atomic when Redis is unreachable', async () => {
  redisStub.configured = true; // REDIS_URL set...
  redisStub.reset();           // ...but every INCR fails, so the await is real
  try {
    const max = 3;
    const burst = 12;
    const lim = createRateLimiter({
      name: 'atomic', windowMs: 60_000, max, keyFn: () => 'playbooks|42', serialize: true, failClosed: true,
    });
    const results = await Promise.all(Array.from({ length: burst }, () => hit(lim, {})));
    const allowed = results.filter((r) => r.verdict === 'allowed').length;
    const denied = results.filter((r) => r.verdict === 'denied').length;
    assert.equal(allowed, max, `serialized limiter must admit exactly ${max}, got ${allowed}`);
    assert.equal(denied, burst - max);
    // One verdict in flight at a time is what makes the check-then-act atomic.
    assert.equal(redisStub.peakInFlight, 1);
    lim.reset();
  } finally {
    redisStub.configured = false;
    redisStub.reset();
  }
});

test('the burst harness really is concurrent (control for the atomicity test)', async () => {
  redisStub.configured = true;
  redisStub.reset();
  try {
    // Same burst against a limiter without `serialize`: several verdicts overlap.
    // Asserted so the atomicity test above cannot pass by never racing at all.
    const lim = createRateLimiter({
      name: 'control', windowMs: 60_000, max: 3, keyFn: () => 'playbooks|43',
    });
    await Promise.all(Array.from({ length: 12 }, () => hit(lim, {})));
    assert.ok(redisStub.peakInFlight > 1, `expected overlapping verdicts, peak was ${redisStub.peakInFlight}`);
    lim.reset();
  } finally {
    redisStub.configured = false;
    redisStub.reset();
  }
});

test('per-tenant keys isolate buckets', async () => {
  const lim = createRateLimiter({
    name: 'iso',
    windowMs: 60_000,
    max: 2,
    keyFn: (req) => `playbooks|${req.tenant.id}`,
    serialize: true,
    failClosed: true,
  });
  // A fresh object per call: the limiter marks the request it has adjudicated,
  // so reusing one object would model a single request, not a sequence.
  const a = () => ({ tenant: { id: 1 } });
  const b = () => ({ tenant: { id: 2 } });
  assert.equal((await hit(lim, a())).verdict, 'allowed');
  assert.equal((await hit(lim, a())).verdict, 'allowed');
  assert.equal((await hit(lim, a())).verdict, 'denied');
  // Tenant A exhausting its bucket must not spend tenant B's allowance.
  assert.equal((await hit(lim, b())).verdict, 'allowed');
  assert.equal((await hit(lim, b())).verdict, 'allowed');
  assert.equal((await hit(lim, b())).verdict, 'denied');
  lim.reset();
});

// ── authAbuseLimiter must be untouched by the opt-ins above ──────────────────

test('authAbuseLimiter still keys on IP+path at 30 per 15 minutes', async () => {
  const lim = authAbuseLimiter();
  const req = (ip, p) => ({ headers: { 'x-forwarded-for': ip }, socket: {}, path: p });

  for (let i = 0; i < 30; i++) {
    assert.equal((await hit(lim, req('10.0.0.1', '/api/auth/login'))).verdict, 'allowed', `attempt ${i + 1}`);
  }
  const denied = await hit(lim, req('10.0.0.1', '/api/auth/login'));
  assert.equal(denied.verdict, 'denied');
  assert.equal(denied.headers['retry-after'], '900');

  // A different IP, and a different auth path on the same IP, keep their own buckets.
  assert.equal((await hit(lim, req('10.0.0.2', '/api/auth/login'))).verdict, 'allowed');
  assert.equal((await hit(lim, req('10.0.0.1', '/api/auth/signup'))).verdict, 'allowed');
  lim.reset();
});
