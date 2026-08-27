'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../services/agent_orchestrator/meta_paused_draft_reconciliation');

function observation(kind, overrides = {}) {
  return {
    object_kind: kind,
    outcome: 'observed',
    status_classification: kind === 'creative' ? 'not_applicable' : 'paused',
    account_binding_matches: true,
    campaign_parent_matches: kind === 'campaign' || kind === 'creative' ? 'not_applicable' : true,
    adset_parent_matches: kind === 'ad' ? true : 'not_applicable',
    creative_link_matches: kind === 'ad' ? true : 'not_applicable',
    observed_at: '2026-08-27T00:00:00.000Z',
    ...overrides,
  };
}
function graph(overrides = {}) {
  const observations = R.KINDS.map((kind) => observation(kind, overrides[kind] || {}));
  return { attempted_observations: 4, completed_observations: 4, observations };
}

test('fully observed paused four-object graph verifies', () => {
  const result = R.evaluate(graph());
  assert.equal(result.state, 'verified');
  assert.deepEqual(result.classifications, []);
  assert.equal(result.observations.length, 4);
});

for (const kind of ['campaign', 'adset', 'ad']) {
  test(`${kind} ACTIVE or delivering is a discrepancy`, () => {
    const active = R.evaluate(graph({ [kind]: { status_classification: kind === 'ad' ? 'delivering' : 'active' } }));
    assert.equal(active.state, 'discrepancy_detected');
    assert.deepEqual(active.classifications, [`${kind}_${kind === 'ad' ? 'delivering' : 'active'}`]);
  });
}

test('missing Creative requires human-review discrepancy', () => {
  const result = R.evaluate(graph({ creative: { outcome: 'missing', error_classification: 'not_found' } }));
  assert.equal(result.state, 'discrepancy_detected');
  assert.deepEqual(result.classifications, ['creative_missing']);
});

test('wrong account and every wrong relationship fail closed as discrepancies', () => {
  const result = R.evaluate(graph({
    campaign: { account_binding_matches: false },
    adset: { campaign_parent_matches: false },
    ad: { campaign_parent_matches: false, adset_parent_matches: false, creative_link_matches: false },
  }));
  assert.equal(result.state, 'discrepancy_detected');
  assert.deepEqual(result.classifications, [
    'ad_adset_mismatch', 'ad_campaign_mismatch', 'ad_creative_mismatch',
    'adset_campaign_mismatch', 'campaign_account_mismatch',
  ]);
});

test('unknown status and unknown bindings are never treated as safe', () => {
  const result = R.evaluate(graph({ campaign: { status_classification: 'unknown', account_binding_matches: 'unknown' } }));
  assert.equal(result.state, 'discrepancy_detected');
  assert.deepEqual(result.classifications, ['campaign_account_mismatch', 'campaign_unsafe_status']);
});

test('partial or duplicate observations fail rather than verify', () => {
  const partial = graph(); partial.completed_observations = 3; partial.observations.pop();
  assert.deepEqual(R.evaluate(partial).classifications, ['partial_observation']);
  const duplicate = graph(); duplicate.observations[3] = observation('campaign');
  assert.equal(R.evaluate(duplicate).state, 'failed');
});

test('provider timeout, unauthorized, malformed, oversized, and permanent/transient responses remain failures', () => {
  for (const error of ['provider_unavailable', 'provider_unauthorized', 'invalid_provider_response', 'response_too_large', 'provider_rejected', 'rate_limited']) {
    const result = R.evaluate(graph({ campaign: { outcome: error === 'rate_limited' ? 'transient_failure' : 'permanent_failure', error_classification: error } }));
    assert.equal(result.state, 'failed');
    assert.deepEqual(result.classifications, [`campaign_${error}`]);
  }
});

test('public contract is sanitized and exposes only operational evidence', () => {
  const row = {
    id: 'mrr_safe', state: 'discrepancy_detected', observations: graph().observations,
    classifications: ['ad_active'], audit_ref: 'mrr-audit:safe', created_at: 'now', completed_at: 'later',
    provider_object_id: 'provider-secret', account_fingerprint: 'account-secret', credential_ref_id: 'vault-secret',
  };
  const output = R.publicRun(row); const serialized = JSON.stringify(output);
  assert.deepEqual(Object.keys(output).sort(), ['audit_reference','completed_at','created_at','discrepancy_classifications','failure_classifications','object_kinds','observations','reconciliation_run_id','state']);
  assert.doesNotMatch(serialized, /provider-secret|account-secret|vault-secret|provider_object_id|account_fingerprint|credential/i);
});

test('module has no provider mutation reachability', () => {
  const src = require('fs').readFileSync(require.resolve('../services/agent_orchestrator/meta_paused_draft_reconciliation'), 'utf8');
  assert.doesNotMatch(src, /require\(['"].*meta_paused_draft['"]\)|https\.request|\bPOST\b|\bPUT\b|\bPATCH\b|\bDELETE\b/);
});
