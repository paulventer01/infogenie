'use strict';
const {test,before,after}=require('node:test');const assert=require('node:assert/strict');const crypto=require('crypto');
const db=require('../../db');const {ensureAuthSchema}=require('../../services/auth/schema');const {ensureTenantSchema}=require('../../services/tenants/schema');
const {ensureAgentOrchestratorSchema}=require('../../services/agent_orchestrator/schema');const R=require('../../services/agent_orchestrator/google_ads_reconciliation_human_review');
const tag=crypto.randomUUID(),h=(x)=>crypto.createHash('sha256').update(x).digest('hex');let tenant,other,user,runs;
const auth=(over={})=>({tenantId:tenant,actorUserId:user,actorType:'human',hasPermission:(p)=>p===R.PERMISSION,...over});
async function replica(sql,params=[]) { const c=await db.getPool().connect();try{await c.query("SET session_replication_role='replica'");if(sql.split(';').filter((x)=>x.trim()).length>1&&params.length){const literal=(v)=>typeof v==='number'?String(v):`'${String(v).replaceAll("'","''")}'`;return await c.query(sql.replace(/\$(\d+)/g,(_m,n)=>literal(params[Number(n)-1])));}return await c.query(sql,params);}finally{await c.query("SET session_replication_role='origin'");c.release();} }
if(!db.hasDb())test('Google Ads review PostgreSQL requires DATABASE_URL',{skip:'no DATABASE_URL'},()=>{});else{
before(async()=>{await ensureAuthSchema();await ensureTenantSchema();await ensureAgentOrchestratorSchema();const p=db.getPool();
  tenant=(await p.query(`INSERT INTO tenants(name,slug,status) VALUES($1,$2,'active') RETURNING id`,[`GAR ${tag}`,`gar-${tag}`])).rows[0].id;
  other=(await p.query(`INSERT INTO tenants(name,slug,status) VALUES($1,$2,'active') RETURNING id`,[`Other ${tag}`,`other-${tag}`])).rows[0].id;
  user=(await p.query(`INSERT INTO users(email,password_hash,name) VALUES($1,'x','reviewer') RETURNING id`,[`gar-${tag}@test.invalid`])).rows[0].id;
  await p.query(`INSERT INTO orchestrator_workflows(id,tenant_id,name) VALUES($1,$2,'review')`,[`wf-${tag}`,tenant]);
  runs={failed:`garrun_failed-${tag}`,discrepancy:`garrun_discrepancy-${tag}`,verified:`garrun_verified-${tag}`};
  for(const [name,state] of Object.entries({failed:'failed',discrepancy:'discrepancy_detected',verified:'verified'}))await replica(`INSERT INTO orchestrator_google_ads_reconciliation_runs
    (tenant_id,id,authorization_id,invocation_id_hash,requested_by,workflow_id,draft_id,publishing_request_id,operation_id,
     snapshot_hash,intent_id,intent_hash,credential_ref_id,credential_ref_version,ledger_root_hash,state,classifications,
     audit_ref,observing_at,observation_deadline,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,4,$14,$15,$16,$17,now()-interval '2 minutes',now()-interval '1 minute',now())`,
    [tenant,runs[name],`garr-${name}-${tag}`,h(`${name}-inv`),user,`wf-${tag}`,`draft-${tag}`,`request-${tag}`,`operation-${tag}`,h(`${name}-snap`),`intent-${tag}`,h(`${name}-intent`),`cred-${tag}`,h(`${name}-ledger`),state,state==='verified'?[]:[`${name}_observation`],`audit-${name}-${tag}`]);
});
after(async()=>{await replica(`DELETE FROM orchestrator_google_ads_reconciliation_review_events WHERE tenant_id=$1;DELETE FROM orchestrator_google_ads_reconciliation_review_cases WHERE tenant_id=$1;DELETE FROM orchestrator_google_ads_reconciliation_runs WHERE tenant_id=$1;DELETE FROM orchestrator_audit_events WHERE tenant_id=$1;DELETE FROM orchestrator_workflows WHERE tenant_id=$1;DELETE FROM tenants WHERE id IN ($1,$2);DELETE FROM users WHERE id=$3`,[tenant,other,user]);});

test('only eligible Google terminal states create once, including under concurrency',async()=>{
  await assert.rejects(R.createOrGet(db.getPool(),auth({reconciliationRunId:runs.verified})),{code:'reconciliation_not_reviewable'});
  await assert.rejects(R.createOrGet(db.getPool(),auth({reconciliationRunId:`mrr-${tag}`})),{code:'reconciliation_not_found'});
  const [a,b]=await Promise.all([R.createOrGet(db.getPool(),auth({reconciliationRunId:runs.failed})),R.createOrGet(db.getPool(),auth({reconciliationRunId:runs.failed}))]);assert.equal(a.case_id,b.case_id);
  const d=await R.createOrGet(db.getPool(),auth({reconciliationRunId:runs.discrepancy}));assert.deepEqual(d.discrepancy_classifications,['discrepancy_observation']);
  assert.equal((await db.getPool().query(`SELECT count(*)::int c FROM orchestrator_google_ads_reconciliation_review_cases WHERE tenant_id=$1`,[tenant])).rows[0].c,2);
});

test('copied lineage is complete, immutable, tenant-bound and events are append-only',async()=>{const p=db.getPool();const row=(await p.query(`SELECT * FROM orchestrator_google_ads_reconciliation_review_cases WHERE tenant_id=$1 AND reconciliation_run_id=$2`,[tenant,runs.failed])).rows[0];
  assert.deepEqual([row.operation_id,row.credential_ref_version,row.original_state,row.original_object_kinds],[`operation-${tag}`,4,'failed',R.KINDS]);
  await assert.rejects(R.getCase(p,auth({tenantId:other,caseId:row.id})),{code:'review_case_not_found'});
  await assert.rejects(p.query(`UPDATE orchestrator_google_ads_reconciliation_review_cases SET operation_id='changed',version=version+1 WHERE tenant_id=$1 AND id=$2`,[tenant,row.id]),/immutable_binding/);
  await assert.rejects(p.query(`DELETE FROM orchestrator_google_ads_reconciliation_review_cases WHERE tenant_id=$1 AND id=$2`,[tenant,row.id]),/delete_prohibited/);
  await assert.rejects(p.query(`DELETE FROM orchestrator_google_ads_reconciliation_review_events WHERE tenant_id=$1`,[tenant]),/append_only/);
});

test('one transition wins, replays are stable, version races and invalid transitions fail',async()=>{const p=db.getPool();let row=(await p.query(`SELECT * FROM orchestrator_google_ads_reconciliation_review_cases WHERE tenant_id=$1 AND reconciliation_run_id=$2`,[tenant,runs.failed])).rows[0];
  const decisions=await Promise.allSettled(['one','two'].map((decisionId)=>R.acknowledge(p,auth({caseId:row.id,decisionId,expectedVersion:0,classification:'observation_failure',note:'Human acknowledged this observation failure'}))));assert.equal(decisions.filter((x)=>x.status==='fulfilled').length,1);assert.equal(decisions.filter((x)=>x.status==='rejected').length,1);
  row=(await p.query(`SELECT * FROM orchestrator_google_ads_reconciliation_review_cases WHERE tenant_id=$1 AND id=$2`,[tenant,row.id])).rows[0];
  const replay=await R.acknowledge(p,auth({caseId:row.id,decisionId:decisions[0].status==='fulfilled'?'one':'two',expectedVersion:0,classification:'observation_failure',note:'Replay may differ but cannot rewrite the decision'}));assert.equal(replay.version,1);
  await assert.rejects(R.escalate(p,auth({caseId:row.id,decisionId:'race',expectedVersion:0,classification:'provider_investigation_required',note:'Human escalation decision'})),{code:'version_conflict'});
  await assert.rejects(p.query(`UPDATE orchestrator_google_ads_reconciliation_review_cases SET state='open',version=version+1 WHERE tenant_id=$1 AND id=$2`,[tenant,row.id]),/invalid_transition/);
});

test('event and case update roll back when audit insertion fails',async()=>{const p=db.getPool();const row=(await p.query(`SELECT * FROM orchestrator_google_ads_reconciliation_review_cases WHERE tenant_id=$1 AND reconciliation_run_id=$2`,[tenant,runs.discrepancy])).rows[0];const before=(await p.query(`SELECT count(*)::int c FROM orchestrator_google_ads_reconciliation_review_events WHERE tenant_id=$1 AND case_id=$2`,[tenant,row.id])).rows[0].c;
  const wrapped={connect:async()=>{const c=await p.connect();return {release:()=>c.release(),query:(sql,args)=>/INSERT INTO orchestrator_audit_events/.test(sql)?Promise.reject(Error('forced audit failure')):c.query(sql,args)};}};
  await assert.rejects(R.escalate(wrapped,auth({caseId:row.id,decisionId:'audit-fail',expectedVersion:0,classification:'provider_investigation_required',note:'Human requests external investigation'})),/forced audit failure/);
  const after=(await p.query(`SELECT state,version FROM orchestrator_google_ads_reconciliation_review_cases WHERE tenant_id=$1 AND id=$2`,[tenant,row.id])).rows[0];assert.deepEqual([after.state,after.version],['open',0]);assert.equal((await p.query(`SELECT count(*)::int c FROM orchestrator_google_ads_reconciliation_review_events WHERE tenant_id=$1 AND case_id=$2`,[tenant,row.id])).rows[0].c,before);
});
}
