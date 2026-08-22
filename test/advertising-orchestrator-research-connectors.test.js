'use strict';

process.env.PERMISSION_ENFORCEMENT = 'on';
process.env.MULTITENANT_ENFORCEMENT = 'on';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const { test } = require('node:test');
const assert = require('node:assert');

const { assertConnectorRequest } = require('../services/agent_orchestrator/research_connector');
const { createResearchRuntime, CAPABILITY_MATRIX, MAX_RETRIES } = require('../services/agent_orchestrator/research_runtime');
const { parseRetryAfter, hostAllowed } = require('../services/agent_orchestrator/connectors/transport');
const meta = require('../services/agent_orchestrator/connectors/meta_research');
const google = require('../services/agent_orchestrator/connectors/google_research');
const tiktok = require('../services/agent_orchestrator/connectors/tiktok_research');

function baseReq(over) {
  return {
    connector_id: 'meta_research',
    connector_version: '1.0.0',
    contract_version: 'v1',
    tenant_id: 9,
    research_run_id: 'run-conn-001',
    workflow_id: 'wf-conn-001',
    approval_id: 1,
    approval_object_version: 1,
    requested_platforms: ['meta'],
    idempotency_key: 'ik-conn-001',
    search_parameters: { query: 'jackets', max_pages: 2 },
    ...over,
  };
}

test('capability matrix lists Meta, Google and TikTok without competitor-account access', () => {
  for (const id of ['meta_research', 'google_research', 'tiktok_research']) {
    assert.ok(CAPABILITY_MATRIX[id]);
    assert.ok(CAPABILITY_MATRIX[id].unsupported.includes('competitor_account_access'));
    assert.ok(CAPABILITY_MATRIX[id].unsupported.includes('campaign_publish'));
  }
  assert.deepStrictEqual(meta.capabilities().supported, ['ad_library']);
  assert.deepStrictEqual(google.capabilities().supported, ['ads_transparency_center']);
  assert.deepStrictEqual(tiktok.capabilities().supported, ['public_profile']);
});

test('host allowlists refuse off-platform destinations', () => {
  assert.strictEqual(hostAllowed('meta_research', 'graph.facebook.com'), true);
  assert.strictEqual(hostAllowed('meta_research', 'evil.example'), false);
  assert.strictEqual(hostAllowed('google_research', 'adstransparency.google.com'), true);
  assert.strictEqual(hostAllowed('tiktok_research', 'business-api.tiktok.com'), true);
});

test('Retry-After parses delta-seconds and HTTP-date', () => {
  assert.strictEqual(parseRetryAfter('2'), 2000);
  const when = new Date(Date.now() + 5000).toUTCString();
  const ms = parseRetryAfter(when);
  assert.ok(ms > 1000 && ms <= 30000);
});

for (const [name, adapter, platform] of [
  ['meta', meta, 'meta'],
  ['google', google, 'google'],
  ['tiktok', tiktok, 'tiktok'],
]) {
  test(`${name} fixture adapter normalizes a PR3A page without a live account`, async () => {
    const hops = [];
    const req = baseReq({
      connector_id: adapter.id,
      requested_platforms: [platform],
      research_run_id: `run-${name}-fix`,
      idempotency_key: `ik-${name}-fix`,
    });
    const page = await adapter.fetchPage(req, {
      tenantId: 9,
      token: 'fixture-token',
      mode: 'fixture',
      transport: async (opts) => {
        hops.push(opts.url);
        return { ok: true, status: 200 };
      },
    });
    assert.strictEqual(page.ok, true);
    assert.strictEqual(page.connector_id, adapter.id);
    assert.ok(page.evidence.length >= 1);
    assert.strictEqual(page.evidence[0].tenant_id, 9);
    assert.strictEqual(page.evidence[0].research_run_id, `run-${name}-fix`);
    assert.ok(page.evidence[0].canonical_source_url || page.evidence[0].provider_external_id);
    assert.ok(!JSON.stringify(page).includes('fixture-token'));
    assert.strictEqual(hops.length, 1);
  });

  test(`${name} missing credentials fail closed with no transport call`, async () => {
    let called = 0;
    const page = await adapter.fetchPage(baseReq({
      connector_id: adapter.id,
      requested_platforms: [platform],
      idempotency_key: `ik-${name}-nocred`,
    }), {
      tenantId: 9,
      mode: 'fixture',
      transport: async () => { called += 1; return { ok: true, status: 200 }; },
    });
    assert.strictEqual(page.ok, false);
    assert.strictEqual(page.error, 'auth_failure');
    assert.strictEqual(called, 0);
  });

  test(`${name} unsupported capability fails closed with no transport call`, async () => {
    let called = 0;
    const page = await adapter.fetchPage(baseReq({
      connector_id: adapter.id,
      requested_platforms: [platform],
      idempotency_key: `ik-${name}-cap`,
    }), {
      tenantId: 9,
      token: 'fixture-token',
      mode: 'fixture',
      operation: 'competitor_account_access',
      transport: async () => { called += 1; return { ok: true, status: 200 }; },
    });
    assert.strictEqual(page.ok, false);
    assert.strictEqual(page.error, 'policy_rejection');
    assert.match(page.message, /capability_not_supported/);
    assert.strictEqual(called, 0);
  });
}

