'use strict';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
require('./helpers/env');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const connector = require('../services/agent_orchestrator/connectors/google_ads_paused_draft');

const CUSTOMER = '1234567890';
const TOKEN = 'token-must-not-escape';
const DEV = 'developer-token-secret';
const OP_KEY = 'a'.repeat(64);
const IDEM = 'gapo-idemp-1';

function snapshot() {
  return { name: 'SMB search draft', budget: { amount_micros: 2500000, currency: 'USD' } };
}

function input(extra = {}) {
  return {
    operation: { provider_operation_key: OP_KEY, idempotency_key: IDEM },
    credentials: { accessToken: TOKEN, developerToken: DEV, customerId: CUSTOMER },
    snapshot: snapshot(),
    ...extra,
  };
}

function successJson() {
  return {
    mutateOperationResponses: [
      { campaignBudgetResult: { resourceName: `customers/${CUSTOMER}/campaignBudgets/11` } },
      { campaignResult: { resourceName: `customers/${CUSTOMER}/campaigns/22` } },
      { adGroupResult: { resourceName: `customers/${CUSTOMER}/adGroups/33` } },
    ],
  };
}

function secretsLeak(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return /token-must-not-escape|developer-token-secret|1234567890|refresh_token|access_token/i.test(text);
}

test('authorized paused shape is immutable SEARCH create with PAUSED-only objects', () => {
  const bound = {
    operation_key: OP_KEY,
    idempotency_key: IDEM,
    customer_id: CUSTOMER,
    amount_micros: '2500000',
  };
  const request = connector.buildPausedGoogleAdsDraftRequest(bound);
  const shaped = connector.assertAuthorizedPausedShape(request);
  assert.equal(shaped, request);
  assert.equal(Object.isFrozen(request), true);
  assert.equal(Object.isFrozen(request.body), true);
  assert.equal(request.method, 'POST');
  assert.equal(request.timeoutMs, connector.TIMEOUT_MS);
  assert.equal(request.provider_operation_key, OP_KEY);
  assert.equal(request.idempotency_key, IDEM);
  assert.equal(
    request.url,
    `${connector.API_ORIGIN}/${connector.API_VERSION}/customers/${CUSTOMER}/googleAds:mutate`
  );
  const ops = request.body.mutateOperations;
  assert.equal(ops.length, 3);
  assert.equal(ops[1].campaignOperation.create.status, connector.PAUSED);
  assert.equal(ops[2].adGroupOperation.create.status, connector.PAUSED);
  assert.equal(ops[1].campaignOperation.create.advertisingChannelType, 'SEARCH');
  assert.equal(ops[1].campaignOperation.create.manualCpc.enhancedCpcEnabled, false);
  assert.equal(ops[0].campaignBudgetOperation.create.amountMicros, '2500000');
  assert.equal(request.body.validateOnly, false);
  assert.equal(request.body.partialFailure, false);
  const serialized = JSON.stringify(request.body);
  assert.doesNotMatch(serialized, /\bENABLED\b|\bSERVING\b|"update"|"remove"|startDateTime|servingStatus/);
  assert.match(ops[1].campaignOperation.create.name, new RegExp(OP_KEY));
});

test('createPausedGoogleAdsDraft succeeds once through an injected mutate client', async () => {
  const calls = [];
  const out = await connector.createPausedGoogleAdsDraft(input({
    inject: {
      mutate: async (request) => {
        calls.push(request);
        connector.assertAuthorizedPausedShape(request);
        return { status: 200, json: successJson() };
      },
    },
  }));
  assert.equal(calls.length, 1);
  assert.equal(out.ok, true);
  assert.equal(out.result_code, 'provider_create_succeeded');
  assert.equal(out.published, false);
  assert.equal(out.activated, false);
  assert.equal(out.serving, false);
  assert.equal(out.external_action_taken, true);
  assert.equal(out.retry, false);
  assert.equal(out.requires_reconciliation, false);
  assert.equal(out.objects_created, 3);
  assert.deepEqual(out.objects.map((row) => [row.object_kind, row.provider_status, row.provider_object_id]), [
    ['campaign_budget', 'PAUSED', '11'],
    ['campaign', 'PAUSED', '22'],
    ['ad_group', 'PAUSED', '33'],
  ]);
  assert.equal(out.provider_operation_key, OP_KEY);
  assert.equal(out.idempotency_key, IDEM);
  assert.equal(Object.isFrozen(out), true);
  assert.equal(secretsLeak(out), false);
});

