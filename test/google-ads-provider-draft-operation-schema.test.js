'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const schemaSource = fs.readFileSync(
  require.resolve('../services/agent_orchestrator/schema'), 'utf8'
);

const SLICE_START = '// PR10B.1 — tenant-leading Google Ads provider-operation ledger';
const SLICE_END = '// PR 8C — consumes one approved';

function operationSlice() {
  const start = schemaSource.indexOf(SLICE_START);
  const end = schemaSource.indexOf(SLICE_END, start);
  assert.ok(start >= 0 && end > start, 'PR10B.1 DDL slice markers must exist');
  return schemaSource.slice(start, end);
}

test('Google Ads provider-operation ledger is tenant-leading with bounded statuses and uniqueness', () => {
  assert.match(schemaSource,
    /CREATE TABLE IF NOT EXISTS orchestrator_google_ads_provider_draft_operations\([\s\S]*?PRIMARY KEY\(tenant_id,id\)/);
  assert.match(schemaSource, /status IN \('pending','in_progress','succeeded','failed','unknown'\)/);
  assert.match(schemaSource, /orchestrator_gapdo_tenant_unique_idemp/);
  assert.match(schemaSource, /orchestrator_gapdo_tenant_unique_capability/);
  assert.match(schemaSource, /orchestrator_gapdo_tenant_unique_invocation/);
  assert.match(schemaSource, /orchestrator_gapdo_tenant_unique_opkey/);
  assert.match(schemaSource, /orchestrator_gapdo_tenant_unique_audit/);
  assert.match(schemaSource, /orchestrator_gapdo_one_live_operation/);
});

test('Google Ads provider-operation ledger enforces PR10B.2 mutation fence and names the guard trigger', () => {
  assert.match(schemaSource,
    /published=FALSE AND activated=FALSE[\s\S]*external_action_taken=\(status='succeeded' AND result_code='provider_create_succeeded'\)/);
  assert.match(schemaSource,
    /OLD\.external_action_taken=FALSE AND NEW\.external_action_taken=TRUE[\s\S]*provider_create_succeeded/);
  assert.match(schemaSource, /DROP CONSTRAINT IF EXISTS orchestrator_gapdo_no_mutation_check/);
  assert.match(schemaSource, /CREATE OR REPLACE FUNCTION orchestrator_gapdo_guard\(\)/);
  assert.match(schemaSource, /DROP TRIGGER IF EXISTS orchestrator_gapdo_guard ON orchestrator_google_ads_provider_draft_operations/);
  assert.match(schemaSource, /CREATE TRIGGER orchestrator_gapdo_guard BEFORE INSERT OR UPDATE OR DELETE/);
  assert.match(schemaSource, /orchestrator_gapdo_audit_evidence/);
  assert.match(schemaSource, /orchestrator_gapdo_invalid_insert/);
});

test('Google Ads provider-operation ledger stores hashes, not secrets or provider URLs', () => {
  const slice = operationSlice();
  assert.doesNotMatch(slice,
    /\b(?:access_token|refresh_token|client_secret|developer_token|authorization_code|authorization_header|customer_id|provider_response|provider_url)\b/i);
  assert.match(slice, /account_fingerprint TEXT NOT NULL/);
  assert.match(slice, /ON DELETE RESTRICT/);
});

test('ADVERTISING_ORCH_TABLES lists the Google Ads operation ledger and not the global kill switch', () => {
  const start = schemaSource.indexOf('const ADVERTISING_ORCH_TABLES = [');
  const end = schemaSource.indexOf('];', start);
  assert.ok(start >= 0 && end > start);
  const list = schemaSource.slice(start, end + 2);
  assert.match(list, /'orchestrator_google_ads_provider_draft_operations'/);
  assert.doesNotMatch(list, /'orchestrator_advertising_global_kill_switches'/);
});

test('PR10B.1 does not alter the Meta platform=\'meta\' frozen check', () => {
  const slice = operationSlice();
  assert.doesNotMatch(slice, /platform\s*=\s*'meta'/);
  assert.match(schemaSource, /CONSTRAINT orchestrator_cpdex_frozen_check CHECK \(\s*contract_version = 'campaign_delivery_v1'\s*AND operation = 'create_provider_draft'\s*AND platform = 'meta'\s*AND connector = 'meta'\s*\)/);
  assert.match(schemaSource, /CONSTRAINT orchestrator_tmcr_platform_check CHECK \(platform = 'meta'\)/);
});
