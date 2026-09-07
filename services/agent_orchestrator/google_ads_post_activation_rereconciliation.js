'use strict';

// PR10D.5 — one human-authorized, read-only re-observation after a PR10D.4
// case is explicitly closed for external remediation. The existing PR10D.3
// proof, vault boundary and GAQL-only observer remain the sole provider path.
const crypto=require('crypto');
const db=require('../../db');
const reconciliation=require('./google_ads_post_activation_reconciliation');

const TABLE='orchestrator_google_ads_post_activation_rereconciliation_attempts';
const REVIEW_CASES='orchestrator_google_ads_post_activation_review_cases';
const REVIEW_EVENTS='orchestrator_google_ads_post_activation_review_events';
const SOURCE_RUNS='orchestrator_google_ads_post_activation_reconciliation_runs';
const PERMISSION=reconciliation.POST_REVIEW_PERMISSION;
const SAFE_ID=/^[A-Za-z0-9_.:-]{1,128}$/;
const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const same=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y);};
function deny(code){const error=new Error(code);error.code=code;error.blocked=true;error.external_action_taken=false;return error;}
function authorize(o={}){const actor=Number(o.actorUserId),tenant=Number(o.tenantId);
  if(!Number.isSafeInteger(actor)||actor<1||o.actorType!=='human'||o.principalType!=='user'||!SAFE_ID.test(String(o.sessionId||'')))
    throw deny('human_session_required');
  if(!Number.isSafeInteger(tenant)||tenant<1||!SAFE_ID.test(String(o.reviewCaseId||''))||!SAFE_ID.test(String(o.invocationId||'')))
    throw deny('validation_failed');
  if(typeof o.hasExplicitTenantPermission!=='function'||o.hasExplicitTenantPermission(PERMISSION)!==true)throw deny('permission_denied');
  return {actor,tenant};}
function requestHash(o,actor){return hash(JSON.stringify({review_case_id:String(o.reviewCaseId),invocation_id:String(o.invocationId),actor}));}
const storageObservations=rows=>(Array.isArray(rows)?rows:[]).map(value=>{const safe=reconciliation._test.safeObservation(value);
  return {...safe,error_classification:safe.error_classification||null};});
function publicAttempt(row,replay=false){return Object.freeze({rereconciliation_attempt_id:row.id,
  review_case_reference:row.review_case_id,review_version:Number(row.review_version),
  closure_event_reference:row.closure_audit_ref,activation_attempt_reference:row.activation_attempt_id,
  activation_result:row.activation_status,state:row.state,replay:!!replay,object_kinds:reconciliation.KINDS,
  observations:(Array.isArray(row.observations)?row.observations:[]).map(reconciliation._test.safeObservation),
  discrepancy_classifications:row.state==='discrepancy_detected'?(row.classifications||[]):[],
  failure_classifications:row.state==='failed'?(row.classifications||[]):[],
  observation_started_at:row.observing_at,observation_completed_at:row.completed_at||null,
  audit_reference:row.audit_ref,external_action_taken:false});}
async function tx(pool,fn){const c=await pool.connect();try{await c.query('BEGIN');const out=await fn(c);await c.query('COMMIT');return out;}
  catch(error){try{await c.query('ROLLBACK');}catch(_){}throw error;}finally{c.release();}}
async function audit(c,row,event){await c.query(`INSERT INTO orchestrator_audit_events
  (tenant_id,workflow_id,event,actor_user_id,detail) VALUES($1,$2,$3,$4,$5::jsonb)`,
 [row.tenant_id,row.workflow_id,event,row.requested_by,JSON.stringify({post_activation_rereconciliation_attempt_id:row.id,
   post_activation_review_case_id:row.review_case_id,status:row.state,audit_reference:row.audit_ref})]);}
function sameRequest(row,o,actor,digest){if(row.review_case_id!==o.reviewCaseId||row.invocation_id_hash!==digest
  ||Number(row.requested_by)!==actor||!same(row.session_id_hash,hash(o.sessionId)))throw deny('idempotency_conflict');}
