'use strict';
// PR10D.1 is metadata-only authority. No vault, connector, transport or provider
// code is imported here; consumption merely closes this one-shot ledger row.
const crypto=require('crypto');
const TABLE='orchestrator_google_ads_activation_capabilities';
const PERMISSION='advertising.campaign.activate';
const CONFIRMATION='AUTHORIZE ONE GOOGLE ADS ACTIVATION ATTEMPT';
const DEFAULT_TTL_MS=5*60*1000,MAX_TTL_MS=10*60*1000,MAX_CONFIRMATION_AGE_MS=5*60*1000;
const SAFE=/^[A-Za-z0-9_.:-]{1,128}$/;
const TERMINAL=['consumed','revoked','expired'];
const hash=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
const valid=v=>SAFE.test(String(v||''));
const integer=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
const cappedExpiry=(issuedAt,ttl,approvalExpiresAt)=>new Date(Math.min(issuedAt.getTime()+ttl,new Date(approvalExpiresAt).getTime()));
function deny(code){const e=new Error(code);e.code=code;e.blocked=true;e.external_action_taken=false;return e;}
function same(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y);}
function optionalSame(a,b){return (a==null&&b==null)||same(String(a),String(b));}
function human(o){const id=integer(o?.actorUserId);if(!id||o.actorType!=='human'||!valid(o.sessionId)
  ||['api_key','worker','service','service_account','automation','autonomous','agent'].includes(String(o.principalType||'').toLowerCase()))throw deny('human_session_required');
  if(typeof o.hasExplicitTenantPermission!=='function'||o.hasExplicitTenantPermission(PERMISSION)!==true)throw deny('permission_denied');return id;}
async function audit(c,row,actor,event,status){await c.query(`INSERT INTO orchestrator_audit_events
  (tenant_id,workflow_id,event,actor_user_id,detail) VALUES($1,$2,$3,$4,$5::jsonb)`,[row.tenant_id,row.workflow_id,event,actor,
  JSON.stringify({capability_id:row.id,reconciliation_run_id:row.reconciliation_run_id,status})]);}
function project(r,replay=false){const iso=k=>r[k]?new Date(r[k]).toISOString():null;return Object.freeze({capability_id:r.id,
  reconciliation_run_id:r.reconciliation_run_id,status:r.status,replay,issued_at:iso('issued_at'),expires_at:iso('expires_at'),
  reserved_at:iso('reserved_at'),consumed_at:iso('consumed_at'),revoked_at:iso('revoked_at'),external_action_taken:false});}

