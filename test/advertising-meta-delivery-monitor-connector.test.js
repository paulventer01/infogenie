'use strict';
process.env.NODE_ENV = 'test';
require('./helpers/env');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const monitor = require('../services/agent_orchestrator/connectors/meta_delivery_monitor');
const { DEFAULT_GRAPH_VERSION } = require('../services/agent_orchestrator/connectors/meta_graph_version');

const ledgerObjects = Object.freeze([
  { object_kind: 'campaign', provider_object_id: 'campaign-secret' },
  { object_kind: 'adset', provider_object_id: 'adset-secret' },
  { object_kind: 'creative', provider_object_id: 'creative-secret' },
  { object_kind: 'ad', provider_object_id: 'ad-secret' },
]);
const bodies = Object.freeze({
  campaign: { id: 'campaign-secret', account_id: '123', status: 'ACTIVE', effective_status: 'ACTIVE' },
  adset: { id: 'adset-secret', account_id: '123', status: 'ACTIVE', effective_status: 'ACTIVE', campaign_id: 'campaign-secret' },
  creative: { id: 'creative-secret', account_id: '123' },
  ad: { id: 'ad-secret', account_id: '123', status: 'ACTIVE', effective_status: 'ACTIVE', campaign_id: 'campaign-secret', adset_id: 'adset-secret', creative: { id: 'creative-secret' } },
});
function input(transport, overrides = {}) {
  return { accessToken: 'token-never-expose', adAccountId: 'act_123', ledgerObjects, transport, sleep: async () => {}, now: () => '2026-08-28T00:00:00.000Z', ...overrides };
}

test('performs one fixed GET for the exact graph and returns sanitized relationship results', async () => {
  const calls = []; let index = 0;
  const result = await monitor.observeMetaDelivery(input(async (request) => {
    calls.push(request); return { status: 200, json: bodies[monitor.OBJECT_KINDS[index++]] };
  }));
  assert.equal(calls.length, 4);
  assert.deepEqual(result.observations.map((row) => row.delivery_classification),
    ['expected_active', 'expected_active', 'unchanged_non_delivering', 'expected_active']);
  assert.equal(result.observations[1].campaign_relationship_matches, true);
  assert.equal(result.observations[3].creative_relationship_matches, true);
  calls.forEach((call, i) => {
    const url = new URL(call.url);
    assert.equal(call.method, 'GET'); assert.equal(url.origin, monitor.GRAPH_ORIGIN);
    assert.equal(url.pathname, `/${DEFAULT_GRAPH_VERSION}/${ledgerObjects[i].provider_object_id}`);
    assert.deepEqual(url.searchParams.get('fields').split(','), monitor.FIELDS[monitor.OBJECT_KINDS[i]]);
    assert.equal(call.timeoutMs, 8000); assert.equal(call.maxResponseBytes, 65536);
  });
  assert.doesNotMatch(JSON.stringify(result), /secret|token-never|provider_object_id|account_id/i);
});

test('classifies pending, inactive, unknown, missing, malformed and relationship changes', async () => {
  let i = 0;
  const fixtures = [
    { status: 200, json: { ...bodies.campaign, effective_status: 'PAUSED' } },
    { status: 200, json: { ...bodies.adset, campaign_id: 'changed', effective_status: 'MYSTERY' } },
    { status: 404, json: { error: 'provider-secret' } },
    { status: 200, json: { ...bodies.ad, effective_status: 'PENDING_REVIEW', creative: { id: 'changed' } } },
  ];
  const result = await monitor.observeMetaDelivery(input(async () => fixtures[i++]));
  assert.equal(result.observations[0].delivery_classification, 'unexpected_inactive');
  assert.equal(result.observations[1].delivery_classification, 'unknown_provider_state');
  assert.equal(result.observations[1].campaign_relationship_matches, false);
  assert.equal(result.observations[2].failure_classification, 'missing_object');
  assert.equal(result.observations[3].delivery_classification, 'delivery_pending');
  assert.equal(result.observations[3].creative_relationship_matches, false);
  assert.doesNotMatch(JSON.stringify(result), /provider-secret|changed/);
});

test('retries only timeout, 429 and 5xx at most three times with bounded backoff', async () => {
  const sequence = [
    { transportError: 'timeout' }, { status: 429 }, { status: 503 },
    { status: 400 }, { status: 401 }, { malformed: true },
  ];
  let calls = 0; const sleeps = [];
  const result = await monitor.observeMetaDelivery(input(async () => sequence[Math.min(calls++, sequence.length - 1)], { sleep: async (ms) => sleeps.push(ms) }));
  assert.equal(result.observations[0].attempts, 3);
  assert.equal(result.observations[0].failure_classification, 'transient_read_failure');
  assert.equal(result.observations[1].attempts, 1);
  assert.equal(result.observations[1].failure_classification, 'permanent_read_failure');
  assert.equal(result.observations[2].attempts, 1);
  assert.equal(result.observations[2].failure_classification, 'unauthorized_provider_response');
  assert.equal(result.observations[3].attempts, 1);
  assert.equal(result.observations[3].failure_classification, 'malformed_response');
  assert.deepEqual(sleeps, monitor.BACKOFF_MS);
});

test('rejects all caller-controlled provider request inputs before any egress', async () => {
  let calls = 0; const transport = async () => { calls += 1; };
  const controls = ['providerObjectId', 'provider_object_id', 'accountId', 'account_id', 'credentialReference',
    'credential_reference', 'url', 'apiVersion', 'api_version', 'method', 'fields', 'metrics', 'dateRange',
    'date_range', 'payload', 'body', 'query', 'queryParams'];
  for (const key of controls) await assert.rejects(monitor.observeMetaDelivery(input(transport, { [key]: 'attacker' })), { code: 'caller_provider_control_rejected' });
  await assert.rejects(monitor.observeMetaDelivery(input(transport, { ledgerObjects: ledgerObjects.slice(1) })), { code: 'invalid_ledger_lineage' });
  assert.equal(calls, 0);
  assert.equal(Object.keys(monitor).some((name) => /post|put|patch|delete|mutat|activate/i.test(name)), false);
});

