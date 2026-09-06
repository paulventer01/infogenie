'use strict';

// PR10D.2 — the single guarded path from a PR10D.1 capability to one Google
// Ads activation attempt. Caller input is only an invocation id; provider ids,
// request shape, reservation key, credentials and status transitions are
// derived from locked authority.
const crypto=require('crypto');
const caps=require('../security/google_ads_activation_capabilities');
const vault=require('../credentials/vault');
const connector=require('./connectors/google_ads_activation');

const TABLE='orchestrator_google_ads_activation_attempts';
const OBJECTS='orchestrator_google_ads_provider_draft_objects';
const OUTCOMES='orchestrator_google_ads_activation_object_outcomes';
const DEADLINE_MS=10000;
const SAFE=/^[A-Za-z0-9_.:-]{1,128}$/;
const RESULTS=Object.freeze({succeeded:'provider_activation_succeeded',failed:'provider_activation_failed',unknown:'provider_activation_unknown'});
const hash=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
const same=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y);};
const integer=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
const deny=c=>caps._deny(c);

function project(r,replay=false){const iso=k=>r[k]?new Date(r[k]).toISOString():null;return Object.freeze({
  activation_attempt_id:r.id,capability_id:r.capability_id,status:r.status,result_code:r.result_code||null,replay:!!replay,
  objects_expected:Number(r.objects_expected),objects_activated:Number(r.objects_activated),
  requires_reconciliation:r.requires_reconciliation===true,external_action_taken:r.external_action_taken,
  created_at:iso('created_at'),started_at:iso('started_at'),settled_at:iso('settled_at')});}
async function withTx(pool,fn){const c=await pool.connect();try{await c.query('BEGIN');const out=await fn(c);await c.query('COMMIT');return out;}
 catch(e){try{await c.query('ROLLBACK');}catch(_e){}throw e;}finally{c.release();}}
async function audit(c,row,event){await c.query(`INSERT INTO orchestrator_audit_events
 (tenant_id,workflow_id,event,actor_user_id,detail) VALUES($1,$2,$3,$4,$5::jsonb)`,
 [row.tenant_id,row.workflow_id,event,row.actor_user_id,JSON.stringify({activation_attempt_id:row.id,capability_id:row.capability_id,status:row.status})]);}
function reservation(capabilityId,invocationId){return `gaact:${hash(`${capabilityId}|${invocationId}`).slice(0,64)}`;}
function invocationMatches(row,o,actor){return Number(row.actor_user_id)===actor&&same(row.session_id_hash,hash(o.sessionId))
 &&same(row.invocation_id_hash,hash(o.invocationId))&&same(String(row.capability_id),String(o.capabilityId));}

async function loadObjects(c,tenantId,operationId){
 const q=await c.query(`SELECT object_kind,sequence_number,provider_object_id,provider_status,published,activated,serving
  FROM ${OBJECTS} WHERE tenant_id=$1 AND operation_id=$2 ORDER BY sequence_number FOR UPDATE`,[tenantId,operationId]);
 const kinds=connector.OBJECT_SEQUENCE;
 if(q.rowCount!==3||q.rows.some((x,i)=>x.object_kind!==kinds[i]||Number(x.sequence_number)!==i+1
   ||x.provider_status!=='PAUSED'||x.published!==false||x.activated!==false||x.serving!==false
   ||!/^[0-9]{1,32}$/.test(String(x.provider_object_id||''))))throw deny('activation_object_binding_rejected');
 return q.rows;
}
function objectDigest(rows){return hash(rows.map(x=>`${x.object_kind}:${x.provider_object_id}`).join('|'));}
function capBound(cap,authority){return caps._bound(cap,authority)&&cap.status==='consumed'
 &&same(String(cap.reconciliation_run_id),String(authority.id));}

