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
const tiktok = require('../services/agent_orchestrator/connectors/tiktok_research');

const TOKEN = 'tiktok-research-token-ABCDEF123456';
const ROOT = path.join(__dirname, '..');

function baseReq(over) {
  return {
    connector_id: 'tiktok_research',
    connector_version: '1.0.0',
    contract_version: 'v1',
    tenant_id: 9,
    research_run_id: 'run-tiktok-live-001',
    workflow_id: 'wf-tiktok-live-001',
    approval_id: 1,
    approval_object_version: 1,
    requested_platforms: ['tiktok'],
    idempotency_key: 'ik-tiktok-live-001',
    search_parameters: { query: 'jackets', countries: ['US'], lookback_days: 30, max_results_per_page: 10 },
    ...over,
  };
}

function sampleAd(over) {
  const ad = {
    id: '1923845247192304',
    title: 'Trail coats',
    first_shown_date: '20260801',
    last_shown_date: '20260820',
    external_url: 'https://example.com/coats',
  };
  const advertiser = {
    business_id: '1755645247067185',
    business_name: 'Acme Coats',
    country_code: 'US',
  };
  const extra = over || {};
  return {
    ad: { ...ad, ...(extra.ad || {}) },
    advertiser: { ...advertiser, ...(extra.advertiser || {}) },
    ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'ad' && k !== 'advertiser')),
  };
}

function adlibOk(ads, over) {
  return {
    data: {
      ads,
      has_more: false,
      search_id: 'sid-page-1',
      ...(over || {}),
    },
    error: { code: 'ok', message: '', log_id: 'log-1' },
  };
}

function liveHop(json, over) {
  return { ok: true, status: 200, json, headers: {}, rate_limit: null, ...over };
}

