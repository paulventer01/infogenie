const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync(require.resolve('../services/agent_orchestrator/schema'), 'utf8');
const table = source.slice(
  source.indexOf('CREATE TABLE IF NOT EXISTS orchestrator_campaign_activation_capabilities'),
  source.indexOf("await _ensureNamedUnique(p, 'orchestrator_campaign_provider_objects'")
);

test('PR7A activation capability is tenant-leading and binds the complete authority graph', () => {
  assert.match(table, /tenant_id INTEGER NOT NULL REFERENCES tenants\(id\) ON DELETE RESTRICT/);
  for (const column of [
    'actor_user_id', 'session_id_hash', 'draft_id', 'draft_revision', 'snapshot_hash',
    'publish_approval_id', 'publishing_request_id', 'intent_id', 'execution_id',
    'reconciliation_run_id', 'advertising_account_id_hash', 'credential_ref_id',
    'credential_ref_version', 'account_fingerprint', 'ledger_root_hash',
    'final_confirmation_hash', 'confirmed_at', 'expires_at', 'audit_ref',
  ]) assert.match(table, new RegExp(`\\b${column}\\b`), column);
  assert.match(table, /FOREIGN KEY \(tenant_id,execution_id\)/);
  assert.match(table, /FOREIGN KEY \(tenant_id,reconciliation_run_id\)/);
  assert.match(table, /PRIMARY KEY \(tenant_id,id\)/);
});

test('PR7A capability has single-use, replay-safe lifecycle constraints', () => {
  assert.match(table, /status IN \('issued','reserved','consumed','revoked','expired'\)/);
  assert.match(table, /orchestrator_cac_tenant_invocation_unique/);
  assert.match(table, /orchestrator_cac_tenant_reservation_unique/);
  assert.match(table, /OLD\.status='issued' AND NEW\.status IN \('reserved','revoked','expired'\)/);
  assert.match(table, /OLD\.status='reserved' AND NEW\.status IN \('consumed','revoked','expired'\)/);
  assert.match(table, /orchestrator_cac_invalid_transition/);
  assert.match(table, /orchestrator_cac_reservation_mismatch/);
  assert.match(table, /orchestrator_cac_delete_prohibited/);
});

test('PR7A capability bindings and bounded expiry are database-immutable', () => {
  assert.match(table, /orchestrator_cac_immutable_binding/);
  for (const column of [
    'tenant_id', 'actor_user_id', 'session_id_hash', 'draft_id', 'draft_revision',
    'snapshot_hash', 'publishing_request_id', 'intent_id', 'execution_id',
    'reconciliation_run_id', 'credential_ref_id', 'credential_ref_version',
    'account_fingerprint', 'ledger_root_hash', 'final_confirmation_hash', 'expires_at',
  ]) assert.match(table, new RegExp(`NEW\\.${column} IS DISTINCT FROM OLD\\.${column}`), column);
  assert.match(table, /confirmed_at <= issued_at AND expires_at > issued_at/);
  assert.doesNotMatch(table, /graph\.facebook|\/act_|effective_status|status\s*=\s*'ACTIVE'/i);
});
