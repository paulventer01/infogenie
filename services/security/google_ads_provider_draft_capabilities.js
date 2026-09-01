'use strict';

// Authority-only boundary: no Google client, secret resolver, connector or provider payload.
const crypto = require('crypto');
const { sha256Hex } = require('../agent_orchestrator/hash');

const PERMISSION = 'advertising.provider_drafts.create';
const CONFIRMATION = 'AUTHORIZE GOOGLE ADS PAUSED DRAFT';
const MAX_CONFIRMATION_AGE_MS = 5 * 60 * 1000;
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_TTL_MS = 10 * 60 * 1000;
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
function hash(v) { return crypto.createHash('sha256').update(String(v)).digest('hex'); }
function same(a,b) { if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y); }
function int(v) { const n=Number(v);return Number.isSafeInteger(n)&&n>0?n:null; }
function valid(v) { return SAFE_ID.test(String(v||'')); }
function deny(code) { const e=new Error(code);e.code=code;e.blocked=true;e.external_action_taken=false;return e; }
function human(o) { const id=int(o.actorUserId);if(!id||o.actorType!=='human'||!valid(o.sessionId)
  ||['api_key','worker','service','service_account','automation','autonomous','agent'].includes(String(o.principalType||'').toLowerCase()))throw deny('human_session_required');
  if(typeof o.hasExplicitTenantPermission!=='function'||o.hasExplicitTenantPermission(PERMISSION)!==true)throw deny('permission_denied');return id; }
async function audit(c,t,a,w,event,id) { await c.query(`INSERT INTO orchestrator_audit_events
  (tenant_id,workflow_id,event,actor_user_id,detail) VALUES($1,$2,$3,$4,$5::jsonb)`,[t,w,event,a,JSON.stringify({capability_id:id})]); }