async function proof(c,o,actor,lock='FOR SHARE'){
  const hint=await c.query(`SELECT activation_attempt_id,reconciliation_run_id FROM ${REVIEW_CASES}
    WHERE tenant_id=$1 AND id=$2`,[o.tenantId,o.reviewCaseId]);
  if(hint.rowCount!==1)throw deny('review_case_not_found');
  const activation=await reconciliation._test.proof(c,{...o,activationAttemptId:hint.rows[0].activation_attempt_id,
    authorizationPurpose:'post_review'},actor,lock);
  const q=await c.query(`SELECT * FROM ${REVIEW_CASES} WHERE tenant_id=$1 AND id=$2 ${lock}`,[o.tenantId,o.reviewCaseId]);
  if(q.rowCount!==1||q.rows[0].activation_attempt_id!==hint.rows[0].activation_attempt_id
    ||q.rows[0].reconciliation_run_id!==hint.rows[0].reconciliation_run_id)throw deny('review_case_not_found');
  const review=q.rows[0];
  if(review.state!=='closed'||review.disposition!=='external_remediation_required'||!review.closed_at)
    throw deny('review_case_ineligible');
  const events=await c.query(`SELECT * FROM ${REVIEW_EVENTS} WHERE tenant_id=$1 AND case_id=$2
    AND case_version=$3 AND to_state='closed' AND disposition='external_remediation_required' FOR SHARE`,
   [o.tenantId,review.id,review.version]);
  if(events.rowCount!==1)throw deny('closure_event_mismatch');
  const source=await c.query(`SELECT * FROM ${SOURCE_RUNS} WHERE tenant_id=$1 AND id=$2
    AND state='discrepancy_detected' AND completed_at IS NOT NULL
    AND activation_attempt_id=$3 AND activation_status=$4 AND workflow_id=$5 AND requested_by=$6
    AND observing_at=$7 AND completed_at=$8
    AND classifications=$9 AND orchestrator_gaparv_safe_observations(observations)=$10::jsonb FOR SHARE`,
   [o.tenantId,review.reconciliation_run_id,review.activation_attempt_id,review.activation_status,review.workflow_id,
    review.source_requested_by,review.source_observing_at,review.source_completed_at,
    review.source_discrepancy_classifications,JSON.stringify(review.observed_provider_state)]);
  if(source.rowCount!==1)throw deny('source_lineage_mismatch');const original=source.rows[0];
  return {review,event:events.rows[0],source:original,activation};}
async function find(c,tenant,caseId){const q=await c.query(`SELECT a.*,e.audit_ref closure_audit_ref FROM ${TABLE} a
  JOIN ${REVIEW_EVENTS} e ON e.tenant_id=a.tenant_id AND e.id=a.closure_event_id
  WHERE a.tenant_id=$1 AND a.review_case_id=$2 FOR UPDATE OF a`,[tenant,caseId]);
  return q.rowCount===1?q.rows[0]:null;}
async function finalizeExpired(c,row,closureAuditRef){if(row.state!=='observing')return row;
  const now=new Date((await c.query('SELECT clock_timestamp() now')).rows[0].now);
  if(new Date(row.observation_deadline)>now)return row;
  const done=await c.query(`UPDATE ${TABLE} SET state='failed',
    classifications=ARRAY['interrupted_observation'],completed_at=$3 WHERE tenant_id=$1 AND id=$2 AND state='observing' RETURNING *`,
   [row.tenant_id,row.id,now]);if(done.rowCount!==1)throw deny('invalid_rereconciliation_transition');
  const failed={...done.rows[0],closure_audit_ref:closureAuditRef};
  await audit(c,failed,'google_ads_post_activation_rereconciliation_failed');return failed;}
async function existing(pool,o,actor,digest){const found=await tx(pool,async c=>{const p=await proof(c,o,actor);let row=await find(c,o.tenantId,o.reviewCaseId);
  if(!row)return null;
  row=await finalizeExpired(c,row,p.event.audit_ref);
  return {row,closure_audit_ref:p.event.audit_ref};});
  if(!found)return null;sameRequest(found.row,o,actor,digest);
  return publicAttempt({...found.row,closure_audit_ref:found.closure_audit_ref},true);}
async function reserve(pool,o,actor,digest){return tx(pool,async c=>{const p=await proof(c,o,actor,'FOR UPDATE');
  const now=new Date((await c.query('SELECT clock_timestamp() now')).rows[0].now),id=`gaparra_${crypto.randomUUID()}`;
  const q=await c.query(`INSERT INTO ${TABLE}(tenant_id,id,review_case_id,review_version,closure_event_id,
    original_reconciliation_run_id,activation_attempt_id,activation_status,invocation_id_hash,requested_by,
    session_id_hash,workflow_id,state,observations,classifications,audit_ref,observing_at,observation_deadline)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'observing','[]'::jsonb,'{}'::text[],$13,$14,$15) RETURNING *`,
   [o.tenantId,id,p.review.id,p.review.version,p.event.id,p.review.reconciliation_run_id,p.review.activation_attempt_id,
    p.review.activation_status,digest,actor,hash(o.sessionId),p.review.workflow_id,`gaparra-audit-${crypto.randomUUID()}`,
    now,new Date(now.getTime()+reconciliation.LEASE_MS)]);
  const row={...q.rows[0],closure_audit_ref:p.event.audit_ref};await audit(c,row,'google_ads_post_activation_rereconciliation_observing');
  return {row,proof:p.activation.row,objects:p.activation.objects};});}
