'use strict';
const {test,before}=require('node:test'),assert=require('node:assert/strict');
const db=require('../../db'),{ensureAuthSchema}=require('../../services/auth/schema'),{ensureTenantSchema}=require('../../services/tenants/schema');
const {ensureAgentOrchestratorSchema}=require('../../services/agent_orchestrator/schema');
if(!db.hasDb())test('Google activation capability PostgreSQL requires DATABASE_URL',{skip:'no DATABASE_URL'},()=>{});else{
 before(async()=>{await ensureAuthSchema();await ensureTenantSchema();await ensureAgentOrchestratorSchema();});
 test('PostgreSQL installs tenant-leading immutable lifecycle constraints',async()=>{const p=db.getPool();
  const columns=(await p.query(`SELECT column_name,is_nullable FROM information_schema.columns WHERE table_name='orchestrator_google_ads_activation_capabilities'`)).rows;
  assert.equal(columns.find(x=>x.column_name==='tenant_id')?.is_nullable,'NO');
 for(const name of ['orchestrator_gaac_status','orchestrator_gaac_hashes','orchestrator_gaac_review','orchestrator_gaac_lifecycle'])
   assert.equal((await p.query('SELECT count(*)::int n FROM pg_constraint WHERE conname=$1',[name])).rows[0].n,1);
  await p.query(`ALTER TABLE orchestrator_google_ads_activation_capabilities DROP CONSTRAINT orchestrator_gaac_lifecycle,
    ADD CONSTRAINT orchestrator_gaac_lifecycle CHECK(confirmed_at<=issued_at AND expires_at>issued_at)`);
  await ensureAgentOrchestratorSchema();
  const lifecycle=(await p.query(`SELECT pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conname='orchestrator_gaac_lifecycle'`)).rows[0].definition;
  for(const invariant of ["confirmed_at >= (issued_at - '00:05:00'::interval)","expires_at <= (issued_at + '00:10:00'::interval)",'reserved_at >= issued_at','reserved_at <= expires_at','consumed_at >= reserved_at','consumed_at <= expires_at','revoked_at >= issued_at'])
   assert.ok(lifecycle.includes(invariant),`missing lifecycle invariant: ${invariant}`);
  assert.equal((await p.query(`SELECT convalidated FROM pg_constraint WHERE conname='orchestrator_gaac_lifecycle'`)).rows[0].convalidated,true);
  const probe=await p.connect();
  try{await probe.query(`CREATE TEMP TABLE gaac_freshness_probe
    (LIKE orchestrator_google_ads_activation_capabilities INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
  const insertProbe=(confirmedAt)=>probe.query(`INSERT INTO gaac_freshness_probe(
    tenant_id,id,actor_user_id,session_id_hash,workflow_id,draft_id,draft_revision,contract_hash,
    publishing_request_id,publish_approval_id,workflow_approval_id,snapshot_hash,intent_id,intent_hash,
    operation_id,source_authorization_id,reconciliation_run_id,credential_owner_user_id,credential_ref_id,
    credential_ref_version,account_fingerprint,ledger_root_hash,confirmation_hash,confirmed_at,issued_at,
    expires_at,audit_ref) VALUES(1,$1,1,repeat('a',64),'w','d',1,repeat('b',64),'pr','pa',1,
    repeat('c',64),'i',repeat('d',64),'op','auth','run',1,'cred',1,repeat('e',64),repeat('f',64),
    repeat('0',64),$2,'2026-01-01T00:10:00Z','2026-01-01T00:15:00Z','audit')`,
    [`cap_${confirmedAt.slice(14,16)}`,confirmedAt]);
  await insertProbe('2026-01-01T00:05:00Z');
  await assert.rejects(insertProbe('2026-01-01T00:04:59Z'),e=>e.code==='23514');
  await assert.rejects(probe.query(`UPDATE gaac_freshness_probe SET status='reserved',reservation_id_hash=repeat('1',64),
    reserved_at=expires_at+interval '1 microsecond' WHERE id='cap_05'`),e=>e.code==='23514');
  await probe.query(`UPDATE gaac_freshness_probe SET status='reserved',reservation_id_hash=repeat('1',64),
    reserved_at=expires_at WHERE id='cap_05'`);
  await assert.rejects(probe.query(`UPDATE gaac_freshness_probe SET status='consumed',invocation_id_hash=repeat('2',64),
    consumed_at=expires_at+interval '1 microsecond' WHERE id='cap_05'`),e=>e.code==='23514');
  }finally{probe.release();}
  assert.equal((await p.query(`SELECT count(*)::int n FROM pg_trigger WHERE tgname='orchestrator_gaac_guard' AND NOT tgisinternal`)).rows[0].n,1);
  const trigger=(await p.query(`SELECT pg_get_triggerdef(oid) definition FROM pg_trigger WHERE tgname='orchestrator_gaac_guard' AND NOT tgisinternal`)).rows[0].definition;
  const guard=(await p.query(`SELECT pg_get_functiondef(tgfoid) definition FROM pg_trigger WHERE tgname='orchestrator_gaac_guard' AND NOT tgisinternal`)).rows[0].definition;
  assert.match(trigger,/BEFORE INSERT OR DELETE OR UPDATE/);
  assert.match(guard,/orchestrator_gaac_invalid_initial_state/);
 });
}
