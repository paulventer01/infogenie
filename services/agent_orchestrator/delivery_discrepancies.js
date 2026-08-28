'use strict';

const crypto=require('crypto');
const db=require('../../db');
const lineage=require('./delivery_discrepancy_lineage');
const PERMISSION='advertising.campaign.delivery.resolve';
const SAFE_ID=/^[A-Za-z0-9_.:-]{1,128}$/;
const STATES=new Set(['open','acknowledged','escalated','resolved']);
const ELIGIBLE=new Set(['delivery_pending','discrepancy_detected','failed']);
const CLASSIFICATIONS=new Set(['delivery_confirmed_externally','provider_delay_accepted','provider_configuration_required',
  'credential_remediation_required','campaign_remediation_required','monitoring_failure_accepted','false_positive','other_documented_resolution']);
const TARGET={acknowledge:'acknowledged',escalate:'escalated',resolve:'resolved'};
const ALLOWED=new Set(['open>acknowledged','open>escalated','acknowledged>escalated','acknowledged>resolved','escalated>resolved']);
function deny(code){const e=new Error(code);e.code=code;return e;}
function authorize(o){if(!Number.isSafeInteger(o.actorUserId)||o.actorUserId<1||o.actorType!=='human'||o.principalType!=='user'
  ||!SAFE_ID.test(String(o.sessionId||'')))throw deny('human_session_required');
  if(typeof o.hasExplicitTenantPermission!=='function'||o.hasExplicitTenantPermission(PERMISSION)!==true)throw deny('permission_denied');}
