'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const schemaSource = fs.readFileSync(
  require.resolve('../services/agent_orchestrator/schema'), 'utf8'
);

const TABLE = 'orchestrator_google_ads_reconciliation_read_authorizations';
const RUNS = 'orchestrator_google_ads_reconciliation_runs';
const SLICE_START = '// PR10C.1 — tenant-leading Google Ads reconciliation read-authorizations';
const SLICE_END = '// PR 8C — consumes one approved';

function slice() {
  const first = schemaSource.indexOf(SLICE_START);
  const start = schemaSource.indexOf(SLICE_START, first + 1);
  const end = schemaSource.indexOf(SLICE_END, start);
  assert.ok(first >= 0 && start > first && end > start, 'PR10C.1 DDL slice markers must exist');
  return schemaSource.slice(start, end);
}

function tablesList() {
  const start = schemaSource.indexOf('const ADVERTISING_ORCH_TABLES = [');
  const end = schemaSource.indexOf('];', start);
  assert.ok(start >= 0 && end > start);
  return schemaSource.slice(start, end + 2);
}

test('ADVERTISING_ORCH_TABLES lists Google Ads reconciliation read-authorizations beside the other Google Ads tables', () => {
  const list = tablesList();
  assert.match(list, /'orchestrator_google_ads_provider_draft_objects'/);
  assert.match(list, new RegExp(`'${TABLE}'`));
  assert.ok(list.indexOf(`'${TABLE}'`) > list.indexOf("'orchestrator_google_ads_provider_draft_objects'"));
  assert.match(list, new RegExp(`'${RUNS}'`));
  assert.ok(list.indexOf(`'${RUNS}'`) > list.indexOf(`'${TABLE}'`));
  assert.doesNotMatch(list, /'orchestrator_advertising_global_kill_switches'/);
});

test('Google Ads reconciliation read-authorizations are tenant-leading with Google object kinds and CRRA statuses', () => {
  const ddl = slice();
  assert.match(ddl, new RegExp(`CREATE TABLE IF NOT EXISTS ${TABLE}\\([\\s\\S]*?PRIMARY KEY\\(tenant_id,id\\)`));
  assert.match(ddl, /REFERENCES tenants\(id\) ON DELETE RESTRICT/);
  assert.match(ddl, /expected_object_kinds = ARRAY\['campaign_budget','campaign','ad_group'\]::TEXT\[\]/);
  assert.match(ddl, /status IN \('issued','reserved','consumed','revoked','expired'\)/);
  assert.match(ddl, /orchestrator_garr_tenant_unique_operation_ledger/);
  assert.match(ddl, /UNIQUE\(tenant_id,operation_id,ledger_root_hash\)/);
  assert.match(ddl, /orchestrator_garr_unique_invocation/);
  assert.match(ddl, /id~'\^garr_'/);
  assert.match(ddl, /session_id_hash TEXT NOT NULL/);
  assert.match(ddl, /CREATE OR REPLACE FUNCTION orchestrator_garr_guard\(\)/);
  assert.match(ddl, /orchestrator_garr_audit_evidence/);
  assert.match(ddl, /orchestrator_garr_invalid_insert/);
  assert.match(ddl, /orchestrator_garr_immutable_binding/);
  assert.match(ddl, /orchestrator_garr_invalid_transition/);
  assert.match(ddl, /orchestrator_garr_operation_lineage/);
  assert.match(ddl, /orchestrator_garr_object_lineage/);
  assert.match(ddl, /issued'\s+AND NEW\.status IN \('reserved','revoked','expired'\)/);
  assert.match(ddl, /reserved'\s+AND NEW\.status IN \('consumed','revoked','expired'\)/);
  assert.match(ddl, /OLD\.status IN \('consumed','revoked','expired'\)/);
  assert.match(ddl, new RegExp(`CREATE TABLE IF NOT EXISTS ${RUNS}\\([\\s\\S]*?PRIMARY KEY\\(tenant_id,id\\)`));
  const create = ddl.slice(ddl.indexOf(`CREATE TABLE IF NOT EXISTS ${TABLE}`),
    ddl.indexOf('CREATE UNIQUE INDEX'));
  assert.doesNotMatch(create, /\bserving\b|\bENABLED\b/);
});

test('Google Ads reconciliation read-authorizations store hashes, not secrets or raw account identifiers', () => {
  const ddl = slice();
  assert.doesNotMatch(ddl,
    /\b(?:access_token|refresh_token|client_secret|developer_token|authorization_code|authorization_header|customer_id|provider_response|provider_url)\b/i);
  assert.match(ddl, /account_fingerprint TEXT NOT NULL/);
  assert.match(ddl, /ON DELETE RESTRICT/);
});

test('PR10C.1 does not mutate Meta CRRA or the platform=\'meta\' freeze', () => {
  const ddl = slice();
  assert.doesNotMatch(ddl, /orchestrator_campaign_reconciliation_read_authorizations/);
  assert.doesNotMatch(ddl, /platform\s*=\s*'meta'/);
  assert.match(schemaSource,
    /CREATE TABLE IF NOT EXISTS orchestrator_campaign_reconciliation_read_authorizations \(/);
  assert.match(schemaSource,
    /expected_object_kinds = ARRAY\['campaign','adset','creative','ad'\]::TEXT\[\]/);
  assert.match(schemaSource,
    /CONSTRAINT orchestrator_cpdex_frozen_check CHECK \(\s*contract_version = 'campaign_delivery_v1'\s*AND operation = 'create_provider_draft'\s*AND platform = 'meta'\s*AND connector = 'meta'\s*\)/);
  assert.match(schemaSource, /CONSTRAINT orchestrator_tmcr_platform_check CHECK \(platform = 'meta'\)/);
  assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS orchestrator_campaign_reconciliation_runs \(/);
});


test('PR10C.4 upgrade backfills credential ownership before restoring the immutable guard', () => {
  const ddl = slice();
  const drop = ddl.indexOf('DROP TRIGGER IF EXISTS orchestrator_garr_guard');
  const addOwner = ddl.indexOf('ADD COLUMN IF NOT EXISTS credential_owner_user_id');
  const backfill = ddl.indexOf('SET credential_owner_user_id=requested_by');
  const enforce = ddl.indexOf('ALTER COLUMN credential_owner_user_id SET NOT NULL');
  const guard = ddl.indexOf('CREATE OR REPLACE FUNCTION orchestrator_garr_guard()');
  const recreate = ddl.indexOf('CREATE TRIGGER orchestrator_garr_guard', guard);
  assert.ok(drop >= 0 && drop < addOwner);
  assert.ok(addOwner < backfill && backfill < enforce);
  assert.ok(enforce < guard && guard < recreate);
  assert.equal(ddl.indexOf('SET credential_owner_user_id=requested_by', backfill + 1), -1,
    'credential-owner migration must have exactly one ordered backfill');
});

test('PR10C.3 decision-hash constraint preserves legacy rows while enforcing new writes', () => {
  const ddl = slice();
  assert.match(ddl,
    /ADD CONSTRAINT orchestrator_garevent_payload_hash_check[\s\S]*?from_state IS NOT NULL AND decision_payload_hash IS NOT NULL[\s\S]*?decision_payload_hash~'\^\[0-9a-f\]\{64\}\$'\)\) NOT VALID;/);
});
