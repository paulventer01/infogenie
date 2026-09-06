'use strict';
const {test,before}=require('node:test'),assert=require('node:assert/strict');
const db=require('../../db'),{ensureAuthSchema}=require('../../services/auth/schema'),{ensureTenantSchema}=require('../../services/tenants/schema');
const {ensureAgentOrchestratorSchema}=require('../../services/agent_orchestrator/schema');
if(!db.hasDb())test('Google activation execution PostgreSQL requires DATABASE_URL',{skip:'no DATABASE_URL'},()=>{});else{
 before(async()=>{await ensureAuthSchema();await ensureTenantSchema();await ensureAgentOrchestratorSchema();});
 test('PostgreSQL installs the sanitized, tenant-leading activation ledger and immutable guard',async()=>{
  const p=db.getPool(),table='orchestrator_google_ads_activation_attempts';
  const columns=(await p.query(`SELECT column_name,is_nullable FROM information_schema.columns WHERE table_name=$1`,[table])).rows;
  for(const required of ['tenant_id','capability_id','session_id_hash','objects_digest','invocation_id_hash','status',
   'objects_expected','objects_activated','requires_reconciliation','external_action_taken'])
   assert.ok(columns.some(x=>x.column_name===required),required);
  for(const forbidden of ['provider_object_id','customer_id','request_url','request_payload','provider_response','access_token','refresh_token','error'])
   assert.equal(columns.some(x=>x.column_name===forbidden),false,forbidden);
  for(const name of ['orchestrator_gaact_hashes','orchestrator_gaact_status','orchestrator_gaact_result','orchestrator_gaact_counts','orchestrator_gaact_time'])
   assert.equal((await p.query('SELECT count(*)::int n FROM pg_constraint WHERE conname=$1',[name])).rows[0].n,1,name);
  assert.equal((await p.query(`SELECT count(*)::int n FROM pg_trigger WHERE tgname='orchestrator_gaact_guard' AND NOT tgisinternal`)).rows[0].n,1);
  const guard=(await p.query(`SELECT pg_get_functiondef(tgfoid) definition FROM pg_trigger
    WHERE tgname='orchestrator_gaact_guard' AND NOT tgisinternal`)).rows[0].definition;
  for(const invariant of ['orchestrator_gaact_audit_evidence','orchestrator_gaact_invalid_initial_state',
   'orchestrator_gaact_invalid_provenance','orchestrator_gaact_immutable_or_invalid_transition'])
   assert.ok(guard.includes(invariant),invariant);
  const outcomeColumns=(await p.query(`SELECT column_name FROM information_schema.columns
    WHERE table_name='orchestrator_google_ads_activation_object_outcomes'`)).rows.map(x=>x.column_name);
  for(const required of ['activation_attempt_id','object_kind','sequence_number','outcome','result_code'])
    assert.ok(outcomeColumns.includes(required),required);
  for(const forbidden of ['provider_object_id','customer_id','request_payload','provider_response','error'])
    assert.equal(outcomeColumns.includes(forbidden),false,forbidden);
  assert.equal((await p.query(`SELECT count(*)::int n FROM pg_trigger
    WHERE tgname='orchestrator_gaacto_guard' AND NOT tgisinternal`)).rows[0].n,1);
 });

 test('PostgreSQL result constraints encode success, determinate failure and ambiguous unknown without skips',async()=>{
  const c=await db.getPool().connect();
  try{
   await c.query(`CREATE TEMP TABLE gaact_result_probe
     (LIKE orchestrator_google_ads_activation_attempts INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
   const base=`INSERT INTO gaact_result_probe(tenant_id,id,capability_id,actor_user_id,session_id_hash,workflow_id,
    operation_id,reconciliation_run_id,credential_owner_user_id,credential_ref_id,credential_ref_version,
    account_fingerprint,ledger_root_hash,objects_digest,invocation_id_hash,status,result_code,objects_expected,
    objects_activated,requires_reconciliation,external_action_taken,created_at,started_at,settled_at,audit_ref)
    VALUES(1,$1,'cap',1,repeat('a',64),'wf','op','run',1,'cred',1,repeat('b',64),repeat('c',64),
      repeat('d',64),repeat('e',64),$2,$3,2,$4,$5,$6,statement_timestamp(),statement_timestamp(),
      CASE WHEN $7::boolean THEN statement_timestamp() ELSE NULL END,$8)`;
   await c.query(base,['progress','in_progress',null,0,false,false,false,'audit-progress']);
   await c.query(base,['success','succeeded','provider_activation_succeeded',2,false,true,true,'audit-success']);
   await c.query(base,['failed','failed','provider_activation_failed',0,false,false,true,'audit-failed']);
   await c.query(base,['unknown','unknown','provider_activation_unknown',0,true,null,true,'audit-unknown']);
   await assert.rejects(c.query(base,['partial','succeeded','provider_activation_succeeded',1,false,true,true,'audit-partial']),e=>e.code==='23514');
   await assert.rejects(c.query(base,['unsafe','unknown','provider_activation_unknown',0,true,false,true,'audit-unsafe']),e=>e.code==='23514');
   await assert.rejects(c.query(`UPDATE gaact_result_probe SET status='failed' WHERE id='success'`),e=>e.code==='23514');
  }finally{c.release();}
 });
}
