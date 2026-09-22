'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bindPage } = require('../services/agent_orchestrator/connectors/factory');
const { assertConnectorResult } = require('../services/agent_orchestrator/research_connector');
const req = { tenant_id: 9, research_run_id: 'fixture-retention', connector_id: 'meta_research', connector_version: '1.0.0' };

for (const name of ['meta', 'google', 'tiktok']) {
  test(`${name} fixture capture remains persistable years after the sample date`, (t) => {
    const now = Date.parse('2035-01-01T12:00:00Z');
    t.mock.timers.enable({ apis: ['Date'], now });
    const page = require(`../services/agent_orchestrator/fixtures/research/${name}.v1.json`);
    const original = JSON.stringify(page);
    const bound = assertConnectorResult(bindPage(page, { ...req, connector_id: `${name}_research` }, { mode: 'fixture' }), { tenantId: 9 });
    for (const row of [...bound.evidence, ...(bound.assets || [])]) {
      assert.equal(Date.parse(row.captured_at), now);
      assert.ok(Date.parse(row.expires_at) > now);
    }
    assert.equal(bound.evidence[0].provider_metrics.source, 'fixture');
    assert.equal(JSON.stringify(page), original, 'shared fixtures must remain immutable');
  });
}

test('fixture rebinding preserves explicit expiry and live binding preserves capture date', () => {
  const page = JSON.parse(JSON.stringify(require('../services/agent_orchestrator/fixtures/research/meta.v1.json')));
  page.evidence[0].expires_at = '2036-01-01T00:00:00.000Z';
  assert.equal(bindPage(page, req, { mode: 'fixture' }).evidence[0].expires_at, page.evidence[0].expires_at);
  // A competitor-only provider page has no fixture metric tags to relabel.
  const live = { ...page, evidence: [], assets: [], continuation_state: {} };
  const bound = bindPage(live, req, { mode: 'live' });
  assert.equal(bound.competitors[0].captured_at, page.competitors[0].captured_at);
});
