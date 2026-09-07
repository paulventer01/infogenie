'use strict';
const {test,before}=require('node:test');const assert=require('node:assert/strict');
const db=require('../../db');const {ensureAuthSchema}=require('../../services/auth/schema');
const {ensureTenantSchema}=require('../../services/tenants/schema');
const {ensureAgentOrchestratorSchema}=require('../../services/agent_orchestrator/schema');
const R=require('../../services/agent_orchestrator/google_ads_post_activation_rereconciliation');

if(!db.hasDb())test('Google post-review re-reconciliation PostgreSQL requires DATABASE_URL',{skip:'no DATABASE_URL'},()=>{});else{
 before(async()=>{await ensureAuthSchema();await ensureTenantSchema();await ensureAgentOrchestratorSchema();});

 test('PostgreSQL installs a tenant-leading, sanitized, one-attempt ledger',async()=>{const p=db.getPool();
  const columns=(await p.query(`SELECT column_name FROM information_schema.columns WHERE table_name=$1`,[R.TABLE])).rows.map(x=>x.column_name);
  for(const required of ['tenant_id','review_case_id','review_version','closure_event_id','original_reconciliation_run_id',
   'activation_attempt_id','activation_status','invocation_id_hash','requested_by','session_id_hash','workflow_id','state',
   'observations','classifications','audit_ref','observing_at','observation_deadline','completed_at'])assert.ok(columns.includes(required),required);
  for(const forbidden of ['provider_object_id','customer_id','credential_ref_id','account_fingerprint','ledger_root_hash',
   'access_token','refresh_token','request_url','query','request_payload','provider_response','raw_error'])
   assert.equal(columns.includes(forbidden),false,forbidden);
  for(const name of ['orchestrator_gaparra_unique_case','orchestrator_gaparra_unique_invocation','orchestrator_gaparra_unique_audit',
   'orchestrator_gaparra_case_fkey','orchestrator_gaparra_event_fkey','orchestrator_gaparra_source_fkey',
   'orchestrator_gaparra_attempt_fkey','orchestrator_gaparra_hash_check','orchestrator_gaparra_state_check',
   'orchestrator_gaparra_observations_check','orchestrator_gaparra_evidence_check','orchestrator_gaparra_time_check'])assert.equal((await p.query(
    'SELECT count(*)::int n FROM pg_constraint WHERE conname=$1',[name])).rows[0].n,1,name);
 });

 test('database guards bind the closed D4 case, closure event and exact D3 evidence',async()=>{const p=db.getPool();
  const guard=(await p.query(`SELECT pg_get_functiondef(tgfoid) definition FROM pg_trigger
    WHERE tgname='orchestrator_gaparra_guard' AND NOT tgisinternal`)).rows[0].definition;
  for(const invariant of [/external_remediation_required/i,/review\.version\s*<>\s*new\.review_version/i,
   /event\.case_version\s*<>\s*review\.version/i,/source\.id\s*<>\s*review\.reconciliation_run_id/i,
   /source\.observing_at\s+IS DISTINCT FROM\s+review\.source_observing_at/i,
   /orchestrator_gaparv_safe_observations\(source\.observations\)/i,/orchestrator_gaparra_invalid_provenance/i,
   /orchestrator_gaparra_immutable_or_invalid_transition/i,/orchestrator_gaparra_delete_prohibited/i])
   assert.match(guard,invariant);
  const consistent=(await p.query(`SELECT pg_get_functiondef(tgfoid) definition FROM pg_trigger
    WHERE tgname='orchestrator_gaparra_consistency'`)).rows[0].definition;
  assert.ok(consistent.includes('orchestrator_gaparra_audit_inconsistent'));
  assert.ok(consistent.includes('post_activation_rereconciliation_attempt_id'));
 });

 test('PostgreSQL constraints admit only clean observing and bounded terminal metadata',async()=>{const c=await db.getPool().connect();
  try{await c.query(`CREATE TEMP TABLE gaparra_probe
    (LIKE orchestrator_google_ads_post_activation_rereconciliation_attempts INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
   const insert=`INSERT INTO gaparra_probe(tenant_id,id,review_case_id,review_version,closure_event_id,
    original_reconciliation_run_id,activation_attempt_id,activation_status,invocation_id_hash,requested_by,session_id_hash,
    workflow_id,state,observations,classifications,audit_ref,observing_at,observation_deadline,completed_at)
    VALUES(1,$1,'gaparv_case',2,1,'gapar_source','attempt',$2,repeat('a',64),1,repeat('b',64),'wf',$3,
      $4::jsonb,$5::text[],$6,statement_timestamp(),statement_timestamp()+interval '1 minute',
      CASE WHEN $7 THEN statement_timestamp() ELSE NULL END)`;
   await c.query(insert,['gaparra_observing','unknown','observing','[]','{}','audit-observing',false]);
   await c.query(insert,['gaparra_failed','succeeded','failed','[]','{observation_failure}','audit-failed',true]);
   await c.query(insert,['gaparra_partial','unknown','failed','[{"object_kind":"campaign_budget","outcome":"malformed","status_classification":"unknown","account_binding_matches":"unknown","campaign_parent_matches":"not_applicable","budget_parent_matches":"not_applicable","error_classification":null,"observed_at":null}]','{partial_observation}','audit-partial',true]);
   await assert.rejects(c.query(insert,['gaparra_bad-review','succeeded','failed','[]','{}','audit-review',false]),e=>e.code==='23514');
   await assert.rejects(c.query(insert,['gaparra_bad-state','succeeded','pending','[]','{}','audit-state',true]),e=>e.code==='23514');
   await assert.rejects(c.query(insert,['gaparra_dirty','unknown','observing','[{"object_kind":"campaign"}]','{}','audit-dirty',false]),e=>e.code==='23514');
   await assert.rejects(c.query(insert,['gaparra_secret','unknown','failed','[{"object_kind":"campaign","customer_id":"123"}]','{}','audit-secret',true]),e=>e.code==='23514');
   await assert.rejects(c.query(insert,['gaparra_false-verified','unknown','verified_active','[]','{}','audit-false',true]),e=>e.code==='23514');
  }finally{c.release();}
 });
}
