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
const meta = require('../services/agent_orchestrator/connectors/meta_research');

const TOKEN = 'live-token-secret-ABCDEF123456';
const ROOT = path.join(__dirname, '..');

function baseReq(over) {
  return {
    connector_id: 'meta_research',
    connector_version: '1.0.0',
    contract_version: 'v1',
    tenant_id: 9,
    research_run_id: 'run-meta-live-001',
    workflow_id: 'wf-meta-live-001',
    approval_id: 1,
    approval_object_version: 1,
    requested_platforms: ['meta'],
    idempotency_key: 'ik-meta-live-001',
    search_parameters: { query: 'jackets', countries: ['US'], lookback_days: 30, max_results_per_page: 10 },
    ...over,
  };
}

function sampleAd(over) {
  return {
    id: '111222333',
    page_id: '444555666',
    page_name: 'Acme Coats',
    ad_creation_time: '2026-08-01',
    ad_creative_bodies: ['Warm winter coats for trail days.'],
    ad_creative_link_titles: ['Trail coats'],
    ad_creative_link_descriptions: ['Shop the public listing.'],
    ad_delivery_start_time: '2026-08-01',
    ad_delivery_stop_time: null,
    ad_snapshot_url: 'https://www.facebook.com/ads/archive/render_ad/?id=111222333',
    publisher_platforms: ['facebook'],
    languages: ['en'],
    impressions: { lower_bound: '1000', upper_bound: '5000' },
    ...over,
  };
}

function archiveJson(ads, after) {
  const paging = after
    ? {
      cursors: { after },
      next: `https://evil.example/steal?access_token=${TOKEN}&after=${after}`,
    }
    : { cursors: {} };
  return { data: ads, paging };
}

function liveHop(json, over) {
  return { ok: true, status: 200, json, headers: {}, rate_limit: null, ...over };
}