// Reserve, consume and persist the durable attempt in one transaction. Any
// duplicate delivery returns stored metadata without opening the vault.
async function begin(pool,o,actor){
 return withTx(pool,async c=>{
  const existing=await c.query(`SELECT * FROM ${TABLE} WHERE tenant_id=$1 AND capability_id=$2 FOR UPDATE`,[o.tenantId,o.capabilityId]);
  if(existing.rowCount){if(existing.rowCount!==1||!invocationMatches(existing.rows[0],o,actor))throw deny('activation_conflict');
    return {attempt:project(existing.rows[0],true),replay:true};}
  const reservationId=reservation(o.capabilityId,o.invocationId);
  const base={...o,actorUserId:actor,actorType:'human',principalType:'user',reservationId};
  const reserved=await caps.reserve(c,base);if(reserved.status==='expired')throw deny('capability_expired');
  const consumed=await caps.consume(c,base);if(consumed.status==='expired')throw deny('capability_expired');
  const q=await c.query(`SELECT * FROM orchestrator_google_ads_activation_capabilities
   WHERE tenant_id=$1 AND id=$2 AND actor_user_id=$3 AND status='consumed' FOR UPDATE`,[o.tenantId,o.capabilityId,actor]);
  if(q.rowCount!==1)throw deny('capability_rejected');const cap=q.rows[0];
  if(!same(cap.session_id_hash,hash(o.sessionId))||!same(cap.reservation_id_hash,hash(reservationId))
    ||!same(cap.invocation_id_hash,hash(o.invocationId)))throw deny('capability_rejected');
  const authority=await caps._authoritative(c,o.tenantId,actor,cap.reconciliation_run_id);
  if(!capBound(cap,authority))throw deny('authoritative_binding_mismatch');
  const objects=await loadObjects(c,o.tenantId,cap.operation_id),now=(await c.query('SELECT clock_timestamp() now')).rows[0].now;
  const row={tenant_id:o.tenantId,id:`gaact_${crypto.randomUUID()}`,capability_id:cap.id,actor_user_id:actor,
    session_id_hash:cap.session_id_hash,workflow_id:cap.workflow_id,operation_id:cap.operation_id,
    reconciliation_run_id:cap.reconciliation_run_id,credential_owner_user_id:cap.credential_owner_user_id,
    credential_ref_id:cap.credential_ref_id,credential_ref_version:cap.credential_ref_version,
    account_fingerprint:cap.account_fingerprint,ledger_root_hash:cap.ledger_root_hash,
    objects_digest:objectDigest(objects),invocation_id_hash:hash(o.invocationId),status:'in_progress',
    result_code:null,objects_expected:2,objects_activated:0,requires_reconciliation:false,
    external_action_taken:false,created_at:now,started_at:now,settled_at:null,audit_ref:`gaact-audit-${crypto.randomUUID()}`};
  await c.query(`INSERT INTO ${TABLE}(tenant_id,id,capability_id,actor_user_id,session_id_hash,workflow_id,
   operation_id,reconciliation_run_id,credential_owner_user_id,credential_ref_id,credential_ref_version,
   account_fingerprint,ledger_root_hash,objects_digest,invocation_id_hash,status,result_code,objects_expected,
   objects_activated,requires_reconciliation,external_action_taken,created_at,started_at,settled_at,audit_ref)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'in_progress',NULL,2,0,FALSE,FALSE,$16,$16,NULL,$17)`,
  [row.tenant_id,row.id,row.capability_id,row.actor_user_id,row.session_id_hash,row.workflow_id,row.operation_id,
   row.reconciliation_run_id,row.credential_owner_user_id,row.credential_ref_id,row.credential_ref_version,
   row.account_fingerprint,row.ledger_root_hash,row.objects_digest,row.invocation_id_hash,now,row.audit_ref]);
  await audit(c,row,'google_ads_activation_attempt_started');
  return {attempt:project(row,false),replay:false,objects};
 });}