const hash=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
function note(value){if(value==null||value==='')return null;if(typeof value!=='string'||value.length>2000||/[\u0000-\u001f\u007f]/.test(value))throw deny('unsafe_note');
  const out=value.replace(/\s+/g,' ').trim();if(!out||out.length>1000)throw deny('unsafe_note');
  if(/(?:authorization\s*:|cookie\s*:|access[_ -]?token|api[_ -]?key|client[_ -]?secret|credential|private\s+key|secret\s*[=:]|-----BEGIN|\{\s*"(?:data|id|access_token)"\s*:)/i.test(out))throw deny('unsafe_note');
  return out;}
function publicEvent(row){return {case_version:Number(row.case_version),previous_state:row.previous_state||null,new_state:row.new_state,
  classification:row.classification||null,note:row.note||null,audit_reference:row.audit_ref,event_timestamp:row.created_at};}
function publicCase(row,events=[]){return {discrepancy_case_id:row.id,source_monitoring_run_reference:row.monitoring_run_id,
  source_monitoring_state:row.source_state,
  discrepancy_classifications:row.source_state==='discrepancy_detected'?(row.source_classifications||[]):[],
  failure_classifications:row.source_state==='failed'?(row.source_failure_classifications||row.source_classifications||[]):[],
  case_state:row.state,case_version:Number(row.version),
  operational_classification:row.classification||null,note:row.note||null,event_history:events.map(publicEvent),audit_reference:row.audit_ref,
  created_at:row.created_at,last_updated_at:row.updated_at,resolved_at:row.resolved_at||null};}
async function withEvents(client,row){const e=await client.query(`SELECT case_version,previous_state,new_state,classification,note,audit_ref,created_at
  FROM orchestrator_campaign_delivery_discrepancy_events WHERE tenant_id=$1 AND case_id=$2 ORDER BY case_version,id`,[row.tenant_id,row.id]);return publicCase(row,e.rows);}
async function audit(client,row,event,previousState,newState,actorUserId,auditRef=row.audit_ref){await client.query(`INSERT INTO orchestrator_audit_events
  (tenant_id,workflow_id,event,actor_user_id,detail) VALUES($1,$2,$3,$4,$5::jsonb)`,[row.tenant_id,row.workflow_id,event,actorUserId,
    JSON.stringify({discrepancy_case_id:row.id,action:event,previous_state:previousState||null,new_state:newState||row.state,audit_reference:auditRef})]);}
function consistent(x){return x.attempt_state==='activated'&&x.capability_state==='consumed'&&x.reconciliation_state==='verified'
  &&x.approval_revoked_at==null&&new Date(x.approval_expires_at)>new Date()&&x.request_workflow_approval_id===x.approval_workflow_approval_id&&x.monitoring_run_id===x.id
  &&x.activation_attempt_id===x.attempt_id&&x.capability_id===x.attempt_capability_id
  &&x.publishing_request_id===x.attempt_publishing_request_id&&x.snapshot_hash===x.attempt_snapshot_hash
  &&x.intent_id===x.attempt_intent_id&&x.execution_id===x.attempt_execution_id&&x.reconciliation_run_id===x.attempt_reconciliation_run_id
  &&x.credential_ref_id===x.attempt_credential_ref_id&&Number(x.credential_ref_version)===Number(x.attempt_credential_ref_version)
  &&x.account_fingerprint===x.attempt_account_fingerprint&&x.ledger_root_hash===x.attempt_ledger_root_hash
  &&x.attempt_publishing_request_id===x.capability_publishing_request_id&&x.attempt_snapshot_hash===x.capability_snapshot_hash
  &&x.attempt_intent_id===x.capability_intent_id&&x.attempt_execution_id===x.capability_execution_id
  &&x.attempt_reconciliation_run_id===x.capability_reconciliation_run_id
  &&x.attempt_credential_ref_id===x.capability_credential_ref_id
  &&Number(x.attempt_credential_ref_version)===Number(x.capability_credential_ref_version)
  &&x.attempt_account_fingerprint===x.capability_account_fingerprint&&x.attempt_ledger_root_hash===x.capability_ledger_root_hash
  &&x.draft_id===x.execution_draft_id&&Number(x.draft_revision)===Number(x.execution_revision)
  &&x.publish_approval_id===x.execution_publish_approval_id&&x.intent_hash===x.execution_intent_hash
  &&x.snapshot_hash===x.execution_snapshot_hash&&x.account_fingerprint===x.execution_account_fingerprint
  &&x.credential_ref_id===x.execution_credential_ref_id&&Number(x.credential_ref_version)===Number(x.execution_credential_ref_version)
  &&x.workflow_id===x.reconciliation_workflow_id&&x.ledger_root_hash===x.reconciliation_ledger_root_hash
  &&Number(x.credential_ref_version)===Number(x.current_credential_version)&&x.account_fingerprint===x.current_account_fingerprint;}
async function source(client,tenantId,id){const q=await client.query(`SELECT m.*,m.id monitoring_run_id,a.id attempt_id,a.state attempt_state,
  a.capability_id attempt_capability_id,a.publishing_request_id attempt_publishing_request_id,a.snapshot_hash attempt_snapshot_hash,
  a.intent_id attempt_intent_id,a.execution_id attempt_execution_id,a.reconciliation_run_id attempt_reconciliation_run_id,
  a.credential_ref_id attempt_credential_ref_id,a.credential_ref_version attempt_credential_ref_version,
  a.account_fingerprint attempt_account_fingerprint,a.ledger_root_hash attempt_ledger_root_hash,
  c.status capability_state,c.draft_id,c.draft_revision,c.publish_approval_id,c.actor_user_id originating_actor_id,
  c.publishing_request_id capability_publishing_request_id,c.snapshot_hash capability_snapshot_hash,
  c.intent_id capability_intent_id,c.execution_id capability_execution_id,c.reconciliation_run_id capability_reconciliation_run_id,
  c.credential_ref_id capability_credential_ref_id,c.credential_ref_version capability_credential_ref_version,
  c.account_fingerprint capability_account_fingerprint,c.ledger_root_hash capability_ledger_root_hash,
  pr.workflow_approval_id request_workflow_approval_id,pa.workflow_approval_id approval_workflow_approval_id,
  pa.revoked_at approval_revoked_at,pa.expires_at approval_expires_at,di.intent_hash,
  ex.draft_id execution_draft_id,ex.revision execution_revision,ex.publish_approval_id execution_publish_approval_id,
  ex.intent_hash execution_intent_hash,ex.snapshot_hash execution_snapshot_hash,ex.account_fingerprint execution_account_fingerprint,
  ex.credential_ref_id execution_credential_ref_id,ex.credential_ref_version execution_credential_ref_version,
  rr.state reconciliation_state,rr.workflow_id reconciliation_workflow_id,rr.ledger_root_hash reconciliation_ledger_root_hash,
  ref.version current_credential_version,ref.account_fingerprint current_account_fingerprint
  FROM orchestrator_campaign_monitoring_runs m
  JOIN orchestrator_campaign_activation_attempts a ON a.tenant_id=m.tenant_id AND a.id=m.activation_attempt_id
  JOIN orchestrator_campaign_activation_capabilities c ON c.tenant_id=a.tenant_id AND c.id=a.capability_id
  JOIN orchestrator_campaign_publish_requests pr ON pr.tenant_id=c.tenant_id AND pr.id=c.publishing_request_id
  JOIN orchestrator_campaign_publish_approvals pa ON pa.tenant_id=pr.tenant_id AND pa.id=pr.publish_approval_id
  JOIN orchestrator_campaign_delivery_intents di ON di.tenant_id=c.tenant_id AND di.id=c.intent_id
  JOIN orchestrator_campaign_provider_draft_executions ex ON ex.tenant_id=c.tenant_id AND ex.id=c.execution_id
  JOIN orchestrator_campaign_reconciliation_runs rr ON rr.tenant_id=c.tenant_id AND rr.id=c.reconciliation_run_id
  JOIN orchestrator_tenant_meta_credential_refs ref ON ref.tenant_id=c.tenant_id AND ref.id=c.credential_ref_id
  WHERE m.tenant_id=$1 AND m.id=$2 FOR UPDATE OF m,a,c,pr,pa,di,ex,rr,ref`,[tenantId,id]);
  if(q.rowCount!==1)throw deny('monitoring_run_not_found');const row=q.rows[0];
  if(!ELIGIBLE.has(row.state)||!row.completed_at)throw deny('source_ineligible');if(!consistent(row))throw deny('authoritative_binding_mismatch');
  const objects=await client.query(`SELECT object_kind,provider_object_id_digest,
    parent_campaign_digest,parent_adset_digest,parent_creative_digest,account_fingerprint,snapshot_hash,compensated
    FROM orchestrator_campaign_provider_objects WHERE tenant_id=$1 AND execution_id=$2 FOR UPDATE`,[tenantId,row.execution_id]);
  try { const root=lineage.validate(objects.rows,{account_fingerprint:row.account_fingerprint,snapshot_hash:row.snapshot_hash});
    if(root!==row.ledger_root_hash)throw deny('authoritative_binding_mismatch');
  } catch (_) { throw deny('authoritative_binding_mismatch'); } return row;}
async function createOrGet(o={}){authorize(o);const tenantId=Number(o.tenantId),runId=String(o.monitoringRunId||'');if(!Number.isSafeInteger(tenantId)||tenantId<1||!SAFE_ID.test(runId))throw deny('validation_failed');
  const client=await (o.pool||db.getPool()).connect();try{await client.query('BEGIN');const s=await source(client,tenantId,runId);
    let found=await client.query(`SELECT * FROM orchestrator_campaign_delivery_discrepancy_cases WHERE tenant_id=$1 AND monitoring_run_id=$2`,[tenantId,runId]);
    if(found.rowCount){const out=await withEvents(client,found.rows[0]);await client.query('COMMIT');return out;}
    const id=`ddc_${crypto.randomUUID()}`,auditRef=`ddc-audit:${hash(id).slice(0,20)}`;
    found=await client.query(`INSERT INTO orchestrator_campaign_delivery_discrepancy_cases
      (tenant_id,id,monitoring_run_id,source_state,source_classifications,source_failure_classifications,source_audit_ref,activation_attempt_id,capability_id,
       publishing_request_id,publish_approval_id,workflow_approval_id,workflow_id,draft_id,draft_revision,snapshot_hash,intent_id,intent_hash,
       execution_id,reconciliation_run_id,credential_ref_id,credential_ref_version,account_fingerprint,ledger_root_hash,source_actor_user_id,
       source_started_at,source_completed_at,creation_actor_user_id,audit_ref)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29) RETURNING *`,
      [tenantId,id,s.id,s.state,s.classifications,s.failure_classifications||[],s.audit_ref,s.activation_attempt_id,s.capability_id,s.publishing_request_id,s.publish_approval_id,
       s.request_workflow_approval_id,s.workflow_id,s.draft_id,s.draft_revision,s.snapshot_hash,s.intent_id,s.intent_hash,s.execution_id,
       s.reconciliation_run_id,s.credential_ref_id,s.credential_ref_version,s.account_fingerprint,s.ledger_root_hash,s.actor_user_id,
       s.started_at,s.completed_at,o.actorUserId,auditRef]);const row=found.rows[0];
    await client.query(`INSERT INTO orchestrator_campaign_delivery_discrepancy_events
      (tenant_id,case_id,case_version,previous_state,new_state,actor_user_id,audit_ref) VALUES($1,$2,1,NULL,'open',$3,$4)`,
      [tenantId,id,o.actorUserId,auditRef]);await audit(client,row,'delivery_discrepancy_created',null,'open',o.actorUserId);
    const out=await withEvents(client,row);await client.query('COMMIT');return out;
  }catch(e){try{await client.query('ROLLBACK');}catch(_){}throw e;}finally{client.release();}}
async function get(o={}){authorize(o);const id=String(o.caseId||'');if(!SAFE_ID.test(id))throw deny('validation_failed');const pool=o.pool||db.getPool();
  const r=await pool.query(`SELECT * FROM orchestrator_campaign_delivery_discrepancy_cases WHERE tenant_id=$1 AND id=$2`,[o.tenantId,id]);if(r.rowCount!==1)throw deny('case_not_found');return withEvents(pool,r.rows[0]);}
async function list(o={}){authorize(o);const limit=o.limit==null?25:Number(o.limit),offset=o.cursor==null?0:Number(o.cursor),state=o.state==null?null:String(o.state);
  if(!Number.isSafeInteger(limit)||limit<1||limit>50||!Number.isSafeInteger(offset)||offset<0||(state&&!STATES.has(state)))throw deny('validation_failed');
  const pool=o.pool||db.getPool(),r=await pool.query(`SELECT * FROM orchestrator_campaign_delivery_discrepancy_cases WHERE tenant_id=$1
    AND ($2::text IS NULL OR state=$2) ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4`,[o.tenantId,state,limit,offset]);
  const items=[];for(const row of r.rows)items.push(await withEvents(pool,row));return {items,next_cursor:r.rowCount===limit?String(offset+limit):null};}
async function transition(o={}){authorize(o);const id=String(o.caseId||''),decision=String(o.decisionId||''),expected=Number(o.expectedVersion),classification=o.classification==null?null:String(o.classification);
  if(!SAFE_ID.test(id)||!SAFE_ID.test(decision)||!Number.isSafeInteger(expected)||expected<1||!TARGET[o.action])throw deny('validation_failed');
  if(o.action==='acknowledge'&&classification!==null)throw deny('invalid_classification');if(o.action!=='acknowledge'&&!CLASSIFICATIONS.has(classification))throw deny('invalid_classification');
  const clean=note(o.note);if(classification==='other_documented_resolution'&&!clean)throw deny('note_required');
  const inputHash=hash(JSON.stringify([id,o.action,expected,classification,clean]));const client=await (o.pool||db.getPool()).connect();try{await client.query('BEGIN');
    let q=await client.query(`SELECT * FROM orchestrator_campaign_delivery_discrepancy_cases WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[o.tenantId,id]);if(q.rowCount!==1)throw deny('case_not_found');let row=q.rows[0];
    q=await client.query(`SELECT input_hash FROM orchestrator_campaign_delivery_discrepancy_events WHERE tenant_id=$1 AND decision_id=$2`,[o.tenantId,decision]);
    if(q.rowCount){if(q.rows[0].input_hash!==inputHash)throw deny('decision_id_conflict');const out=await withEvents(client,row);await client.query('COMMIT');return out;}
    if(Number(row.version)!==expected)throw deny('version_conflict');const target=TARGET[o.action];if(!ALLOWED.has(`${row.state}>${target}`))throw deny('invalid_transition');
    const previous=row.state,auditRef=`ddc-event:${hash(`${id}:${decision}`).slice(0,20)}`;
    q=await client.query(`UPDATE orchestrator_campaign_delivery_discrepancy_cases SET state=$3,version=version+1,classification=$4,note=$5,
      updated_at=now(),resolved_at=CASE WHEN $3='resolved' THEN now() ELSE NULL END
      WHERE tenant_id=$1 AND id=$2 AND version=$6 RETURNING *`,[o.tenantId,id,target,classification,clean,expected]);if(q.rowCount!==1)throw deny('version_conflict');row=q.rows[0];
    await client.query(`INSERT INTO orchestrator_campaign_delivery_discrepancy_events
      (tenant_id,case_id,case_version,previous_state,new_state,classification,note,actor_user_id,decision_id,input_hash,audit_ref)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[o.tenantId,id,row.version,previous,target,classification,clean,o.actorUserId,decision,inputHash,auditRef]);
    await audit(client,row,`delivery_discrepancy_${o.action}`,previous,target,o.actorUserId,auditRef);const out=await withEvents(client,row);await client.query('COMMIT');return out;
  }catch(e){try{await client.query('ROLLBACK');}catch(_){}throw e;}finally{client.release();}}

module.exports={PERMISSION,ELIGIBLE,CLASSIFICATIONS,createOrGet,get,list,transition,publicCase,sanitizeNote:note,
  _test:{authorize,source,consistent,publicEvent}};