async function liveFetch(req, hopOrFn, ctxOver) {
  const hops = [];
  const page = await meta.fetchPage(req, {
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
  assert.doesNotMatch(dumped, /access_token/i);
  assert.doesNotMatch(dumped, /Bearer /i);
}

test('1. live Meta page normalizes and is ingestible', async () => {
  const { page, hops } = await liveFetch(baseReq(), liveHop(archiveJson([sampleAd()], null)));
  assert.strictEqual(page.ok, true);
  assert.strictEqual(hops.length, 1);
  assert.match(hops[0].url, /^https:\/\/graph\.facebook\.com\/v21\.0\/ads_archive\?/);
  assert.doesNotMatch(hops[0].url, /access_token/);
  assert.strictEqual(hops[0].headers.Authorization, `Bearer ${TOKEN}`);
  assert.strictEqual(hops[0].timeoutMs, REQUEST_TIMEOUT_MS);
  assert.strictEqual(hops[0].maxBodyBytes, MAX_BODY_BYTES);
  assert.strictEqual(page.evidence.length, 1);
  assert.strictEqual(page.competitors.length, 1);
  assert.strictEqual(page.assets.length, 0);
  assert.strictEqual(page.evidence[0].platform, 'meta');
  assert.strictEqual(page.evidence[0].connector_id, 'meta_research');
  assert.strictEqual(page.evidence[0].connector_version, '1.0.0');
  assert.strictEqual(page.evidence[0].tenant_id, 9);
  assert.strictEqual(page.evidence[0].research_run_id, 'run-meta-live-001');
  assert.strictEqual(page.evidence[0].provider_external_id, '111222333');
  assert.strictEqual(page.competitors[0].provider_advertiser_id, '444555666');
  assert.strictEqual(page.evidence[0].canonical_source_url, 'https://www.facebook.com/ads/library/?id=111222333');
  assert.strictEqual(page.evidence[0].provenance_method, 'ad_library');
  assert.strictEqual(page.evidence[0].source_type, 'ad_creative');
  assert.strictEqual(page.competitors[0].discovery_source, 'ad_library');
  assert.strictEqual(page.evidence[0].provider_metrics.source, 'live');
  assert.notStrictEqual(page.evidence[0].provider_metrics._fabricated, true);
  assert.strictEqual(page.evidence[0].metrics_kind, 'provider_reported');
  assert.strictEqual(page.evidence[0].provider_metrics.impressions_lower, 1000);
  assert.strictEqual(page.continuation_state.honesty_class, 'live');
  assert.equal(Object.prototype.hasOwnProperty.call(page.continuation_state, 'source'), false);
  assertPageHonesty({ mode: 'live', page });
  assertConnectorResult(page, { tenantId: 9 });
  assertNoSecrets(page);
});

test('2. multi-page cursor pagination uses bound after, not paging.next', async () => {
  const firstJson = archiveJson([sampleAd()], 'meta-after-2');
  const secondJson = archiveJson([sampleAd({ id: '999888777' })], null);
  const hops = [];
  const first = await meta.fetchPage(baseReq({ idempotency_key: 'ik-pg1' }), {
    tenantId: 9, token: TOKEN, mode: 'live',
    transport: async (opts) => { hops.push(opts); return liveHop(firstJson); },
  });
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.page.has_more, true);
  assert.ok(first.page.next_cursor);
  const decoded = meta.unbindMetaCursor(first.page.next_cursor, 9, 'run-meta-live-001');
  assert.strictEqual(decoded.ok, true);
  assert.strictEqual(decoded.after, 'meta-after-2');
  const second = await meta.fetchPage(baseReq({
    cursor: first.page.next_cursor,
    idempotency_key: 'ik-pg2',
  }), {
    tenantId: 9, token: TOKEN, mode: 'live',
    transport: async (opts) => { hops.push(opts); return liveHop(secondJson); },
  });
  assert.strictEqual(second.ok, true);
  assert.strictEqual(second.page.has_more, false);
  assert.ok(hops[0].url.includes('search_terms=jackets'));
  assert.ok(!hops[0].url.includes('after='));
  assert.ok(hops[1].url.includes('after=meta-after-2'));
  for (const hop of hops) {
    assert.match(hop.url, /^https:\/\/graph\.facebook\.com\//);
    assert.doesNotMatch(hop.url, /evil\.example/);
    assert.doesNotMatch(hop.url, /access_token/);
  }
  assertNoSecrets(first);
  assertNoSecrets(second);
});

test('3. idempotent replay yields the same fingerprints', async () => {
  const hop = liveHop(archiveJson([sampleAd()], null));
  const a = (await liveFetch(baseReq({ idempotency_key: 'ik-a' }), hop)).page;
  const b = (await liveFetch(baseReq({ idempotency_key: 'ik-b' }), hop)).page;
  assert.strictEqual(a.evidence[0].content_fingerprint, b.evidence[0].content_fingerprint);
  assert.strictEqual(a.evidence[0].dedup_key, b.evidence[0].dedup_key);
  assert.strictEqual(a.evidence[0].id, b.evidence[0].id);
});

test('4. tenant isolation rejects a foreign cursor and binds evidence tenant', async () => {
  const bound = meta.bindMetaCursor(9, 'run-meta-live-001', 'after-a');
  const rejected = await meta.fetchPage(baseReq({
    tenant_id: 11,
    research_run_id: 'run-meta-live-001',
    cursor: bound,
    idempotency_key: 'ik-ten',
  }), {
    tenantId: 11, token: TOKEN, mode: 'live',
    transport: async () => { throw new Error('must-not-fetch'); },
  });
  assert.strictEqual(rejected.ok, false);
  assert.strictEqual(rejected.error, 'invalid_response');
  assert.match(rejected.message, /invalid_pagination_cursor/);
  const raw = await meta.fetchPage(baseReq({ cursor: 'unbound-meta-cursor', idempotency_key: 'ik-raw' }), {
    tenantId: 9, token: TOKEN, mode: 'live',
    transport: async () => { throw new Error('must-not-fetch'); },
  });
  assert.strictEqual(raw.ok, false);
  assert.match(raw.message, /invalid_pagination_cursor/);
  const ok = (await liveFetch(baseReq({ tenant_id: 11, idempotency_key: 'ik-t11' }), liveHop(archiveJson([sampleAd()], null)), { tenantId: 11 })).page;
  assert.strictEqual(ok.evidence[0].tenant_id, 11);
});

test('5. approval/run binding rejects a foreign-run cursor', async () => {
  const foreign = meta.bindMetaCursor(9, 'run-other', 'after-x');
  const page = await meta.fetchPage(baseReq({ cursor: foreign, idempotency_key: 'ik-run' }), {
    tenantId: 9, token: TOKEN, mode: 'live',
    transport: async () => { throw new Error('must-not-fetch'); },
  });
  assert.strictEqual(page.ok, false);
  assert.match(page.message, /invalid_pagination_cursor/);
  const ok = (await liveFetch(baseReq(), liveHop(archiveJson([sampleAd()], null)))).page;
  assert.strictEqual(ok.evidence[0].research_run_id, 'run-meta-live-001');
});

test('8. HTTP 401 and 403 fail closed with a single transport call', async () => {
  for (const [status, error, message] of [
    [401, 'auth_failure', /provider_auth_rejected/],
    [403, 'policy_rejection', /provider_permission_denied/],
  ]) {
    let calls = 0;
    const page = await meta.fetchPage(baseReq({ idempotency_key: `ik-${status}` }), {
      tenantId: 9, token: TOKEN, mode: 'live',
      transport: async () => {
        calls += 1;
        return { ok: true, status, json: { error: { code: status === 401 ? 190 : 10, type: 'OAuthException' } } };
      },
    });
    assert.strictEqual(page.ok, false);
    assert.strictEqual(page.error, error);
    assert.match(page.message, message);
    assert.strictEqual(page.retry_class, 'terminal');
    assert.strictEqual(calls, 1);
  }
});

test('9. HTTP 429 returns rate_limit; runtime honours Retry-After budget', async () => {
  const { page } = await liveFetch(baseReq({ idempotency_key: 'ik-rl' }), {
    ok: true, status: 429, json: null, retryAfterMs: parseRetryAfter('2'),
  });
  assert.strictEqual(page.ok, false);
  assert.strictEqual(page.error, 'rate_limit');
  assert.strictEqual(page.retry_after_ms, 2000);
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
      return { ok: true, status: 429, retryAfterMs: 1500, json: null };
    },
  });
  const retried = await runtime.fetchPage(baseReq({ idempotency_key: 'ik-rl-rt' }), {
    tenantId: 9, userId: 4, credentialRef: 'user_integrations',
  });
  assert.strictEqual(retried.error, 'rate_limit');
  assert.strictEqual(calls, MAX_RETRIES + 1);
  assert.deepStrictEqual(sleeps, Array(MAX_RETRIES).fill(1500));
});