test('provider rejection is determinate failed with no connector retry', async () => {
  let calls = 0;
  const out = await connector.createPausedGoogleAdsDraft(input({
    inject: {
      mutate: async () => {
        calls += 1;
        return { status: 400, json: { error: { message: 'raw-provider-secret', code: 3 } } };
      },
    },
  }));
  assert.equal(calls, 1);
  assert.equal(out.ok, false);
  assert.equal(out.result_code, 'provider_create_failed');
  assert.equal(out.requires_reconciliation, false);
  assert.equal(out.retry, false);
  assert.equal(out.external_action_taken, false);
  assert.equal(out.serving, false);
  assert.doesNotMatch(JSON.stringify(out), /raw-provider-secret/);
  assert.equal(secretsLeak(out), false);
});

test('timeout and thrown transport are unknown, require reconciliation, and do not retry', async () => {
  for (const mutate of [
    async () => ({ transportError: 'timeout', mayHaveActed: true }),
    async () => { throw new Error(`https://googleads.googleapis.com/${TOKEN}/${CUSTOMER}`); },
    async () => ({ status: 503, json: { error: { message: 'unavailable' } } }),
  ]) {
    let calls = 0;
    const out = await connector.createPausedGoogleAdsDraft(input({
      inject: { mutate: async () => { calls += 1; return mutate(); } },
    }));
    assert.equal(calls, 1);
    assert.equal(out.ok, false);
    assert.equal(out.result_code, 'provider_outcome_unknown');
    assert.equal(out.requires_reconciliation, true);
    assert.equal(out.retry, false);
    assert.equal(out.external_action_taken, false);
    assert.equal(secretsLeak(out), false);
  }
});

test('provider_operation_key and idempotency_key are stable across duplicate caller invocations', async () => {
  const seen = [];
  const mutate = async (request) => {
    seen.push({
      op: request.provider_operation_key,
      idemp: request.idempotency_key,
      name: request.body.mutateOperations[1].campaignOperation.create.name,
    });
    return { status: 200, json: successJson() };
  };
  const first = await connector.createPausedGoogleAdsDraft(input({ inject: { mutate } }));
  const second = await connector.createPausedGoogleAdsDraft(input({ inject: { mutate } }));
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[0], seen[1]);
  assert.equal(first.provider_operation_key, second.provider_operation_key);
  assert.equal(first.idempotency_key, second.idempotency_key);
  assert.equal(first.provider_operation_key, OP_KEY);
});

test('enabled, serving, and caller mutate controls are impossible before any client call', async () => {
  let calls = 0;
  const inject = { mutate: async () => { calls += 1; return { status: 200, json: successJson() }; } };
  for (const extra of [
    { status: 'ENABLED' },
    { serving: true },
    { enabled: true },
    { activate: true },
    { publish: true },
    { schedule: true },
    { launch: true },
    { optimize: true },
    { spend: 100 },
    { mutateOperations: [] },
    { operations: [] },
    { payload: { status: 'ENABLED' } },
    { body: { status: 'ENABLED' } },
    { url: 'https://evil.invalid' },
    { method: 'PUT' },
    { snapshot: { ...snapshot(), status: 'ENABLED' } },
    { snapshot: { ...snapshot(), schedule: { start_at: '2026-01-01T00:00:00Z' } } },
    { snapshot: { ...snapshot(), serving_status: 'SERVING' } },
  ]) {
    await assert.rejects(
      connector.createPausedGoogleAdsDraft(input({ inject, ...extra })),
      (err) => err && err.code === 'caller_provider_control_rejected'
    );
  }
  assert.equal(calls, 0);
});

test('default path never opens a live Google socket; live requires explicit opt-in', async () => {
  let sockets = 0;
  const orig = https.request;
  https.request = function requestSpy(...args) {
    sockets += 1;
    throw new Error('NETWORK_FORBIDDEN');
  };
  try {
    assert.notEqual(process.env[connector.LIVE_OPT_IN_ENV], '1');
    await assert.rejects(
      connector.createPausedGoogleAdsDraft(input()),
      (err) => err && err.code === 'live_google_ads_disabled'
    );
    await assert.rejects(
      connector.createPausedGoogleAdsDraft(input({ allowLive: true })),
      (err) => err && err.code === 'live_google_ads_disabled'
    );
    const out = await connector.createPausedGoogleAdsDraft(input({
      inject: { mutate: async () => ({ status: 200, json: successJson() }) },
    }));
    assert.equal(out.ok, true);
    assert.equal(sockets, 0);
  } finally {
    https.request = orig;
  }
});
