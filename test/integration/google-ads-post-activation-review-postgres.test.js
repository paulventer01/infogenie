'use strict';
const {test,before,after}=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');
const db=require('../../db');const {ensureAuthSchema}=require('../../services/auth/schema');const {ensureTenantSchema}=require('../../services/tenants/schema');
const {ensureAgentOrchestratorSchema}=require('../../services/agent_orchestrator/schema');
const R=require('../../services/agent_orchestrator/google_ads_post_activation_review');
const tag=crypto.randomUUID(),h=v=>crypto.createHash('sha256').update(v).digest('hex');let tenant,other,user,otherUser,run,verified,incomplete;
const observations=[
 {object_kind:'campaign_budget',outcome:'observed',status_classification:'paused',account_binding_matches:true,
  campaign_parent_matches:'not_applicable',budget_parent_matches:'not_applicable',observed_at:'2026-09-07T00:00:00.000Z'},
 {object_kind:'campaign',outcome:'observed',status_classification:'active',account_binding_matches:true,
  campaign_parent_matches:'not_applicable',budget_parent_matches:true,observed_at:'2026-09-07T00:00:00.000Z'},
 {object_kind:'ad_group',outcome:'missing',status_classification:'unknown',account_binding_matches:'unknown',
  campaign_parent_matches:'unknown',budget_parent_matches:'not_applicable',observed_at:'2026-09-07T00:00:00.000Z'},
];
const auth=(over={})=>({pool:db.getPool(),tenantId:tenant,actorUserId:user,actorType:'human',principalType:'user',sessionId:'review-session',
 hasExplicitTenantPermission:key=>key===R.PERMISSION,...over});
async function replica(sql,params=[]){const c=await db.getPool().connect();try{await c.query("SET session_replication_role='replica'");
  if(sql.split(';').filter(x=>x.trim()).length>1&&params.length){const literal=v=>typeof v==='number'?String(v):`'${String(v).replaceAll("'","''")}'`;
    return await c.query(sql.replace(/\$(\d+)/g,(_m,n)=>literal(params[Number(n)-1])));}return await c.query(sql,params);
 }finally{await c.query("SET session_replication_role='origin'");c.release();}}
