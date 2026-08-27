'use strict';
process.env.NODE_ENV = 'test';
require('./helpers/env');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const observer = require('../services/agent_orchestrator/connectors/meta_reconciliation_observer');
const { DEFAULT_GRAPH_VERSION } = require('../services/agent_orchestrator/connectors/meta_graph_version');

const ledgerObjects = Object.freeze([
  { object_kind: 'campaign', provider_object_id: 'cmp-secret' },
  { object_kind: 'adset', provider_object_id: 'set-secret' },
  { object_kind: 'creative', provider_object_id: 'crt-secret' },
  { object_kind: 'ad', provider_object_id: 'ad-secret' },
]);
const bodies = {
  campaign: { id: 'cmp-secret', account_id: '123', status: 'PAUSED', effective_status: 'PAUSED' },
  adset: { id: 'set-secret', account_id: '123', status: 'ACTIVE', effective_status: 'ACTIVE', campaign_id: 'cmp-secret' },
  creative: { id: 'crt-secret', account_id: '123' },
  ad: { id: 'ad-secret', account_id: '123', status: 'ACTIVE', effective_status: 'WITH_ISSUES', campaign_id: 'cmp-secret', adset_id: 'set-secret', creative: { id: 'crt-secret' } },
};

function input(transport, over = {}) {
  return { accessToken: 'never-log-this', adAccountId: 'act_123', ledgerObjects, authorizationId: 'auth-safe', ledgerReference: 'ledger-safe', transport, now: () => '2026-08-27T00:00:00.000Z', ...over };
}

test('performs exactly four internally-built GET observations and normalizes without identifiers or secrets', async () => {
  delete process.env.META_GRAPH_API_VERSION;
  const calls = [];
  const result = await observer.observeMetaLedger(input(async (request) => {
    calls.push(request);
    const kind = observer.OBJECT_KINDS[calls.length - 1];
    return { status: 200, json: bodies[kind] };
  }));
  assert.equal(DEFAULT_GRAPH_VERSION, 'v26.0');
  assert.equal(result.attempted_observations, 4);
  assert.equal(result.completed_observations, 4);
  assert.deepEqual(result.observations.map((x) => x.object_kind), observer.OBJECT_KINDS);
  assert.deepEqual(result.observations.map((x) => x.status_classification), ['paused', 'active', 'not_applicable', 'delivering']);
  assert.equal(result.observations[1].campaign_parent_matches, true);
  assert.equal(result.observations[3].adset_parent_matches, true);
  assert.equal(result.observations[3].creative_link_matches, true);
  for (let i = 0; i < calls.length; i += 1) {
    const request = calls[i]; const url = new URL(request.url);
    assert.equal(request.method, 'GET');
    assert.equal(url.origin, observer.GRAPH_ORIGIN);
    assert.equal(url.pathname, `/${DEFAULT_GRAPH_VERSION}/${ledgerObjects[i].provider_object_id}`);
    assert.deepEqual(url.searchParams.get('fields').split(','), observer.FIELDS[observer.OBJECT_KINDS[i]]);
    assert.equal(request.timeoutMs, 8000); assert.equal(request.maxResponseBytes, 65536);
  }
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /never-log-this|secret|account_id|provider_object_id/i);
});

test('rejects caller provider controls and incomplete/duplicate lineage before transport', async () => {
  let calls = 0; const transport = async () => { calls += 1; };
  for (const override of [{ method: 'POST' }, { fields: ['id'] }, { url: 'https://evil.invalid' }, { providerObjectId: 'x' }, { apiVersion: 'v1.0' }, { accountId: 'x' }, { provider_object_id: 'x' }, { account_id: 'x' }, { api_version: 'v1.0' }]) {
    await assert.rejects(observer.observeMetaLedger(input(transport, override)), { code: 'caller_provider_control_rejected' });
  }
  await assert.rejects(observer.observeMetaLedger(input(transport, { ledgerObjects: ledgerObjects.slice(0, 3) })), { code: 'invalid_ledger_lineage' });
  await assert.rejects(observer.observeMetaLedger(input(transport, { ledgerObjects: [ledgerObjects[0], ledgerObjects[0], ledgerObjects[2], ledgerObjects[3]] })), { code: 'invalid_ledger_lineage' });
  assert.equal(calls, 0);
});

test('sanitizes provider, shape, redirect, size and transport failures', async () => {
  const fixtures = [
    { status: 401, json: { error: { message: 'provider-secret' } } },
    { status: 404, json: { error: { message: 'provider-secret' } } },
    { status: 429, json: { error: { message: 'provider-secret' } } },
    { status: 503, json: { error: { message: 'provider-secret' } } },
    { status: 200, malformed: true }, { oversized: true }, { redirect: true, location: 'https://evil.invalid/token' },
    { status: 400, json: { error: { message: 'provider-secret' } } },
  ];
  for (const fixture of fixtures) {
    let n = 0;
    const result = await observer.observeMetaLedger(input(async () => fixtures[(n++) % fixtures.length]));
    assert.equal(result.observations.length, 4);
    assert.doesNotMatch(JSON.stringify(result), /provider-secret|evil\.invalid|never-log-this/);
  }
  const transportFailure = await observer.observeMetaLedger(input(async () => { throw new Error('token provider payload'); }));
  assert.deepEqual(transportFailure.observations.map((x) => x.outcome), Array(4).fill('transient_failure'));
});

test('rejects a response identity that differs from the ledger-derived identity', async () => {
  const result = await observer.observeMetaLedger(input(async () => ({ status: 200, json: { id: 'different-object', account_id: '123' } })));
  assert.deepEqual(result.observations.map((x) => x.outcome), Array(4).fill('malformed'));
  assert.deepEqual(result.observations.map((x) => x.error_classification), Array(4).fill('invalid_provider_response'));
});

test('normalizes mismatched and absent account/parent/link bindings safely', async () => {
  let i = 0;
  const altered = [bodies.campaign, { ...bodies.adset, account_id: '999', campaign_id: 'wrong' }, bodies.creative, { ...bodies.ad, adset_id: undefined, creative: undefined }];
  const result = await observer.observeMetaLedger(input(async () => ({ status: 200, json: altered[i++] })));
  assert.equal(result.observations[1].account_binding_matches, false);
  assert.equal(result.observations[1].campaign_parent_matches, false);
  assert.equal(result.observations[3].adset_parent_matches, 'unknown');
  assert.equal(result.observations[3].creative_link_matches, 'unknown');
});
