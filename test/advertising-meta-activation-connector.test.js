'use strict';
process.env.NODE_ENV = 'test';
require('./helpers/env');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const connector = require('../services/agent_orchestrator/connectors/meta_activation');
const { DEFAULT_GRAPH_VERSION } = require('../services/agent_orchestrator/connectors/meta_graph_version');

const ledgerObjects = Object.freeze([
  { object_kind: 'campaign', provider_object_id: 'campaign-secret-id' },
  { object_kind: 'adset', provider_object_id: 'adset-secret-id' },
  { object_kind: 'creative', provider_object_id: 'creative-secret-id' },
  { object_kind: 'ad', provider_object_id: 'ad-secret-id' },
]);

function request(transport, extra = {}) {
  return {
    accessToken: 'token-must-not-escape', adAccountId: 'act_123', ledgerObjects, transport,
    now: () => '2026-08-28T00:00:00.000Z', ...extra,
  };
}

test('uses the supported version and exact status-only sequence, verifying creative without mutation', async () => {
  delete process.env.META_GRAPH_API_VERSION;
  const calls = []; const persisted = [];
  const result = await connector.activateMetaGraph(request(async (call) => {
    calls.push(call);
    if (call.method === 'GET') return { status: 200, json: { id: 'creative-secret-id', account_id: '123', status: 'PAUSED', effective_status: 'PAUSED' } };
    return { status: 200, json: { success: true } };
  }, { onOutcome: async (event) => persisted.push(event) }));
  assert.equal(result.state, 'activated');
  assert.deepEqual(result.outcomes.map((event) => [event.object_kind, event.outcome]), [
    ['campaign', 'activated'], ['adset', 'activated'], ['creative', 'unchanged_non_delivering'], ['ad', 'activated'],
  ]);
  assert.deepEqual(calls.map((call) => call.method), ['POST', 'POST', 'GET', 'POST']);
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), ledgerObjects.map((row) => `/${DEFAULT_GRAPH_VERSION}/${row.provider_object_id}`));
  assert.deepEqual(calls.map((call) => call.body), ['status=ACTIVE', 'status=ACTIVE', undefined, 'status=ACTIVE']);
  assert.equal(new URL(calls[2].url).searchParams.get('fields'), 'id,account_id,status,effective_status');
  assert.ok(calls.every((call) => call.timeoutMs === 8000 && call.maxResponseBytes === 16384));
  assert.equal(persisted.length, 8);
  assert.doesNotMatch(JSON.stringify(result), /secret|token|provider_object_id|account/i);
});

test('rejects provider controls and malformed lineage before any egress', async () => {
  let calls = 0; const transport = async () => { calls += 1; };
  for (const extra of [
    { url: 'https://evil.invalid' }, { method: 'DELETE' }, { fields: ['budget'] },
    { payload: { status: 'ACTIVE' } }, { status: 'ACTIVE' }, { apiVersion: 'v1.0' },
    { providerObjectId: 'other' }, { accountId: 'other' },
  ]) await assert.rejects(connector.activateMetaGraph(request(transport, extra)), { code: 'caller_provider_control_rejected' });
  await assert.rejects(connector.activateMetaGraph(request(transport, { ledgerObjects: ledgerObjects.slice(1) })), { code: 'invalid_ledger_lineage' });
  assert.equal(calls, 0);
});

test('stops without retry and sanitizes known rejection, partial failure and ambiguous mutation outcome', async () => {
  const scenarios = [
    { replies: [{ status: 400, json: { error: { message: 'raw-provider-secret' } } }], state: 'failed', outcome: 'provider_rejected', calls: 1 },
    { replies: [{ status: 200, json: { success: true } }, { status: 403, json: { error: { message: 'raw-provider-secret' } } }], state: 'partial_failure', outcome: 'provider_forbidden', calls: 2 },
    { replies: [{ transportError: 'timeout', mayHaveActed: true }], state: 'outcome_unknown', outcome: 'outcome_unknown', calls: 1 },
  ];
  for (const scenario of scenarios) {
    let n = 0;
    const result = await connector.activateMetaGraph(request(async () => scenario.replies[n++]));
    assert.equal(result.state, scenario.state); assert.equal(result.outcomes.at(-1).outcome, scenario.outcome);
    assert.equal(n, scenario.calls); assert.doesNotMatch(JSON.stringify(result), /raw-provider-secret|token-must-not-escape/);
  }
});

test('creative mismatch or read timeout prevents ad activation and yields honest partial failure', async () => {
  for (const creativeReply of [
    { status: 200, json: { id: 'creative-secret-id', account_id: '123', status: 'ACTIVE', effective_status: 'ACTIVE' } },
    { transportError: 'timeout' },
  ]) {
    let n = 0;
    const result = await connector.activateMetaGraph(request(async (call) => {
      n += 1;
      return call.method === 'GET' ? creativeReply : { status: 200, json: { success: true } };
    }));
    assert.equal(result.state, 'partial_failure'); assert.equal(n, 3);
    assert.notEqual(result.outcomes.at(-1).outcome, 'unchanged_non_delivering');
  }
});

test('thrown POST transport failure is ambiguous, bounded, and never exposes the exception', async () => {
  let calls = 0;
  const result = await connector.activateMetaGraph(request(async () => {
    calls += 1; throw new Error('https://graph.facebook.com/token/raw-provider-secret');
  }));
  assert.equal(calls, 1); assert.equal(result.state, 'outcome_unknown');
  assert.doesNotMatch(JSON.stringify(result), /graph\.facebook|token|secret|https/);
});
