'use strict';
const test=require('node:test'); const assert=require('node:assert/strict'); const fs=require('fs');
const source=fs.readFileSync(require.resolve('../services/agent_orchestrator/schema'),'utf8');

test('PR7B activation attempt is tenant-leading, single-use and terminally immutable',()=>{
  assert.match(source,/CREATE TABLE IF NOT EXISTS orchestrator_campaign_activation_attempts/);
  assert.match(source,/UNIQUE \(tenant_id,capability_id\)/);
  assert.match(source,/UNIQUE \(tenant_id,invocation_id_hash\)/);
  assert.match(source,/orchestrator_caa_terminal_immutable/);
  assert.match(source,/state IN \('started','activated','failed','partial_failure','outcome_unknown','compensated'\)/);
});

test('PR7B object outcomes are safe and database append-only',()=>{
  assert.match(source,/CREATE TABLE IF NOT EXISTS orchestrator_campaign_activation_events/);
  assert.match(source,/object_kind IN \('campaign','adset','creative','ad'\)/);
  assert.match(source,/orchestrator_cae_append_only/);
  const table=source.match(/CREATE TABLE IF NOT EXISTS orchestrator_campaign_activation_events \([\s\S]*?\n    \);/)[0];
  assert.doesNotMatch(table,/provider_object_id/);
});