async function settle(pool,o,actor,started,outcome){return tx(pool,async c=>{const p=await proof(c,o,actor);
  const q=await c.query(`SELECT * FROM ${TABLE} WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[o.tenantId,started.row.id]);
  if(q.rowCount!==1||q.rows[0].state!=='observing')throw deny('invalid_rereconciliation_transition');
  const now=new Date((await c.query('SELECT clock_timestamp() now')).rows[0].now),finalOutcome=new Date(q.rows[0].observation_deadline)<=now
    ?{state:'failed',classifications:['interrupted_observation'],observations:[]}:outcome;
  const done=await c.query(`UPDATE ${TABLE} SET state=$3,observations=$4::jsonb,classifications=$5,completed_at=$6
    WHERE tenant_id=$1 AND id=$2 AND state='observing' RETURNING *`,[o.tenantId,started.row.id,finalOutcome.state,
    JSON.stringify(storageObservations(finalOutcome.observations)),finalOutcome.classifications,now]);
  if(done.rowCount!==1)throw deny('invalid_rereconciliation_transition');const row={...done.rows[0],closure_audit_ref:p.event.audit_ref};
  await audit(c,row,`google_ads_post_activation_rereconciliation_${row.state}`);return publicAttempt(row,false);});}
async function rereconcile(o={}){const {actor,tenant}=authorize(o),pool=o.pool||db.getPool(),opts={...o,tenantId:tenant,
  reviewCaseId:String(o.reviewCaseId),invocationId:String(o.invocationId),authorizationPurpose:'post_review'},digest=requestHash(opts,actor);
  const replay=await existing(pool,opts,actor,digest);if(replay)return replay;
  let started;try{started=await reserve(pool,opts,actor,digest);}catch(error){
    if(error&&error.code==='23505'){const race=await existing(pool,opts,actor,digest);if(race)return race;}throw error;}
  let outcome;try{const observed=await reconciliation._test.observe(pool,opts,actor,started);
    outcome=reconciliation.evaluate(observed,started.row.activation_status);}
  catch(error){outcome={state:'failed',classifications:[error&&error.code==='credential_boundary_mismatch'
    ?'credential_boundary_failure':'observation_failure'],observations:[]};}
  return settle(pool,opts,actor,started,outcome);}
async function getAttempt(o={}){const actor=Number(o.actorUserId),tenant=Number(o.tenantId),attemptId=String(o.attemptId||'');
  authorize({...o,invocationId:'read'});if(!SAFE_ID.test(attemptId))throw deny('validation_failed');
  const found=await tx(o.pool||db.getPool(),async c=>{const hint=await c.query(`SELECT review_case_id FROM ${TABLE} WHERE tenant_id=$1 AND id=$2`,[tenant,attemptId]);
    if(hint.rowCount!==1||hint.rows[0].review_case_id!==String(o.reviewCaseId))throw deny('rereconciliation_not_found');
    const p=await proof(c,{...o,tenantId:tenant,reviewCaseId:hint.rows[0].review_case_id,
      authorizationPurpose:'post_review'},actor);const row=await find(c,tenant,hint.rows[0].review_case_id);
    if(!row||row.id!==attemptId)throw deny('rereconciliation_not_found');return {row:await finalizeExpired(c,row,p.event.audit_ref),
      closure_audit_ref:p.event.audit_ref};});
  if(Number(found.row.requested_by)!==actor||!same(found.row.session_id_hash,hash(o.sessionId)))throw deny('rereconciliation_not_found');
  return publicAttempt({...found.row,closure_audit_ref:found.closure_audit_ref},true);}

module.exports={TABLE,PERMISSION,rereconcile,getAttempt,publicAttempt,
  _test:{authorize,requestHash,storageObservations,sameRequest,proof,find,finalizeExpired,existing,reserve,settle,audit}};
