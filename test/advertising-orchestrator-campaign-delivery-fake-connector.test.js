'use strict';

process.env.PERMISSION_ENFORCEMENT = 'on';
process.env.MULTITENANT_ENFORCEMENT = 'on';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const D = require('../services/agent_orchestrator/campaign_delivery_contracts');
const { simulateDelivery } = require('../services/agent_orchestrator/campaign_delivery_fake_connector');

const ROOT = path.join(__dirname, '..');
const NEW_MODULES = [
  'services/agent_orchestrator/campaign_delivery_attempts.js',
  'services/agent_orchestrator/campaign_delivery_worker.js',
  'services/agent_orchestrator/campaign_delivery_fake_connector.js',
  'services/agent_orchestrator/campaign_delivery_sandbox_outcomes.js',
];

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '');
}

function walkJs(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'legacy_archive') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkJs(p, acc);
    else if (/\.(js|ts|tsx)$/.test(ent.name)) acc.push(p);
  }
  return acc;
}

test('enforcement flags stay on', () => {
  assert.equal(process.env.PERMISSION_ENFORCEMENT, 'on');
  assert.equal(process.env.MULTITENANT_ENFORCEMENT, 'on');
});

test('eight scenarios map exactly; unknown fails closed; honesty flags frozen', () => {
  const cases = [
    ['success', 'ok', false, null, 'simulated_ok'],
    ['duplicate', 'duplicate', false, null, 'simulated_duplicate'],
    ['transient', 'error', true, 'simulated_transient', 'retry_transient'],
    ['rate_limit', 'error', true, 'simulated_rate_limited', 'retry_rate_limit'],
    ['timeout', 'error', true, 'simulated_timeout', 'retry_timeout'],
    ['permanent', 'error', false, 'simulated_permanent', 'dead_letter_permanent'],
    ['malformed', 'error', false, 'simulated_malformed', 'dead_letter_malformed'],
    ['blocked', 'error', false, 'simulated_blocked', 'dead_letter_blocked'],
  ];
  assert.deepStrictEqual([...D.SCENARIOS], cases.map((c) => c[0]));
  for (const [scenario, outcome, retryable, errorCode, status] of cases) {
    const r = simulateDelivery({
      scenario, platform: 'meta', intentId: 'cdi_1', outboxId: 'obx_1',
      attemptId: 'cda_1', attemptNumber: 1, generation: 1,
    });
    assert.equal(r.outcome, outcome, scenario);
    assert.equal(r.retryable, retryable, scenario);
    assert.equal(r.errorCode, errorCode, scenario);
    assert.equal(r.status, status, scenario);
    assert.equal(r.simulated, true, scenario);
    assert.equal(r.published, false, scenario);
    assert.equal(r.external_action_taken, false, scenario);
    assert.equal(r.connector, 'fake', scenario);
    assert.equal(r.source, D.OUTCOME_SOURCE_SANDBOX, scenario);
    assert.equal(r.scenario, scenario);
    assert.ok(Object.isFrozen(r), scenario);
    assert.deepStrictEqual(D.SCENARIO_MAP[scenario], {
      outcome, retryable, errorCode, status,
    });
  }

  assert.throws(
    () => simulateDelivery({ scenario: 'live_publish' }),
    (e) => e && e.code === 'validation_failed'
  );
  assert.throws(
    () => simulateDelivery({}),
    (e) => e && e.code === 'validation_failed'
  );
  assert.throws(
    () => simulateDelivery({ scenario: 'SUCCESS' }),
    (e) => e && e.code === 'validation_failed'
  );
});

test('honesty source accepts only sandbox or test_opts; arbitrary/live/provider fail closed', () => {
  const base = {
    scenario: 'success', platform: 'meta', intentId: 'cdi_1', outboxId: 'obx_1',
    attemptId: 'cda_1', attemptNumber: 1, generation: 1,
  };
  assert.equal(simulateDelivery(base).source, D.OUTCOME_SOURCE_SANDBOX);
  assert.equal(
    simulateDelivery({ ...base, source: D.OUTCOME_SOURCE_SANDBOX }).source,
    D.OUTCOME_SOURCE_SANDBOX
  );
  assert.equal(
    simulateDelivery({ ...base, source: D.OUTCOME_SOURCE_TEST_OPTS }).source,
    D.OUTCOME_SOURCE_TEST_OPTS
  );

  for (const source of [
    'live', 'provider', 'meta', 'production', 'real', 'published',
    'LIVE', 'Sandbox', 'test', 'opts', 'campaign_delivery_v1',
  ]) {
    assert.throws(
      () => simulateDelivery({ ...base, source }),
      (e) => e && e.code === 'validation_failed',
      source
    );
  }
});

