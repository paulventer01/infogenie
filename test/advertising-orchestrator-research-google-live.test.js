'use strict';

process.env.PERMISSION_ENFORCEMENT = 'on';
process.env.MULTITENANT_ENFORCEMENT = 'on';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

require('./helpers/env');

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { assertConnectorRequest, assertConnectorResult } = require('../services/agent_orchestrator/research_connector');
const { assertSearchParameters } = require('../services/agent_orchestrator/research_validate');
const { assertPageHonesty } = require('../services/agent_orchestrator/research_honesty');
const { createResearchRuntime, MAX_RETRIES } = require('../services/agent_orchestrator/research_runtime');
const { connectorErrorPage } = require('../services/agent_orchestrator/research_errors');
const { redactSecrets } = require('../services/agent_orchestrator/research_auth');
const { hostAllowed, parseRetryAfter, REQUEST_TIMEOUT_MS, MAX_BODY_BYTES } = require('../services/agent_orchestrator/connectors/transport');
const google = require('../services/agent_orchestrator/connectors/google_research');

const TOKEN = 'google-ads-oauth-token-ABCDEF123456';
const ORIG_LOGIN = process.env.DATAFORSEO_LOGIN;
const ORIG_PASSWORD = process.env.DATAFORSEO_PASSWORD;
const DFS_LOGIN = 'dfs-login-test';
const DFS_PASSWORD = 'dfs-pass-secret-ABCDEF123456';
const BASIC = `Basic ${Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`, 'utf8').toString('base64')}`;
const ROOT = path.join(__dirname, '..');

function installTestKeys() {
  process.env.DATAFORSEO_LOGIN = DFS_LOGIN;
  process.env.DATAFORSEO_PASSWORD = DFS_PASSWORD;
}
function restoreKeys() {
  if (ORIG_LOGIN == null) delete process.env.DATAFORSEO_LOGIN;
  else process.env.DATAFORSEO_LOGIN = ORIG_LOGIN;
  if (ORIG_PASSWORD == null) delete process.env.DATAFORSEO_PASSWORD;
  else process.env.DATAFORSEO_PASSWORD = ORIG_PASSWORD;
}
installTestKeys();

function baseReq(over) {
  return {
    connector_id: 'google_research',
    connector_version: '1.0.0',
    contract_version: 'v1',
    tenant_id: 9,
    research_run_id: 'run-google-live-001',
    workflow_id: 'wf-google-live-001',
    approval_id: 1,
    approval_object_version: 1,
    requested_platforms: ['google'],
    idempotency_key: 'ik-google-live-001',
    search_parameters: { query: 'jackets', countries: ['US'], lookback_days: 30, max_results_per_page: 10 },
    ...over,
  };
}

function sampleAdvertiser(over) {
  return {
    type: 'ads_advertiser',
    title: 'Acme Coats',
    advertiser_id: 'AR11122233344455566677',
    ...over,
  };
}

function sampleAd(over) {
  return {
    type: 'ads_search',
    advertiser_id: 'AR11122233344455566677',
    creative_id: 'CR99988877766655544433',
    title: 'Acme Coats',
    url: 'https://adstransparency.google.com/advertiser/AR11122233344455566677/creative/CR99988877766655544433',
    format: 'text',
    first_shown: '2026-08-01 00-00-00 +00:00',
    last_shown: '2026-08-20 00-00-00 +00:00',
    preview_url: 'https://adstransparency.google.com/preview?id=steal',
    preview_image: { url: 'https://evil.example/preview.jpg', height: 100, width: 100 },
    ...over,
  };
}

function dfsOk(items) {
  return {
    status_code: 20000,
    status_message: 'Ok.',
    tasks: [{
      status_code: 20000,
      status_message: 'Ok.',
      result: [{ items }],
    }],
  };
}

function liveHop(json, over) {
  return { ok: true, status: 200, json, headers: {}, rate_limit: null, ...over };
}

function byPath(opts) {
  return String(opts && opts.url || '');
}

function isAdvertisers(url) {
  return url.includes('/serp/google/ads_advertisers/');
}

function isAdsSearch(url) {
  return url.includes('/serp/google/ads_search/');
}

async function liveFetch(req, hopOrFn, ctxOver) {
  const hops = [];
  const page = await google.fetchPage(req, {
    tenantId: req.tenant_id,
    token: TOKEN,
    mode: 'live',
    now: Date.parse('2026-08-23T12:00:00.000Z'),
    transport: async (opts) => {
      hops.push(opts);
      return typeof hopOrFn === 'function' ? hopOrFn(opts, hops) : hopOrFn;
    },
    ...ctxOver,
  });
  return { page, hops };
}

function twoHop(advertisers, ads) {
  return (opts) => {
    const url = byPath(opts);
    if (isAdvertisers(url)) return liveHop(dfsOk(advertisers));
    if (isAdsSearch(url)) return liveHop(dfsOk(ads));
    throw new Error(`unexpected url ${url}`);
  };
}

function assertNoSecrets(value) {
  const dumped = typeof value === 'string' ? value : JSON.stringify(value);
  assert.doesNotMatch(dumped, new RegExp(TOKEN));
  assert.doesNotMatch(dumped, new RegExp(DFS_PASSWORD));
  assert.doesNotMatch(dumped, /access_token/i);
  assert.doesNotMatch(dumped, /Bearer /i);
  assert.doesNotMatch(dumped, new RegExp(BASIC.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

test('1. live Google page normalizes advertisers + ads_search hops', async () => {
  const { page, hops } = await liveFetch(baseReq(), twoHop(
    [sampleAdvertiser(), { type: 'ads_multi_account_advertiser', title: 'Nested Co', ads: [{ advertiser_id: 'AR00000000000000000001', title: 'Nested Co' }] }],
    [sampleAd()]
  ));
  assert.strictEqual(page.ok, true);
  assert.strictEqual(hops.length, 2);
  assert.strictEqual(hops[0].url, google.ADVERTISERS_URL);
  assert.strictEqual(hops[1].url, google.ADS_SEARCH_URL);
  assert.strictEqual(hops[0].method, 'POST');
  assert.strictEqual(hops[0].headers.Authorization, BASIC);
  assert.strictEqual(hops[1].headers.Authorization, BASIC);
  assert.doesNotMatch(hops[0].url, /login|password|token/i);
  assert.doesNotMatch(JSON.stringify(hops[0].body), new RegExp(TOKEN));
  assert.strictEqual(hops[0].timeoutMs, REQUEST_TIMEOUT_MS);
  assert.strictEqual(hops[0].maxBodyBytes, MAX_BODY_BYTES);
  const advBody = JSON.parse(hops[0].body);
  assert.strictEqual(Array.isArray(advBody), true);
  assert.strictEqual(advBody.length, 1);
  assert.strictEqual(advBody[0].keyword, 'jackets');
  assert.strictEqual(advBody[0].location_code, 2840);
  const searchBody = JSON.parse(hops[1].body);
  assert.ok(searchBody[0].advertiser_ids.includes('AR11122233344455566677'));
  assert.ok(searchBody[0].depth <= 40);
  assert.strictEqual(page.evidence.length, 1);
  assert.strictEqual(page.competitors.length, 1);
  assert.strictEqual(page.assets.length, 0);
  assert.strictEqual(page.evidence[0].platform, 'google');
  assert.strictEqual(page.evidence[0].connector_id, 'google_research');
  assert.strictEqual(page.evidence[0].connector_version, '1.0.0');
  assert.strictEqual(page.evidence[0].tenant_id, 9);
  assert.strictEqual(page.evidence[0].research_run_id, 'run-google-live-001');
  assert.strictEqual(page.evidence[0].provider_external_id, 'CR99988877766655544433');
  assert.strictEqual(page.competitors[0].provider_advertiser_id, 'AR11122233344455566677');
  assert.strictEqual(page.competitors[0].canonical_url, 'https://adstransparency.google.com/advertiser/AR11122233344455566677');
  assert.strictEqual(page.evidence[0].canonical_source_url, 'https://adstransparency.google.com/advertiser/AR11122233344455566677/creative/CR99988877766655544433');
  assert.strictEqual(page.evidence[0].provenance_method, 'ads_transparency_center');
  assert.strictEqual(page.competitors[0].discovery_source, 'ads_transparency_center');
  assert.strictEqual(page.evidence[0].source_type, 'ad_copy');
  assert.strictEqual(page.evidence[0].creative_format, 'text');
  assert.strictEqual(page.evidence[0].provider_metrics.source, 'live');
  assert.notStrictEqual(page.evidence[0].provider_metrics._fabricated, true);
  assert.strictEqual(page.evidence[0].metrics_kind, 'estimated');
  assert.strictEqual(page.continuation_state.honesty_class, 'live');
  assert.equal(Object.prototype.hasOwnProperty.call(page.continuation_state, 'source'), false);
  assert.ok(!Object.prototype.hasOwnProperty.call(page.evidence[0], 'raw_payload'));
  assertPageHonesty({ mode: 'live', page });
  assertConnectorResult(page, { tenantId: 9 });
  assertNoSecrets(page);
});

test('2. a full first ads_search page is terminal; crafted cursor still detects loops', async () => {
  const hops = [];
  const first = await google.fetchPage(baseReq({
    search_parameters: { query: 'jackets', countries: ['US'], max_results_per_page: 1 },
    idempotency_key: 'ik-pg1',
  }), {
    tenantId: 9, token: TOKEN, mode: 'live',
    transport: async (opts) => {
      hops.push(opts);
      return twoHop([sampleAdvertiser()], [sampleAd()])(opts);
    },
  });
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.evidence.length, 1);
  assert.strictEqual(first.page.has_more, false);
  assert.strictEqual(first.page.next_cursor, null);
  assert.strictEqual(first.continuation_state.cursor, null);
  const crafted = google.bindGoogleCursor(9, 'run-google-live-001', {
    ids: ['AR11122233344455566677'], tgt: '', p: 1, f: 'CR99988877766655544433',
  });
  assert.ok(crafted);
  const decoded = google.unbindGoogleCursor(crafted, 9, 'run-google-live-001');
  assert.strictEqual(decoded.ok, true);
  assert.strictEqual(decoded.state.p, 1);
  assert.ok(decoded.state.ids.includes('AR11122233344455566677'));
  const advanced = await google.fetchPage(baseReq({
    cursor: crafted,
    search_parameters: { query: 'jackets', countries: ['US'], max_results_per_page: 1 },
    idempotency_key: 'ik-pg2',
  }), {
    tenantId: 9, token: TOKEN, mode: 'live',
    transport: async (opts) => {
      hops.push(opts);
      assert.ok(isAdsSearch(opts.url));
      return liveHop(dfsOk([sampleAd({ creative_id: 'CR11111111111111111111', title: 'Page two' })]));
    },
  });
  assert.strictEqual(advanced.ok, true);
  assert.strictEqual(advanced.evidence[0].provider_external_id, 'CR11111111111111111111');
  assert.strictEqual(advanced.page.has_more, false);
  assert.strictEqual(advanced.page.next_cursor, null);
  assert.ok(hops.filter((h) => isAdvertisers(h.url)).length === 1);
  const looped = await google.fetchPage(baseReq({
    cursor: crafted,
    search_parameters: { query: 'jackets', countries: ['US'], max_results_per_page: 1 },
    idempotency_key: 'ik-loop',
  }), {
    tenantId: 9, token: TOKEN, mode: 'live',
    transport: async (opts) => liveHop(dfsOk([sampleAd()])),
  });
  assert.strictEqual(looped.ok, false);
  assert.strictEqual(looped.error, 'invalid_response');
  assert.match(looped.message, /repeated_continuation_token/);
  for (const hop of hops) {
    assert.match(hop.url, /^https:\/\/api\.dataforseo\.com\//);
    assert.doesNotMatch(hop.url, /adstransparency\.google\.com/);
    assert.doesNotMatch(hop.url, /evil\.example/);
  }
  assertNoSecrets(first);
  assertNoSecrets(advanced);
});

test('3. idempotent replay yields the same fingerprints', async () => {
  const hop = twoHop([sampleAdvertiser()], [sampleAd()]);
  const a = (await liveFetch(baseReq({ idempotency_key: 'ik-a' }), hop)).page;
  const b = (await liveFetch(baseReq({ idempotency_key: 'ik-b' }), hop)).page;
  assert.strictEqual(a.evidence[0].content_fingerprint, b.evidence[0].content_fingerprint);
  assert.strictEqual(a.evidence[0].dedup_key, b.evidence[0].dedup_key);
  assert.strictEqual(a.evidence[0].id, b.evidence[0].id);
});

test('4. empty live results stay live and never become fixture', async () => {
  const emptyAdv = (await liveFetch(baseReq({ idempotency_key: 'ik-empty-adv' }), twoHop([], []))).page;
  assert.strictEqual(emptyAdv.ok, true);
  assert.strictEqual(emptyAdv.evidence.length, 0);
  assert.strictEqual(emptyAdv.page.has_more, false);
  assert.strictEqual(emptyAdv.page.next_cursor, null);
  assert.strictEqual(emptyAdv.continuation_state.honesty_class, 'live');
  assert.notStrictEqual(emptyAdv.continuation_state.honesty_class, 'fixture');
  const emptyAds = (await liveFetch(baseReq({ idempotency_key: 'ik-empty-ads' }), twoHop([sampleAdvertiser()], []))).page;
  assert.strictEqual(emptyAds.ok, true);
  assert.strictEqual(emptyAds.evidence.length, 0);
  assert.strictEqual(emptyAds.page.has_more, false);
  assert.strictEqual(emptyAds.page.next_cursor, null);
  assert.strictEqual(emptyAds.continuation_state.honesty_class, 'live');
  const none = (await liveFetch(baseReq({ idempotency_key: 'ik-40102' }), (opts) => {
    if (isAdvertisers(opts.url)) {
      return liveHop({ status_code: 20000, tasks: [{ status_code: 40102, result: null }] });
    }
    throw new Error('must-not-search');
  })).page;
  assert.strictEqual(none.ok, true);
  assert.strictEqual(none.evidence.length, 0);
  assert.strictEqual(none.continuation_state.honesty_class, 'live');
});

test('5. malformed and oversized provider bodies fail closed', async () => {
  const malformed = (await liveFetch(baseReq({ idempotency_key: 'ik-mal' }), {
    ok: true, status: 200, json: null, malformed: true,
  })).page;
  assert.strictEqual(malformed.error, 'invalid_response');
  assert.match(malformed.message, /malformed_provider_response/);
  const oversized = (await liveFetch(baseReq({ idempotency_key: 'ik-big' }), {
    ok: true, status: 200, json: null, oversized: true,
  })).page;
  assert.strictEqual(oversized.error, 'invalid_response');
  assert.match(oversized.message, /oversized_provider_response/);
  const viaPage = (await liveFetch(baseReq({ idempotency_key: 'ik-ep' }), {
    ok: false, errorPage: connectorErrorPage('invalid_response', 'oversized_provider_response'),
  })).page;
  assert.match(viaPage.message, /oversized_provider_response/);
});

test('6. missing and dummy DataForSEO creds fail closed with no hop', async () => {
  for (const [login, password] of [
    [undefined, undefined],
    ['_DUMMY_login', 'real-pass'],
    ['real-login', '_DUMMY_pass'],
  ]) {
    if (login == null) {
      delete process.env.DATAFORSEO_LOGIN;
      delete process.env.DATAFORSEO_PASSWORD;
    } else {
      process.env.DATAFORSEO_LOGIN = login;
      process.env.DATAFORSEO_PASSWORD = password;
    }
    let calls = 0;
    const page = await google.fetchPage(baseReq({ idempotency_key: `ik-cred-${login || 'none'}` }), {
      tenantId: 9, token: TOKEN, mode: 'live',
      transport: async () => { calls += 1; return liveHop(dfsOk([])); },
    });
    assert.strictEqual(page.ok, false);
    assert.strictEqual(page.error, 'auth_failure');
    assert.match(page.message, /missing_credentials/);
    assert.strictEqual(calls, 0);
  }
  installTestKeys();
  let tokenCalls = 0;
  const noToken = await google.fetchPage(baseReq({ idempotency_key: 'ik-notoken' }), {
    tenantId: 9, mode: 'live',
    transport: async () => { tokenCalls += 1; return liveHop(dfsOk([])); },
  });
  assert.strictEqual(noToken.error, 'auth_failure');
  assert.match(noToken.message, /missing_credentials/);
  assert.strictEqual(tokenCalls, 0);
});

test('7. 401, 403, 429+Retry-After, timeout, and 5xx map correctly', async () => {
  for (const [status, error, message] of [
    [401, 'auth_failure', /provider_auth_rejected/],
    [403, 'policy_rejection', /provider_permission_denied/],
  ]) {
    let calls = 0;
    const page = await google.fetchPage(baseReq({ idempotency_key: `ik-${status}` }), {
      tenantId: 9, token: TOKEN, mode: 'live',
      transport: async () => {
        calls += 1;
        return { ok: true, status, json: { status_code: status === 401 ? 40100 : 40200 } };
      },
    });
    assert.strictEqual(page.ok, false);
    assert.strictEqual(page.error, error);
    assert.match(page.message, message);
    assert.strictEqual(page.retry_class, 'terminal');
    assert.strictEqual(calls, 1);
  }
  const limited = (await liveFetch(baseReq({ idempotency_key: 'ik-rl' }), {
    ok: true, status: 429, json: null, retryAfterMs: parseRetryAfter('2'),
  })).page;
  assert.strictEqual(limited.error, 'rate_limit');
  assert.strictEqual(limited.retry_after_ms, 2000);
  const timed = await google.fetchPage(baseReq({ idempotency_key: 'ik-to' }), {
    tenantId: 9, token: TOKEN, mode: 'live',
    transport: async () => { throw new Error('timeout'); },
  });
  assert.strictEqual(timed.error, 'transient');
  const ac = new AbortController();
  ac.abort();
  let abortCalls = 0;
  const cancelled = await google.fetchPage(baseReq({ idempotency_key: 'ik-ab' }), {
    tenantId: 9, token: TOKEN, mode: 'live', signal: ac.signal,
    transport: async () => { abortCalls += 1; return liveHop(dfsOk([])); },
  });
  assert.strictEqual(cancelled.error, 'terminal');
  assert.match(cancelled.message, /cancelled/);
  assert.strictEqual(abortCalls, 0);
});

test('8. runtime retry budget exhausts; repeated-token loop is terminal', async () => {
  let calls = 0;
  const sleeps = [];
  const runtime = createResearchRuntime({
    mode: 'live',
    now: () => 1,
    random: () => 0,
    sleep: async (ms) => { sleeps.push(ms); },
    resolveSecret: async () => TOKEN,
    transport: async () => {
      calls += 1;
      return { ok: true, status: 503, json: null };
    },
  });
  const retried = await runtime.fetchPage(baseReq({ idempotency_key: 'ik-5xx' }), {
    tenantId: 9, userId: 4, credentialRef: 'user_integrations',
  });
  assert.strictEqual(retried.error, 'transient');
  assert.strictEqual(calls, MAX_RETRIES + 1);
  let rlCalls = 0;
  const rlRuntime = createResearchRuntime({
    mode: 'live',
    now: () => 1,
    random: () => 0,
    sleep: async () => {},
    resolveSecret: async () => TOKEN,
    transport: async () => {
      rlCalls += 1;
      return { ok: true, status: 429, retryAfterMs: 1500, json: { status_code: 40501 } };
    },
  });
  const rl = await rlRuntime.fetchPage(baseReq({ idempotency_key: 'ik-rl-rt' }), {
    tenantId: 9, userId: 4, credentialRef: 'user_integrations',
  });
  assert.strictEqual(rl.error, 'rate_limit');
  assert.strictEqual(rlCalls, MAX_RETRIES + 1);
  const bound = google.bindGoogleCursor(9, 'run-google-live-001', {
    ids: ['AR11122233344455566677'], tgt: '', p: 1, f: 'CR99988877766655544433',
  });
  const looped = (await liveFetch(baseReq({ cursor: bound, idempotency_key: 'ik-rep' }), liveHop(dfsOk([sampleAd()])))).page;
  assert.strictEqual(looped.error, 'invalid_response');
  assert.match(looped.message, /repeated_continuation_token/);
  assert.strictEqual(looped.retry_class, 'terminal');
});

test('9. tenant isolation rejects a foreign cursor and binds evidence tenant', async () => {
  const bound = google.bindGoogleCursor(9, 'run-google-live-001', {
    ids: ['AR11122233344455566677'], tgt: '', p: 1, f: 'prev',
  });
  const rejected = await google.fetchPage(baseReq({
    tenant_id: 11,
    research_run_id: 'run-google-live-001',
    cursor: bound,
    idempotency_key: 'ik-ten',
  }), {
    tenantId: 11, token: TOKEN, mode: 'live',
    transport: async () => { throw new Error('must-not-fetch'); },
  });
  assert.strictEqual(rejected.ok, false);
  assert.strictEqual(rejected.error, 'invalid_response');
  assert.match(rejected.message, /invalid_pagination_cursor/);
  const raw = await google.fetchPage(baseReq({ cursor: 'unbound-google-cursor', idempotency_key: 'ik-raw' }), {
    tenantId: 9, token: TOKEN, mode: 'live',
    transport: async () => { throw new Error('must-not-fetch'); },
  });
  assert.strictEqual(raw.ok, false);
  assert.match(raw.message, /invalid_pagination_cursor/);
  const ok = (await liveFetch(baseReq({ tenant_id: 11, idempotency_key: 'ik-t11' }), twoHop([sampleAdvertiser()], [sampleAd()]), { tenantId: 11 })).page;
  assert.strictEqual(ok.evidence[0].tenant_id, 11);
});

test('10. approval/run binding rejects a foreign-run cursor', async () => {
  const foreign = google.bindGoogleCursor(9, 'run-other', {
    ids: ['AR11122233344455566677'], tgt: '', p: 1, f: 'prev',
  });
  const page = await google.fetchPage(baseReq({ cursor: foreign, idempotency_key: 'ik-run' }), {
    tenantId: 9, token: TOKEN, mode: 'live',
    transport: async () => { throw new Error('must-not-fetch'); },
  });
  assert.strictEqual(page.ok, false);
  assert.match(page.message, /invalid_pagination_cursor/);
  const ok = (await liveFetch(baseReq(), twoHop([sampleAdvertiser()], [sampleAd()]))).page;
  assert.strictEqual(ok.evidence[0].research_run_id, 'run-google-live-001');
});

test('14. fixture tagging is still fixture', async () => {
  const fixture = await google.fetchPage(baseReq({ idempotency_key: 'ik-hon-f' }), {
    tenantId: 9, token: 'fixture-token', mode: 'fixture',
    transport: async () => ({ ok: true, status: 200 }),
  });
  assert.strictEqual(fixture.ok, true);
  assert.strictEqual(fixture.evidence[0].provider_metrics.source, 'fixture');
  assert.strictEqual(fixture.evidence[0].provider_metrics._fabricated, true);
  assert.strictEqual(fixture.continuation_state.honesty_class, 'fixture');
});

test('15. live mode refuses fixture tags; empty/error live never returns a fixture page', async () => {
  const live = (await liveFetch(baseReq({ idempotency_key: 'ik-hon-l' }), twoHop([sampleAdvertiser()], [sampleAd()]))).page;
  assert.strictEqual(live.evidence[0].provider_metrics.source, 'live');
  assert.notStrictEqual(live.evidence[0].provider_metrics._fabricated, true);
  assert.strictEqual(live.continuation_state.honesty_class, 'live');
  const empty = (await liveFetch(baseReq({ idempotency_key: 'ik-hon-e' }), twoHop([], []))).page;
  assert.strictEqual(empty.ok, true);
  assert.strictEqual(empty.continuation_state.honesty_class, 'live');
  assert.notStrictEqual(empty.continuation_state.honesty_class, 'fixture');
  const failed = (await liveFetch(baseReq({ idempotency_key: 'ik-hon-err' }), {
    ok: true, status: 401, json: { status_code: 40100 },
  })).page;
  assert.strictEqual(failed.ok, false);
  assert.notStrictEqual(failed.continuation_state && failed.continuation_state.honesty_class, 'fixture');
  assert.ok(!failed.evidence);
});

test('16. host allowlist is DataForSEO only; ATC and preview URLs are never fetched', async () => {
  assert.strictEqual(hostAllowed('google_research', 'api.dataforseo.com'), true);
  assert.strictEqual(hostAllowed('google_research', 'adstransparency.google.com'), false);
  assert.strictEqual(hostAllowed('google_research', 'evil.example'), false);
  const { hops, page } = await liveFetch(baseReq(), twoHop([sampleAdvertiser()], [sampleAd({
    url: 'https://adstransparency.google.com/advertiser/AR11122233344455566677/creative/CR99988877766655544433',
    preview_url: 'https://adstransparency.google.com/preview?id=1',
    preview_image: { url: 'https://evil.example/img.jpg' },
  })]));
  assert.strictEqual(page.ok, true);
  for (const hop of hops) {
    assert.match(hop.url, /^https:\/\/api\.dataforseo\.com\//);
    assert.doesNotMatch(hop.url, /adstransparency\.google\.com/);
    assert.doesNotMatch(hop.url, /evil\.example/);
    assert.doesNotMatch(hop.url, /preview/);
  }
  const mapped = google.mapDfsHttpError({ status: 200, json: { status_code: 40100 } });
  assert.strictEqual(mapped.error, 'auth_failure');
});

test('17. Authorization Basic is sent and redacted; Google token is never upstream', async () => {
  const { page, hops } = await liveFetch(baseReq(), twoHop([sampleAdvertiser()], [sampleAd()]));
  assertNoSecrets(page);
  assert.ok(hops[0].headers.Authorization.startsWith('Basic '));
  assert.strictEqual(hops[0].headers.Authorization, BASIC);
  assert.notStrictEqual(hops[0].headers.Authorization, `Bearer ${TOKEN}`);
  const redacted = redactSecrets({
    authorization: hops[0].headers.Authorization,
    password: DFS_PASSWORD,
    Authorization: hops[0].headers.Authorization,
    nested: { Authorization: BASIC },
  });
  assert.strictEqual(redacted.authorization, '[redacted]');
  assert.strictEqual(redacted.password, '[redacted]');
  assert.strictEqual(redacted.Authorization, '[redacted]');
  assert.strictEqual(redacted.nested.Authorization, '[redacted]');
  assert.doesNotMatch(JSON.stringify(redacted), new RegExp(DFS_PASSWORD));
  assert.doesNotMatch(JSON.stringify(redacted), /Basic /i);
});

test('unknown country omits location_code; multi-country does not invent geography', async () => {
  const { hops, page } = await liveFetch(baseReq({
    idempotency_key: 'ik-geo',
    search_parameters: { query: 'jackets', countries: ['US', 'GB'], lookback_days: 30, max_results_per_page: 10 },
  }), twoHop([sampleAdvertiser()], [sampleAd()]));
  assert.strictEqual(JSON.parse(hops[0].body)[0].location_code, 2840);
  for (const row of page.competitors) {
    assert.strictEqual(row.country, null);
    assert.strictEqual(row.market, null);
  }
  for (const ev of page.evidence) {
    assert.strictEqual(ev.market, null);
  }
  const unknown = await liveFetch(baseReq({
    idempotency_key: 'ik-xx',
    search_parameters: { query: 'jackets', countries: ['ZZ'], max_results_per_page: 10 },
  }), twoHop([sampleAdvertiser()], [sampleAd()]));
  assert.equal(Object.prototype.hasOwnProperty.call(JSON.parse(unknown.hops[0].body)[0], 'location_code'), false);
  for (const row of unknown.page.competitors) {
    assert.strictEqual(row.country, null);
    assert.strictEqual(row.market, null);
  }
  for (const ev of unknown.page.evidence) {
    assert.strictEqual(ev.country == null, true);
    assert.strictEqual(ev.market, null);
  }
  const supported = await liveFetch(baseReq({
    idempotency_key: 'ik-us',
    search_parameters: { query: 'jackets', countries: ['US'], max_results_per_page: 10 },
  }), twoHop([sampleAdvertiser()], [sampleAd()]));
  assert.strictEqual(JSON.parse(supported.hops[0].body)[0].location_code, 2840);
  assert.strictEqual(supported.page.competitors[0].country, 'US');
  assert.strictEqual(supported.page.competitors[0].market, 'US');
  assert.strictEqual(supported.page.evidence[0].market, 'US');
});

test('domain query can use target; missing query fails closed; no new /api prefix', async () => {
  const { hops, page } = await liveFetch(baseReq({
    idempotency_key: 'ik-dom',
    search_parameters: { query: 'example.com', countries: ['US'], max_results_per_page: 10 },
  }), (opts) => {
    if (isAdvertisers(opts.url)) return liveHop(dfsOk([]));
    return liveHop(dfsOk([sampleAd()]));
  });
  assert.strictEqual(page.ok, true);
  assert.strictEqual(JSON.parse(hops[1].body)[0].target, 'example.com');
  let calls = 0;
  const missing = await google.fetchPage(baseReq({
    search_parameters: { countries: ['US'] },
    idempotency_key: 'ik-nq',
  }), {
    tenantId: 9, token: TOKEN, mode: 'live',
    transport: async () => { calls += 1; return liveHop(dfsOk([])); },
  });
  assert.strictEqual(missing.error, 'policy_rejection');
  assert.match(missing.message, /search_query_required/);
  assert.strictEqual(calls, 0);
  const src = fs.readFileSync(path.join(ROOT, 'services/agent_orchestrator/connectors/google_research.js'), 'utf8');
  assert.doesNotMatch(src, /router\.(get|post|put|delete|use)\(/);
  assert.doesNotMatch(src, /app\.(get|post|put|delete)\(/);
  assert.doesNotMatch(src, /prefix:\s*'\/api\//);
  assert.doesNotMatch(src, /adstransparency\.google\.com\/rpc|puppeteer|playwright|perplexity/i);
  assert.throws(
    () => assertSearchParameters({ query: 'x', access_token: TOKEN }),
    (err) => err && err.code === 'validation_failed'
  );
  assert.throws(
    () => assertConnectorRequest(baseReq({ search_parameters: { query: 'x', access_token: TOKEN } }), { tenantId: 9 }),
    (err) => err && err.code === 'validation_failed'
  );
});

const liveSmoke = process.env.INFOGENIE_LIVE_GOOGLE_RESEARCH === '1'
  && !!ORIG_LOGIN
  && !!ORIG_PASSWORD
  && !/^_DUMMY/i.test(String(ORIG_LOGIN))
  && !/^_DUMMY/i.test(String(ORIG_PASSWORD));

test('opt-in live DataForSEO Google research smoke', {
  skip: liveSmoke ? false : 'INFOGENIE_LIVE_GOOGLE_RESEARCH / real DATAFORSEO_* unset',
}, async () => {
  restoreKeys();
  const { defaultTransport } = require('../services/agent_orchestrator/connectors/transport');
  const page = await google.fetchPage(baseReq({
    idempotency_key: 'ik-live-smoke',
    search_parameters: { query: 'shoes', countries: ['US'], lookback_days: 7, max_results_per_page: 1 },
  }), {
    tenantId: 9,
    token: TOKEN,
    mode: 'live',
    transport: defaultTransport,
  });
  const dumped = JSON.stringify(page);
  assert.doesNotMatch(dumped, new RegExp(String(ORIG_PASSWORD).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(dumped, /Authorization/i);
  if (page.ok) {
    assert.strictEqual(page.continuation_state.honesty_class, 'live');
    for (const ev of page.evidence) {
      assert.strictEqual(ev.provider_metrics.source, 'live');
      assert.notStrictEqual(ev.provider_metrics._fabricated, true);
    }
  } else {
    assert.ok(page.error);
    assert.doesNotMatch(String(page.message || ''), new RegExp(String(ORIG_PASSWORD).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  installTestKeys();
});

let dbHarness = null;
try {
  dbHarness = require('./helpers');
} catch (_) {
  dbHarness = null;
}

const HAS_DB = !!(dbHarness && dbHarness.hasDb());

if (!HAS_DB) {
  test('11–13 persistPage / cancel / lease skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else {
  const db = require('../db');
  const { ensureTenantSchema } = require('../services/tenants/schema');
  const { ensureAgentOrchestratorSchema } = require('../services/agent_orchestrator/schema');
  const { ensureResearchLimits } = require('../services/agent_orchestrator/research_store');
  const {
    startResearchRun, cancelResearchRun, persistPage, executeResearchRun,
  } = require('../services/agent_orchestrator/research_ingest');
  const { acquireLease, releaseLease } = require('../services/agent_orchestrator/leases');

  const fx = dbHarness.makeFixtures();
  let app;
  let tenantA;
  let ownerA;
  let cookieA;

  function orch(method, urlPath, { cookie, body, headers } = {}) {
    return dbHarness.request(app.baseUrl, method, `/api/agent-orchestrator/workflows${urlPath}`, {
      cookie, body, headers,
    });
  }

  async function approvedWorkflow() {
    const created = await orch('POST', '', {
      cookie: cookieA,
      body: {
        name: 'Google live host',
        objective: 'Collect public ads',
        product_or_service: 'Analytics',
        offer: 'Trial',
        landing_page_url: 'https://example.com/trial',
        target_markets: ['US'],
        target_audiences: ['SMB'],
        selected_platforms: ['google'],
        advertising_budget: 100,
        currency: 'USD',
      },
      headers: { 'Idempotency-Key': `ik-c-${crypto.randomBytes(4).toString('hex')}` },
    });
    assert.ok(created.json && created.json.ok, created.text);
    let wf = created.json.workflow;
    const reqd = await orch('POST', `/${wf.id}/request-approval`, {
      cookie: cookieA, body: { gate: 'research_execution' },
      headers: { 'Idempotency-Key': `ik-ra-${crypto.randomBytes(4).toString('hex')}` },
    });
    wf = reqd.json.workflow;
    const appr = await orch('POST', `/${wf.id}/approve`, {
      cookie: cookieA,
      body: {
        gate: 'research_execution',
        object_type: 'workflow',
        object_id: wf.id,
        object_version: wf.version,
        platforms: wf.selected_platforms,
        advertising_budget: wf.advertising_budget,
        credit_ceiling: 0,
        comment: 'ok',
      },
      headers: { 'Idempotency-Key': `ik-ap-${crypto.randomBytes(4).toString('hex')}` },
    });
    assert.strictEqual(appr.status, 200, appr.text);
    return appr.json.workflow;
  }

  before(async () => {
    await fx.ensureSchemas();
    await ensureTenantSchema();
    await ensureAgentOrchestratorSchema();
    tenantA = await fx.seedTenant('Google live A');
    ownerA = await fx.seedUser({ tenantId: tenantA.id, owner: true });
    await ensureResearchLimits(db.getPool(), tenantA.id, { records: 1000, bytes: 104857600 });
    app = await dbHarness.bootApp();
    cookieA = (await dbHarness.login(app.baseUrl, ownerA.email, ownerA.password)).cookie;
  });

  after(async () => {
    if (app) await app.close();
    if (tenantA && db.hasDb()) {
      await db.getPool().query('DELETE FROM tenants WHERE id = $1', [tenantA.id]);
    }
    await fx.cleanup();
  });

  async function runningHost(searchParameters) {
    const wf = await approvedWorkflow();
    const created = await startResearchRun(db.getPool(), {
      tenantId: tenantA.id,
      userId: ownerA.id,
      workflowId: wf.id,
      requestedPlatforms: ['google'],
      searchParameters: searchParameters || { query: 'jackets', countries: ['US'], max_results_per_page: 1 },
      idempotencyKey: `ik-gl-${crypto.randomBytes(4).toString('hex')}`,
      credentialRefs: { google_research: 'user_integrations' },
      execute: false,
    });
    await db.getPool().query(
      `UPDATE orchestrator_research_runs SET state='running', started_at=now()
        WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, created.run.id]
    );
    const lease = await acquireLease(db.getPool(), tenantA.id, wf.id, { actorUserId: ownerA.id });
    return { wf, run: created.run, lease };
  }

  test('3+13. persistPage accepts a live page and skips unique replays', async () => {
    const host = await runningHost();
    const fetched = (await liveFetch(baseReq({
      tenant_id: tenantA.id,
      research_run_id: host.run.id,
      workflow_id: host.wf.id,
      approval_id: host.run.approval_id,
      approval_object_version: host.run.approval_object_version,
      idempotency_key: `ik-pers-${host.run.id}`,
    }), twoHop([sampleAdvertiser({ advertiser_id: `AR-${host.run.id}`.slice(0, 24) })], [sampleAd({
      advertiser_id: `AR-${host.run.id}`.slice(0, 24),
      creative_id: `CR-${host.run.id}`.slice(0, 24),
    })]), { tenantId: tenantA.id })).page;
    const ctx = {
      tenantId: tenantA.id,
      runId: host.run.id,
      workflowId: host.wf.id,
      holder: host.lease.holder,
      mode: 'live',
      version: host.run.approval_object_version,
      approval_object_version: host.run.approval_object_version,
    };
    const first = await persistPage(db.getPool(), fetched, ctx);
    assert.strictEqual(first.stale, false);
    assert.ok(first.records >= 1);
    const replay = await persistPage(db.getPool(), fetched, ctx);
    assert.strictEqual(replay.stale, false);
    assert.strictEqual(replay.records, 0);
    const ev = await db.getPool().query(
      `SELECT provider_metrics, metrics_kind FROM orchestrator_research_evidence
        WHERE tenant_id=$1 AND research_run_id=$2`,
      [tenantA.id, host.run.id]
    );
    assert.ok(ev.rowCount >= 1);
    assert.strictEqual(ev.rows[0].provider_metrics.source, 'live');
    assert.notStrictEqual(ev.rows[0].provider_metrics._fabricated, true);
    await releaseLease(db.getPool(), tenantA.id, host.wf.id, host.lease.holder);
  });

  test('11. cancel / lost lease between pages prevents stale writes', async () => {
    const host = await runningHost();
    const page = (await liveFetch(baseReq({
      tenant_id: tenantA.id,
      research_run_id: host.run.id,
      workflow_id: host.wf.id,
      approval_id: host.run.approval_id,
      approval_object_version: host.run.approval_object_version,
      idempotency_key: `ik-stale-${host.run.id}`,
    }), twoHop([
      sampleAdvertiser({ advertiser_id: `ARa-${host.run.id}`.slice(0, 24), title: 'A Co' }),
      sampleAdvertiser({ advertiser_id: `ARb-${host.run.id}`.slice(0, 24), title: 'B Co' }),
    ], [
      sampleAd({ advertiser_id: `ARa-${host.run.id}`.slice(0, 24), creative_id: `CRa-${host.run.id}`.slice(0, 24) }),
      sampleAd({ advertiser_id: `ARb-${host.run.id}`.slice(0, 24), creative_id: `CRb-${host.run.id}`.slice(0, 24), title: 'B Co' }),
    ]), { tenantId: tenantA.id })).page;
    const cancelled = await persistPage(db.getPool(), page, {
      tenantId: tenantA.id,
      runId: host.run.id,
      workflowId: host.wf.id,
      holder: host.lease.holder,
      mode: 'live',
      version: host.run.approval_object_version,
      approval_object_version: host.run.approval_object_version,
      beforeWrite: async ({ records }) => {
        if (records === 1) await cancelResearchRun(db.getPool(), tenantA.id, host.run.id);
      },
    });
    assert.strictEqual(cancelled.stale, true);
    const ev = await db.getPool().query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND research_run_id=$2`,
      [tenantA.id, host.run.id]
    );
    assert.strictEqual(ev.rowCount, 0);
  });

  test('12. full ads_search page + max_pages: 2 completes without a second hop', async () => {
    const host = await runningHost({
      query: 'jackets',
      countries: ['US'],
      max_results_per_page: 1,
      max_pages: 2,
    });
    let adsSearchHops = 0;
    const runtime = createResearchRuntime({
      mode: 'live',
      resolveSecret: async () => TOKEN,
      transport: async (opts) => {
        if (isAdvertisers(opts.url)) return liveHop(dfsOk([sampleAdvertiser()]));
        adsSearchHops += 1;
        if (adsSearchHops > 1) throw new Error('must-not-request-second-ads-search');
        return liveHop(dfsOk([sampleAd({ creative_id: `pg1-${host.run.id}`.slice(0, 24) })]));
      },
    });
    const finished = await executeResearchRun(db.getPool(), {
      tenantId: tenantA.id,
      runId: host.run.id,
      userId: ownerA.id,
      holder: host.lease.holder,
      runtime,
      credentialRefs: { google_research: 'user_integrations' },
      betweenPages: async () => {
        throw new Error('must-not-paginate');
      },
    });
    assert.strictEqual(finished.state, 'completed');
    assert.notStrictEqual(finished.error_code, 'repeated_continuation_token');
    assert.strictEqual(adsSearchHops, 1);
    const ev = await db.getPool().query(
      `SELECT provider_external_id FROM orchestrator_research_evidence
        WHERE tenant_id=$1 AND research_run_id=$2`,
      [tenantA.id, host.run.id]
    );
    assert.ok(ev.rowCount >= 1);
    for (const row of ev.rows) {
      assert.notStrictEqual(row.provider_external_id, `pg2-${host.run.id}`.slice(0, 24));
    }
    await releaseLease(db.getPool(), tenantA.id, host.wf.id, host.lease.holder);
  });
}
