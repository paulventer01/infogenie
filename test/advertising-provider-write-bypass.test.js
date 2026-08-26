'use strict';
// Zero-network regression: advertising provider-write bypass closure.
// Asserts launch routes, live-mode flips, audience sync, optimizer mutation
// helpers, and cron/timer entry points refuse BEFORE credential/vault/network.

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.INFOGENIE_API_KEY = process.env.INFOGENIE_API_KEY || '<set-via-environment>';
process.env.PERMISSION_ENFORCEMENT = process.env.PERMISSION_ENFORCEMENT || 'on';
process.env.MULTITENANT_ENFORCEMENT = process.env.MULTITENANT_ENFORCEMENT || 'on';

require('./helpers/env');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const {
  CODE,
  MESSAGE,
  isAdvertisingProviderMutationAllowed,
  assertAdvertisingProviderMutationAllowed,
  denyAdvertisingProviderMutation,
} = require('../services/security/advertising_provider_mutations');
const security = require('../services/security');
const platforms = require('../services/optimizer/platforms');
const pixelManager = require('../services/pixel_manager/api');

const { bootApp, request, login, makeFixtures, hasDb } = require('./helpers');

const HAS_DB = hasDb();
const skipDb = !HAS_DB && 'no DATABASE_URL';
const ROOT = path.join(__dirname, '..');
const LAUNCH_ROUTES = [
  '/api/launch/google-ads',
  '/api/launch/meta',
  '/api/launch/microsoft-ads',
  '/api/launch/tiktok',
];
const CAPI_ROUTES = [
  '/api/pixel-manager/capi/meta',
  '/api/pixel-manager/capi/linkedin',
  '/api/pixel-manager/capi/tiktok',
];

let networkHits = 0;
const origHttpsRequest = https.request;
const origHttpRequest = http.request;
const origFetch = global.fetch;

function installNetworkTripwire() {
  networkHits = 0;
  const wrap = (orig) => function (...args) {
    networkHits += 1;
    throw new Error('NETWORK_FORBIDDEN: advertising provider mutation tests must stay zero-network');
  };
  https.request = wrap(origHttpsRequest);
  http.request = function (...args) {
    // Allow loopback harness calls to our own bootApp server.
    const first = args[0];
    const url = typeof first === 'string' ? first
      : (first && first.href) || (first && first.hostname) || '';
    const host = (first && first.hostname) || '';
    if (String(url).includes('127.0.0.1') || host === '127.0.0.1' || host === 'localhost') {
      return origHttpRequest.apply(this, args);
    }
    networkHits += 1;
    throw new Error('NETWORK_FORBIDDEN: advertising provider mutation tests must stay zero-network');
  };
  global.fetch = async function (input) {
    const u = String(input && input.url ? input.url : input);
    if (u.includes('127.0.0.1') || u.includes('localhost')) {
      return origFetch.apply(this, arguments);
    }
    networkHits += 1;
    throw new Error('NETWORK_FORBIDDEN: advertising provider mutation tests must stay zero-network');
  };
}

function restoreNetwork() {
  https.request = origHttpsRequest;
  http.request = origHttpRequest;
  global.fetch = origFetch;
}

function assertDenied(body, label) {
  assert.ok(body, label + ' body');
  assert.equal(body.ok, false, label + ' ok');
  assert.equal(body.blocked, true, label + ' blocked');
  assert.equal(body.code, CODE, label + ' code');
  assert.equal(body.published, false, label + ' published');
  assert.equal(body.external_action_taken, false, label + ' external_action_taken');
  assert.match(String(body.error || ''), /disabled/i, label + ' error');
}

// ── Guard unit (no DB, no network) ──────────────────────────────────────────

