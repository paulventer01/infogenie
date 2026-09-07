'use strict';
const {test,before}=require('node:test');
const assert=require('node:assert/strict');
const db=require('../../db');
const {ensureAuthSchema}=require('../../services/auth/schema');
const {ensureTenantSchema}=require('../../services/tenants/schema');
const {ensureAgentOrchestratorSchema}=require('../../services/agent_orchestrator/schema');

if(!db.hasDb())test('Google post-activation reconciliation PostgreSQL requires DATABASE_URL',{skip:'no DATABASE_URL'},()=>{});else{
 before(async()=>{await ensureAuthSchema();await ensureTenantSchema();await ensureAgentOrchestratorSchema();});

 test('PostgreSQL installs a tenant-leading sanitized post-activation run ledger',async()=>{
  const p=db.getPool(),table='orchestrator_google_ads_post_activation_reconciliation_runs';
  const columns=(await p.query(`SELECT column_name,is_nullable FROM information_schema.columns WHERE table_name=$1`,[table])).rows;
  for(const required of ['tenant_id','activation_attempt_id','activation_status','invocation_id_hash','requested_by',
    'session_id_hash','workflow_id','state','observations','classifications','observation_deadline','completed_at'])
    assert.ok(columns.some(x=>x.column_name===required),required);
  for(const forbidden of ['provider_object_id','customer_id','request_url','query','request_payload','provider_response',
    'access_token','refresh_token','error','operation_id','credential_owner_user_id','credential_ref_id',
    'credential_ref_version','account_fingerprint','ledger_root_hash','objects_digest'])
    assert.equal(columns.some(x=>x.column_name===forbidden),false,forbidden);
  for(const name of ['orchestrator_gapar_hashes','orchestrator_gapar_activation','orchestrator_gapar_state',
    'orchestrator_gapar_time','orchestrator_gapar_observations','orchestrator_gapar_initial'])
    assert.equal((await p.query('SELECT count(*)::int n FROM pg_constraint WHERE conname=$1',[name])).rows[0].n,1,name);
  assert.equal((await p.query(`SELECT count(*)::int n FROM pg_trigger
    WHERE tgname='orchestrator_gapar_guard' AND NOT tgisinternal`)).rows[0].n,1);
  const guard=(await p.query(`SELECT pg_get_functiondef(tgfoid) definition FROM pg_trigger
    WHERE tgname='orchestrator_gapar_guard' AND NOT tgisinternal`)).rows[0].definition;
  for(const invariant of ['orchestrator_gapar_audit_evidence','orchestrator_gapar_invalid_initial_state',
    'orchestrator_gapar_invalid_provenance','orchestrator_gapar_immutable_or_invalid_transition'])
    assert.ok(guard.includes(invariant),invariant);
  assert.equal((await p.query(`SELECT count(*)::int n FROM pg_indexes WHERE tablename=$1
    AND indexdef LIKE '%UNIQUE%tenant_id, activation_attempt_id%'`,[table])).rows[0].n,1);
  assert.equal((await p.query(`SELECT count(*)::int n FROM pg_indexes WHERE tablename=$1
    AND indexdef LIKE '%UNIQUE%tenant_id, invocation_id_hash%'`,[table])).rows[0].n,1);
 });

 test('PostgreSQL constraints admit only bounded observing and terminal states',async()=>{
  const c=await db.getPool().connect();
  try{
   await c.query(`CREATE TEMP TABLE gapar_probe
     (LIKE orchestrator_google_ads_post_activation_reconciliation_runs INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
   const insert=`INSERT INTO gapar_probe(tenant_id,id,activation_attempt_id,activation_status,invocation_id_hash,
     requested_by,session_id_hash,workflow_id,state,observations,classifications,audit_ref,observing_at,
     observation_deadline,completed_at)
     VALUES(1,$1,'attempt',$2,repeat('a',64),1,repeat('b',64),'wf',$3,$4::jsonb,$5::text[],$6,statement_timestamp(),
       statement_timestamp()+interval '1 minute',CASE WHEN $7 THEN statement_timestamp() ELSE NULL END)`;
   await c.query(insert,['observing','unknown','observing','[]','{}','audit-observing',false]);
   for(const state of ['verified_active','verified_inactive','discrepancy_detected','failed'])
     await c.query(insert,[state,'succeeded',state,'[]','{}',`audit-${state}`,true]);
   await assert.rejects(c.query(insert,['bad-status','failed','observing','[]','{}','audit-bad-status',false]),e=>e.code==='23514');
   await assert.rejects(c.query(insert,['bad-state','unknown','pending','[]','{}','audit-bad-state',false]),e=>e.code==='23514');
   await assert.rejects(c.query(insert,['early-result','unknown','verified_active','[]','{}','audit-early',false]),e=>e.code==='23514');
   await assert.rejects(c.query(insert,['dirty-observing','unknown','observing','[{"object_kind":"campaign"}]','{}','audit-dirty',false]),e=>e.code==='23514');
  }finally{c.release();}
 });
}
