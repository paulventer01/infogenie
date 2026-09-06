'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../services/agent_orchestrator/schema'),'utf8');
test('Google activation capability is separate, tenant-leading and immutable',()=>{
 assert.match(source,/CREATE TABLE IF NOT EXISTS orchestrator_google_ads_activation_capabilities\(/);
 assert.match(source,/PRIMARY KEY\(tenant_id,id\)/);assert.match(source,/UNIQUE\(tenant_id,reconciliation_run_id\)/);
 assert.match(source,/orchestrator_gaac_guard BEFORE INSERT OR UPDATE OR DELETE/);
 assert.match(source,/orchestrator_gaac_reservation_unique/);assert.match(source,/orchestrator_gaac_invocation_unique/);
});
test('schema binds full Google authority and consume-once review lineage',()=>{
 for(const name of ['workflow_id','draft_revision','contract_hash','publishing_request_id','publish_approval_id','workflow_approval_id','snapshot_hash','intent_id','intent_hash','operation_id','source_authorization_id','reconciliation_run_id','rereconciliation_attempt_id','credential_owner_user_id','credential_ref_id','credential_ref_version','account_fingerprint','ledger_root_hash'])assert.match(source,new RegExp(name));
 assert.match(source,/status IN\('issued','reserved','consumed','revoked','expired'\)/);
 assert.match(source,/review_case_id IS NOT NULL AND review_version>=1 AND closure_event_id IS NOT NULL/);
 assert.match(source,/confirmed_at<=issued_at AND confirmed_at>=issued_at-interval '5 minutes' AND expires_at>issued_at/);
 assert.match(source,/confirmed_at>=issued_at-interval '5 minutes'/);
 assert.match(source,/_ensureNamedCheck\(p, 'orchestrator_google_ads_activation_capabilities',[\s\S]*'orchestrator_gaac_lifecycle'/);
 assert.match(source,/expires_at<=issued_at\+interval '10 minutes'/);
 assert.match(source,/expires_at<=approval_expires_at/);
 assert.match(source,/source_graph\.approval_expires_at IS DISTINCT FROM NEW\.approval_expires_at/);
 assert.match(source,/ADD COLUMN IF NOT EXISTS approval_expires_at TIMESTAMPTZ/);
 assert.match(source,/reserved_at IS NULL OR \(reserved_at>=issued_at/);
 assert.match(source,/consumed_at IS NULL OR \(consumed_at>=reserved_at/);
 assert.match(source,/reserved_at<=expires_at/);
 assert.match(source,/consumed_at<=expires_at/);
 assert.match(source,/revoked_at IS NULL OR revoked_at>=issued_at/);
 assert.match(source,/TG_OP='INSERT'/);assert.match(source,/orchestrator_gaac_invalid_initial_state/);
 assert.match(source,/status='consumed'[\s\S]*revoked_by IS NULL/);
 assert.match(source,/status='expired'[\s\S]*revoked_by IS NULL/);
 assert.match(source,/OLD\.status='issued' AND NEW\.status IN\('revoked','expired'\)/);
 assert.match(source,/NEW\.reservation_id_hash IS NOT NULL OR NEW\.reserved_at IS NOT NULL/);
 assert.match(source,/orchestrator_google_ads_rereconciliation_attempts/);
 assert.match(source,/review_attempt\.new_authorization_id<>NEW\.source_authorization_id/);
 assert.match(source,/review_attempt\.new_reconciliation_run_id<>NEW\.reconciliation_run_id/);
 assert.match(source,/orchestrator_gaac_invalid_source_provenance/);
 for(const field of ['authorization_id','operation_id','workflow_approval_id','request_workflow_approval_id','credential_owner_user_id','credential_ref_owner_user_id'])
  assert.match(source,new RegExp(`source_graph\\.${field}`));
});
