'use strict';

// PR10C.3 is deliberately independent of the Meta review ledger. It reads only
// terminal Google Ads reconciliation metadata and has no external reachability.
const crypto = require('crypto');

const PERMISSION = 'advertising.reconciliation.review';
const STATES = Object.freeze(['open','acknowledged','escalated','closed']);
const CLASSIFICATIONS = Object.freeze([
  'provider_investigation_required','external_remediation_required','unexpected_activation','object_missing',
  'relationship_mismatch','account_mismatch','observation_failure','accepted_risk','false_positive','closed_unresolved',
]);
const KINDS = Object.freeze(['campaign_budget','campaign','ad_group']);
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const NOTE_MAX = 1000;
const FORBIDDEN_NOTE = /(?:https?:\/\/|bearer\s+|access[_ -]?token|client[_ -]?secret|api[_ -]?key|password|credential|account[_ -]?id|provider[_ -]?id|customer[_ -]?id)/i;

function hash(v) { return crypto.createHash('sha256').update(String(v)).digest('hex'); }
function fail(code) { const e=new Error(code);e.code=code;e.blocked=true;e.external_action_taken=false;return e; }
function authorize(opts) {
  if(!Number.isSafeInteger(opts.actorUserId)||opts.actorUserId<1||opts.actorType!=='human')throw fail('authentication_required');
  if(typeof opts.hasPermission!=='function'||opts.hasPermission(PERMISSION)!==true)throw fail('permission_denied');
  const tenantId=Number(opts.tenantId);if(!Number.isSafeInteger(tenantId)||tenantId<1)throw fail('validation_failed');return tenantId;
}
function id(value) { const out=String(value||'');if(!SAFE_ID.test(out))throw fail('validation_failed');return out; }
function note(value) { if(typeof value!=='string')throw fail('invalid_note');const out=value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();if(!out||out.length>NOTE_MAX||FORBIDDEN_NOTE.test(out))throw fail('invalid_note');return out; }
function classification(value) { if(!CLASSIFICATIONS.includes(value))throw fail('invalid_classification');return value; }
function publicCase(row) {
  const categories=(row.original_classifications||[]).filter((x)=>/^[a-z][a-z0-9_]{0,95}$/.test(x)).slice(0,12);
  return Object.freeze({case_id:row.id,reconciliation_run_id:row.reconciliation_run_id,object_kinds:KINDS,
    state:row.state,classification:row.classification||null,assigned_reviewer:row.assigned_reviewer_id||null,
    note:row.note||null,discrepancy_classifications:row.original_state==='discrepancy_detected'?categories:[],
    failure_classifications:row.original_state==='failed'?categories:[],created_at:row.created_at,
    acknowledged_at:row.acknowledged_at||null,escalated_at:row.escalated_at||null,closed_at:row.closed_at||null,
    audit_reference:row.audit_ref,version:row.version,external_action_taken:false});
}
async function tx(pool,fn) { const c=await pool.connect();try{await c.query('BEGIN');const out=await fn(c);await c.query('COMMIT');return out;}catch(e){try{await c.query('ROLLBACK');}catch(_){}throw e;}finally{c.release();} }
async function audit(c,row,event,actorUserId,eventRef) { await c.query(`INSERT INTO orchestrator_audit_events
  (tenant_id,workflow_id,event,actor_user_id,detail) VALUES($1,$2,$3,$4,$5::jsonb)`,[row.tenant_id,row.workflow_id,event,actorUserId,JSON.stringify({google_ads_review_case_id:row.id,audit_reference:eventRef})]); }