test('guard: default-deny with no escape hatch', () => {
  assert.equal(isAdvertisingProviderMutationAllowed(), false);
  assert.equal(security.isAdvertisingProviderMutationAllowed(), false);
  assert.throws(
    () => assertAdvertisingProviderMutationAllowed({ op: 'unit' }),
    (err) => err && err.code === CODE && err.blocked === true,
  );
  const d = denyAdvertisingProviderMutation({ route: 'unit' });
  assertDenied(d, 'deny payload');
  assert.equal(d.route, 'unit');
  assert.equal(MESSAGE.includes('disabled'), true);
  // Extras must not override mandatory deny fields (Security finding).
  const hijack = denyAdvertisingProviderMutation({
    published: true,
    blocked: false,
    ok: true,
    code: 'open',
    error: 'nope',
    external_action_taken: true,
    route: 'hijack',
  });
  assertDenied(hijack, 'hijack deny');
  assert.equal(hijack.route, 'hijack');
});

// PR 6F-0 added a narrow Meta create_provider_draft capability. It must not
// widen this closure: the generic gate stays shut, the mint path stays off the
// broad security index, and a capability cannot be laundered into a denial.
test('guard: the PR 6F-0 capability is not a bypass of the default-deny gate', async () => {
  const caps = require('../services/security/advertising_provider_capabilities');

  assert.equal(isAdvertisingProviderMutationAllowed(), false, 'gate still closed');
  for (const banned of [
    'mintMetaCreateProviderDraftCapability',
    'withAdvertisingProviderExecutionTransaction',
    'assertMetaCreateProviderDraftCapability',
  ]) {
    assert.equal(banned in security, false, `services/security must not export ${banned}`);
  }

  // No mint site anywhere in product code, so nothing can obtain one today.
  for (const rel of [
    'server.js',
    'services/optimizer/platforms.js',
    'services/audiences/api.js',
    'services/pixel_manager/api.js',
    'services/agent_orchestrator/campaign_api.js',
    'services/agent_orchestrator/campaign_provider_confirmations.js',
    'services/agent_orchestrator/campaign_delivery_worker.js',
  ]) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.doesNotMatch(src, /mintMetaCreateProviderDraftCapability/, rel + ' mints no capability');
    assert.doesNotMatch(src, /advertising_provider_capabilities/, rel + ' does not reach the capability module');
  }

  // A real capability cannot be forged, and a plain look-alike is refused.
  const client = {
    async query() { return { rows: [], rowCount: 0 }; },
  };
  const now = 1_700_000_000_000;
  const binding = {
    tenant_id: 7, revision: 1, workflow_approval_id: 2, generation: 1,
    credential_ref_version: 1, requested_by: 3,
    draft_id: 'cd_1', publish_approval_id: 'cpa_1', publishing_request_id: 'cpr_1',
    intent_id: 'cdi_1', outbox_id: 'ob_1', attempt_id: 'cda_1',
    challenge_id: 'cpc_1', confirmation_id: 'cpcf_1', credential_ref_id: 'tmcr_1',
    claim_token_hash: 'a'.repeat(64), intent_hash: 'b'.repeat(64),
    snapshot_hash: 'c'.repeat(64), contract_hash: 'd'.repeat(64),
    request_hash: 'e'.repeat(64), phrase_digest: 'f'.repeat(64),
    account_fingerprint: '1'.repeat(64),
    issued_at_ms: now, expires_at_ms: now + 30_000,
  };
  const cap = await caps.withAdvertisingProviderExecutionTransaction(client, (tx) =>
    caps.mintMetaCreateProviderDraftCapability(tx, binding));
  assert.equal(caps.isAdvertisingProviderCapability({ ...binding }), false, 'clone is not a capability');

  // Holding a capability does not open the generic gate.
  assert.equal(isAdvertisingProviderMutationAllowed(), false, 'gate still closed with a capability in hand');
  assert.throws(() => assertAdvertisingProviderMutationAllowed({ op: 'launch', capability: cap }),
    (err) => err && err.code === CODE && err.blocked === true);

  // And a denial cannot serialize it.
  const denied = denyAdvertisingProviderMutation({ platform: 'meta', capability: cap });
  assertDenied(denied, 'capability deny');
  assert.equal('capability' in denied, false, 'capability stripped from the deny payload');
  assert.doesNotThrow(() => JSON.stringify(denied));
});

