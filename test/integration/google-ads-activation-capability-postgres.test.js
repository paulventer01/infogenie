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
  const lifecycle=(await p.query(`SELECT pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conname='orchestrator_gaac_lifecycle'`)).rows[0].definition;
  for(const invariant of ["expires_at <= (issued_at + '00:10:00'::interval)",'reserved_at >= issued_at','consumed_at >= reserved_at','revoked_at >= issued_at'])
   assert.match(lifecycle,new RegExp(invariant.replace(/[+()[\]]/g,'\\$&')));
  assert.equal((await p.query(`SELECT count(*)::int n FROM pg_trigger WHERE tgname='orchestrator_gaac_guard' AND NOT tgisinternal`)).rows[0].n,1);
 });
}
