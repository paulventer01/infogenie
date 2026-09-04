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
  assert.equal((await p.query(`SELECT count(*)::int n FROM pg_trigger WHERE tgname='orchestrator_gaac_guard' AND NOT tgisinternal`)).rows[0].n,1);
 });
}