test('scenario allowlist is exact own-key only; prototype and case variants fail closed', () => {
  const base = {
    platform: 'meta', intentId: 'cdi_1', outboxId: 'obx_1',
    attemptId: 'cda_1', attemptNumber: 1, generation: 1,
  };
  for (const scenario of D.SCENARIOS) {
    assert.equal(D.isKnownScenario(scenario), true, scenario);
    assert.ok(D.scenarioSpecOf(scenario));
    assert.equal(D.assertKnownScenario(scenario), scenario);
  }
  for (const scenario of [
    'constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty',
    'SUCCESS', 'Success', 'success ', ' success', '', null, undefined, 1, {},
  ]) {
    assert.equal(D.isKnownScenario(scenario), false, String(scenario));
    assert.equal(D.scenarioSpecOf(scenario), null, String(scenario));
    assert.throws(
      () => D.assertKnownScenario(scenario),
      (e) => e && e.code === 'validation_failed',
      String(scenario)
    );
    if (scenario != null && scenario !== '') {
      assert.throws(
        () => simulateDelivery({ ...base, scenario }),
        (e) => e && e.code === 'validation_failed',
        String(scenario)
      );
    }
  }
  // Truthiness on SCENARIO_MAP[raw] would wrongly accept these Object.prototype keys.
  assert.ok(D.SCENARIO_MAP.constructor);
  assert.ok(D.SCENARIO_MAP.toString);
  assert.equal(D.isKnownScenario('constructor'), false);
  assert.equal(D.isKnownScenario('__proto__'), false);
});

test('additive contract constants and backoff; parseDeliveryBody unchanged', () => {
  assert.equal(D.CONNECTOR, 'fake');
  assert.equal(D.AUDIT_EVENT_SIMULATED, 'campaign_delivery_attempt_simulated');
  assert.equal(D.MAX_ATTEMPTS, 8);
  assert.equal(D.LEASE_MS, 30000);
  assert.equal(D.PARK_INTERVAL_DAYS, 36500);
  assert.equal(D.WORKER_INTERVAL_MS, 2000);
  assert.equal(D.FLAG_ENV, 'INFOGENIE_CAMPAIGN_DELIVERY_WORKER');
  assert.equal(D.OUTCOME_SOURCE_SANDBOX, 'sandbox');
  assert.equal(D.OUTCOME_SOURCE_TEST_OPTS, 'test_opts');
  assert.deepStrictEqual([...D.ALLOWED_OUTCOME_SOURCES], ['sandbox', 'test_opts']);
  assert.equal(D.isAllowedOutcomeSource('sandbox'), true);
  assert.equal(D.isAllowedOutcomeSource('test_opts'), true);
  assert.equal(D.isAllowedOutcomeSource('live'), false);
  assert.equal(D.isAllowedOutcomeSource('secret'), false);
  assert.throws(() => D.assertAllowedOutcomeSource('live'), (e) => e && e.code === 'validation_failed');
  assert.throws(() => D.assertAllowedOutcomeSource('secret'), (e) => e && e.code === 'validation_failed');
  assert.equal(D.SKIP_REASON_NO_OUTCOME, 'no_outcome_source');
  assert.equal(D.delaySeconds(1), 2);
  assert.equal(D.delaySeconds(8), 256);
  assert.equal(D.delaySeconds(9), 256);
  assert.ok(D.delaySeconds(8) <= 300);
  const parsed = D.parseDeliveryBody({
    contract_version: 'campaign_delivery_v1',
    operation: 'create_provider_draft',
    platform: 'meta',
    idempotency_key: 'k1',
  });
  assert.deepStrictEqual(parsed, {
    contract_version: 'campaign_delivery_v1',
    operation: 'create_provider_draft',
    platform: 'meta',
    idempotency_key: 'k1',
  });
});

test('new modules are fake-only: no remote I/O, vault, credentials, or SDKs', () => {
  const requireBanned = /require\(\s*['"](?:node:)?(?:http|https|net|dns|tls|dgram|axios|node-fetch|undici)['"]\s*\)/;
  const identBanned = /\b(?:getCredentials|hasCredentials|checkCredentials)\s*\(/;
  const wordBanned = /\b(?:vault|oauth|axios|undici|node-fetch|facebook-nodejs|google-ads-api|business-sdk|tiktok-business)\b/i;
  for (const rel of NEW_MODULES) {
    const src = stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    assert.doesNotMatch(src, /\bfetch\s*\(/, rel);
    assert.doesNotMatch(src, requireBanned, rel);
    assert.doesNotMatch(src, identBanned, rel);
    assert.doesNotMatch(src, wordBanned, rel);
    assert.doesNotMatch(src, /ORCHESTRATOR_DELIVERY_WORKER/);
    assert.doesNotMatch(src, /outbox\.complete\s*\(/);
    assert.doesNotMatch(src, /outbox\.fail\s*\(/);
  }
});

test('ORCHESTRATOR_DELIVERY_WORKER is absent from product sources', () => {
  const files = [
    path.join(ROOT, 'server.js'),
    ...walkJs(path.join(ROOT, 'services')),
  ];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(src, /ORCHESTRATOR_DELIVERY_WORKER/, path.relative(ROOT, file));
  }
});
