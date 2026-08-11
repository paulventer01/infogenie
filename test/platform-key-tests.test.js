'use strict';
// test/platform-key-tests.test.js — Every platform-key connectivity probe must
// report the correct verdict (ok / invalid / unconfigured / timed-out).
//
// The per-vendor probes in services/credentials/platform_keys.js (_runTest, run
// via testKey) are subtle and easy to regress:
//   • Apollo + BuiltWith return HTTP 200 even for a BAD key — the truth is in the
//     response body (is_logged_in / Errors[]).
//   • Cloudflare + Gemini reject a bad key with 400 (not just 401/403).
//   • PageSpeed + Google Search + Amplitude parse an error-message string out of
//     the body, and treat a 400 "missing param" as a SUCCESS (key was accepted).
//   • Perplexity + Firecrawl also treat 400/422 as success (auth passed, only the
//     empty probe body failed validation).
// A regression in any of these would silently mark a bad key "OK" (or a good key
// "invalid"), and nobody would notice until a vendor call failed in production.
//
// Strategy: stub global.fetch so no real network call is made, drive process.env
// so resolvePlatformKey() returns a dummy key, and assert testKey() returns the
// expected status for three scenarios per vendor — a valid response, a bad-key
// response (incl. the 200-with-error-body cases), and an unconfigured key — plus
// the abort/timeout path. The CASES table is checked against the live REGISTRY so
// a NEW testable vendor added without a matching case fails this test.
//
// DATABASE_URL is cleared so testKey()'s verdict-persistence (_recordTest) stays
// purely in-memory and the test never touches the real database.
//
// Run: node --test   (or: npm test)

const { test, before, after } = require('node:test');
const assert = require('node:assert');

// Make the run hermetic: no DB writes from _recordTest, no real key overlay.
const _savedDbUrl = process.env.DATABASE_URL;
delete process.env.DATABASE_URL;

const platformKeys = require('../services/credentials/platform_keys');

// Every env var any probe reads. Cleared before each case so scenarios never
// leak a key from the ambient environment (the test box has real keys set).
const ALL_KEY_VARS = [
  'AI_INTEGRATIONS_OPENAI_API_KEY', 'OPENAI_API_KEY',
  'AI_INTEGRATIONS_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY', 'PERPLEXITY_API_KEY', 'CLOUDFLARE_AI_TOKEN',
  'DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD', 'FIRECRAWL_API_KEY',
  'APOLLO_API_KEY', 'BUILTWITH_API_KEY', 'GOOGLE_PAGESPEED_API_KEY',
  'GOOGLE_SEARCH_API_KEY', 'RESEND_API_KEY', 'AMPLITUDE_API_KEY',
  'STRIPE_SECRET_KEY',
  'YOUTUBE_DATA_API_KEY', 'BING_WEBMASTER_API_KEY', 'SPYFU_API_KEY',
  'MAJESTIC_API_KEY', 'MANGOOLS_API_KEY', 'MODASH_API_KEY',
  'MOONSHOT_API_KEY', 'RAPIDAPI_KEY', 'ZAI_API_KEY',
];
const _savedKeyVars = {};

const _realFetch = global.fetch;
// The next fetch behaviour: a function (...args) => response (or that throws).
let _fetchImpl = () => { throw new Error('fetch not stubbed for this case'); };

before(() => {
  for (const v of ALL_KEY_VARS) _savedKeyVars[v] = process.env[v];
  global.fetch = (...args) => _fetchImpl(...args);
});

after(() => {
  global.fetch = _realFetch;
  for (const v of ALL_KEY_VARS) {
    if (_savedKeyVars[v] === undefined) delete process.env[v];
    else process.env[v] = _savedKeyVars[v];
  }
  if (_savedDbUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = _savedDbUrl;
});

// Build a Response-like object exposing exactly what _runTest touches: .ok,
// .status and an async .text(). body may be a string or a JSON-able object.
function fakeResp({ status = 200, body = '' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return typeof body === 'string' ? body : JSON.stringify(body); },
  };
}

function clearAllKeyVars() {
  for (const v of ALL_KEY_VARS) delete process.env[v];
}

