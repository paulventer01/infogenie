'use strict';
process.env.NODE_ENV = 'test';
require('./helpers/env');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const observer = require('../services/agent_orchestrator/connectors/google_ads_paused_draft_reconciliation_observer');

const CUSTOMER = '1234567890';
const TOKEN = 'tok-secret-never';
const DEV = 'dev-secret-never';
const SRC = path.join(__dirname, '../services/agent_orchestrator/connectors/google_ads_paused_draft_reconciliation_observer.js');
const ledgerObjects = Object.freeze([
  { object_kind: 'campaign_budget', provider_object_id: '11' },
  { object_kind: 'campaign', provider_object_id: '22' },
  { object_kind: 'ad_group', provider_object_id: '33' },
]);

function bodies(over = {}) {
  return {
    campaign_budget: { resourceName: `customers/${CUSTOMER}/campaignBudgets/11`, status: 'PAUSED', ...over.campaign_budget },
    campaign: { resourceName: `customers/${CUSTOMER}/campaigns/22`, status: 'PAUSED', campaignBudget: `customers/${CUSTOMER}/campaignBudgets/11`, ...over.campaign },
    ad_group: { resourceName: `customers/${CUSTOMER}/adGroups/33`, status: 'PAUSED', campaign: `customers/${CUSTOMER}/campaigns/22`, ...over.ad_group },
  };
}

function input(transport, extra = {}) {
  const { credentials, ...rest } = extra;
  return {
    credentials: { accessToken: TOKEN, developerToken: DEV, customerId: CUSTOMER, ...credentials },
    ledgerObjects, authorizationId: 'garr_safe', ledgerReference: 'ledger-safe',
    transport, now: () => '2026-09-03T00:00:00.000Z', ...rest,
  };
}

function leaked(value) {
  return /tok-secret-never|dev-secret-never|1234567890|refresh_token|googleads\.googleapis\.com/i
    .test(typeof value === 'string' ? value : JSON.stringify(value));
}

async function observe(jsonMap) {
  let i = 0;
  return observer.observePausedGoogleAdsLedger(input(async (request) => {
    const kind = observer.OBJECT_KINDS[i++];
    return { status: 200, json: jsonMap[kind], _req: request, _kind: kind };
  }));
}

test('GET-only allowlisted URLs; PAUSED binds; ENABLED is not paused; secrets stay out', async () => {
  const calls = [];
  const json = bodies();
  const result = await observer.observePausedGoogleAdsLedger(input(async (request) => {
    calls.push(request);
    return { status: 200, json: json[observer.OBJECT_KINDS[calls.length - 1]] };
  }));
  assert.equal(result.attempted_observations, 3);
  assert.equal(result.completed_observations, 3);
  assert.equal(result.serving, false);
  assert.deepEqual(result.observations.map((x) => [x.object_kind, x.status_classification, x.outcome]),
    [['campaign_budget', 'paused', 'observed'], ['campaign', 'paused', 'observed'], ['ad_group', 'paused', 'observed']]);
  assert.equal(result.observations[0].account_binding_matches, true);
  assert.equal(result.observations[1].budget_parent_matches, true);
  assert.equal(result.observations[2].campaign_parent_matches, true);
  assert.equal(Object.isFrozen(result), true);
  const expectedPath = {
    campaign_budget: `/v17/customers/${CUSTOMER}/campaignBudgets/11`,
    campaign: `/v17/customers/${CUSTOMER}/campaigns/22`,
    ad_group: `/v17/customers/${CUSTOMER}/adGroups/33`,
  };
  for (let i = 0; i < calls.length; i += 1) {
    const request = calls[i]; const url = new URL(request.url); const kind = observer.OBJECT_KINDS[i];
    assert.equal(request.method, 'GET');
    assert.equal(url.origin, observer.API_ORIGIN);
    assert.equal(url.pathname, expectedPath[kind]);
    assert.deepEqual(url.searchParams.get('fields').split(','), observer.FIELDS[kind]);
    assert.doesNotMatch(request.url, /mutate|:search|tok-secret-never|dev-secret-never|Bearer/i);
    assert.equal(request.timeoutMs, observer.TIMEOUT_MS);
    assert.equal(request.maxResponseBytes, observer.MAX_RESPONSE_BYTES);
  }
  assert.equal(leaked(result), false);

  const enabled = await observe(bodies({ campaign: { status: 'ENABLED' } }));
  assert.notEqual(enabled.observations[1].status_classification, 'paused');
  assert.ok(['active', 'unsafe'].includes(enabled.observations[1].status_classification));
  assert.equal(enabled.serving, false);
  assert.equal(leaked(enabled), false);
});

test('classifies 404/401/403/timeout/5xx/oversized/malformed/redirect without leaking secrets', async () => {
  const fixtures = [
    [{ status: 404, json: { error: { message: 'provider-secret' } } }, 'missing'],
    [{ status: 401, json: { error: { message: 'provider-secret' } } }, 'unauthorized'],
    [{ status: 403, json: { error: { message: 'provider-secret' } } }, 'unauthorized'],
    [{ transportError: 'timeout' }, 'transient_failure'],
    [{ status: 503, json: { error: { message: 'provider-secret' } } }, 'transient_failure'],
    [{ oversized: true }, 'malformed'],
    [{ status: 200, malformed: true }, 'malformed'],
    [{ redirect: true, location: 'https://evil.invalid/token' }, 'malformed'],
  ];
  for (const [fixture, outcome] of fixtures) {
    const result = await observer.observePausedGoogleAdsLedger(input(async () => fixture));
    assert.deepEqual(result.observations.map((x) => x.outcome), Array(3).fill(outcome));
    assert.equal(leaked(result), false);
    assert.doesNotMatch(JSON.stringify(result), /provider-secret|evil\.invalid/);
  }
});

test('rejects caller keys; live default off; transport called exactly 3 times', async () => {
  let calls = 0; const transport = async () => { calls += 1; return { status: 404 }; };
  for (const key of ['url', 'method', 'fields', 'customerId', 'customer_id', 'providerObjectId',
    'provider_object_id', 'status', 'payload', 'body', 'mutateOperations', 'operations']) {
    await assert.rejects(observer.observePausedGoogleAdsLedger(input(transport, { [key]: 'x' })),
      { code: 'caller_provider_control_rejected' });
  }
  assert.equal(calls, 0);
  assert.notEqual(process.env[observer.LIVE_OPT_IN_ENV], '1');
  let sockets = 0; const orig = https.request;
  https.request = () => { sockets += 1; throw new Error('NETWORK_FORBIDDEN'); };
  try {
    await assert.rejects(observer.observePausedGoogleAdsLedger(input(undefined)),
      (err) => err && err.code === 'live_google_ads_reconciliation_disabled');
    await assert.rejects(observer.observePausedGoogleAdsLedger(input(undefined, { allowLive: true })),
      (err) => err && err.code === 'live_google_ads_reconciliation_disabled');
    assert.equal(sockets, 0);
  } finally { https.request = orig; }
  const mixed = [{ status: 404 }, { status: 401 }, { status: 503 }];
  let n = 0;
  const result = await observer.observePausedGoogleAdsLedger(input(async () => mixed[n++]));
  assert.equal(n, 3);
  assert.deepEqual(result.observations.map((x) => x.outcome), ['missing', 'unauthorized', 'transient_failure']);
});

test('observer source has no write-connector symbols', () => {
  const src = fs.readFileSync(SRC, 'utf8');
  assert.doesNotMatch(src, /googleAds:mutate|createPausedGoogleAdsDraft/);
  assert.doesNotMatch(src, /google_ads_paused_draft\.js/);
});
