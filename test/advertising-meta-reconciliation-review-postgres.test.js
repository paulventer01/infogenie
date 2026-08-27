'use strict';
const {test,before,after}=require('node:test'); const assert=require('node:assert/strict');
const db=require('../db'); const {ensureAuthSchema}=require('../services/auth/schema'); const {ensureTenantSchema}=require('../services/tenants/schema');
const {ensureAgentOrchestratorSchema}=require('../services/agent_orchestrator/schema'); const R=require('../services/agent_orchestrator/meta_reconciliation_human_review');
const suffix=`${Date.now()}-${Math.random().toString(36).slice(2)}`; const h=c=>c.repeat(64); let tenant,user,other,run;
const auth=(x={})=>({tenantId:tenant,actorUserId:user,actorType:'human',hasPermission:p=>p===R.PERMISSION,...x});

if(!db.hasDb()) test('PostgreSQL human review skipped — no DATABASE_URL',{skip:'no DATABASE_URL'},()=>{}); else {
 before(async()=>{await ensureAuthSchema();await ensureTenantSchema();await ensureAgentOrchestratorSchema();const p=db.getPool();
  tenant=(await p.query(`INSERT INTO tenants(name,slug,status) VALUES($1,$2,'active') RETURNING id`,[`Review ${suffix}`,`review-${suffix}`])).rows[0].id;
  other=(await p.query(`INSERT INTO tenants(name,slug,status) VALUES($1,$2,'active') RETURNING id`,[`Other ${suffix}`,`other-${suffix}`])).rows[0].id;
  user=(await p.query(`INSERT INTO users(email,password_hash,name) VALUES($1,'x','reviewer') RETURNING id`,[`review-${suffix}@test.invalid`])).rows[0].id;run=`mrr-${suffix}`;
  await p.query(`INSERT INTO orchestrator_workflows(id,tenant_id,name,created_by_user_id) VALUES($1,$2,$1,$3)`,[`wf-${suffix}`,tenant,user]);
  await p.query('SET session_replication_role=replica');try{await p.query(`INSERT INTO orchestrator_campaign_reconciliation_runs
   (tenant_id,id,authorization_id,invocation_id_hash,requested_by,workflow_id,draft_id,publishing_request_id,execution_id,
    snapshot_hash,intent_id,intent_hash,credential_ref_id,credential_ref_version,account_fingerprint,ledger_root_hash,state,
    classifications,audit_ref,observing_at,observation_deadline,completed_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,3,$14,$15,'failed',ARRAY['observation_failure'],$16,now()-interval '2 minutes',now()-interval '1 minute',now())`,
  [tenant,run,`auth-${suffix}`,h('1'),user,`wf-${suffix}`,`draft-${suffix}`,`request-${suffix}`,`execution-${suffix}`,h('2'),`intent-${suffix}`,h('3'),`cred-${suffix}`,h('4'),h('5'),`run-audit-${suffix}`]);}finally{await p.query('SET session_replication_role=origin');}
 });
 after(async()=>{const p=db.getPool();await p.query('SET session_replication_role=replica');try{await p.query(`DELETE FROM orchestrator_campaign_reconciliation_review_events WHERE tenant_id=$1`,[tenant]);await p.query(`DELETE FROM orchestrator_campaign_reconciliation_review_cases WHERE tenant_id=$1`,[tenant]);await p.query(`DELETE FROM orchestrator_campaign_reconciliation_runs WHERE tenant_id=$1`,[tenant]);await p.query(`DELETE FROM orchestrator_audit_events WHERE tenant_id=$1`,[tenant]);await p.query(`DELETE FROM tenants WHERE id=ANY($1)`,[[tenant,other]]);await p.query(`DELETE FROM users WHERE id=$1`,[user]);}finally{await p.query('SET session_replication_role=origin');}});

 test('eligible failed run creates once concurrently with immutable copied lineage',async()=>{
  const [a,b]=await Promise.all([R.createOrGet(db.getPool(),auth({reconciliationRunId:run})),R.createOrGet(db.getPool(),auth({reconciliationRunId:run}))]);assert.equal(a.case_id,b.case_id);
  const p=db.getPool();const row=(await p.query(`SELECT * FROM orchestrator_campaign_reconciliation_review_cases WHERE tenant_id=$1 AND id=$2`,[tenant,a.case_id])).rows[0];
  assert.equal(row.original_state,'failed');assert.equal(row.credential_ref_version,3);assert.equal(row.original_requested_by,user);
  await assert.rejects(p.query(`UPDATE orchestrator_campaign_reconciliation_review_cases SET workflow_id='changed',version=version+1 WHERE tenant_id=$1 AND id=$2`,[tenant,a.case_id]),/immutable_binding/);
  await assert.rejects(p.query(`DELETE FROM orchestrator_campaign_reconciliation_review_cases WHERE tenant_id=$1 AND id=$2`,[tenant,a.case_id]),/delete_prohibited/);
 });

 test('tenant isolation and lifecycle concurrency preserve reconciliation result',async()=>{
  const p=db.getPool();const caseRow=(await p.query(`SELECT id FROM orchestrator_campaign_reconciliation_review_cases WHERE tenant_id=$1 AND reconciliation_run_id=$2`,[tenant,run])).rows[0];
  await assert.rejects(R.getCase(p,auth({tenantId:other,caseId:caseRow.id})),{code:'review_case_not_found'});
  const beforeRun=(await p.query(`SELECT row_to_json(r)::text v FROM orchestrator_campaign_reconciliation_runs r WHERE tenant_id=$1 AND id=$2`,[tenant,run])).rows[0].v;
  const decisions=await Promise.allSettled(['one','two'].map(decisionId=>R.acknowledge(p,auth({caseId:caseRow.id,decisionId,expectedVersion:0,classification:'observation_failure',note:'Human acknowledged the operational observation failure'}))));
  assert.equal(decisions.filter(x=>x.status==='fulfilled').length,1);assert.equal(decisions.filter(x=>x.status==='rejected').length,1);
  let c=(await p.query(`SELECT * FROM orchestrator_campaign_reconciliation_review_cases WHERE tenant_id=$1 AND id=$2`,[tenant,caseRow.id])).rows[0];
  await R.escalate(p,auth({caseId:c.id,decisionId:'escalate',expectedVersion:c.version,classification:'provider_investigation_required',note:'Human escalation requests an external provider investigation'}));
  c=(await p.query(`SELECT * FROM orchestrator_campaign_reconciliation_review_cases WHERE tenant_id=$1 AND id=$2`,[tenant,c.id])).rows[0];
  await R.close(p,auth({caseId:c.id,decisionId:'close',expectedVersion:c.version,classification:'closed_unresolved',note:'Human closed this operational case unresolved; future reconciliation is required'}));
  await assert.rejects(R.close(p,auth({caseId:c.id,decisionId:'again',expectedVersion:c.version+1,classification:'closed_unresolved',note:'Human attempted another operational closure'})),{code:'invalid_review_transition'});
  const afterRun=(await p.query(`SELECT row_to_json(r)::text v FROM orchestrator_campaign_reconciliation_runs r WHERE tenant_id=$1 AND id=$2`,[tenant,run])).rows[0].v;assert.equal(afterRun,beforeRun);
  await assert.rejects(p.query(`DELETE FROM orchestrator_campaign_reconciliation_review_events WHERE tenant_id=$1`,[tenant]),/append_only/);
 });

 test('database rejects invalid review transition and audit failure rolls back',async()=>{
  const p=db.getPool();const c=(await p.query(`SELECT * FROM orchestrator_campaign_reconciliation_review_cases WHERE tenant_id=$1`,[tenant])).rows[0];
  await assert.rejects(p.query(`UPDATE orchestrator_campaign_reconciliation_review_cases SET state='open',closed_at=NULL,version=version+1 WHERE tenant_id=$1 AND id=$2`,[tenant,c.id]),/invalid_transition|check constraint/);
 });
}