// Locks every mutable authority row. The selected reconciliation must be the
// latest completed lineage for the operation. Once review exists, only the
// verified run produced by the current, correctly closed review may qualify.
async function authoritative(c,tenantId,actorId,runId,{requireOpenSwitches=true,allowExpiredApproval=false}={}){
 const lineage=await c.query(`SELECT operation_id FROM orchestrator_google_ads_reconciliation_runs WHERE tenant_id=$1 AND id=$2`,[tenantId,runId]);
 if(lineage.rowCount!==1)throw deny('authority_not_found');const operationId=lineage.rows[0].operation_id;
 const operation=await c.query(`SELECT id FROM orchestrator_google_ads_provider_draft_operations WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[tenantId,operationId]);
 if(operation.rowCount!==1)throw deny('authority_not_found');
 const r=await c.query(`SELECT run.*,a.purpose,a.review_case_id,a.review_version,a.closure_event_id,
  a.credential_owner_user_id,a.account_fingerprint,op.workflow_id,op.draft_revision,op.contract_hash,
  op.publish_approval_id,op.workflow_approval_id,op.capability_id,op.external_action_taken,
  d.current_revision,d.status AS draft_status,pr.revision AS request_revision,pr.contract_hash AS request_contract_hash,
  pr.publish_approval_id AS request_approval_id,pr.workflow_approval_id AS request_workflow_approval_id,
  pa.revision AS approval_revision,pa.contract_hash AS approval_contract_hash,pa.revoked_at AS approval_revoked_at,
  pa.expires_at AS approval_expires_at,(pa.expires_at>clock_timestamp()) approval_active,
  g.active AS global_switch_active,k.active AS tenant_switch_active,
  di.intent_hash AS current_intent_hash,cred.owner_user_id,cred.version AS current_credential_version,cred.status AS credential_status,
  ra.id AS rereconciliation_attempt_id,rc.state AS review_state,rc.version AS current_review_version,
  (SELECT count(*) FROM orchestrator_google_ads_provider_draft_objects ob WHERE ob.tenant_id=op.tenant_id AND ob.operation_id=op.id
    AND ob.provider_status='PAUSED' AND ob.serving=FALSE AND ob.published=FALSE AND ob.activated=FALSE) object_count
 FROM orchestrator_google_ads_reconciliation_runs run
 JOIN orchestrator_google_ads_reconciliation_read_authorizations a ON a.tenant_id=run.tenant_id AND a.id=run.authorization_id
 JOIN orchestrator_google_ads_provider_draft_operations op ON op.tenant_id=run.tenant_id AND op.id=run.operation_id
 JOIN orchestrator_campaign_drafts d ON d.tenant_id=op.tenant_id AND d.id=op.draft_id
 JOIN orchestrator_campaign_publish_requests pr ON pr.tenant_id=op.tenant_id AND pr.id=op.publishing_request_id
 JOIN orchestrator_campaign_publish_approvals pa ON pa.tenant_id=op.tenant_id AND pa.id=op.publish_approval_id
 JOIN orchestrator_campaign_delivery_intents di ON di.tenant_id=op.tenant_id AND di.id=op.intent_id
 JOIN orchestrator_tenant_google_ads_credential_refs cred ON cred.tenant_id=op.tenant_id AND cred.id=op.credential_ref_id
 JOIN tenants t ON t.id=op.tenant_id AND t.status='active'
 JOIN tenant_users tu ON tu.tenant_id=t.id AND tu.user_id=$3 AND tu.status='active'
 JOIN roles role ON role.id=tu.role_id AND (role.tenant_id=t.id OR role.tenant_id IS NULL) AND role.permissions ? $4
 JOIN orchestrator_advertising_global_kill_switches g ON g.switch_key='google_ads_activation'
 JOIN orchestrator_advertising_tenant_kill_switches k ON k.tenant_id=t.id AND k.switch_key='google_ads_activation'
 LEFT JOIN orchestrator_google_ads_rereconciliation_attempts ra ON ra.tenant_id=run.tenant_id AND ra.new_reconciliation_run_id=run.id
 LEFT JOIN orchestrator_google_ads_reconciliation_review_cases rc ON rc.tenant_id=ra.tenant_id AND rc.id=ra.review_case_id
 WHERE run.tenant_id=$1 AND run.id=$2 AND run.operation_id=$5
 FOR UPDATE OF run,a,op,d,pr,pa,di,cred,t,tu,role,g,k`,[tenantId,runId,actorId,PERMISSION,operationId]);
 if(r.rowCount!==1)throw deny('authority_not_found');const x=r.rows[0];
 const reviews=await c.query(`SELECT id,state,version FROM orchestrator_google_ads_reconciliation_review_cases WHERE tenant_id=$1 AND operation_id=$2 FOR UPDATE`,[tenantId,x.operation_id]);
 const newer=await c.query(`SELECT 1 FROM orchestrator_google_ads_reconciliation_runs WHERE tenant_id=$1 AND operation_id=$2 AND (created_at,id)>( $3,$4) LIMIT 1 FOR UPDATE`,[tenantId,x.operation_id,x.created_at,x.id]);
 if((requireOpenSwitches&&(x.global_switch_active===true||x.tenant_switch_active===true))
   ||x.state!=='verified'||!x.completed_at||newer.rowCount||x.external_action_taken!==true||Number(x.object_count)!==3
   ||x.draft_status!=='approved_for_publish'||Number(x.current_revision)!==Number(x.draft_revision)||Number(x.request_revision)!==Number(x.draft_revision)
   ||Number(x.approval_revision)!==Number(x.draft_revision)||!same(x.contract_hash,x.request_contract_hash)||!same(x.contract_hash,x.approval_contract_hash)
   ||!same(x.publish_approval_id,x.request_approval_id)||Number(x.workflow_approval_id)!==Number(x.request_workflow_approval_id)
   ||x.approval_revoked_at||(!allowExpiredApproval&&x.approval_active!==true)||!same(x.intent_hash,x.current_intent_hash)
   ||x.credential_status!=='active'||Number(x.credential_ref_version)!==Number(x.current_credential_version)
   ||Number(x.credential_owner_user_id)!==Number(x.owner_user_id))throw deny('authoritative_binding_mismatch');
 if(reviews.rowCount&&(!x.rereconciliation_attempt_id||x.purpose!=='post_review'||x.review_state!=='closed'
   ||Number(x.review_version)!==Number(x.current_review_version)||!reviews.rows.some(v=>v.id===x.review_case_id&&v.state==='closed'&&Number(v.version)===Number(x.review_version))))throw deny('post_review_reconciliation_required');
 return x;}
function bound(cap,x){return [['workflow_id','workflow_id'],['draft_id','draft_id'],['contract_hash','contract_hash'],['publishing_request_id','publishing_request_id'],
 ['publish_approval_id','publish_approval_id'],['snapshot_hash','snapshot_hash'],['intent_id','intent_id'],['intent_hash','intent_hash'],['operation_id','operation_id'],
 ['source_authorization_id','authorization_id'],['reconciliation_run_id','id'],['credential_owner_user_id','credential_owner_user_id'],
 ['credential_ref_id','credential_ref_id'],['account_fingerprint','account_fingerprint'],['ledger_root_hash','ledger_root_hash']]
 .every(([a,b])=>same(String(cap[a]),String(x[b])))
 &&[['review_case_id','review_case_id'],['closure_event_id','closure_event_id'],['rereconciliation_attempt_id','rereconciliation_attempt_id']]
 .every(([a,b])=>optionalSame(cap[a],x[b]))&&Number(cap.draft_revision)===Number(x.draft_revision)
 &&Number(cap.workflow_approval_id)===Number(x.workflow_approval_id)
 &&new Date(cap.approval_expires_at).getTime()===new Date(x.approval_expires_at).getTime()
 &&Number(cap.review_version||0)===Number(x.review_version||0)&&Number(cap.credential_ref_version)===Number(x.credential_ref_version);}
async function issue(c,o={}){const tenantId=integer(o.tenantId),actor=human(o),ttl=o.ttlMs===undefined?DEFAULT_TTL_MS:integer(o.ttlMs),confirmedAt=new Date(o.confirmedAt);
 if(!tenantId||!valid(o.reconciliationRunId)||!valid(o.confirmationId)||o.confirmation!==CONFIRMATION||!ttl||ttl>MAX_TTL_MS
   ||!Number.isFinite(confirmedAt.getTime()))throw deny('validation_failed');
 // An identical replay must be able to lock and retire its already-issued row
 // when the approval and (capped) capability expire together. This exception
 // only relaxes the approval-time predicate; every other authority predicate
 // is still re-proved, and no new row is inserted below without a live approval.
 const x=await authoritative(c,tenantId,actor,String(o.reconciliationRunId),{allowExpiredApproval:true}),now=new Date((await c.query('SELECT clock_timestamp() now')).rows[0].now);
 const confirmationHash=hash(`${tenantId}|${actor}|${o.sessionId}|${o.confirmationId}|${CONFIRMATION}|${confirmedAt.toISOString()}`);
 const prior=await c.query(`SELECT * FROM ${TABLE} WHERE tenant_id=$1 AND confirmation_hash=$2 FOR UPDATE`,[tenantId,confirmationHash]);
 const replay=async q=>{const cap=q.rows[0];if(q.rowCount!==1||!same(cap.confirmation_hash,confirmationHash)||Number(cap.actor_user_id)!==actor
   ||!same(cap.session_id_hash,hash(o.sessionId))||!bound(cap,x))throw deny('capability_conflict');
  if(!TERMINAL.includes(cap.status)&&!(new Date(cap.expires_at)>now)){await c.query(`UPDATE ${TABLE} SET status='expired' WHERE tenant_id=$1 AND id=$2`,[tenantId,cap.id]);
   cap.status='expired';await audit(c,cap,actor,'google_ads_activation_capability_expired','expired');}
  return project(cap,true);};
 if(prior.rowCount)return replay(prior);
 if(!(new Date(x.approval_expires_at)>now))throw deny('authoritative_binding_mismatch');
 if(confirmedAt>now||now-confirmedAt>MAX_CONFIRMATION_AGE_MS)throw deny('fresh_confirmation_required');
 const row={...x,tenant_id:tenantId,id:`gaac_${crypto.randomUUID()}`};
 await c.query('SAVEPOINT google_ads_activation_issue');
 try{await c.query(`INSERT INTO ${TABLE}(tenant_id,id,actor_user_id,session_id_hash,workflow_id,draft_id,draft_revision,contract_hash,publishing_request_id,publish_approval_id,workflow_approval_id,snapshot_hash,intent_id,intent_hash,operation_id,source_authorization_id,reconciliation_run_id,review_case_id,review_version,closure_event_id,rereconciliation_attempt_id,credential_owner_user_id,credential_ref_id,credential_ref_version,account_fingerprint,ledger_root_hash,confirmation_hash,confirmed_at,issued_at,expires_at,approval_expires_at,audit_ref)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)`,[tenantId,row.id,actor,hash(o.sessionId),x.workflow_id,x.draft_id,x.draft_revision,x.contract_hash,x.publishing_request_id,x.publish_approval_id,x.workflow_approval_id,x.snapshot_hash,x.intent_id,x.intent_hash,x.operation_id,x.authorization_id,x.id,x.review_case_id,x.review_version,x.closure_event_id,x.rereconciliation_attempt_id,x.credential_owner_user_id,x.credential_ref_id,x.credential_ref_version,x.account_fingerprint,x.ledger_root_hash,confirmationHash,confirmedAt,now,cappedExpiry(now,ttl,x.approval_expires_at),x.approval_expires_at,`gaac-audit-${crypto.randomUUID()}`]);
 await c.query('RELEASE SAVEPOINT google_ads_activation_issue');}catch(e){if(e?.code!=='23505')throw e;
  await c.query('ROLLBACK TO SAVEPOINT google_ads_activation_issue');
  const winner=await c.query(`SELECT * FROM ${TABLE} WHERE tenant_id=$1 AND (confirmation_hash=$2 OR reconciliation_run_id=$3) FOR UPDATE`,[tenantId,confirmationHash,x.id]);
  return replay(winner);
 }
 row.status='issued';row.issued_at=now;row.expires_at=cappedExpiry(now,ttl,x.approval_expires_at);row.approval_expires_at=x.approval_expires_at;row.reconciliation_run_id=x.id;await audit(c,row,actor,'google_ads_activation_capability_issued','issued');return project(row);}
async function locked(c,o,states,{requireOpenSwitches=true}={}){const tenantId=integer(o.tenantId),actor=human(o);if(!tenantId||!valid(o.capabilityId))throw deny('capability_rejected');
 const hint=await c.query(`SELECT reconciliation_run_id FROM ${TABLE} WHERE tenant_id=$1 AND id=$2`,[tenantId,String(o.capabilityId)]);if(hint.rowCount!==1)throw deny('capability_rejected');
 const authority=await authoritative(c,tenantId,actor,hint.rows[0].reconciliation_run_id,{requireOpenSwitches,allowExpiredApproval:true});
 const q=await c.query(`SELECT * FROM ${TABLE} WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[tenantId,String(o.capabilityId)]);if(q.rowCount!==1)throw deny('capability_rejected');const cap=q.rows[0];
 if(Number(cap.actor_user_id)!==actor||!same(cap.session_id_hash,hash(o.sessionId)))throw deny('capability_rejected');
 if(!same(cap.reconciliation_run_id,hint.rows[0].reconciliation_run_id)||!bound(cap,authority))throw deny('authoritative_binding_mismatch');
 const now=new Date((await c.query('SELECT clock_timestamp() now')).rows[0].now);
 if(TERMINAL.includes(cap.status)){if(cap.status!=='expired'&&!(new Date(authority.approval_expires_at)>now))throw deny('authoritative_binding_mismatch');return {terminal:true,cap,actor};}
 if(!states.includes(cap.status))throw deny('capability_rejected');
 if(!(new Date(cap.expires_at)>now)){await c.query(`UPDATE ${TABLE} SET status='expired' WHERE tenant_id=$1 AND id=$2`,[tenantId,cap.id]);cap.status='expired';await audit(c,cap,actor,'google_ads_activation_capability_expired','expired');return {terminal:true,cap,actor};}
 if(!(new Date(authority.approval_expires_at)>now))throw deny('authoritative_binding_mismatch');
 return {tenantId,actor,cap,now};}
