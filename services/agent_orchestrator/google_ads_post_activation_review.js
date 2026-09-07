'use strict';

// PR10D.4 — a metadata-only human decision ledger over one completed PR10D.3
// discrepancy. This module deliberately has no connector, vault or provider
// dependency and cannot alter the immutable reconciliation source.
const crypto=require('crypto');
const db=require('../../db');

const TABLE='orchestrator_google_ads_post_activation_review_cases';
const EVENTS='orchestrator_google_ads_post_activation_review_events';
const SOURCE='orchestrator_google_ads_post_activation_reconciliation_runs';
const PERMISSION='advertising.reconciliation.review';
const STATES=Object.freeze(['open','acknowledged','escalated','closed']);
const DISPOSITIONS=Object.freeze(['provider_investigation_required','external_remediation_required','activation_state_mismatch',
  'unexpected_activation','object_missing','relationship_mismatch','account_mismatch','accepted_risk','false_positive','closed_unresolved']);
const KINDS=Object.freeze(['campaign_budget','campaign','ad_group']);
const INTENDED_STATE=Object.freeze({campaign_budget:'paused',campaign:'active',ad_group:'active'});
const SAFE_ID=/^[A-Za-z0-9_.:-]{1,128}$/;
const SAFE_CLASS=/^[a-z][a-z0-9_]{0,95}$/;
const NOTE_MAX=1000;
const FORBIDDEN_NOTE=/(?:https?:\/\/|bearer\s+|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|api[_ -]?key|password|credential|account[_ -]?id|provider[_ -]?id|customer[_ -]?id)/i;
const RAW_CUSTOMER_ID=/(?:^|\D)\d(?:[\s().‐‑‒–—-]*\d){9}(?!\d)/;
const ALLOWED=Object.freeze({open:['acknowledged','escalated'],acknowledged:['escalated','closed'],escalated:['closed'],closed:[]});
const OUTCOMES=new Set(['observed','missing']);
const STATUS=new Set(['paused','active','unsafe','inactive','unknown']);
const RELATION=new Set([true,false,'unknown','not_applicable']);

const hash=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
function deny(code){const e=new Error(code);e.code=code;e.blocked=true;e.external_action_taken=false;return e;}
function id(value){const out=String(value||'');if(!SAFE_ID.test(out))throw deny('validation_failed');return out;}
function authorize(o={}){const actor=Number(o.actorUserId),tenant=Number(o.tenantId);
  if(!Number.isSafeInteger(actor)||actor<1||o.actorType!=='human'||o.principalType!=='user'||!SAFE_ID.test(String(o.sessionId||'')))
    throw deny('human_session_required');
  if(!Number.isSafeInteger(tenant)||tenant<1)throw deny('validation_failed');
  if(typeof o.hasExplicitTenantPermission!=='function'||o.hasExplicitTenantPermission(PERMISSION)!==true)throw deny('permission_denied');
  return {actor,tenant};}
function note(value){if(typeof value!=='string')throw deny('invalid_note');const out=value.normalize('NFKC')
  .replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
  if(!out||out.length>NOTE_MAX||FORBIDDEN_NOTE.test(out)||RAW_CUSTOMER_ID.test(out))throw deny('invalid_note');return out;}
function disposition(value){if(!DISPOSITIONS.includes(value))throw deny('invalid_disposition');return value;}
function safeTime(value){const d=new Date(value);return Number.isFinite(d.getTime())?d.toISOString():null;}
function safeObservation(value={}){const out={object_kind:KINDS.includes(value.object_kind)?value.object_kind:'unknown',
  outcome:OUTCOMES.has(value.outcome)?value.outcome:'unknown',status_classification:STATUS.has(value.status_classification)?value.status_classification:'unknown',
  account_binding_matches:RELATION.has(value.account_binding_matches)?value.account_binding_matches:'unknown',
  campaign_parent_matches:RELATION.has(value.campaign_parent_matches)?value.campaign_parent_matches:'unknown',
  budget_parent_matches:RELATION.has(value.budget_parent_matches)?value.budget_parent_matches:'unknown',
  error_classification:null,observed_at:safeTime(value.observed_at)};
  return Object.freeze(out);}
function validateSource(row){if(!row||row.state!=='discrepancy_detected'||!row.completed_at||!['succeeded','unknown'].includes(row.activation_status))
  throw deny('reconciliation_not_reviewable');
  const observations=Array.isArray(row.observations)?row.observations:[],classes=Array.isArray(row.classifications)?row.classifications:[];
  const allowedKeys=new Set(['object_kind','outcome','status_classification','account_binding_matches','campaign_parent_matches',
    'budget_parent_matches','error_classification','observed_at']);
  if(observations.length!==3||new Set(observations.map(x=>x&&x.object_kind)).size!==3||KINDS.some(k=>!observations.some(x=>x&&x.object_kind===k))
    ||observations.some(x=>!x||Object.keys(x).some(k=>!allowedKeys.has(k))||!OUTCOMES.has(x.outcome))
    ||classes.length<1||classes.length>12||classes.some(x=>!SAFE_CLASS.test(x)))throw deny('reconciliation_evidence_invalid');
  return {observations:observations.map(safeObservation),classifications:[...classes]};}