async function claim(c,o,actor,attemptId){
 const aq=await c.query(`SELECT * FROM ${TABLE} WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[o.tenantId,attemptId]);
 if(aq.rowCount!==1)throw deny('activation_rejected');const row=aq.rows[0];
 if(row.status!=='in_progress'||!invocationMatches(row,o,actor))return {row,replay:true};
 const cq=await c.query(`SELECT * FROM orchestrator_google_ads_activation_capabilities
  WHERE tenant_id=$1 AND id=$2 AND status='consumed' FOR UPDATE`,[o.tenantId,row.capability_id]);
 if(cq.rowCount!==1)throw deny('capability_rejected');const cap=cq.rows[0];
 if(!same(cap.session_id_hash,row.session_id_hash)||!same(cap.invocation_id_hash,row.invocation_id_hash))throw deny('capability_rejected');
 const authority=await caps._authoritative(c,o.tenantId,actor,cap.reconciliation_run_id);
 if(!capBound(cap,authority)||!same(row.reconciliation_run_id,cap.reconciliation_run_id)
  ||!same(row.account_fingerprint,cap.account_fingerprint)||Number(row.credential_ref_version)!==Number(cap.credential_ref_version))throw deny('authoritative_binding_mismatch');
 const objects=await loadObjects(c,o.tenantId,row.operation_id);
 if(!same(row.objects_digest,objectDigest(objects)))throw deny('activation_object_binding_rejected');
 return {row,cap,objects,replay:false};
}
async function recordOutcomes(c,row,status){
 const unknown=status==='unknown',acted=status==='succeeded'?true:(unknown?null:false);
 for(const [i,kind] of ['campaign','ad_group'].entries())await c.query(`INSERT INTO ${OUTCOMES}
  (tenant_id,id,activation_attempt_id,object_kind,sequence_number,outcome,result_code,
   requires_reconciliation,external_action_taken,recorded_at,audit_ref)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp(),$10)`,
 [row.tenant_id,`gaacto_${crypto.randomUUID()}`,row.id,kind,i+1,status,RESULTS[status],unknown,acted,
  `gaacto-audit-${crypto.randomUUID()}`]);
}
async function settle(c,row,status){
 if(!Object.hasOwn(RESULTS,status)||row.status!=='in_progress')throw deny('activation_rejected');
 const succeeded=status==='succeeded',unknown=status==='unknown';
 await recordOutcomes(c,row,status);
 const q=await c.query(`UPDATE ${TABLE} SET status=$3,result_code=$4,objects_activated=$5,
  requires_reconciliation=$6,external_action_taken=$7,settled_at=clock_timestamp()
  WHERE tenant_id=$1 AND id=$2 AND status='in_progress' RETURNING *`,
 [row.tenant_id,row.id,status,RESULTS[status],succeeded?2:0,unknown,succeeded?true:(unknown?null:false)]);
 if(q.rowCount!==1)throw deny('activation_rejected');await audit(c,q.rows[0],'google_ads_activation_attempt_settled');return project(q.rows[0],false);
}
async function forceSettle(pool,o,actor,attemptId,status){return withTx(pool,async c=>{const q=await c.query(`SELECT * FROM ${TABLE}
 WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[o.tenantId,attemptId]);if(q.rowCount!==1)throw deny('activation_rejected');
 const row=q.rows[0];if(!invocationMatches(row,o,actor))throw deny('activation_rejected');if(row.status!=='in_progress')return project(row,true);
 return settle(c,row,status);});}
async function bounded(run){let timer;try{return await Promise.race([Promise.resolve().then(run),
 new Promise((_r,reject)=>{timer=setTimeout(()=>reject(deny('provider_deadline_exceeded')),DEADLINE_MS);})]);}finally{if(timer)clearTimeout(timer);}}

async function execute(pool,o={}){
 if(!pool||typeof pool.connect!=='function')throw deny('activation_rejected');
 const tenantId=integer(o.tenantId);if(!tenantId||!SAFE.test(String(o.capabilityId||''))||!SAFE.test(String(o.invocationId||'')))throw deny('validation_failed');
 const actor=caps._human(o),input={...o,tenantId};if(o.providerTransport!==undefined&&typeof o.providerTransport!=='function')throw deny('validation_failed');
 if(o.tokenTransport!==undefined&&typeof o.tokenTransport!=='function')throw deny('validation_failed');
 const live=o.providerTransport===undefined;if(live&&!(o.allowLive===true&&process.env[connector.LIVE_OPT_IN_ENV]==='1'))throw deny('live_google_ads_disabled');
 const started=await begin(pool,input,actor);if(started.replay)return started.attempt;
 let invoked=false;
 try{return await withTx(pool,async c=>{const x=await claim(c,input,actor,started.attempt.activation_attempt_id);
  if(x.replay)return project(x.row,true);
  const result=await vault.withGoogleAdsActivationSecretScope(c,{tenantId,ownerUserId:actor,
   credentialRefId:x.cap.credential_ref_id,credentialRefVersion:x.cap.credential_ref_version,
   accountFingerprint:x.cap.account_fingerprint,tokenTransport:o.tokenTransport||vault.googleAdsOAuthTokenTransport,
   tokenTimeoutMs:o.tokenTimeoutMs},async credentials=>{
    const once=request=>{if(invoked)throw deny('provider_reinvocation_rejected');invoked=true;return o.providerTransport(request);};
    if(live)invoked=true;
    return bounded(()=>connector.activateGoogleAdsCampaign({operation:{provider_operation_key:hash(x.row.id)},
      credentials,objects:x.objects,...(live?{allowLive:true}:{inject:{mutate:once}})}));});
  const status=result?.result_code===RESULTS.succeeded?'succeeded':result?.result_code===RESULTS.failed?'failed':'unknown';
  return settle(c,x.row,status);});}
 catch(e){try{const out=await forceSettle(pool,input,actor,started.attempt.activation_attempt_id,invoked?'unknown':'failed');
   if(invoked)return out;}catch(_settle){}throw e;}
}

module.exports={TABLE,OUTCOMES,RESULTS,DEADLINE_MS,execute,_project:project,_reservation:reservation,_objectDigest:objectDigest};