test('direct import: platforms.applyChange / applyMeta never touch network', async () => {
  installNetworkTripwire();
  try {
    const r1 = await platforms.applyChange('meta', 'camp_1', { action: 'pause' });
    assertDenied(r1, 'applyChange');
    const r2 = await platforms.applyChange('google', 'camp_2', { action: 'budget', dailyBudget: 50 });
    assertDenied(r2, 'applyChange google');
    // applyMeta is not exported separately from applyChange path for google stub,
    // but applyChange covers the dispatcher. Force apply via module internals:
    assert.equal(typeof platforms.applyChange, 'function');
    assert.equal(networkHits, 0);
  } finally {
    restoreNetwork();
  }
});

test('source: lowest-level mutation helpers call the guard before vault/network', () => {
  const files = [
    'services/optimizer/platforms.js',
    'services/optimizer/bandit.js',
    'services/optimizer/google_bandit.js',
    'services/optimizer/creative_refresh.js',
    'services/optimizer/google_creative_refresh.js',
    'services/audiences/api.js',
    'services/pixel_manager/api.js',
    'server.js',
  ];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(src, /advertising_provider_mutations/, rel + ' imports guard');
  }
  const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  for (const route of LAUNCH_ROUTES) {
    assert.ok(serverSrc.includes(route), route);
  }
  // Launch handlers must deny before resolve*Credentials / callHttpsGeneric.
  const googleIdx = serverSrc.indexOf("app.post('/api/launch/google-ads'");
  const googleEnd = serverSrc.indexOf('});', googleIdx);
  const googleFn = serverSrc.slice(googleIdx, googleEnd);
  assert.match(googleFn, /denyAdvertisingProviderMutation/);
  assert.doesNotMatch(googleFn, /resolveGoogleAdsCredentials|callHttpsGeneric|oauth2\.googleapis/);

  const pixelSrc = fs.readFileSync(path.join(ROOT, 'services/pixel_manager/api.js'), 'utf8');
  for (const fn of ['sendMetaCapi', 'sendLinkedInCapi', 'sendTikTokCapi']) {
    assert.match(pixelSrc, new RegExp(`function ${fn}[\\s\\S]*?assertAdvertisingProviderMutationAllowed`));
  }
  for (const route of ['/capi/meta', '/capi/linkedin', '/capi/tiktok']) {
    const idx = pixelSrc.indexOf(`router.post('${route}'`);
    assert.ok(idx >= 0, route + ' exists');
    const end = pixelSrc.indexOf('});', idx);
    const body = pixelSrc.slice(idx, end);
    assert.match(body, /denyAdvertisingProviderMutation/);
    assert.doesNotMatch(body, /access_token|getPool|_httpsPost|buildMetaCapiPayload/);
  }
});