function publicCase(row){const observations=(Array.isArray(row.observed_provider_state)?row.observed_provider_state:[]).map(safeObservation);
  const classes=(row.source_discrepancy_classifications||[]).filter(x=>SAFE_CLASS.test(x)).slice(0,12);
  return Object.freeze({review_case_id:row.id,reconciliation_run_reference:row.reconciliation_run_id,
    activation_attempt_reference:row.activation_attempt_id,campaign_workflow_reference:row.workflow_id,
    activation_result:row.activation_status,intended_provider_state:INTENDED_STATE,observed_provider_state:observations,
    discrepancy_classifications:classes,state:row.state,disposition:row.disposition||null,
    assigned_reviewer:row.assigned_reviewer_id||null,note:row.note||null,version:Number(row.version),
    created_at:row.created_at,acknowledged_at:row.acknowledged_at||null,escalated_at:row.escalated_at||null,
    closed_at:row.closed_at||null,audit_reference:row.audit_ref,external_action_taken:false});}
async function tx(pool,fn){const c=await pool.connect();try{await c.query('BEGIN');const out=await fn(c);await c.query('COMMIT');return out;}
  catch(e){try{await c.query('ROLLBACK');}catch(_){}throw e;}finally{c.release();}}
async function lockAuthority(c,tenant,actor){const q=await c.query(`SELECT t.id FROM tenants t
  JOIN tenant_users tu ON tu.tenant_id=t.id AND tu.user_id=$2 AND tu.status='active'
  JOIN roles r ON r.id=tu.role_id AND (r.tenant_id=t.id OR r.tenant_id IS NULL)
  WHERE t.id=$1 AND t.status='active' AND r.permissions ? $3 FOR SHARE OF t,tu,r`,[tenant,actor,PERMISSION]);
  if(q.rowCount!==1)throw deny('permission_denied');}
async function audit(c,row,event,eventRef,actor){await c.query(`INSERT INTO orchestrator_audit_events
  (tenant_id,workflow_id,event,actor_user_id,detail) VALUES($1,$2,$3,$4,$5::jsonb)`,[row.tenant_id,row.workflow_id,event,actor,
  JSON.stringify({post_activation_review_case_id:row.id,reconciliation_run_id:row.reconciliation_run_id,state:row.state,audit_reference:eventRef})]);}
async function source(c,tenant,runId){const q=await c.query(`SELECT * FROM ${SOURCE} WHERE tenant_id=$1 AND id=$2 FOR SHARE`,[tenant,runId]);
  if(q.rowCount!==1)throw deny('reconciliation_not_found');return {row:q.rows[0],...validateSource(q.rows[0])};}

async function createOrGet(o={}){const {actor,tenant}=authorize(o),runId=id(o.reconciliationRunId),pool=o.pool||db.getPool();
  return tx(pool,async c=>{await lockAuthority(c,tenant,actor);const src=await source(c,tenant,runId);
    let q=await c.query(`SELECT * FROM ${TABLE} WHERE tenant_id=$1 AND reconciliation_run_id=$2 FOR UPDATE`,[tenant,runId]);
    if(q.rowCount)return publicCase(q.rows[0]);
    const caseId=`gaparv_${crypto.randomUUID()}`,auditRef=`gaparv-audit:${hash(caseId).slice(0,20)}`;
    q=await c.query(`INSERT INTO ${TABLE}(tenant_id,id,reconciliation_run_id,activation_attempt_id,activation_status,
      workflow_id,intended_provider_state,observed_provider_state,source_discrepancy_classifications,source_requested_by,
      source_observing_at,source_completed_at,created_by,audit_ref)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,orchestrator_gaparv_safe_observations($8::jsonb),$9,$10,$11,$12,$13,$14)
      ON CONFLICT DO NOTHING RETURNING *`,[tenant,caseId,runId,src.row.activation_attempt_id,src.row.activation_status,
      src.row.workflow_id,JSON.stringify(INTENDED_STATE),JSON.stringify(src.row.observations),src.classifications,src.row.requested_by,
      src.row.observing_at,src.row.completed_at,actor,auditRef]);
    if(!q.rowCount){const durable=await c.query(`SELECT * FROM ${TABLE} WHERE tenant_id=$1 AND reconciliation_run_id=$2`,[tenant,runId]);
      if(durable.rowCount===1)return publicCase(durable.rows[0]);throw deny('concurrent_creation_conflict');}
    const row=q.rows[0];await c.query(`INSERT INTO ${EVENTS}
      (tenant_id,case_id,case_version,decision_id,from_state,to_state,actor_user_id,audit_ref)
      VALUES($1,$2,0,$3,NULL,'open',$4,$5)`,[tenant,caseId,`create:${caseId}`,actor,auditRef]);
    await audit(c,row,'google_ads_post_activation_review_opened',auditRef,actor);return publicCase(row);});}