async function authoritative(c,tenantId,ids) {
  const r=await c.query(`SELECT t.status AS tenant_status,d.status AS draft_status,d.workflow_id,d.id AS draft_id,d.current_revision,d.contract_hash,
    pr.id AS publishing_request_id,pr.draft_id AS request_draft_id,pr.publish_approval_id,pr.workflow_approval_id,pr.revision AS request_revision,pr.requested_by AS request_actor_user_id,
    pr.contract_hash AS request_contract_hash,pr.snapshot_hash,pa.draft_id AS approval_draft_id,
    pa.revision AS approval_revision,pa.contract_hash AS approval_contract_hash,pa.snapshot_json,pa.actor_user_id AS approval_actor_user_id,
    pa.workflow_approval_id AS approval_workflow_approval_id,pa.revoked_at AS approval_revoked_at,pa.expires_at AS approval_expires_at,(pa.expires_at>clock_timestamp()) AS approval_active,
    di.id AS intent_id,di.draft_id AS intent_draft_id,di.publishing_request_id AS intent_request_id,di.intent_hash,di.revision AS intent_revision,di.contract_hash AS intent_contract_hash,
    di.snapshot_hash AS intent_snapshot_hash,di.publish_approval_id AS intent_approval_id,di.requested_by AS intent_actor_user_id,
    cr.id AS credential_ref_id,cr.version AS credential_ref_version,cr.account_fingerprint,
    cr.status AS credential_status,cr.revoked_at AS credential_revoked,cr.owner_user_id AS credential_owner_user_id,
    wa.workflow_id AS authority_workflow_id,wa.gate AS authority_gate,wa.decision AS authority_decision,
    r.permissions ? $8 AS explicit_permission,
    COALESCE(g.active,true) AS global_disabled,COALESCE(k.active,true) AS tenant_disabled
   FROM tenants t JOIN tenant_users tu ON tu.tenant_id=t.id AND tu.user_id=$2 AND tu.status='active'
   JOIN roles r ON r.id=tu.role_id AND (r.tenant_id=t.id OR r.tenant_id IS NULL)
   JOIN orchestrator_campaign_drafts d ON d.tenant_id=t.id AND d.id=$3
   JOIN orchestrator_campaign_publish_requests pr ON pr.tenant_id=t.id AND pr.id=$4
   JOIN orchestrator_campaign_publish_approvals pa ON pa.tenant_id=t.id AND pa.id=pr.publish_approval_id
   JOIN orchestrator_approvals wa ON wa.tenant_id=t.id AND wa.id=pr.workflow_approval_id
   JOIN orchestrator_campaign_delivery_intents di ON di.tenant_id=t.id AND di.id=$5
   JOIN orchestrator_tenant_google_ads_credential_refs cr ON cr.tenant_id=t.id AND cr.id=$6
    JOIN orchestrator_advertising_global_kill_switches g ON g.switch_key='google_ads_provider_draft'
    JOIN orchestrator_advertising_tenant_kill_switches k ON k.tenant_id=t.id AND k.switch_key='google_ads_provider_draft'
   WHERE t.id=$1 AND pr.publish_approval_id=$7 FOR UPDATE OF t,tu,r,d,pr,pa,wa,di,cr,g,k`,
  [tenantId,ids.actorUserId,ids.draftId,ids.publishingRequestId,ids.intentId,ids.credentialRefId,ids.publishApprovalId,PERMISSION]);
  if(r.rowCount!==1)throw deny('authority_not_found');const x=r.rows[0];
  if(x.tenant_status!=='active'||x.draft_status!=='approved_for_publish'||x.explicit_permission!==true||x.global_disabled||x.tenant_disabled
    ||x.credential_status!=='active'||x.credential_revoked||Number(x.credential_owner_user_id)!==Number(ids.actorUserId)
    ||Number(x.approval_actor_user_id)!==Number(ids.actorUserId)||Number(x.request_actor_user_id)!==Number(ids.actorUserId)
    ||Number(x.intent_actor_user_id)!==Number(ids.actorUserId)
    ||x.authority_decision!=='approved'||x.authority_gate!=='campaign_publishing'||!same(x.authority_workflow_id,x.workflow_id)
    ||x.approval_revoked_at||x.approval_active!==true
    ||!same(x.draft_id,x.approval_draft_id)||!same(x.draft_id,x.request_draft_id)||!same(x.draft_id,x.intent_draft_id)||!same(x.draft_id,ids.draftId)
    ||Number(x.current_revision)!==Number(x.request_revision)||Number(x.current_revision)!==Number(x.approval_revision)
    ||Number(x.current_revision)!==Number(x.intent_revision)||Number(x.current_revision)!==Number(ids.draftRevision)
    ||!same(x.contract_hash,x.request_contract_hash)||!same(x.contract_hash,x.approval_contract_hash)||!same(x.contract_hash,x.intent_contract_hash)
    ||!same(x.snapshot_hash,sha256Hex(x.snapshot_json))||!same(x.snapshot_hash,x.intent_snapshot_hash)
    ||Number(x.workflow_approval_id)!==Number(x.approval_workflow_approval_id)
    ||!same(x.publish_approval_id,x.intent_approval_id)||!same(x.intent_id,ids.intentId)||!same(x.publishing_request_id,x.intent_request_id)
    ||Number(x.credential_ref_version)!==Number(ids.credentialRefVersion))throw deny('authoritative_binding_mismatch');return x;
}
function capIds(cap,actorUserId) { return {actorUserId,draftId:cap.draft_id,draftRevision:cap.draft_revision,
  publishingRequestId:cap.publishing_request_id,publishApprovalId:cap.publish_approval_id,intentId:cap.intent_id,
  credentialRefId:cap.credential_ref_id,credentialRefVersion:cap.credential_ref_version}; }