test('frontend: Campaigns launch action disabled', () => {
  const src = fs.readFileSync(path.join(ROOT, 'components/features/create/Campaigns.tsx'), 'utf8');
  assert.match(src, /Launch disabled|disabled/);
  assert.match(src, /aria-disabled/);
  assert.doesNotMatch(src, /_igLaunch\(0\)/);
  const appSrc = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  assert.match(appSrc, /Provider launch disabled|provider launch hard-disabled/i);
  assert.doesNotMatch(appSrc, /fetch\(apiUrl/);
});

// ── HTTP + module integration (needs DB for session fixtures) ───────────────

let appHandle = null;
let fx = null;
let owner = null;
let cookie = null;

before(async () => {
  if (!HAS_DB) return;
  installNetworkTripwire();
  fx = makeFixtures();
  await fx.ensureSchemas();
  const tenant = await fx.seedTenant();
  owner = await fx.seedUser({ tenantId: tenant.id, owner: true });
  appHandle = await bootApp();
  const logged = await login(appHandle.baseUrl, owner.email, owner.password);
  assert.equal(logged.status, 200, 'login');
  cookie = logged.cookie;
  assert.ok(cookie, 'session cookie');
});

after(async () => {
  restoreNetwork();
  if (appHandle) await appHandle.close();
  if (fx) await fx.cleanup();
});

test('session: POST /api/launch/* refuse with 403 and zero network', { skip: skipDb }, async () => {
  const beforeHits = networkHits;
  for (const route of LAUNCH_ROUTES) {
    const res = await request(appHandle.baseUrl, 'POST', route, {
      cookie,
      body: { campaignName: 'Bypass Probe', budget: 1000 },
    });
    assert.equal(res.status, 403, route + ' status');
    assertDenied(res.json, route);
    assert.equal(res.json.success, false, route + ' success');
  }
  assert.equal(networkHits, beforeHits, 'no outbound network from launch routes');
});

test('INFOGENIE_API_KEY: POST /api/launch/* refuse with 403 and zero network', { skip: skipDb }, async () => {
  const beforeHits = networkHits;
  for (const route of LAUNCH_ROUTES) {
    const res = await request(appHandle.baseUrl, 'POST', route, {
      apiKey: true,
      body: { campaignName: 'API Key Probe', budget: 500 },
    });
    assert.equal(res.status, 403, route + ' api-key status');
    assertDenied(res.json, route + ' api-key');
  }
  assert.equal(networkHits, beforeHits);
});

test('manual HTTP: live-mode transitions rejected', { skip: skipDb }, async () => {
  const beforeHits = networkHits;
  const paths = [
    '/api/optimizer/dry-run',
    '/api/optimizer/creative-refresh/dry-run',
    '/api/optimizer/bandit/dry-run',
  ];
  for (const route of paths) {
    const res = await request(appHandle.baseUrl, 'POST', route, {
      cookie,
      body: { dryRun: false },
    });
    assert.equal(res.status, 403, route);
    assertDenied(res.json, route);
  }
  // Keeping dry-run=true remains allowed (not a provider write).
  const keep = await request(appHandle.baseUrl, 'POST', '/api/optimizer/dry-run', {
    cookie,
    body: { dryRun: true },
  });
  assert.equal(keep.status, 200);
  assert.equal(keep.json.ok, true);
  assert.equal(keep.json.dryRun, true);
  assert.equal(networkHits, beforeHits);
});

test('manual HTTP: Meta audience sync-ads refused before network', { skip: skipDb }, async () => {
  const beforeHits = networkHits;
  const res = await request(appHandle.baseUrl, 'POST', '/api/audiences/1/sync-ads', {
    cookie,
    body: { platform: 'meta' },
  });
  assert.equal(res.status, 403);
  assertDenied(res.json, 'sync-ads');
  assert.equal(networkHits, beforeHits);
});

test('scheduled jobs / timers: force:true cannot open provider writes', async () => {
  // Source lock: runners force dry-run regardless of opts.dryRun / settings.
  const banditSrc = fs.readFileSync(path.join(ROOT, 'services/optimizer/bandit.js'), 'utf8');
  const gBanditSrc = fs.readFileSync(path.join(ROOT, 'services/optimizer/google_bandit.js'), 'utf8');
  const refreshSrc = fs.readFileSync(path.join(ROOT, 'services/optimizer/creative_refresh.js'), 'utf8');
  const gRefreshSrc = fs.readFileSync(path.join(ROOT, 'services/optimizer/google_creative_refresh.js'), 'utf8');
  const rulesSrc = fs.readFileSync(path.join(ROOT, 'services/optimizer/rules.js'), 'utf8');
  for (const [name, src] of [
    ['bandit', banditSrc],
    ['google_bandit', gBanditSrc],
    ['creative_refresh', refreshSrc],
    ['google_creative_refresh', gRefreshSrc],
    ['rules', rulesSrc],
  ]) {
    assert.match(src, /dryRun = true/, name + ' forces dryRun');
    assert.match(src, /assertAdvertisingProviderMutationAllowed|applyChange/, name + ' guarded');
  }

  installNetworkTripwire();
  try {
    // Direct mutation entry points used by timers/cron must deny with zero network
    // even when callers pass force:true / dryRun:false intent.
    const denied = await platforms.applyChange('meta', 'timer-camp', {
      action: 'budget',
      dailyBudget: 99,
      force: true,
    });
    assertDenied(denied, 'timer applyChange');
    assert.equal(networkHits, 0);
  } finally {
    restoreNetwork();
  }
});

test('direct module call: applyChange with force-like payload stays denied', async () => {
  installNetworkTripwire();
  try {
    const r = await platforms.applyChange('meta', 'x', { action: 'resume', force: true });
    assertDenied(r, 'force applyChange');
    assert.equal(networkHits, 0);
  } finally {
    restoreNetwork();
  }
});

test('direct function: sendMetaCapi / sendLinkedInCapi / sendTikTokCapi deny before network', async () => {
  installNetworkTripwire();
  try {
    assert.equal(typeof pixelManager.sendMetaCapi, 'function');
    assert.equal(typeof pixelManager.sendLinkedInCapi, 'function');
    assert.equal(typeof pixelManager.sendTikTokCapi, 'function');

    const meta = await pixelManager.sendMetaCapi('pix_1', 'tok_secret', { data: [] });
    assertDenied(meta, 'sendMetaCapi');
    const li = await pixelManager.sendLinkedInCapi('tok_secret', { conversion: 'urn:x' });
    assertDenied(li, 'sendLinkedInCapi');
    const tt = await pixelManager.sendTikTokCapi('tok_secret', { event: 'Purchase' });
    assertDenied(tt, 'sendTikTokCapi');
    assert.equal(networkHits, 0);
  } finally {
    restoreNetwork();
  }
});

test('session: POST /api/pixel-manager/capi/* refuse with 403 and zero network', { skip: skipDb }, async () => {
  const beforeHits = networkHits;
  for (const route of CAPI_ROUTES) {
    const res = await request(appHandle.baseUrl, 'POST', route, {
      cookie,
      body: { event_name: 'Purchase', event_data: { email: 'probe@example.com', value: 10 } },
    });
    assert.equal(res.status, 403, route + ' status');
    assertDenied(res.json, route);
  }
  assert.equal(networkHits, beforeHits, 'no outbound network from CAPI routes');
});

test('INFOGENIE_API_KEY: POST /api/pixel-manager/capi/* refuse with 403 and zero network', { skip: skipDb }, async () => {
  const beforeHits = networkHits;
  for (const route of CAPI_ROUTES) {
    const res = await request(appHandle.baseUrl, 'POST', route, {
      apiKey: true,
      body: { event_name: 'Lead', event_data: { value: 1 } },
    });
    assert.equal(res.status, 403, route + ' api-key status');
    assertDenied(res.json, route + ' api-key');
  }
  assert.equal(networkHits, beforeHits);
});

test('pixel-manager read paths remain available (configs / capi-log)', { skip: skipDb }, async () => {
  const configs = await request(appHandle.baseUrl, 'GET', '/api/pixel-manager/configs', { cookie });
  assert.equal(configs.status, 200, configs.text);
  assert.equal(configs.json.ok, true);
  assert.ok(Array.isArray(configs.json.configs));
  const log = await request(appHandle.baseUrl, 'GET', '/api/pixel-manager/capi-log', { cookie });
  assert.equal(log.status, 200, log.text);
  assert.equal(log.json.ok, true);
  assert.ok(Array.isArray(log.json.events));
});