test('10. retryable 5xx exhausts the runtime budget', async () => {
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
  const page = await runtime.fetchPage(baseReq({ idempotency_key: 'ik-5xx' }), {
    tenantId: 9, userId: 4, credentialRef: 'user_integrations',
  });
  assert.strictEqual(page.ok, false);
  assert.strictEqual(page.error, 'transient');
  assert.strictEqual(calls, MAX_RETRIES + 1);
});

test('11. abort cancels and timeout is transient', async () => {
  const ac = new AbortController();
  ac.abort();
  let abortCalls = 0;
  const cancelled = await meta.fetchPage(baseReq({ idempotency_key: 'ik-ab' }), {
    tenantId: 9, token: TOKEN, mode: 'live', signal: ac.signal,
    transport: async () => { abortCalls += 1; return liveHop(archiveJson([], null)); },
  });
  assert.strictEqual(cancelled.ok, false);
  assert.strictEqual(cancelled.error, 'terminal');
  assert.match(cancelled.message, /cancelled/);
  assert.strictEqual(abortCalls, 0);

  const timed = await meta.fetchPage(baseReq({ idempotency_key: 'ik-to' }), {
    tenantId: 9, token: TOKEN, mode: 'live',
    transport: async () => { throw new Error('timeout'); },
  });
  assert.strictEqual(timed.ok, false);
  assert.strictEqual(timed.error, 'transient');
});

