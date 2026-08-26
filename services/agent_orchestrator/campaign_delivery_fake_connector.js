'use strict';

const { fail } = require('./errors');
const D = require('./campaign_delivery_contracts');

const ALLOWED_SOURCES = new Set([
  D.OUTCOME_SOURCE_SANDBOX,
  D.OUTCOME_SOURCE_TEST_OPTS,
]);

function resolveHonestySource(raw) {
  if (raw == null || raw === '') return D.OUTCOME_SOURCE_SANDBOX;
  const source = String(raw);
  if (!ALLOWED_SOURCES.has(source)) fail('validation_failed', { field: 'source' });
  return source;
}

function simulateDelivery(input) {
  const scenario = input && input.scenario;
  const spec = scenario != null ? D.SCENARIO_MAP[scenario] : null;
  if (!spec) fail('validation_failed');
  const source = resolveHonestySource(input && input.source);
  return Object.freeze({
    scenario,
    outcome: spec.outcome,
    retryable: spec.retryable,
    errorCode: spec.errorCode,
    status: spec.status,
    source,
    simulated: true,
    published: false,
    external_action_taken: false,
    connector: D.CONNECTOR,
    platform: input.platform,
    intentId: input.intentId,
    outboxId: input.outboxId,
    attemptId: input.attemptId,
    attemptNumber: input.attemptNumber,
    generation: input.generation,
  });
}

module.exports = { simulateDelivery };