// One entry per testable vendor, keyed by the `test` id used in REGISTRY.
//   set:   env vars to populate so the key resolves (configured scenarios)
//   valid: the fetch response a GOOD key produces  → expect status 'ok'
//   bad:   the fetch response a BAD key produces    → expect status 'invalid'
// The 'unconfigured' scenario clears every key var and expects 'unconfigured'.
const CASES = {
  // Simple bearer/header probes: 2xx = ok, 401/403 = invalid.
  openai:        { set: { AI_INTEGRATIONS_OPENAI_API_KEY: 'k' }, valid: { status: 200 }, bad: { status: 401 } },
  anthropic:     { set: { AI_INTEGRATIONS_ANTHROPIC_API_KEY: 'k' }, valid: { status: 200 }, bad: { status: 401 } },
  resend:        { set: { RESEND_API_KEY: 'k' }, valid: { status: 200 }, bad: { status: 401 } },
  stripe:        { set: { STRIPE_SECRET_KEY: 'k' }, valid: { status: 200 }, bad: { status: 401 } },
  // Two-part credential: needs BOTH login and password.
  dataforseo:    { set: { DATAFORSEO_LOGIN: 'l', DATAFORSEO_PASSWORD: 'p' }, valid: { status: 200 }, bad: { status: 401 } },
  // Gemini + Cloudflare reject a bad key with 400 (not just 401/403).
  gemini:        { set: { GEMINI_API_KEY: 'k' }, valid: { status: 200 }, bad: { status: 400 } },
  cloudflare:    { set: { CLOUDFLARE_AI_TOKEN: 'k' }, valid: { status: 200 }, bad: { status: 400 } },
  // Empty-probe-body services: 400/422 means auth PASSED → ok; 401/403 = invalid.
  perplexity:    { set: { PERPLEXITY_API_KEY: 'k' }, valid: { status: 400 }, bad: { status: 401 } },
  firecrawl:     { set: { FIRECRAWL_API_KEY: 'k' }, valid: { status: 400 }, bad: { status: 401 } },
  // HTTP-200-with-error-body services: verdict comes from the body, not status.
  apollo:        { set: { APOLLO_API_KEY: 'k' }, valid: { status: 200, body: { is_logged_in: true } }, bad: { status: 200, body: { is_logged_in: false } } },
  builtwith:     { set: { BUILTWITH_API_KEY: 'k' }, valid: { status: 200, body: { Results: [] } }, bad: { status: 200, body: { Errors: [{ Message: 'Invalid API Key' }] } } },
  // Google error-string services: 400 "missing param" = ok; bad key string = invalid.
  pagespeed:     { set: { GOOGLE_PAGESPEED_API_KEY: 'k' }, valid: { status: 400, body: 'Required parameter: url' }, bad: { status: 400, body: 'API key not valid. Please pass a valid API key.' } },
  google_search: { set: { GOOGLE_SEARCH_API_KEY: 'k' }, valid: { status: 400, body: 'Required parameter: q' }, bad: { status: 400, body: 'API key not valid.' } },
  amplitude:     { set: { AMPLITUDE_API_KEY: 'k' }, valid: { status: 400, body: 'missing required field' }, bad: { status: 400, body: 'Invalid API key' } },
  // Additional registry vendors (must stay 1:1 with REGISTRY `test` ids).
  youtube_data:    { set: { YOUTUBE_DATA_API_KEY: 'k' }, valid: { status: 200, body: { items: [] } }, bad: { status: 400, body: 'API key not valid.' } },
  bing_webmaster:  { set: { BING_WEBMASTER_API_KEY: 'k' }, valid: { status: 200, body: [] }, bad: { status: 403 } },
  spyfu:           { set: { SPYFU_API_KEY: 'k' }, valid: { status: 200, body: {} }, bad: { status: 401 } },
  majestic:        { set: { MAJESTIC_API_KEY: 'k' }, valid: { status: 200, body: { Code: 'OK' } }, bad: { status: 200, body: { Code: 'ApiKeyUnauthorized', ErrorMessage: 'bad key' } } },
  mangools:        { set: { MANGOOLS_API_KEY: 'k' }, valid: { status: 200, body: { keywords: [] } }, bad: { status: 401, body: { error: { type: 'AuthError', message: 'Invalid API Key' } } } },
  modash:          { set: { MODASH_API_KEY: 'k' }, valid: { status: 200 }, bad: { status: 401 } },
  moonshot:        { set: { MOONSHOT_API_KEY: 'k' }, valid: { status: 200 }, bad: { status: 401 } },
  rapidapi_llama:  { set: { RAPIDAPI_KEY: 'k' }, valid: { status: 200 }, bad: { status: 401 } },
  zai:             { set: { ZAI_API_KEY: 'k' }, valid: { status: 200 }, bad: { status: 401 } },
};