test('12. malformed JSON and oversized body fail closed', async () => {
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

test('13. host allowlist rejects evil hosts and never fetches paging.next', async () => {
  assert.strictEqual(hostAllowed('meta_research', 'graph.facebook.com'), true);
  assert.strictEqual(hostAllowed('meta_research', 'evil.example'), false);
  const url = meta.buildMetaArchiveUrl({ query: 'jackets', countries: ['US'], limit: 10 });
  assert.match(url, /^https:\/\/graph\.facebook\.com\/v21\.0\/ads_archive\?/);
  assert.doesNotMatch(url, /access_token/);
  const { hops } = await liveFetch(baseReq(), liveHop(archiveJson([sampleAd()], 'next-1')));
  assert.strictEqual(hops.length, 1);
  assert.doesNotMatch(hops[0].url, /evil\.example/);
  const mapped = meta.mapMetaHttpError({ status: 200, json: { error: { code: 190, type: 'OAuthException' } } });
  assert.strictEqual(mapped.error, 'auth_failure');
});

test('14. Authorization and secret-like values are redacted', async () => {
  const { page, hops } = await liveFetch(baseReq(), liveHop(archiveJson([sampleAd()], 'aa')));
  assertNoSecrets(page);
  assert.ok(hops[0].headers.Authorization.startsWith('Bearer '));
  const redacted = redactSecrets({
    authorization: hops[0].headers.Authorization,
    token: TOKEN,
    access_token: TOKEN,
    nested: { Authorization: `Bearer ${TOKEN}` },
  });
  assert.strictEqual(redacted.authorization, '[redacted]');
  assert.strictEqual(redacted.token, '[redacted]');
  assert.strictEqual(redacted.access_token, '[redacted]');
  assert.strictEqual(redacted.nested.Authorization, '[redacted]');
  assert.doesNotMatch(JSON.stringify(redacted), new RegExp(TOKEN));
  assert.doesNotMatch(JSON.stringify(redacted), /Bearer /i);
});

test('15. live vs fixture honesty stays distinct', async () => {
  const live = (await liveFetch(baseReq({ idempotency_key: 'ik-hon-l' }), liveHop(archiveJson([sampleAd()], null)))).page;
  const fixture = await meta.fetchPage(baseReq({ idempotency_key: 'ik-hon-f' }), {
    tenantId: 9, token: 'fixture-token', mode: 'fixture',
    transport: async () => ({ ok: true, status: 200 }),
  });
  assert.strictEqual(live.evidence[0].provider_metrics.source, 'live');
  assert.notStrictEqual(live.evidence[0].provider_metrics._fabricated, true);
  assert.strictEqual(live.continuation_state.honesty_class, 'live');
  assert.strictEqual(fixture.evidence[0].provider_metrics.source, 'fixture');
  assert.strictEqual(fixture.evidence[0].provider_metrics._fabricated, true);
  assert.strictEqual(fixture.continuation_state.honesty_class, 'fixture');
  const empty = (await liveFetch(baseReq({ idempotency_key: 'ik-empty' }), liveHop(archiveJson([], null)))).page;
  assert.strictEqual(empty.ok, true);
  assert.strictEqual(empty.evidence.length, 0);
  assert.strictEqual(empty.continuation_state.honesty_class, 'live');
});

test('16. no new /api prefix and search_parameters reject access_token', () => {
  const metaSrc = fs.readFileSync(path.join(ROOT, 'services/agent_orchestrator/connectors/meta_research.js'), 'utf8');
  const apiSrc = fs.readFileSync(path.join(ROOT, 'services/agent_orchestrator/research_api.js'), 'utf8');
  const matrixSrc = fs.readFileSync(path.join(ROOT, 'services/tenants/permission_matrix.js'), 'utf8');
  assert.doesNotMatch(metaSrc, /router\.(get|post|put|delete|use)\(/);
  assert.doesNotMatch(metaSrc, /app\.(get|post|put|delete)\(/);
  assert.doesNotMatch(metaSrc, /prefix:\s*'\/api\//);
  assert.match(apiSrc, /\/api\/agent-orchestrator\/research|credential_refs/);
  assert.doesNotMatch(apiSrc, /body\.access_token|search_parameters\.access_token/);
  assert.match(matrixSrc, /\/api\/agent-orchestrator\/research/);
  assert.throws(
    () => assertSearchParameters({ query: 'x', access_token: TOKEN }),
    (err) => err && err.code === 'validation_failed'
  );
  assert.throws(
    () => assertConnectorRequest(baseReq({ search_parameters: { query: 'x', access_token: TOKEN } }), { tenantId: 9 }),
    (err) => err && err.code === 'validation_failed'
  );
});

test('snapshot URL is not proof of image; multi-country search does not invent geography', async () => {
  const snapOnly = (await liveFetch(baseReq({ idempotency_key: 'ik-snap' }), liveHop(archiveJson([sampleAd({
    ad_creative_bodies: [],
    ad_creative_link_titles: [],
    ad_creative_link_descriptions: [],
    ad_snapshot_url: 'https://www.facebook.com/ads/archive/render_ad/?id=111222333',
  })], null)))).page;
  assert.strictEqual(snapOnly.ok, true);
  assert.strictEqual(snapOnly.evidence[0].creative_format, 'unknown');
  assert.notStrictEqual(snapOnly.evidence[0].creative_format, 'image');
  assert.notStrictEqual(snapOnly.evidence[0].creative_format, 'video');
  assert.strictEqual(snapOnly.evidence[0].source_type, 'ad_creative');

  const textOnly = (await liveFetch(baseReq({ idempotency_key: 'ik-txt' }), liveHop(archiveJson([sampleAd({
    ad_snapshot_url: null,
    ad_creative_bodies: ['Copy only'],
    ad_creative_link_titles: [],
  })], null)))).page;
  assert.strictEqual(textOnly.evidence[0].creative_format, 'text');
  assert.strictEqual(textOnly.evidence[0].source_type, 'ad_copy');

  const multi = (await liveFetch(baseReq({
    idempotency_key: 'ik-geo',
    search_parameters: { query: 'jackets', countries: ['US', 'GB'], lookback_days: 30, max_results_per_page: 10 },
  }), liveHop(archiveJson([sampleAd()], null)))).page;
  assert.strictEqual(multi.ok, true);
  assert.ok(multi.competitors.length >= 1);
  for (const row of multi.competitors) {
    assert.strictEqual(row.country, null);
    assert.strictEqual(row.market, null);
  }
  for (const ev of multi.evidence) {
    assert.strictEqual(ev.market, null);
    assert.notStrictEqual(ev.market, 'US');
    assert.notStrictEqual(ev.market, 'GB');
  }
});

test('Meta throttle codes 4/17/32/613 are rate_limit; code 100 stays terminal', async () => {
  for (const code of [4, 17, 32, 613]) {
    const mapped = meta.mapMetaHttpError({
      status: 400,
      json: { error: { code, message: 'throttled' } },
      retryAfterMs: 1500,
    });
    assert.strictEqual(mapped.ok, false, `code ${code}`);
    assert.strictEqual(mapped.error, 'rate_limit', `code ${code}`);
    assert.strictEqual(mapped.retry_class, 'retryable', `code ${code}`);
    assert.strictEqual(mapped.retry_after_ms, 1500, `code ${code}`);

    const page = (await liveFetch(baseReq({ idempotency_key: `ik-th-${code}` }), {
      ok: true,
      status: 400,
      json: { error: { code, type: 'OAuthException' } },
      retryAfterMs: 2000,
    })).page;
    assert.strictEqual(page.error, 'rate_limit', `fetch code ${code}`);
    assert.strictEqual(page.retry_class, 'retryable', `fetch code ${code}`);
    assert.strictEqual(page.retry_after_ms, 2000, `fetch code ${code}`);
  }
  const validation = meta.mapMetaHttpError({
    status: 400,
    json: { error: { code: 100, message: 'Invalid parameter' } },
  });
  assert.strictEqual(validation.error, 'invalid_response');
  assert.strictEqual(validation.retry_class, 'terminal');
  const fetched = (await liveFetch(baseReq({ idempotency_key: 'ik-100' }), {
    ok: true,
    status: 400,
    json: { error: { code: 100 } },
  })).page;
  assert.strictEqual(fetched.error, 'invalid_response');
  assert.strictEqual(fetched.retry_class, 'terminal');
});

test('200 body with Meta error object is mapped, not treated as success', async () => {
  const page = (await liveFetch(baseReq({ idempotency_key: 'ik-200e' }), liveHop({
    error: { message: 'Invalid OAuth', type: 'OAuthException', code: 190 },
  }))).page;
  assert.strictEqual(page.ok, false);
  assert.strictEqual(page.error, 'auth_failure');
});

test('missing live query fails closed without transport', async () => {
  let calls = 0;
  const page = await meta.fetchPage(baseReq({
    search_parameters: { countries: ['US'] },
    idempotency_key: 'ik-nq',
  }), {
    tenantId: 9, token: TOKEN, mode: 'live',
    transport: async () => { calls += 1; return liveHop(archiveJson([], null)); },
  });
  assert.strictEqual(page.error, 'policy_rejection');
  assert.match(page.message, /search_query_required/);
  assert.strictEqual(calls, 0);
});

const liveSmoke = process.env.INFOGENIE_LIVE_META_RESEARCH === '1'
  && !!process.env.INFOGENIE_LIVE_META_RESEARCH_TOKEN;

test('opt-in live Meta ads_archive smoke', {
  skip: liveSmoke ? false : 'INFOGENIE_LIVE_META_RESEARCH / INFOGENIE_LIVE_META_RESEARCH_TOKEN unset',
}, async () => {
  const token = process.env.INFOGENIE_LIVE_META_RESEARCH_TOKEN;
  const { defaultTransport } = require('../services/agent_orchestrator/connectors/transport');
  const page = await meta.fetchPage(baseReq({
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
  assert.doesNotMatch(dumped, /access_token=/i);
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
  test('6–7 persistPage / cancel / lease skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
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
        name: 'Meta live host',
        objective: 'Collect public ads',
        product_or_service: 'Analytics',
        offer: 'Trial',
        landing_page_url: 'https://example.com/trial',
        target_markets: ['US'],
        target_audiences: ['SMB'],
        selected_platforms: ['meta'],
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
    tenantA = await fx.seedTenant('Meta live A');
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
      requestedPlatforms: ['meta'],
      searchParameters: { query: 'jackets', countries: ['US'] },
      idempotencyKey: `ik-ml-${crypto.randomBytes(4).toString('hex')}`,
      credentialRefs: { meta_research: 'user_integrations' },
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

  test('1+3. persistPage accepts a live page and skips unique replays', async () => {
    const host = await runningHost();
    const fetched = (await liveFetch(baseReq({
      tenant_id: tenantA.id,
      research_run_id: host.run.id,
      workflow_id: host.wf.id,
      approval_id: host.run.approval_id,
      approval_object_version: host.run.approval_object_version,
      idempotency_key: `ik-pers-${host.run.id}`,
    }), liveHop(archiveJson([sampleAd({ id: `ad-${host.run.id}` })], null)), { tenantId: tenantA.id })).page;
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

  test('6. cancel / lost lease between pages prevents stale writes', async () => {
    const host = await runningHost();
    const page = (await liveFetch(baseReq({
      tenant_id: tenantA.id,
      research_run_id: host.run.id,
      workflow_id: host.wf.id,
      approval_id: host.run.approval_id,
      approval_object_version: host.run.approval_object_version,
      idempotency_key: `ik-stale-${host.run.id}`,
    }), liveHop(archiveJson([
      sampleAd({ id: `stale-a-${host.run.id}`, page_id: `p-a-${host.run.id}`, page_name: 'A Co' }),
      sampleAd({ id: `stale-b-${host.run.id}`, page_id: `p-b-${host.run.id}`, page_name: 'B Co' }),
    ], null)), { tenantId: tenantA.id })).page;
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

  test('7. stop-order cancel during pagination keeps later pages off disk', async () => {
    const host = await runningHost();
    const firstJson = archiveJson([sampleAd({ id: `pg1-${host.run.id}` })], 'after-2');
    const secondJson = archiveJson([sampleAd({ id: `pg2-${host.run.id}` })], null);
    let pages = 0;
    const runtime = createResearchRuntime({
      mode: 'live',
      resolveSecret: async () => TOKEN,
      transport: async () => {
        pages += 1;
        return liveHop(pages === 1 ? firstJson : secondJson);
      },
    });
    const finished = await executeResearchRun(db.getPool(), {
      tenantId: tenantA.id,
      runId: host.run.id,
      userId: ownerA.id,
      holder: host.lease.holder,
      runtime,
      credentialRefs: { meta_research: 'user_integrations' },
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