async function getCase(o={}){const {actor,tenant}=authorize(o),caseId=id(o.caseId);return tx(o.pool||db.getPool(),async c=>{
  await lockAuthority(c,tenant,actor);const q=await c.query(`SELECT * FROM ${TABLE} WHERE tenant_id=$1 AND id=$2 FOR SHARE`,[tenant,caseId]);
  if(q.rowCount!==1)throw deny('review_case_not_found');return publicCase(q.rows[0]);});}
async function listCases(o={}){const {actor,tenant}=authorize(o),limit=Math.min(Math.max(Number(o.limit)||25,1),100);
  const state=o.state==null?null:String(o.state),cursor=o.cursor==null?null:id(o.cursor);if(state&&!STATES.includes(state))throw deny('validation_failed');
  return tx(o.pool||db.getPool(),async c=>{await lockAuthority(c,tenant,actor);const q=await c.query(`SELECT * FROM ${TABLE}
    WHERE tenant_id=$1 AND ($2::text IS NULL OR state=$2) AND ($3::text IS NULL OR id<$3) ORDER BY id DESC LIMIT $4`,
    [tenant,state,cursor,limit+1]);return {cases:q.rows.slice(0,limit).map(publicCase),next_cursor:q.rows.length>limit?q.rows[limit-1].id:null};});}
async function transition(toState,o={}){const {actor,tenant}=authorize(o),caseId=id(o.caseId),decisionId=id(o.decisionId),
  expected=Number(o.expectedVersion),why=disposition(o.disposition),safeNote=note(o.note);
  if(!Number.isSafeInteger(expected)||expected<0||!['acknowledged','escalated','closed'].includes(toState))throw deny('validation_failed');
  const payloadHash=hash(JSON.stringify({toState,expected,disposition:why,note:safeNote,actor}));
  return tx(o.pool||db.getPool(),async c=>{await lockAuthority(c,tenant,actor);let q=await c.query(`SELECT * FROM ${TABLE}
    WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[tenant,caseId]);if(q.rowCount!==1)throw deny('review_case_not_found');let row=q.rows[0];
    q=await c.query(`SELECT decision_payload_hash FROM ${EVENTS} WHERE tenant_id=$1 AND case_id=$2 AND decision_id=$3`,[tenant,caseId,decisionId]);
    if(q.rowCount){if(q.rows[0].decision_payload_hash===payloadHash)return publicCase(row);throw deny('idempotency_conflict');}
    if(Number(row.version)!==expected)throw deny('version_conflict');if(!ALLOWED[row.state].includes(toState))throw deny('invalid_review_transition');
    const now=o.now instanceof Date?o.now:new Date(),eventRef=`gaparv-event:${hash(`${caseId}:${decisionId}`).slice(0,20)}`;
    q=await c.query(`UPDATE ${TABLE} SET state=$3,disposition=$4,assigned_reviewer_id=$5,note=$6,note_digest=$7,
      version=version+1,acknowledged_at=CASE WHEN $3='acknowledged' THEN $8 ELSE acknowledged_at END,
      escalated_at=CASE WHEN $3='escalated' THEN $8 ELSE escalated_at END,
      closed_at=CASE WHEN $3='closed' THEN $8 ELSE closed_at END
      WHERE tenant_id=$1 AND id=$2 AND version=$9 RETURNING *`,[tenant,caseId,toState,why,actor,safeNote,hash(safeNote),now,expected]);
    if(q.rowCount!==1)throw deny('version_conflict');const updated=q.rows[0];
    await c.query(`INSERT INTO ${EVENTS}(tenant_id,case_id,case_version,decision_id,decision_payload_hash,from_state,to_state,
      disposition,actor_user_id,note,note_digest,audit_ref,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [tenant,caseId,updated.version,decisionId,payloadHash,row.state,toState,why,actor,safeNote,hash(safeNote),eventRef,now]);
    await audit(c,updated,`google_ads_post_activation_review_${toState}`,eventRef,actor);return publicCase(updated);});}

module.exports={TABLE,EVENTS,SOURCE,PERMISSION,STATES,DISPOSITIONS,KINDS,INTENDED_STATE,NOTE_MAX,createOrGet,getCase,listCases,
  acknowledge:o=>transition('acknowledged',o),escalate:o=>transition('escalated',o),close:o=>transition('closed',o),publicCase,
  _test:{authorize,note,disposition,safeObservation,validateSource,lockAuthority,source,transition,audit}};