test('runtime 429 honours Retry-After and stops after the retry budget', async () => {
  let calls = 0;
  const sleeps = [];
  const runtime = createResearchRuntime({
    mode: 'fixture',
    now: () => 1,
    random: () => 0,
    sleep: async (ms) => { sleeps.push(ms); },
    resolveSecret: async () => 'fixture-token',
    transport: async () => {
      calls += 1;
      return { ok: true, status: 429, retryAfterMs: 1500, rate_limit: null };
    },
  });
  const page = await runtime.fetchPage(baseReq({ idempotency_key: 'ik-429' }), {
    tenantId: 9,
    userId: 4,
    credentialRef: 'user_integrations',
  });
  assert.strictEqual(page.ok, false);
  assert.strictEqual(page.error, 'rate_limit');
  assert.strictEqual(calls, MAX_RETRIES + 1);
  assert.ok(sleeps.every((ms) => ms === 1500));
  assert.strictEqual(sleeps.length, MAX_RETRIES);
});

test('runtime refuses a missing credential_ref before the adapter transport runs', async () => {
  let calls = 0;
  const runtime = createResearchRuntime({
    mode: 'fixture',
    transport: async () => { calls += 1; return { ok: true, status: 200 }; },
  });
  const page = await runtime.fetchPage(baseReq({ idempotency_key: 'ik-miss' }), {
    tenantId: 9,
    userId: 4,
  });
  assert.strictEqual(page.ok, false);
  assert.strictEqual(page.error, 'auth_failure');
  assert.strictEqual(calls, 0);
});

test('pagination cursor must be a previously issued opaque token', async () => {
  const req = assertConnectorRequest(baseReq({
    cursor: 'not-issued',
    idempotency_key: 'ik-cur',
  }), { tenantId: 9 });
  const page = await meta.fetchPage(req, { tenantId: 9, token: 'fixture-token', mode: 'fixture' });
  assert.strictEqual(page.ok, false);
  assert.strictEqual(page.error, 'invalid_response');
});

test('meta pagination fixture yields a validated next_cursor then a terminal page', async () => {
  const first = await meta.fetchPage(baseReq({ idempotency_key: 'ik-pg1' }), {
    tenantId: 9, token: 'fixture-token', mode: 'fixture',
  });
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.page.has_more, true);
  assert.ok(first.page.next_cursor);
  const second = await meta.fetchPage(baseReq({
    cursor: first.page.next_cursor,
    idempotency_key: 'ik-pg2',
  }), { tenantId: 9, token: 'fixture-token', mode: 'fixture' });
  assert.strictEqual(second.ok, true);
  assert.strictEqual(second.page.has_more, false);
  assert.strictEqual(second.page.next_cursor, null);
});

const liveEnv = {
  meta: process.env.INFOGENIE_LIVE_META_RESEARCH === '1',
  google: process.env.INFOGENIE_LIVE_GOOGLE_RESEARCH === '1',
  tiktok: process.env.INFOGENIE_LIVE_TIKTOK_RESEARCH === '1',
};

test('meta live adapter skipped — credentials absent', {
  skip: liveEnv.meta ? false : 'INFOGENIE_LIVE_META_RESEARCH not set',
}, () => {});

test('google live adapter skipped — credentials absent', {
  skip: liveEnv.google ? false : 'INFOGENIE_LIVE_GOOGLE_RESEARCH not set',
}, () => {});

test('tiktok live adapter skipped — credentials absent', {
  skip: liveEnv.tiktok ? false : 'INFOGENIE_LIVE_TIKTOK_RESEARCH not set',
}, () => {});