async function confirm(c,o={}) { const tenantId=int(o.tenantId),actorId=human(o);
  if(!tenantId||![o.draftId,o.publishingRequestId,o.publishApprovalId,o.intentId,o.credentialRefId].every(valid)
    ||o.finalConfirmation!==CONFIRMATION)throw deny('fresh_confirmation_required');
  const row=await authoritative(c,tenantId,{...o,actorUserId:actorId});
  const created=new Date((await c.query('SELECT clock_timestamp() AS now')).rows[0]?.now),id=`gacf_${crypto.randomUUID()}`;
  await c.query(`INSERT INTO orchestrator_google_ads_provider_draft_confirmations
    (tenant_id,id,actor_user_id,session_id_hash,draft_id,draft_revision,publishing_request_id,publish_approval_id,intent_id,
     credential_ref_id,credential_ref_version,phrase_hash,created_at,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::timestamptz,$13::timestamptz+INTERVAL '2 minutes')`,
  [tenantId,id,actorId,hash(o.sessionId),row.draft_id,row.current_revision,row.publishing_request_id,row.publish_approval_id,
    row.intent_id,row.credential_ref_id,row.credential_ref_version,hash(CONFIRMATION),created]);
  return Object.freeze({confirmation_id:id,expires_at:new Date(created.getTime()+120000).toISOString(),external_action_taken:false}); }
async function issue(c,o={}) { const tenantId=int(o.tenantId),actorId=human(o),ttl=int(o.ttlMs||DEFAULT_TTL_MS);
  if(!tenantId||![o.draftId,o.publishingRequestId,o.publishApprovalId,o.intentId,o.credentialRefId,o.finalConfirmationId].every(valid)
    ||!ttl||ttl>MAX_TTL_MS)throw deny('fresh_confirmation_required');
  const row=await authoritative(c,tenantId,{...o,actorUserId:actorId});
  const confirmation=(await c.query(`SELECT * FROM orchestrator_google_ads_provider_draft_confirmations
    WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[tenantId,o.finalConfirmationId])).rows[0];
  const clock=(await c.query('SELECT clock_timestamp() AS now')).rows[0]?.now,freshNow=new Date(clock);
  if(!Number.isFinite(freshNow.getTime()))throw deny('fresh_confirmation_required');
  if(!confirmation||confirmation.consumed_at||!(new Date(confirmation.expires_at)>freshNow)
    ||!(new Date(row.approval_expires_at)>freshNow)
    ||Number(confirmation.actor_user_id)!==actorId||!same(confirmation.session_id_hash,hash(o.sessionId))
    ||!same(confirmation.draft_id,row.draft_id)||Number(confirmation.draft_revision)!==Number(row.current_revision)
    ||!same(confirmation.publishing_request_id,row.publishing_request_id)||!same(confirmation.publish_approval_id,row.publish_approval_id)
    ||!same(confirmation.intent_id,row.intent_id)||!same(confirmation.credential_ref_id,row.credential_ref_id)
    ||Number(confirmation.credential_ref_version)!==Number(row.credential_ref_version)||!same(confirmation.phrase_hash,hash(CONFIRMATION)))throw deny('fresh_confirmation_required');
  await c.query(`UPDATE orchestrator_google_ads_provider_draft_capabilities SET status='expired'
    WHERE tenant_id=$1 AND draft_id=$2 AND publishing_request_id=$3 AND publish_approval_id=$4 AND intent_id=$5
      AND status IN ('issued','reserved') AND expires_at<=clock_timestamp()`,
  [tenantId,row.draft_id,row.publishing_request_id,row.publish_approval_id,row.intent_id]);
  const id=`gac_${crypto.randomUUID()}`,expires=new Date(freshNow.getTime()+ttl);
  const confirmationHash=hash(`${tenantId}|${o.finalConfirmationId}`);
  try { await c.query(`INSERT INTO orchestrator_google_ads_provider_draft_capabilities
   (tenant_id,id,actor_user_id,session_id_hash,workflow_id,draft_id,draft_revision,contract_hash,publishing_request_id,publish_approval_id,
    workflow_approval_id,snapshot_hash,intent_id,intent_hash,credential_ref_id,credential_ref_version,account_fingerprint,final_confirmation_id,
    final_confirmation_hash,confirmed_at,issued_at,expires_at,audit_ref) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
  [tenantId,id,actorId,hash(o.sessionId),row.workflow_id,row.draft_id,row.current_revision,row.contract_hash,row.publishing_request_id,
    row.publish_approval_id,row.workflow_approval_id,row.snapshot_hash,row.intent_id,row.intent_hash,row.credential_ref_id,row.credential_ref_version,
    row.account_fingerprint,o.finalConfirmationId,confirmationHash,confirmation.created_at,freshNow,expires,`gac-audit-${crypto.randomUUID()}`]);
    await c.query(`UPDATE orchestrator_google_ads_provider_draft_confirmations SET consumed_at=$3,capability_id=$4
      WHERE tenant_id=$1 AND id=$2 AND consumed_at IS NULL`,[tenantId,o.finalConfirmationId,freshNow,id]); }
  catch(e) { if(e?.code==='23505')throw deny('capability_conflict');throw e; }
  await audit(c,tenantId,actorId,row.workflow_id,'google_ads_provider_draft_capability_issued',id);return project({id,status:'issued',issued_at:freshNow,expires_at:expires}); }