async function reserve(c,o={}){if(!valid(o.reservationId))throw deny('validation_failed');const x=await locked(c,o,['issued','reserved']);if(x.terminal){
 if(x.cap.status==='expired')return project(x.cap,true);
 if(x.cap.status!=='consumed'||!same(x.cap.reservation_id_hash,hash(o.reservationId)))throw deny('capability_rejected');return project(x.cap,true);}
 if(x.cap.status==='reserved'){if(!same(x.cap.reservation_id_hash,hash(o.reservationId)))throw deny('capability_rejected');return project(x.cap,true);}
 await c.query(`UPDATE ${TABLE} SET status='reserved',reservation_id_hash=$3,reserved_at=$4 WHERE tenant_id=$1 AND id=$2`,[x.tenantId,x.cap.id,hash(o.reservationId),x.now]);x.cap.status='reserved';x.cap.reserved_at=x.now;await audit(c,x.cap,x.actor,'google_ads_activation_capability_reserved','reserved');return project(x.cap);}
async function consume(c,o={}){if(!valid(o.reservationId)||!valid(o.invocationId))throw deny('validation_failed');const x=await locked(c,o,['reserved']);if(x.terminal){
 if(x.cap.status==='expired')return project(x.cap,true);
 if(x.cap.status!=='consumed'||!same(x.cap.reservation_id_hash,hash(o.reservationId))||!same(x.cap.invocation_id_hash,hash(o.invocationId)))throw deny('capability_rejected');return project(x.cap,true);}
 if(!same(x.cap.reservation_id_hash,hash(o.reservationId)))throw deny('capability_rejected');await c.query(`UPDATE ${TABLE} SET status='consumed',invocation_id_hash=$3,consumed_at=$4 WHERE tenant_id=$1 AND id=$2`,[x.tenantId,x.cap.id,hash(o.invocationId),x.now]);x.cap.status='consumed';x.cap.consumed_at=x.now;await audit(c,x.cap,x.actor,'google_ads_activation_capability_consumed','consumed');return project(x.cap);}
async function revoke(c,o={}){const x=await locked(c,o,['issued','reserved'],{requireOpenSwitches:false});if(x.terminal)return project(x.cap,true);await c.query(`UPDATE ${TABLE} SET status='revoked',revoked_at=$3,revoked_by=$4 WHERE tenant_id=$1 AND id=$2`,[x.tenantId,x.cap.id,x.now,x.actor]);x.cap.status='revoked';x.cap.revoked_at=x.now;await audit(c,x.cap,x.actor,'google_ads_activation_capability_revoked','revoked');return project(x.cap);}
async function get(c,o={}){const x=await locked(c,o,['issued','reserved']);return project(x.cap,true);}
module.exports={PERMISSION,CONFIRMATION,MAX_CONFIRMATION_AGE_MS,MAX_TTL_MS,issue,reserve,consume,revoke,get,
 _authoritative:authoritative,_bound:bound,_cappedExpiry:cappedExpiry,_deny:deny,_human:human};