async function liveFetch(req, hopOrFn, ctxOver) {
  const hops = [];
  const page = await tiktok.fetchPage(req, {
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

function assertNoSecrets(value) {
  const dumped = typeof value === 'string' ? value : JSON.stringify(value);
  assert.doesNotMatch(dumped, new RegExp(TOKEN));
  assert.doesNotMatch(dumped, /Bearer /i);
}

function hopBody(hop) {
  return JSON.parse(hop.body);
}

test('1. live TikTok page normalizes documented fields and is ingestible', async () => {
  const { page, hops } = await liveFetch(baseReq(), liveHop(adlibOk([sampleAd()])));
  assert.strictEqual(page.ok, true);
  assert.strictEqual(hops.length, 1);
  assert.ok(hops[0].url.startsWith(tiktok.ADLIB_URL));
  assert.match(hops[0].url, /[?&]fields=/);
  assert.strictEqual(hops[0].method, 'POST');
  assert.strictEqual(hops[0].headers.Authorization, `Bearer ${TOKEN}`);
  assert.strictEqual(hops[0].timeoutMs, REQUEST_TIMEOUT_MS);
  assert.strictEqual(hops[0].maxBodyBytes, MAX_BODY_BYTES);
  const body = hopBody(hops[0]);
  assert.strictEqual(body.search_term, 'jackets');
  assert.strictEqual(body.max_count, 10);
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'search_id'), false);
  assert.strictEqual(body.filters.country_code, 'US');
  assert.strictEqual(body.filters.ad_published_date_range.min, '20260724');
  assert.strictEqual(body.filters.ad_published_date_range.max, '20260823');
  assert.doesNotMatch(hops[0].url, /library\.tiktok\.com|access_token|Bearer/);
  assert.doesNotMatch(JSON.stringify(body), new RegExp(TOKEN));
  assert.strictEqual(page.evidence.length, 1);
  assert.strictEqual(page.competitors.length, 1);
  assert.strictEqual(page.assets.length, 0);
  assert.strictEqual(page.evidence[0].platform, 'tiktok');
  assert.strictEqual(page.evidence[0].connector_id, 'tiktok_research');
  assert.strictEqual(page.evidence[0].connector_version, '1.0.0');
  assert.strictEqual(page.evidence[0].tenant_id, 9);
  assert.strictEqual(page.evidence[0].research_run_id, 'run-tiktok-live-001');
  assert.strictEqual(page.evidence[0].provider_external_id, '1923845247192304');
  assert.strictEqual(page.competitors[0].provider_advertiser_id, '1755645247067185');
  assert.strictEqual(page.competitors[0].discovery_source, 'public_profile');
  assert.strictEqual(page.evidence[0].canonical_source_url, 'https://library.tiktok.com/ads?id=1923845247192304');
  assert.strictEqual(page.competitors[0].canonical_url, 'https://library.tiktok.com/ads?advertiser=1755645247067185');
  assert.strictEqual(page.evidence[0].provenance_method, 'ad_library');
  assert.strictEqual(page.evidence[0].source_type, 'public_video');
  assert.strictEqual(page.evidence[0].headline, 'Trail coats');
  assert.strictEqual(page.evidence[0].provider_started_on, '2026-08-01');
  assert.strictEqual(page.evidence[0].provider_ended_on, '2026-08-20');
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

test('2. bound cursor pagination via search_id; never fetch library.tiktok.com', async () => {
  const hops = [];
  const first = await tiktok.fetchPage(baseReq({ idempotency_key: 'ik-pg1' }), {
    tenantId: 9, token: TOKEN, mode: 'live',
    transport: async (opts) => {
      hops.push(opts);
      return liveHop(adlibOk([sampleAd()], { has_more: true, search_id: 'sid-1' }));
    },
  });
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.page.has_more, true);
  assert.ok(first.page.next_cursor);
  const decoded = tiktok.unbindTikTokCursor(first.page.next_cursor, 9, 'run-tiktok-live-001');
  assert.strictEqual(decoded.ok, true);
  assert.strictEqual(decoded.searchId, 'sid-1');
  const second = await tiktok.fetchPage(baseReq({
    cursor: first.page.next_cursor,
    idempotency_key: 'ik-pg2',
  }), {
    tenantId: 9, token: TOKEN, mode: 'live',
    transport: async (opts) => {
      hops.push(opts);
      return liveHop(adlibOk([sampleAd({ ad: { id: '999888777' } })], { has_more: false, search_id: 'sid-2' }));
    },
  });
  assert.strictEqual(second.ok, true);
  assert.strictEqual(second.evidence[0].provider_external_id, '999888777');
  assert.equal(Object.prototype.hasOwnProperty.call(hopBody(hops[0]), 'search_id'), false);
  assert.strictEqual(hopBody(hops[1]).search_id, 'sid-1');
  for (const hop of hops) {
    assert.match(hop.url, /^https:\/\/open\.tiktokapis\.com\//);
    assert.doesNotMatch(hop.url, /library\.tiktok\.com|business-api\.tiktok\.com|evil\.example/);
  }
  assertNoSecrets(first);
  assertNoSecrets(second);
});

test('3. repeated search_id / first ad id → repeated_continuation_token', async () => {
  const first = (await liveFetch(baseReq({ idempotency_key: 'ik-loop-1' }), liveHop(adlibOk(
    [sampleAd()],
    { has_more: true, search_id: 'sid-loop' }
  )))).page;
  const sameSid = await tiktok.fetchPage(baseReq({
    cursor: first.page.next_cursor,
    idempotency_key: 'ik-loop-sid',
  }), {
    tenantId: 9, token: TOKEN, mode: 'live',
    transport: async () => liveHop(adlibOk([sampleAd({ ad: { id: '555' } })], { search_id: 'sid-loop' })),
  });
  assert.strictEqual(sameSid.ok, false);
  assert.strictEqual(sameSid.error, 'invalid_response');
  assert.match(sameSid.message, /repeated_continuation_token/);
  assert.strictEqual(sameSid.retry_class, 'terminal');
  const bound = tiktok.bindTikTokCursor(9, 'run-tiktok-live-001', 'sid-next', '1923845247192304');
  const sameFirst = (await liveFetch(baseReq({ cursor: bound, idempotency_key: 'ik-loop-f' }), liveHop(adlibOk(
    [sampleAd()],
    { search_id: 'sid-other' }
  )))).page;
  assert.strictEqual(sameFirst.error, 'invalid_response');
  assert.match(sameFirst.message, /repeated_continuation_token/);
});

test('4. idempotent replay yields the same fingerprints', async () => {
  const hop = liveHop(adlibOk([sampleAd()]));
  const a = (await liveFetch(baseReq({ idempotency_key: 'ik-a' }), hop)).page;
  const b = (await liveFetch(baseReq({ idempotency_key: 'ik-b' }), hop)).page;
  assert.strictEqual(a.evidence[0].content_fingerprint, b.evidence[0].content_fingerprint);
  assert.strictEqual(a.evidence[0].dedup_key, b.evidence[0].dedup_key);
  assert.strictEqual(a.evidence[0].id, b.evidence[0].id);
});

test('5. empty live results stay live and never become fixture', async () => {
  const empty = (await liveFetch(baseReq({ idempotency_key: 'ik-empty' }), liveHop(adlibOk([])))).page;
  assert.strictEqual(empty.ok, true);
  assert.strictEqual(empty.evidence.length, 0);
  assert.strictEqual(empty.continuation_state.honesty_class, 'live');
  assert.notStrictEqual(empty.continuation_state.honesty_class, 'fixture');
  assert.ok(!empty.evidence.some((ev) => ev.provider_metrics && ev.provider_metrics._fabricated));
});

test('6. malformed and oversized provider bodies fail closed', async () => {
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
  const noData = (await liveFetch(baseReq({ idempotency_key: 'ik-nodata' }), liveHop({
    error: { code: 'ok' },
  }))).page;
  assert.match(noData.message, /malformed_provider_response/);
});

test('7. missing and dummy tokens fail closed with no hop', async () => {
  for (const token of [undefined, '', '_DUMMY_tiktok', '_dummy_token']) {
    let calls = 0;
    const page = await tiktok.fetchPage(baseReq({ idempotency_key: `ik-tok-${token || 'none'}` }), {
      tenantId: 9, token, mode: 'live',
      transport: async () => { calls += 1; return liveHop(adlibOk([])); },
    });
    assert.strictEqual(page.ok, false);
    assert.strictEqual(page.error, 'auth_failure');
    assert.match(page.message, /missing_credentials/);
    assert.strictEqual(calls, 0);
  }
  let queryCalls = 0;
  const missingQuery = await tiktok.fetchPage(baseReq({
    search_parameters: { countries: ['US'] },
    idempotency_key: 'ik-nq',
  }), {
    tenantId: 9, token: TOKEN, mode: 'live',
    transport: async () => { queryCalls += 1; return liveHop(adlibOk([])); },
  });
  assert.strictEqual(missingQuery.error, 'policy_rejection');
  assert.match(missingQuery.message, /search_query_required/);
  assert.strictEqual(queryCalls, 0);
});

test('8. 401/403/429+Retry-After/5xx/400 mapping', async () => {
  for (const [status, error, message] of [
    [401, 'auth_failure', /provider_auth_rejected/],
    [403, 'policy_rejection', /provider_permission_denied/],
    [400, 'invalid_response', /provider_validation_failed/],
    [500, 'transient', /provider_unavailable/],
  ]) {
    let calls = 0;
    const page = await tiktok.fetchPage(baseReq({ idempotency_key: `ik-${status}` }), {
      tenantId: 9, token: TOKEN, mode: 'live',
      transport: async () => {
        calls += 1;
        return { ok: true, status, json: { error: { code: status === 401 ? 'access_token_invalid' : 'err' } } };
      },
    });
    assert.strictEqual(page.ok, false);
    assert.strictEqual(page.error, error);
    assert.match(page.message, message);
    assert.strictEqual(calls, 1);
  }
  const limited = (await liveFetch(baseReq({ idempotency_key: 'ik-rl' }), {
    ok: true, status: 429, json: null, retryAfterMs: parseRetryAfter('2'),
  })).page;
  assert.strictEqual(limited.error, 'rate_limit');
  assert.strictEqual(limited.retry_after_ms, 2000);
  const vendorAuth = (await liveFetch(baseReq({ idempotency_key: 'ik-200e' }), liveHop({
    error: { code: 'access_token_invalid', message: 'bad token' },
  }))).page;
  assert.strictEqual(vendorAuth.error, 'auth_failure');
});

test('9. runtime retry budget exhausts for 5xx; 4xx is not retried', async () => {
  let calls = 0;
  const runtime = createResearchRuntime({
    mode: 'live',
    now: () => 1,
    random: () => 0,
    sleep: async () => {},
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
  let four = 0;
  const fourRuntime = createResearchRuntime({
    mode: 'live',
    now: () => 1,
    random: () => 0,
    sleep: async () => {},
    resolveSecret: async () => TOKEN,
    transport: async () => {
      four += 1;
      return { ok: true, status: 400, json: { error: { code: 'invalid_params' } } };
    },
  });
  const rejected = await fourRuntime.fetchPage(baseReq({ idempotency_key: 'ik-400-rt' }), {
    tenantId: 9, userId: 4, credentialRef: 'user_integrations',
  });
  assert.strictEqual(rejected.error, 'invalid_response');
  assert.strictEqual(four, 1);
});

test('10. tenant isolation rejects a foreign cursor and binds evidence tenant', async () => {
  const bound = tiktok.bindTikTokCursor(9, 'run-tiktok-live-001', 'sid-a', 'prev');
  const rejected = await tiktok.fetchPage(baseReq({
    tenant_id: 11,
    research_run_id: 'run-tiktok-live-001',
    cursor: bound,
    idempotency_key: 'ik-ten',
  }), {
    tenantId: 11, token: TOKEN, mode: 'live',
    transport: async () => { throw new Error('must-not-fetch'); },
  });
  assert.strictEqual(rejected.ok, false);
  assert.strictEqual(rejected.error, 'invalid_response');
  assert.match(rejected.message, /invalid_pagination_cursor/);
  const raw = await tiktok.fetchPage(baseReq({ cursor: 'unbound-tiktok-cursor', idempotency_key: 'ik-raw' }), {
    tenantId: 9, token: TOKEN, mode: 'live',
    transport: async () => { throw new Error('must-not-fetch'); },
  });
  assert.match(raw.message, /invalid_pagination_cursor/);
  const ok = (await liveFetch(baseReq({ tenant_id: 11, idempotency_key: 'ik-t11' }), liveHop(adlibOk([sampleAd()])), { tenantId: 11 })).page;
  assert.strictEqual(ok.evidence[0].tenant_id, 11);
});

test('11. approval/run binding rejects a foreign-run cursor', async () => {
  const foreign = tiktok.bindTikTokCursor(9, 'run-other', 'sid-x', 'prev');
  const page = await tiktok.fetchPage(baseReq({ cursor: foreign, idempotency_key: 'ik-run' }), {
    tenantId: 9, token: TOKEN, mode: 'live',
    transport: async () => { throw new Error('must-not-fetch'); },
  });
  assert.strictEqual(page.ok, false);
  assert.match(page.message, /invalid_pagination_cursor/);
  const ok = (await liveFetch(baseReq(), liveHop(adlibOk([sampleAd()])))).page;
  assert.strictEqual(ok.evidence[0].research_run_id, 'run-tiktok-live-001');
});

test('15. fixture mode still fixture / synthetic labels', async () => {
  const fixture = await tiktok.fetchPage(baseReq({ idempotency_key: 'ik-hon-f' }), {
    tenantId: 9, token: 'fixture-token', mode: 'fixture',
    transport: async () => ({ ok: true, status: 200 }),
  });
  assert.strictEqual(fixture.ok, true);
  assert.strictEqual(fixture.evidence[0].provider_metrics.source, 'fixture');
  assert.strictEqual(fixture.evidence[0].provider_metrics._fabricated, true);
  assert.strictEqual(fixture.continuation_state.honesty_class, 'fixture');
  assert.strictEqual(fixture.evidence[0].provenance_method, 'public_scrape');
});

test('16. host allowlist is open.tiktokapis.com only; media/library URLs never fetched', async () => {
  assert.strictEqual(hostAllowed('tiktok_research', 'open.tiktokapis.com'), true);
  assert.strictEqual(hostAllowed('tiktok_research', 'library.tiktok.com'), false);
  assert.strictEqual(hostAllowed('tiktok_research', 'business-api.tiktok.com'), false);
  assert.strictEqual(hostAllowed('tiktok_research', 'evil.example'), false);
  const { hops, page } = await liveFetch(baseReq(), liveHop(adlibOk([sampleAd({
    ad: {
      image_urls: ['https://library.tiktok.com/ads?id=1'],
      videos: [{ url: 'https://evil.example/video.mp4' }],
    },
  })])));
  assert.strictEqual(page.ok, true);
  assert.strictEqual(page.assets.length, 0);
  for (const hop of hops) {
    assert.match(hop.url, /^https:\/\/open\.tiktokapis\.com\//);
    assert.doesNotMatch(hop.url, /library\.tiktok\.com|evil\.example|ad\.videos|image_urls|download_url/);
  }
  const mapped = tiktok.mapTikTokHttpError({ status: 200, json: { error: { code: 'access_token_invalid' } } });
  assert.strictEqual(mapped.error, 'auth_failure');
});

test('17. Authorization Bearer is sent and redacted from page JSON', async () => {
  const { page, hops } = await liveFetch(baseReq(), liveHop(adlibOk([sampleAd()])));
  assertNoSecrets(page);
  assert.ok(hops[0].headers.Authorization.startsWith('Bearer '));
  assert.strictEqual(hops[0].headers.Authorization, `Bearer ${TOKEN}`);
  const redacted = redactSecrets({
    authorization: hops[0].headers.Authorization,
    token: TOKEN,
    Authorization: hops[0].headers.Authorization,
    nested: { Authorization: `Bearer ${TOKEN}` },
  });
  assert.strictEqual(redacted.authorization, '[redacted]');
  assert.strictEqual(redacted.token, '[redacted]');
  assert.strictEqual(redacted.Authorization, '[redacted]');
  assert.strictEqual(redacted.nested.Authorization, '[redacted]');
  assert.doesNotMatch(JSON.stringify(redacted), new RegExp(TOKEN));
  assert.doesNotMatch(JSON.stringify(redacted), /Bearer /i);
});

test('18. PII minimization: no email/phone fields; targeting not requested; no raw payload', async () => {
  const { page, hops } = await liveFetch(baseReq(), liveHop(adlibOk([sampleAd({
    ad: { title: 'Write hello@example.com or +1-202-555-0100' },
  })])));
  const dumped = JSON.stringify(page);
  assert.ok(!Object.prototype.hasOwnProperty.call(page.evidence[0], 'email'));
  assert.ok(!Object.prototype.hasOwnProperty.call(page.evidence[0], 'phone'));
  assert.ok(!Object.prototype.hasOwnProperty.call(page.evidence[0], 'raw_payload'));
  assert.doesNotMatch(dumped, /"targeting"|ad_group\.targeting_info|follower_count/);
  const fields = new URL(hops[0].url).searchParams.get('fields');
  assert.strictEqual(fields, tiktok.ADLIB_FIELDS.join(','));
  assert.doesNotMatch(fields, /targeting|email|phone|profile|comment|reach|videos|image_urls|follower/);
  const body = hopBody(hops[0]);
  assert.equal(Object.prototype.hasOwnProperty.call(body.filters || {}, 'ages'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(body.filters || {}, 'gender'), false);
  const src = fs.readFileSync(path.join(ROOT, 'services/agent_orchestrator/connectors/tiktok_research.js'), 'utf8');
  assert.doesNotMatch(src, /router\.(get|post|put|delete|use)\(/);
  assert.doesNotMatch(src, /puppeteer|playwright|rapidapi/i);
  assert.throws(
    () => assertSearchParameters({ query: 'x', access_token: TOKEN }),
    (err) => err && err.code === 'validation_failed'
  );
  assert.throws(
    () => assertConnectorRequest(baseReq({ search_parameters: { query: 'x', access_token: TOKEN } }), { tenantId: 9 }),
    (err) => err && err.code === 'validation_failed'
  );
});

test('19. timeout / abort → transient / cancelled', async () => {
  const timed = await tiktok.fetchPage(baseReq({ idempotency_key: 'ik-to' }), {
    tenantId: 9, token: TOKEN, mode: 'live',
    transport: async () => { throw new Error('timeout'); },
  });
  assert.strictEqual(timed.error, 'transient');
  const ac = new AbortController();
  ac.abort();
  let abortCalls = 0;
  const cancelled = await tiktok.fetchPage(baseReq({ idempotency_key: 'ik-ab' }), {
    tenantId: 9, token: TOKEN, mode: 'live', signal: ac.signal,
    transport: async () => { abortCalls += 1; return liveHop(adlibOk([])); },
  });
  assert.strictEqual(cancelled.error, 'terminal');
  assert.match(cancelled.message, /cancelled/);
  assert.strictEqual(abortCalls, 0);
});

test('unsupported operation fails closed; multi-country omits vendor geo', async () => {
  let calls = 0;
  const denied = await tiktok.fetchPage(baseReq({ idempotency_key: 'ik-cap' }), {
    tenantId: 9, token: TOKEN, mode: 'live', operation: 'ad_library',
    transport: async () => { calls += 1; return liveHop(adlibOk([])); },
  });
  assert.strictEqual(denied.error, 'policy_rejection');
  assert.match(denied.message, /capability_not_supported/);
  assert.strictEqual(calls, 0);
  const { hops, page } = await liveFetch(baseReq({
    idempotency_key: 'ik-geo',
    search_parameters: { query: 'jackets', countries: ['US', 'GB'], lookback_days: 30, max_results_per_page: 10 },
  }), liveHop(adlibOk([sampleAd({ advertiser: { country_code: undefined } })])));
  assert.equal(Object.prototype.hasOwnProperty.call(hopBody(hops[0]).filters || {}, 'country_code'), false);
  assert.strictEqual(page.competitors[0].country, null);
  assert.strictEqual(page.evidence[0].market, null);
});

const liveToken = process.env.INFOGENIE_LIVE_TIKTOK_RESEARCH_TOKEN;
const liveSmoke = process.env.INFOGENIE_LIVE_TIKTOK_RESEARCH === '1'
  && !!liveToken
  && !/^_DUMMY/i.test(String(liveToken));

test('20. opt-in live TikTok Commercial Content API smoke', {
  skip: liveSmoke ? false : 'INFOGENIE_LIVE_TIKTOK_RESEARCH=1 and a non-dummy INFOGENIE_LIVE_TIKTOK_RESEARCH_TOKEN are required',
}, async () => {
  const token = process.env.INFOGENIE_LIVE_TIKTOK_RESEARCH_TOKEN;
  const { defaultTransport } = require('../services/agent_orchestrator/connectors/transport');
  const page = await tiktok.fetchPage(baseReq({
    idempotency_key: 'ik-live-smoke',
    search_parameters: { query: 'shoes', countries: ['US'], lookback_days: 7, max_results_per_page: 1 },
  }), {
    tenantId: 9,
    token,
    mode: 'live',
    transport: defaultTransport,
  });
  const dumped = JSON.stringify(page);
  assert.doesNotMatch(dumped, new RegExp(String(token).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(dumped, /Bearer /i);
  if (page.ok) {
    assert.strictEqual(page.continuation_state.honesty_class, 'live');
    for (const ev of page.evidence) {
      assert.strictEqual(ev.provider_metrics.source, 'live');
      assert.notStrictEqual(ev.provider_metrics._fabricated, true);
    }
  } else {
    assert.ok(page.error);
    assert.doesNotMatch(String(page.message || ''), new RegExp(String(token).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

let dbHarness = null;
try {
  dbHarness = require('./helpers');
} catch (_) {
  dbHarness = null;
}

const HAS_DB = !!(dbHarness && dbHarness.hasDb());

if (!HAS_DB) {
  test('12–14 persistPage / cancel / lease skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
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
        name: 'TikTok live host',
        objective: 'Collect public ads',
        product_or_service: 'Analytics',
        offer: 'Trial',
        landing_page_url: 'https://example.com/trial',
        target_markets: ['US'],
        target_audiences: ['SMB'],
        selected_platforms: ['tiktok'],
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
    tenantA = await fx.seedTenant('TikTok live A');
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

  async function runningHost() {
    const wf = await approvedWorkflow();
    const created = await startResearchRun(db.getPool(), {
      tenantId: tenantA.id,
      userId: ownerA.id,
      workflowId: wf.id,
      requestedPlatforms: ['tiktok'],
      searchParameters: { query: 'jackets', countries: ['US'], max_results_per_page: 1 },
      idempotencyKey: `ik-tl-${crypto.randomBytes(4).toString('hex')}`,
      credentialRefs: { tiktok_research: 'user_integrations' },
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

  test('12. persistPage accepts a live page and skips unique replays', async () => {
    const host = await runningHost();
    const fetched = (await liveFetch(baseReq({
      tenant_id: tenantA.id,
      research_run_id: host.run.id,
      workflow_id: host.wf.id,
      approval_id: host.run.approval_id,
      approval_object_version: host.run.approval_object_version,
      idempotency_key: `ik-pers-${host.run.id}`,
    }), liveHop(adlibOk([sampleAd({
      ad: { id: `ad-${host.run.id}`.slice(0, 24) },
      advertiser: { business_id: `adv-${host.run.id}`.slice(0, 24) },
    })])), { tenantId: tenantA.id })).page;
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

  test('13. cancel / lost lease immediately before persist prevents writes', async () => {
    const host = await runningHost();
    const page = (await liveFetch(baseReq({
      tenant_id: tenantA.id,
      research_run_id: host.run.id,
      workflow_id: host.wf.id,
      approval_id: host.run.approval_id,
      approval_object_version: host.run.approval_object_version,
      idempotency_key: `ik-stale-${host.run.id}`,
    }), liveHop(adlibOk([
      sampleAd({ ad: { id: `stale-a-${host.run.id}` }, advertiser: { business_id: `p-a-${host.run.id}`, business_name: 'A Co' } }),
      sampleAd({ ad: { id: `stale-b-${host.run.id}` }, advertiser: { business_id: `p-b-${host.run.id}`, business_name: 'B Co' } }),
    ])), { tenantId: tenantA.id })).page;
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

  test('14. cancel between pages keeps later pages off disk', async () => {
    const host = await runningHost();
    let pages = 0;
    const runtime = createResearchRuntime({
      mode: 'live',
      resolveSecret: async () => TOKEN,
      transport: async () => {
        pages += 1;
        if (pages === 1) {
          return liveHop(adlibOk(
            [sampleAd({ ad: { id: `pg1-${host.run.id}` } })],
            { has_more: true, search_id: `sid-${host.run.id}` }
          ));
        }
        return liveHop(adlibOk(
          [sampleAd({ ad: { id: `pg2-${host.run.id}` } })],
          { has_more: false, search_id: `sid2-${host.run.id}` }
        ));
      },
    });
    const finished = await executeResearchRun(db.getPool(), {
      tenantId: tenantA.id,
      runId: host.run.id,
      userId: ownerA.id,
      holder: host.lease.holder,
      runtime,
      credentialRefs: { tiktok_research: 'user_integrations' },
      betweenPages: async () => {
        await cancelResearchRun(db.getPool(), tenantA.id, host.run.id);
      },
    });
    assert.strictEqual(finished.state, 'cancelled');
    const ev = await db.getPool().query(
      `SELECT provider_external_id FROM orchestrator_research_evidence
        WHERE tenant_id=$1 AND research_run_id=$2`,
      [tenantA.id, host.run.id]
    );
    for (const row of ev.rows) {
      assert.notStrictEqual(row.provider_external_id, `pg2-${host.run.id}`);
    }
    await releaseLease(db.getPool(), tenantA.id, host.wf.id, host.lease.holder);
  });
}