if(!db.hasDb())test('Google post-activation review PostgreSQL requires DATABASE_URL',{skip:'no DATABASE_URL'},()=>{});else{
before(async()=>{await ensureAuthSchema();await ensureTenantSchema();await ensureAgentOrchestratorSchema();const p=db.getPool();
 user=(await p.query(`INSERT INTO users(email,password_hash,name) VALUES($1,'x','reviewer') RETURNING id`,[`gaparv-${tag}@test.invalid`])).rows[0].id;
 otherUser=(await p.query(`INSERT INTO users(email,password_hash,name) VALUES($1,'x','other reviewer') RETURNING id`,[`gaparv-other-${tag}@test.invalid`])).rows[0].id;
 tenant=(await p.query(`INSERT INTO tenants(name,slug,status) VALUES($1,$2,'active') RETURNING id`,[`GAPARV ${tag}`,`gaparv-${tag}`])).rows[0].id;
 other=(await p.query(`INSERT INTO tenants(name,slug,status) VALUES($1,$2,'active') RETURNING id`,[`GAPARV other ${tag}`,`gaparv-other-${tag}`])).rows[0].id;
 const role=(await p.query(`INSERT INTO roles(tenant_id,key,name,permissions) VALUES($1,$2,'review',$3::jsonb) RETURNING id`,
  [tenant,`gaparv-${tag}`,JSON.stringify([R.PERMISSION])])).rows[0].id;
 const otherRole=(await p.query(`INSERT INTO roles(tenant_id,key,name,permissions) VALUES($1,$2,'review',$3::jsonb) RETURNING id`,
  [other,`gaparv-other-${tag}`,JSON.stringify([R.PERMISSION])])).rows[0].id;
 await p.query(`INSERT INTO tenant_users(tenant_id,user_id,role_id,status) VALUES($1,$2,$3,'active'),($4,$5,$6,'active')`,
  [tenant,user,role,other,otherUser,otherRole]);
 await p.query(`INSERT INTO orchestrator_workflows(id,tenant_id,name) VALUES($1,$2,'post activation review')`,[`wf-${tag}`,tenant]);
 run=`gapar_discrepancy-${tag}`;verified=`gapar_verified-${tag}`;incomplete=`gapar_incomplete-${tag}`;
 for(const item of [
  {id:run,attempt:`attempt-${tag}`,state:'discrepancy_detected',obs:observations,classes:['ad_group_missing']},
  {id:verified,attempt:`verified-${tag}`,state:'verified_active',obs:observations.map(x=>({...x,outcome:'observed'})),classes:[]},
  {id:incomplete,attempt:`incomplete-${tag}`,state:'discrepancy_detected',obs:observations.slice(0,2),classes:['partial_observation']},
 ])await replica(`INSERT INTO orchestrator_google_ads_post_activation_reconciliation_runs
   (tenant_id,id,activation_attempt_id,activation_status,invocation_id_hash,requested_by,session_id_hash,workflow_id,state,
    observations,classifications,audit_ref,observing_at,observation_deadline,completed_at)
   VALUES($1,$2,$3,'succeeded',$4,$5,$6,$7,$8,$9::jsonb,$10,$11,now()-interval '2 minutes',now()-interval '1 minute',now())`,
   [tenant,item.id,item.attempt,h(item.id),user,h(`session-${item.id}`),`wf-${tag}`,item.state,JSON.stringify(item.obs),item.classes,`audit-${item.id}`]);
});
after(async()=>{await replica(`DELETE FROM orchestrator_google_ads_post_activation_review_events WHERE tenant_id IN($1,$2);
 DELETE FROM orchestrator_google_ads_post_activation_review_cases WHERE tenant_id IN($1,$2);
 DELETE FROM orchestrator_google_ads_post_activation_reconciliation_runs WHERE tenant_id IN($1,$2);
 DELETE FROM orchestrator_audit_events WHERE tenant_id IN($1,$2);DELETE FROM orchestrator_workflows WHERE tenant_id IN($1,$2);
 DELETE FROM tenant_users WHERE tenant_id IN($1,$2);DELETE FROM roles WHERE tenant_id IN($1,$2);
 DELETE FROM tenants WHERE id IN($1,$2);DELETE FROM users WHERE id IN($3,$4)`,[tenant,other,user,otherUser]);});

test('schema is tenant-leading, sanitized and enforces logical uniqueness',async()=>{const p=db.getPool(),table=R.TABLE;
 const columns=(await p.query(`SELECT column_name FROM information_schema.columns WHERE table_name=$1`,[table])).rows.map(x=>x.column_name);
 for(const required of ['tenant_id','reconciliation_run_id','activation_attempt_id','workflow_id','intended_provider_state',
  'observed_provider_state','source_discrepancy_classifications','state','disposition','version','audit_ref'])assert.ok(columns.includes(required),required);
 for(const forbidden of ['provider_object_id','customer_id','credential_ref_id','account_fingerprint','ledger_root_hash','access_token',
  'refresh_token','request_url','query','provider_response','raw_error'])assert.equal(columns.includes(forbidden),false,forbidden);
 for(const name of ['orchestrator_gaparv_unique_run','orchestrator_gaparv_unique_attempt','orchestrator_gaparv_intended_check',
  'orchestrator_gaparv_observed_check','orchestrator_gaparv_lifecycle_check'])assert.equal((await p.query(
   'SELECT count(*)::int n FROM pg_constraint WHERE conname=$1',[name])).rows[0].n,1,name);
});

test('only one case is created for one complete discrepancy, including under concurrency',async()=>{
 await assert.rejects(R.createOrGet(auth({reconciliationRunId:verified})),{code:'reconciliation_not_reviewable'});
 await assert.rejects(R.createOrGet(auth({reconciliationRunId:incomplete})),{code:'reconciliation_evidence_invalid'});
 const [a,b]=await Promise.all([R.createOrGet(auth({reconciliationRunId:run})),R.createOrGet(auth({reconciliationRunId:run}))]);
 assert.equal(a.review_case_id,b.review_case_id);assert.equal(a.state,'open');assert.deepEqual(a.discrepancy_classifications,['ad_group_missing']);
 assert.equal((await db.getPool().query(`SELECT count(*)::int n FROM ${R.TABLE} WHERE tenant_id=$1`,[tenant])).rows[0].n,1);
});

test('copied evidence is exact, immutable, tenant-isolated and permission revocation is immediate',async()=>{const p=db.getPool();
 const row=(await p.query(`SELECT * FROM ${R.TABLE} WHERE tenant_id=$1 AND reconciliation_run_id=$2`,[tenant,run])).rows[0];
 assert.deepEqual(row.intended_provider_state,R.INTENDED_STATE);assert.equal(row.observed_provider_state.length,3);
 assert.deepEqual([row.activation_attempt_id,row.workflow_id,row.state],[`attempt-${tag}`,`wf-${tag}`,'open']);
 await assert.rejects(R.getCase(auth({tenantId:other,actorUserId:otherUser,caseId:row.id})),{code:'review_case_not_found'});
 await p.query(`UPDATE tenant_users SET status='suspended' WHERE tenant_id=$1 AND user_id=$2`,[tenant,user]);
 await assert.rejects(R.getCase(auth({caseId:row.id})),{code:'permission_denied'});
 await p.query(`UPDATE tenant_users SET status='active' WHERE tenant_id=$1 AND user_id=$2`,[tenant,user]);
 await assert.rejects(p.query(`UPDATE ${R.TABLE} SET workflow_id='changed',version=version+1 WHERE tenant_id=$1 AND id=$2`,[tenant,row.id]),/immutable_binding/);
 await assert.rejects(p.query(`DELETE FROM ${R.TABLE} WHERE tenant_id=$1 AND id=$2`,[tenant,row.id]),/delete_prohibited/);
 await assert.rejects(p.query(`DELETE FROM ${R.EVENTS} WHERE tenant_id=$1`,[tenant]),/append_only/);
});

test('human transitions are optimistic, idempotent and cannot silently close',async()=>{const p=db.getPool();let row=(await p.query(
 `SELECT * FROM ${R.TABLE} WHERE tenant_id=$1 AND reconciliation_run_id=$2`,[tenant,run])).rows[0];
 await assert.rejects(R.close(auth({caseId:row.id,decisionId:'silent-close',expectedVersion:0,disposition:'closed_unresolved',
  note:'Human closure decision'})),{code:'invalid_review_transition'});
 const decisions=await Promise.allSettled(['one','two'].map(decisionId=>R.acknowledge(auth({caseId:row.id,decisionId,expectedVersion:0,
  disposition:'activation_state_mismatch',note:'Human acknowledged the provider discrepancy'}))));
 assert.equal(decisions.filter(x=>x.status==='fulfilled').length,1);assert.equal(decisions.filter(x=>x.status==='rejected').length,1);
 row=(await p.query(`SELECT * FROM ${R.TABLE} WHERE tenant_id=$1 AND id=$2`,[tenant,row.id])).rows[0];const winner=decisions[0].status==='fulfilled'?'one':'two';
 const replay=await R.acknowledge(auth({caseId:row.id,decisionId:winner,expectedVersion:0,disposition:'activation_state_mismatch',
  note:'Human acknowledged the provider discrepancy'}));assert.equal(replay.version,1);
 await assert.rejects(R.acknowledge(auth({caseId:row.id,decisionId:winner,expectedVersion:0,disposition:'activation_state_mismatch',
  note:'Changed replay payload'})),{code:'idempotency_conflict'});
 const closed=await R.close(auth({caseId:row.id,decisionId:'explicit-close',expectedVersion:1,disposition:'closed_unresolved',
  note:'Human explicitly closed this case unresolved'}));assert.equal(closed.state,'closed');assert.ok(closed.closed_at);
});

test('event or audit failure rolls back the case transition',async()=>{const p=db.getPool();
 const extra=`gapar_rollback-${tag}`;await replica(`INSERT INTO orchestrator_google_ads_post_activation_reconciliation_runs
  (tenant_id,id,activation_attempt_id,activation_status,invocation_id_hash,requested_by,session_id_hash,workflow_id,state,observations,
   classifications,audit_ref,observing_at,observation_deadline,completed_at) VALUES($1,$2,$3,'unknown',$4,$5,$6,$7,
   'discrepancy_detected',$8::jsonb,ARRAY['mixed_activation_state'],$9,now()-interval '2 minutes',now()-interval '1 minute',now())`,
  [tenant,extra,`rollback-${tag}`,h(extra),user,h(`session-${extra}`),`wf-${tag}`,JSON.stringify(observations),`audit-${extra}`]);
 const created=await R.createOrGet(auth({reconciliationRunId:extra}));const wrapped={connect:async()=>{const c=await p.connect();return{
  release:()=>c.release(),query:(sql,args)=>sql.startsWith('INSERT INTO orchestrator_audit_events')?Promise.reject(Error('forced audit failure')):c.query(sql,args)};}};
 await assert.rejects(R.escalate(auth({pool:wrapped,caseId:created.review_case_id,decisionId:'audit-fail',expectedVersion:0,
  disposition:'provider_investigation_required',note:'Human requests provider investigation'})),/forced audit failure/);
 const after=(await p.query(`SELECT state,version FROM ${R.TABLE} WHERE tenant_id=$1 AND id=$2`,[tenant,created.review_case_id])).rows[0];
 assert.deepEqual(after,{state:'open',version:0});
});

test('deferred consistency rejects orphan decisions without matching case and audit state',async()=>{const p=db.getPool(),row=(await p.query(
 `SELECT * FROM ${R.TABLE} WHERE tenant_id=$1 AND reconciliation_run_id=$2`,[tenant,`gapar_rollback-${tag}`])).rows[0],c=await p.connect();
 try{await c.query('BEGIN');await c.query(`INSERT INTO ${R.EVENTS}(tenant_id,case_id,case_version,decision_id,decision_payload_hash,
  from_state,to_state,disposition,actor_user_id,note,note_digest,audit_ref) VALUES($1,$2,1,'orphan',$3,'open','acknowledged',
  'activation_state_mismatch',$4,'Safe note',$5,'orphan-audit')`,[tenant,row.id,h('payload'),user,h('Safe note')]);
  await assert.rejects(c.query('COMMIT'),/gaparv_ledger_inconsistent/);await c.query('ROLLBACK');}finally{c.release();}
});
}