async function lock(c,o,allowed,revalidate=true) { const tenantId=int(o.tenantId),actorId=human(o);if(!tenantId||!valid(o.capabilityId))throw deny('capability_rejected');
  const peek=await c.query('SELECT * FROM orchestrator_google_ads_provider_draft_capabilities WHERE tenant_id=$1 AND id=$2',[tenantId,o.capabilityId]);
  if(peek.rowCount!==1)throw deny('capability_rejected');
  const row=revalidate?await authoritative(c,tenantId,capIds(peek.rows[0],actorId)):null;
  if(!revalidate){const grant=await c.query(`SELECT 1 FROM tenants t JOIN tenant_users tu ON tu.tenant_id=t.id AND tu.user_id=$2 AND tu.status='active'
    JOIN roles r ON r.id=tu.role_id AND (r.tenant_id=t.id OR r.tenant_id IS NULL)
    WHERE t.id=$1 AND t.status='active' AND r.permissions ? $3 FOR UPDATE OF t,tu,r`,[tenantId,actorId,PERMISSION]);if(grant.rowCount!==1)throw deny('permission_denied');}
  const q=await c.query('SELECT * FROM orchestrator_google_ads_provider_draft_capabilities WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenantId,o.capabilityId]);
  if(q.rowCount!==1)throw deny('capability_rejected');const cap=q.rows[0],now=o.now instanceof Date?o.now:new Date();
  if(!allowed.includes(cap.status)||Number(cap.actor_user_id)!==actorId||!same(cap.session_id_hash,hash(o.sessionId)))throw deny('capability_rejected');
  if(revalidate&&(!same(cap.draft_id,peek.rows[0].draft_id)||!same(cap.publishing_request_id,peek.rows[0].publishing_request_id)
    ||!same(cap.publish_approval_id,peek.rows[0].publish_approval_id)||!same(cap.intent_id,peek.rows[0].intent_id)))throw deny('capability_rejected');
  if(!(new Date(cap.expires_at)>now)){await c.query("UPDATE orchestrator_google_ads_provider_draft_capabilities SET status='expired' WHERE tenant_id=$1 AND id=$2",[tenantId,cap.id]);await audit(c,tenantId,actorId,cap.workflow_id,'google_ads_provider_draft_capability_expired',cap.id);return Object.freeze({expired:true,capability_id:cap.id,error:'capability_expired',external_action_taken:false});}
  if(row&&(!same(row.contract_hash,cap.contract_hash)||!same(row.snapshot_hash,cap.snapshot_hash)||!same(row.intent_hash,cap.intent_hash)||!same(row.account_fingerprint,cap.account_fingerprint)))throw deny('authoritative_binding_mismatch');
  return {tenantId,actorId,cap,row,now}; }
async function transition(c,o,status,idField,idValue,timeField,event) { if(!valid(idValue))throw deny('capability_rejected');const x=await lock(c,o,status==='reserved'?['issued']:['reserved']);if(x.expired)return x;
  if(status==='consumed'&&!same(x.cap.reservation_id_hash,hash(o.reservationId)))throw deny('capability_rejected');
  const fresh=(await c.query('SELECT clock_timestamp() AS now')).rows[0]?.now,transitionNow=new Date(fresh);
  if(!Number.isFinite(transitionNow.getTime())||!(new Date(x.cap.expires_at)>transitionNow)||!(new Date(x.row.approval_expires_at)>transitionNow)){await c.query("UPDATE orchestrator_google_ads_provider_draft_capabilities SET status='expired' WHERE tenant_id=$1 AND id=$2",[x.tenantId,x.cap.id]);await audit(c,x.tenantId,x.actorId,x.cap.workflow_id,'google_ads_provider_draft_capability_expired',x.cap.id);return Object.freeze({expired:true,capability_id:x.cap.id,error:'capability_expired',external_action_taken:false});}
  await c.query(`UPDATE orchestrator_google_ads_provider_draft_capabilities SET status=$3,${idField}=$4,${timeField}=$5 WHERE tenant_id=$1 AND id=$2`,[x.tenantId,x.cap.id,status,hash(idValue),transitionNow]);await audit(c,x.tenantId,x.actorId,x.cap.workflow_id,event,x.cap.id);return project({...x.cap,status,[timeField]:transitionNow}); }
const reserve=(c,o={})=>transition(c,o,'reserved','reservation_id_hash',o.reservationId,'reserved_at','google_ads_provider_draft_capability_reserved');
const consume=(c,o={})=>transition(c,o,'consumed','invocation_id_hash',o.invocationId,'consumed_at','google_ads_provider_draft_capability_consumed');
async function revoke(c,o={}) { const x=await lock(c,o,['issued','reserved'],false);if(x.expired)return x;await c.query("UPDATE orchestrator_google_ads_provider_draft_capabilities SET status='revoked',revoked_at=$3,revoked_by=$4 WHERE tenant_id=$1 AND id=$2",[x.tenantId,x.cap.id,x.now,x.actorId]);await audit(c,x.tenantId,x.actorId,x.cap.workflow_id,'google_ads_provider_draft_capability_revoked',x.cap.id);return project({...x.cap,status:'revoked',revoked_at:x.now}); }
function project(x){const iso=k=>x[k]?new Date(x[k]).toISOString():null;return Object.freeze({capability_id:x.id,status:x.status,expires_at:iso('expires_at'),issued_at:iso('issued_at'),reserved_at:iso('reserved_at'),consumed_at:iso('consumed_at'),revoked_at:iso('revoked_at'),external_action_taken:false});}
async function get(c,o={}) { const tenantId=int(o.tenantId),actorId=human(o);if(!tenantId||!valid(o.capabilityId))throw deny('capability_rejected');
  const r=await c.query(`SELECT cap.*,
      CASE WHEN cap.status IN ('issued','reserved') AND cap.expires_at<=clock_timestamp() THEN 'expired' ELSE cap.status END AS status
    FROM orchestrator_google_ads_provider_draft_capabilities cap
    JOIN tenants t ON t.id=cap.tenant_id AND t.status='active'
    JOIN tenant_users tu ON tu.tenant_id=t.id AND tu.user_id=$3 AND tu.status='active'
    JOIN roles role ON role.id=tu.role_id AND (role.tenant_id=t.id OR role.tenant_id IS NULL)
    WHERE cap.tenant_id=$1 AND cap.id=$2 AND cap.actor_user_id=$3 AND cap.session_id_hash=$4
      AND role.permissions ? $5 FOR UPDATE OF cap,t,tu,role`,[tenantId,o.capabilityId,actorId,hash(o.sessionId),PERMISSION]);
  if(r.rowCount!==1)throw deny('capability_rejected');return project(r.rows[0]); }
module.exports={PERMISSION,CONFIRMATION,MAX_CONFIRMATION_AGE_MS,MAX_TTL_MS,confirm,issue,reserve,consume,revoke,get,_authoritative:authoritative,_deny:deny};
