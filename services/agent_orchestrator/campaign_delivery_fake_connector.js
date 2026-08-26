'use strict';

const { fail } = require('./errors');
const D = require('./campaign_delivery_contracts');

function simulateDelivery(input) {
  const scenario = input && input.scenario;
  const spec = D.scenarioSpecOf(scenario);
  if (!spec) fail('validation_failed');
  const source = D.assertAllowedOutcomeSource(input && input.source, { allowEmptyDefault: true });
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