// Map each REGISTRY `test` id → the key_name that carries it (the one testKey is
// called with). Guarantees we test the SHIPPED wiring, not a hand-kept list.
const TEST_ID_TO_KEY = {};
for (const entry of platformKeys.REGISTRY) {
  if (entry.test) TEST_ID_TO_KEY[entry.test] = entry.key;
}

// Guard: every testable vendor in the registry must have a CASES entry, so a new
// probe added without a verdict assertion makes this test fail loudly.
test('every testable registry key has a verdict case', () => {
  const registryIds = Object.keys(TEST_ID_TO_KEY).sort();
  const caseIds = Object.keys(CASES).sort();
  assert.deepStrictEqual(
    registryIds, caseIds,
    'CASES must cover exactly the testable REGISTRY ids — add/remove a case to match',
  );
});

for (const [id, spec] of Object.entries(CASES)) {
  const keyName = TEST_ID_TO_KEY[id];

  test(`${id}: valid response → ok`, async () => {
    assert.ok(keyName, `precondition: registry has a key for test id "${id}"`);
    clearAllKeyVars();
    Object.assign(process.env, spec.set);
    _fetchImpl = () => fakeResp(spec.valid);
    const r = await platformKeys.testKey(keyName);
    assert.strictEqual(r.status, 'ok', `${id} valid response should report ok (got: ${r.status} — ${r.message})`);
    assert.strictEqual(r.ok, true, `${id} valid response should set ok:true`);
  });

  test(`${id}: bad-key response → invalid`, async () => {
    clearAllKeyVars();
    Object.assign(process.env, spec.set);
    _fetchImpl = () => fakeResp(spec.bad);
    const r = await platformKeys.testKey(keyName);
    assert.strictEqual(r.status, 'invalid', `${id} bad-key response should report invalid (got: ${r.status} — ${r.message})`);
    assert.strictEqual(r.ok, false, `${id} bad-key response should set ok:false`);
  });

  test(`${id}: no key configured → unconfigured`, async () => {
    clearAllKeyVars();
    // fetch must never be called when the key is absent.
    _fetchImpl = () => { throw new Error(`${id}: probe attempted a fetch with no key configured`); };
    const r = await platformKeys.testKey(keyName);
    assert.strictEqual(r.status, 'unconfigured', `${id} with no key should report unconfigured (got: ${r.status} — ${r.message})`);
    assert.strictEqual(r.ok, false, `${id} unconfigured should set ok:false`);
  });
}

// The abort timeout (_fetchT aborts a hung vendor) must surface as a clear
// "timed out" error, not a crash or a false verdict.
test('aborted/hung request → timed-out error', async () => {
  clearAllKeyVars();
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = 'k';
  _fetchImpl = () => {
    const e = new Error('The operation was aborted');
    e.name = 'AbortError';
    throw e;
  };
  const r = await platformKeys.testKey('AI_INTEGRATIONS_OPENAI_API_KEY');
  assert.strictEqual(r.status, 'error', 'aborted request should report error status');
  assert.match(r.message, /timed out/i, 'aborted request message should mention timing out');
});

// A non-abort network failure should surface as a generic error (not a crash,
// not a false ok/invalid), distinct from the timeout path above.
test('network failure → error (not a false verdict)', async () => {
  clearAllKeyVars();
  process.env.STRIPE_SECRET_KEY = 'k';
  _fetchImpl = () => { throw new Error('ECONNREFUSED'); };
  const r = await platformKeys.testKey('STRIPE_SECRET_KEY');
  assert.strictEqual(r.status, 'error', 'network failure should report error status');
  assert.strictEqual(r.ok, false, 'network failure should set ok:false');
});