async function createOrGet(pool,opts={}) {
  const tenantId=authorize(opts),runId=id(opts.reconciliationRunId);
  return tx(pool,async(c)=>{
    const existing=await c.query(`SELECT * FROM orchestrator_google_ads_reconciliation_review_cases WHERE tenant_id=$1 AND reconciliation_run_id=$2 FOR UPDATE`,[tenantId,runId]);
    if(existing.rowCount)return publicCase(existing.rows[0]);
    const run=(await c.query(`SELECT * FROM orchestrator_google_ads_reconciliation_runs WHERE tenant_id=$1 AND id=$2 FOR SHARE`,[tenantId,runId])).rows[0];
    if(!run)throw fail('reconciliation_not_found');if(!['discrepancy_detected','failed'].includes(run.state))throw fail('reconciliation_not_reviewable');
    const caseId=`garc_${crypto.randomUUID()}`,auditRef=`garc-audit:${hash(caseId).slice(0,20)}`;
    const inserted=await c.query(`INSERT INTO orchestrator_google_ads_reconciliation_review_cases
      (tenant_id,id,reconciliation_run_id,authorization_id,workflow_id,draft_id,publishing_request_id,operation_id,snapshot_hash,
       intent_id,intent_hash,credential_ref_id,credential_ref_version,ledger_root_hash,original_object_kinds,original_state,
       original_classifications,original_requested_by,original_created_at,original_completed_at,created_by,audit_ref)
      SELECT r.tenant_id,$2,r.id,r.authorization_id,r.workflow_id,r.draft_id,r.publishing_request_id,r.operation_id,
        r.snapshot_hash,r.intent_id,r.intent_hash,r.credential_ref_id,r.credential_ref_version,r.ledger_root_hash,
        ARRAY['campaign_budget','campaign','ad_group']::TEXT[],r.state,r.classifications,r.requested_by,r.created_at,
        r.completed_at,$3,$4 FROM orchestrator_google_ads_reconciliation_runs r WHERE r.tenant_id=$1 AND r.id=$5
      ON CONFLICT (tenant_id,reconciliation_run_id) DO NOTHING RETURNING *`,
    [tenantId,caseId,opts.actorUserId,auditRef,run.id]);
    if(!inserted.rowCount){const durable=await c.query(`SELECT * FROM orchestrator_google_ads_reconciliation_review_cases WHERE tenant_id=$1 AND reconciliation_run_id=$2`,[tenantId,runId]);if(durable.rowCount)return publicCase(durable.rows[0]);throw fail('concurrent_creation_conflict');}
    await c.query(`INSERT INTO orchestrator_google_ads_reconciliation_review_events (tenant_id,case_id,decision_id,from_state,to_state,actor_user_id,audit_ref) VALUES($1,$2,$3,NULL,'open',$4,$5)`,[tenantId,caseId,`create:${caseId}`,opts.actorUserId,auditRef]);
    await audit(c,inserted.rows[0],'google_ads_reconciliation_review_opened',opts.actorUserId,auditRef);return publicCase(inserted.rows[0]);
  });
}
async function getCase(pool,opts={}) { const tenantId=authorize(opts),caseId=id(opts.caseId);const r=await pool.query(`SELECT * FROM orchestrator_google_ads_reconciliation_review_cases WHERE tenant_id=$1 AND id=$2`,[tenantId,caseId]);if(r.rowCount!==1)throw fail('review_case_not_found');return publicCase(r.rows[0]); }
async function listCases(pool,opts={}) { const tenantId=authorize(opts),limit=Math.min(Math.max(Number(opts.limit)||25,1),100),state=opts.state==null?null:String(opts.state);if(state&&!STATES.includes(state))throw fail('validation_failed');const cursor=opts.cursor==null?null:id(opts.cursor);const r=await pool.query(`SELECT * FROM orchestrator_google_ads_reconciliation_review_cases WHERE tenant_id=$1 AND ($2::text IS NULL OR state=$2) AND ($3::text IS NULL OR id<$3) ORDER BY id DESC LIMIT $4`,[tenantId,state,cursor,limit+1]);return {cases:r.rows.slice(0,limit).map(publicCase),next_cursor:r.rows.length>limit?r.rows[limit-1].id:null}; }
const ALLOWED=Object.freeze({open:['acknowledged','escalated'],acknowledged:['escalated','closed'],escalated:['closed'],closed:[]});
async function transition(pool,toState,opts={}) {
  const tenantId=authorize(opts),caseId=id(opts.caseId),decisionId=id(opts.decisionId),safeNote=note(opts.note),safeClassification=classification(opts.classification);
  if(!['acknowledged','escalated','closed'].includes(toState)||!Number.isSafeInteger(opts.expectedVersion)||opts.expectedVersion<0)throw fail('validation_failed');
  return tx(pool,async(c)=>{const prior=await c.query(`SELECT * FROM orchestrator_google_ads_reconciliation_review_cases WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[tenantId,caseId]);if(prior.rowCount!==1)throw fail('review_case_not_found');const row=prior.rows[0];
    const replay=await c.query(`SELECT to_state FROM orchestrator_google_ads_reconciliation_review_events WHERE tenant_id=$1 AND case_id=$2 AND decision_id=$3`,[tenantId,caseId,decisionId]);if(replay.rowCount){if(replay.rows[0].to_state===toState)return publicCase(row);throw fail('idempotency_conflict');}
    if(row.version!==opts.expectedVersion)throw fail('version_conflict');if(!ALLOWED[row.state].includes(toState))throw fail('invalid_review_transition');
    const now=opts.now instanceof Date?opts.now:new Date(),eventRef=`garc-event:${hash(`${caseId}:${decisionId}`).slice(0,20)}`;
    const updated=await c.query(`UPDATE orchestrator_google_ads_reconciliation_review_cases SET state=$3,classification=$4,assigned_reviewer_id=$5,note=$6,note_digest=$7,version=version+1,acknowledged_at=CASE WHEN $3='acknowledged' THEN $8 ELSE acknowledged_at END,escalated_at=CASE WHEN $3='escalated' THEN $8 ELSE escalated_at END,closed_at=CASE WHEN $3='closed' THEN $8 ELSE closed_at END WHERE tenant_id=$1 AND id=$2 AND version=$9 RETURNING *`,[tenantId,caseId,toState,safeClassification,opts.actorUserId,safeNote,hash(safeNote),now,opts.expectedVersion]);if(updated.rowCount!==1)throw fail('version_conflict');
    await c.query(`INSERT INTO orchestrator_google_ads_reconciliation_review_events (tenant_id,case_id,decision_id,from_state,to_state,classification,actor_user_id,note,note_digest,audit_ref,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[tenantId,caseId,decisionId,row.state,toState,safeClassification,opts.actorUserId,safeNote,hash(safeNote),eventRef,now]);
    await audit(c,updated.rows[0],`google_ads_reconciliation_review_${toState}`,opts.actorUserId,eventRef);return publicCase(updated.rows[0]);});
}
module.exports={PERMISSION,STATES,CLASSIFICATIONS,KINDS,NOTE_MAX,publicCase,createOrGet,getCase,listCases,acknowledge:(p,o)=>transition(p,'acknowledged',o),escalate:(p,o)=>transition(p,'escalated',o),close:(p,o)=>transition(p,'closed',o),_test:{authorize,note,classification,transition,audit}};
