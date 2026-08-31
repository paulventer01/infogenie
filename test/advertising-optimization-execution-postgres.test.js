'use strict';
const {test,before}=require('node:test'),assert=require('node:assert/strict'),crypto=require('crypto'),db=require('../db');
const fixture=require('./advertising-meta-delivery-discrepancy-postgres.test');
const R=require('../services/agent_orchestrator/optimization_recommendations'),E=require('../services/agent_orchestrator/optimization_execution');
const permit=()=>true;
const actor=(f,user=f.user,x={})=>({tenantId:f.tenant,actorUserId:user,actorType:'human',principalType:'human',sessionId:`human-${f.tag}-${user}`,hasExplicitTenantPermission:permit,pool:db.getPool(),...x});
async function approved(tag){
 const f=await fixture.seedMonitoring('discrepancy_detected',tag);let s=await R.createOrGet(actor(f,f.user,{monitoringRunId:f.run,invocationId:'recommend'}));
 s=await R.transition(actor(f,f.user,{setId:s.recommendation_set_id,action:'submit',expectedVersion:1,decisionId:'submit-rec'}));
 s=await R.transition(actor(f,f.user,{setId:s.recommendation_set_id,action:'approve',expectedVersion:2,decisionId:'approve-rec'}));
 const user=(await db.getPool().query(`INSERT INTO users(email,password_hash,name) VALUES($1,'x','approver') RETURNING id`,[`${tag}-${crypto.randomUUID()}@test.invalid`])).rows[0].id;
 const rec=await db.getPool().query(`SELECT id FROM orchestrator_campaign_optimization_recommendations WHERE tenant_id=$1 AND set_id=$2 AND category='review_delivery_configuration'`,[f.tenant,s.recommendation_set_id]);assert.equal(rec.rowCount,1);
 return {...f,set:s.recommendation_set_id,rec:rec.rows[0].id,approver:user};
}
const create=(f,inv='create',x={})=>E.createOrGet(actor(f,f.user,{recommendationSetId:f.set,recommendationId:f.rec,invocationId:inv,...x}));
const move=(f,r,user,action,decision,x={})=>E.transition(actor(f,user,{requestId:r.request_id,action,decisionId:decision,expectedVersion:r.version,...x}));
const row=async(f,id)=> (await db.getPool().query(`SELECT * FROM orchestrator_optimization_execution_requests WHERE tenant_id=$1 AND id=$2`,[f.tenant,id])).rows[0];
if(!db.hasDb())test('PR8B PostgreSQL requires DATABASE_URL',{skip:'no DATABASE_URL'},()=>{});else{
 before(()=>fixture.bootstrapSchemasOnce());
 test('eligible creation freezes lineage, safely projects, replays, rejects collision, and isolates tenants',async()=>{
  const a=await approved(`pr8b-create-a-${Date.now()}`),b=await approved(`pr8b-create-b-${Date.now()}`);const first=await create(a,'shared'),replay=await create(a,'shared'),other=await create(b,'shared');
  assert.deepEqual(replay,first);assert.notEqual(other.request_id,first.request_id);assert.equal(first.execution_performed,false);assert.equal(first.provider_contacted,false);
  assert.deepEqual(Object.keys(first).sort(),['authorized_creator_user_id','created_at','decided_at','deciding_user_id','execution_performed','proposed_internal_action','provider_contacted','rationale','recommendation_id','recommendation_set_id','request_id','safe_evidence_references','state','submitted_at','version'].sort());
  await assert.rejects(E.createOrGet(actor(a,a.user,{recommendationSetId:a.set,recommendationId:a.rec,invocationId:'shared-x'})),{code:'validation_failed'});
  const frozen=await row(a,first.request_id);for(const [k,v] of [['monitoring_run_id',a.run],['activation_attempt_id',a.attempt],['capability_id',a.cap],['workflow_id',a.workflow],['publishing_request_id',a.request],['intent_id',a.intent],['execution_id',a.execution],['reconciliation_run_id',a.recon],['credential_ref_id',a.credential],['ledger_root_hash',a.ledgerRoot]])assert.equal(frozen[k],v,k);
 });
 test('invocation collisions and competing creates leave exactly one active durable request',async()=>{
  const f=await approved(`pr8b-race-${Date.now()}`);await create(f,'one');await assert.rejects(create(f,'one',{recommendationId:'different'}),{code:'invocation_id_conflict'});
  const g=await approved(`pr8b-concurrent-${Date.now()}`),results=await Promise.allSettled([create(g,'race-a'),create(g,'race-b')]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  const count=await db.getPool().query(`SELECT count(*)::int n FROM orchestrator_optimization_execution_requests WHERE tenant_id=$1 AND recommendation_set_id=$2 AND recommendation_id=$3 AND state IN('draft','submitted')`,[g.tenant,g.set,g.rec]);assert.equal(count.rows[0].n,1);
 });
 test('lifecycle approves with distinct human, rejects, replays decisions, and protects versions and terminals',async()=>{
  const f=await approved(`pr8b-approved-${Date.now()}`);let r=await create(f);await assert.rejects(move(f,r,f.user,'approve','direct'),{code:'creator_approver_conflict'});r=await move(f,r,f.user,'submit','submit');
  await assert.rejects(move(f,r,f.approver,'approve','stale',{expectedVersion:1}),{code:'version_conflict'});await assert.rejects(move(f,r,f.user,'approve','creator'),{code:'creator_approver_conflict'});
  const done=await move(f,r,f.approver,'approve','approve',{note:'Human approval for later internal execution review.'}),replay=await move(f,r,f.approver,'approve','approve',{note:'Human approval for later internal execution review.'});assert.deepEqual(replay,done);assert.equal(done.state,'approved');
  await assert.rejects(move(f,done,f.approver,'reject','terminal'),{code:'invalid_transition'});await assert.rejects(db.getPool().query(`DELETE FROM orchestrator_optimization_execution_requests WHERE tenant_id=$1 AND id=$2`,[f.tenant,done.request_id]),/deletion|immutable/i);
  const g=await approved(`pr8b-rejected-${Date.now()}`);let rejected=await create(g);rejected=await move(g,rejected,g.user,'submit','submit');rejected=await move(g,rejected,g.approver,'reject','reject');assert.equal(rejected.state,'rejected');
 });
 test('identical concurrent decisions yield one event; competing decisions yield one winner',async()=>{
  const f=await approved(`pr8b-decisions-${Date.now()}`);let r=await create(f);r=await move(f,r,f.user,'submit','submit');const same=await Promise.all([1,2].map(()=>move(f,r,f.approver,'approve','same')));assert.deepEqual(same[0],same[1]);
  let q=await db.getPool().query(`SELECT count(*)::int n FROM orchestrator_optimization_execution_events WHERE tenant_id=$1 AND request_id=$2 AND new_state='approved'`,[f.tenant,r.request_id]);assert.equal(q.rows[0].n,1);
  const g=await approved(`pr8b-compete-${Date.now()}`);let x=await create(g);x=await move(g,x,g.user,'submit','submit');const competed=await Promise.allSettled([move(g,x,g.approver,'approve','yes'),move(g,x,g.approver,'reject','no')]);assert.equal(competed.filter(v=>v.status==='fulfilled').length,1);assert.equal(competed.filter(v=>v.status==='rejected').length,1);
 });
 test('source revocation transactionally invalidates and append-only/lineage guards remain effective',async()=>{
  const f=await approved(`pr8b-invalidate-${Date.now()}`);let r=await create(f);await db.getPool().query(`UPDATE orchestrator_tenant_meta_credential_refs SET revoked_at=now(),status='revoked' WHERE tenant_id=$1 AND id=$2`,[f.tenant,f.credential]);await assert.rejects(move(f,r,f.user,'submit','d'.repeat(100)),{code:'source_ineligible'});assert.equal((await row(f,r.request_id)).state,'invalidated');
  await assert.rejects(db.getPool().query(`UPDATE orchestrator_optimization_execution_requests SET recommendation_id='changed' WHERE tenant_id=$1 AND id=$2`,[f.tenant,r.request_id]),/immutable|lineage/i);
  await assert.rejects(db.getPool().query(`DELETE FROM orchestrator_optimization_execution_events WHERE tenant_id=$1 AND request_id=$2`,[f.tenant,r.request_id]),/append.only/i);
 });
 test('event or audit failure rolls back lifecycle and preserves PR8A and PR7C source rows byte-identically',async()=>{
  const f=await approved(`pr8b-rollback-${Date.now()}`),p=db.getPool();let r=await create(f);const snap=async(table,id)=> (await p.query(`SELECT row_to_json(x)::text v FROM ${table} x WHERE tenant_id=$1 AND id=$2`,[f.tenant,id])).rows[0].v,beforeSet=await snap('orchestrator_campaign_optimization_recommendation_sets',f.set),beforeRun=await snap('orchestrator_campaign_monitoring_runs',f.run);
  const wrapped=pattern=>({connect:async()=>{const c=await p.connect();return {release:()=>c.release(),query:(sql,args)=>pattern.test(sql)?Promise.reject(new Error('injected failure')):c.query(sql,args)}}});
  await assert.rejects(move(f,r,f.user,'submit','event-fail',{pool:wrapped(/INSERT INTO orchestrator_optimization_execution_events/)}),/injected/);assert.deepEqual((await row(f,r.request_id)).state,'draft');
  await assert.rejects(move(f,r,f.user,'submit','audit-fail',{pool:wrapped(/INSERT INTO orchestrator_audit_events/)}),/injected/);assert.deepEqual((await row(f,r.request_id)).state,'draft');assert.equal(await snap('orchestrator_campaign_optimization_recommendation_sets',f.set),beforeSet);assert.equal(await snap('orchestrator_campaign_monitoring_runs',f.run),beforeRun);
 });
}
