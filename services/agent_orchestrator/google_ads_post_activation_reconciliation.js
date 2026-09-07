'use strict';

// PR10D.3 — one human-triggered, read-only observation of a terminal PR10D.2
// attempt. Provider identifiers stay inside the locked ledger and the existing
// GAQL-only observer; public and audit projections are sanitized.
const crypto=require('crypto');
const db=require('../../db');
const vault=require('../credentials/vault');
const observer=require('./connectors/google_ads_paused_draft_reconciliation_observer');
const lineage=require('../security/google_ads_paused_draft_reconciliation');

const TABLE='orchestrator_google_ads_post_activation_reconciliation_runs';
const PERMISSION='advertising.campaign.monitor';
const KINDS=Object.freeze(['campaign_budget','campaign','ad_group']);
const TERMINAL=Object.freeze(['verified_active','verified_inactive','discrepancy_detected','failed']);
const LEASE_MS=180000;
const SAFE_ID=/^[A-Za-z0-9_.:-]{1,128}$/;
const OUTCOMES=new Set(['observed','missing','unauthorized','transient_failure','malformed','permanent_failure']);
const STATUS=new Set(['paused','active','unsafe','inactive','unknown']);
const ERRORS=new Set(['not_found','provider_unauthorized','rate_limited','provider_unavailable','response_too_large','redirect_rejected','invalid_provider_response','provider_rejected']);
const hash=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
const same=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y);};
function deny(code){const e=new Error(code);e.code=code;e.blocked=true;e.external_action_taken=false;return e;}
function human(o){const id=Number(o&&o.actorUserId);if(!Number.isSafeInteger(id)||id<1||o.actorType!=='human'
  ||o.principalType!=='user'||!SAFE_ID.test(String(o.sessionId||'')))throw deny('human_session_required');
  if(typeof o.hasExplicitTenantPermission!=='function'||o.hasExplicitTenantPermission(PERMISSION)!==true)throw deny('permission_denied');return id;}
function safeTime(v){if(typeof v!=='string'||v.length>40)return null;const d=new Date(v);return Number.isFinite(d.getTime())?d.toISOString():null;}
function safeObservation(v={}){return Object.freeze({
  object_kind:KINDS.includes(v.object_kind)?v.object_kind:'unknown',
  outcome:OUTCOMES.has(v.outcome)?v.outcome:'malformed',
  status_classification:STATUS.has(v.status_classification)?v.status_classification:'unknown',
  account_binding_matches:v.account_binding_matches===true||v.account_binding_matches===false?v.account_binding_matches:'unknown',
  campaign_parent_matches:v.campaign_parent_matches===true||v.campaign_parent_matches===false?v.campaign_parent_matches:'not_applicable',
  budget_parent_matches:v.budget_parent_matches===true||v.budget_parent_matches===false?v.budget_parent_matches:'not_applicable',
  error_classification:ERRORS.has(v.error_classification)?v.error_classification:undefined,
  observed_at:safeTime(v.observed_at),
});}
function publicRun(row,replay=false){return Object.freeze({
  reconciliation_run_id:row.id,activation_attempt_reference:row.activation_attempt_id,
  activation_result:row.activation_status,state:row.state,replay:!!replay,object_kinds:KINDS,
  observations:(Array.isArray(row.observations)?row.observations:[]).map(safeObservation),
  discrepancy_classifications:row.state==='discrepancy_detected'?(row.classifications||[]):[],
  failure_classifications:row.state==='failed'?(row.classifications||[]):[],
  observation_started_at:row.observing_at,observation_completed_at:row.completed_at||null,
  audit_reference:row.audit_ref,external_action_taken:false,
});}
function evaluate(result,activationStatus){const observations=Array.isArray(result&&result.observations)?result.observations.map(safeObservation):[];
  if(Number(result&&result.attempted_observations)!==3||Number(result&&result.completed_observations)!==3
    ||observations.length!==3||new Set(observations.map(x=>x.object_kind)).size!==3
    ||KINDS.some(k=>!observations.some(x=>x.object_kind===k)))return {state:'failed',classifications:['partial_observation'],observations};
  const failures=[],discrepancies=[];
  for(const o of observations){if(o.outcome==='missing')discrepancies.push(`${o.object_kind}_missing`);
    else if(o.outcome!=='observed')failures.push(`${o.object_kind}_${o.error_classification||o.outcome}`);
    if(o.outcome!=='observed')continue;
    if(o.account_binding_matches!==true)discrepancies.push(`${o.object_kind}_account_mismatch`);
    if(o.object_kind==='campaign'&&o.budget_parent_matches!==true)discrepancies.push('campaign_budget_mismatch');
    if(o.object_kind==='ad_group'&&o.campaign_parent_matches!==true)discrepancies.push('ad_group_campaign_mismatch');
    if(o.object_kind==='campaign_budget'&&!['paused','inactive'].includes(o.status_classification))discrepancies.push('campaign_budget_changed');
    if(['unsafe','unknown'].includes(o.status_classification))discrepancies.push(`${o.object_kind}_unsafe_status`);}
  if(failures.length)return {state:'failed',classifications:[...new Set(failures)].sort(),observations};
  const by=Object.fromEntries(observations.map(x=>[x.object_kind,x]));
  const active=['campaign','ad_group'].every(k=>by[k].outcome==='observed'&&by[k].status_classification==='active');
  const inactive=['campaign','ad_group'].every(k=>by[k].outcome==='observed'&&['paused','inactive'].includes(by[k].status_classification));
  if(!active&&!inactive)discrepancies.push('mixed_activation_state');
  if(inactive&&activationStatus==='succeeded')discrepancies.push('activation_success_not_observed');
  if(discrepancies.length)return {state:'discrepancy_detected',classifications:[...new Set(discrepancies)].sort(),observations};
  return {state:active?'verified_active':'verified_inactive',classifications:[],observations};}

async function audit(c,row,event){await c.query(`INSERT INTO orchestrator_audit_events
  (tenant_id,workflow_id,event,actor_user_id,detail) VALUES($1,$2,$3,$4,$5::jsonb)`,
 [row.tenant_id,row.workflow_id,event,row.requested_by,JSON.stringify({reconciliation_run_id:row.id,activation_attempt_id:row.activation_attempt_id,status:row.state})]);}
async function withTx(pool,fn){const c=await pool.connect();try{await c.query('BEGIN');const out=await fn(c);await c.query('COMMIT');return out;}
 catch(e){try{await c.query('ROLLBACK');}catch(_){}throw e;}finally{c.release();}}
function sameRequest(row,o,actor,invocationHash){if(row.activation_attempt_id!==o.activationAttemptId||row.invocation_id_hash!==invocationHash
  ||Number(row.requested_by)!==actor||!same(row.session_id_hash,hash(o.sessionId)))throw deny('idempotency_conflict');}
function objectDigest(rows){return hash(rows.map(x=>`${x.object_kind}:${x.provider_object_id}`).join('|'));}
function validateObjects(rows,proof){const root=lineage.validateLineage(rows,{account_fingerprint:proof.account_fingerprint});
  if(!same(root,proof.ledger_root_hash)||!same(objectDigest(rows),proof.objects_digest))throw deny('authoritative_binding_mismatch');return rows;}
async function proof(c,o,actor,lock='FOR SHARE'){const hint=await c.query(`SELECT capability_id,operation_id FROM orchestrator_google_ads_activation_attempts
  WHERE tenant_id=$1 AND id=$2 ${lock}`,[o.tenantId,o.activationAttemptId]);if(hint.rowCount!==1)throw deny('activation_attempt_not_found');
  await c.query(`SELECT id FROM orchestrator_google_ads_activation_capabilities WHERE tenant_id=$1 AND id=$2 ${lock}`,
   [o.tenantId,hint.rows[0].capability_id]);
  await c.query(`SELECT id FROM orchestrator_google_ads_provider_draft_operations WHERE tenant_id=$1 AND id=$2 ${lock}`,[o.tenantId,hint.rows[0].operation_id]);
  const q=await c.query(`SELECT a.*,cap.status capability_status,cap.operation_id capability_operation_id,
    cap.actor_user_id capability_actor_user_id,cap.session_id_hash capability_session_id_hash,
    cap.workflow_id capability_workflow_id,cap.credential_owner_user_id capability_credential_owner_user_id,
    cap.reconciliation_run_id capability_reconciliation_run_id,
    cap.credential_ref_id capability_credential_ref_id,cap.credential_ref_version capability_credential_ref_version,
    cap.account_fingerprint capability_account_fingerprint,cap.ledger_root_hash capability_ledger_root_hash,
    op.status operation_status,op.workflow_id operation_workflow_id,op.reconciliation_run_id operation_reconciliation_run_id,
    op.credential_ref_id operation_credential_ref_id,op.credential_ref_version operation_credential_ref_version,
    op.account_fingerprint operation_account_fingerprint,
    op.published operation_published,op.activated operation_activated,
    op.external_action_taken operation_acted,cred.status credential_status,cred.revoked_at,
    cred.version current_credential_version,cred.account_fingerprint current_account_fingerprint,
    cred.owner_user_id FROM orchestrator_google_ads_activation_attempts a
    JOIN orchestrator_google_ads_activation_capabilities cap ON cap.tenant_id=a.tenant_id AND cap.id=a.capability_id
    JOIN orchestrator_google_ads_provider_draft_operations op ON op.tenant_id=a.tenant_id AND op.id=a.operation_id
    JOIN orchestrator_tenant_google_ads_credential_refs cred ON cred.tenant_id=a.tenant_id AND cred.id=a.credential_ref_id
    JOIN tenants t ON t.id=a.tenant_id AND t.status='active'
    JOIN tenant_users tu ON tu.tenant_id=t.id AND tu.user_id=$3 AND tu.status='active'
    JOIN roles role ON role.id=tu.role_id AND (role.tenant_id=t.id OR role.tenant_id IS NULL)
    WHERE a.tenant_id=$1 AND a.id=$2 AND role.permissions ? $4 ${lock} OF cred,t,tu,role`,
   [o.tenantId,o.activationAttemptId,actor,PERMISSION]);
  if(q.rowCount!==1)throw deny('permission_denied');const row=q.rows[0];
  if(!['succeeded','unknown'].includes(row.status))throw deny('activation_attempt_ineligible');
  if(row.capability_status!=='consumed'||row.operation_status!=='succeeded'||row.operation_acted!==true
    ||row.operation_published!==false||row.operation_activated!==false
    ||Number(row.capability_actor_user_id)!==Number(row.actor_user_id)
    ||!same(row.capability_session_id_hash,row.session_id_hash)||row.capability_workflow_id!==row.workflow_id
    ||Number(row.capability_credential_owner_user_id)!==Number(row.credential_owner_user_id)
    ||row.capability_operation_id!==row.operation_id||row.capability_reconciliation_run_id!==row.reconciliation_run_id
    ||row.capability_credential_ref_id!==row.credential_ref_id
    ||Number(row.capability_credential_ref_version)!==Number(row.credential_ref_version)
    ||!same(row.capability_account_fingerprint,row.account_fingerprint)||!same(row.capability_ledger_root_hash,row.ledger_root_hash)
    ||row.operation_workflow_id!==row.workflow_id||row.operation_reconciliation_run_id!==row.reconciliation_run_id
    ||row.operation_credential_ref_id!==row.credential_ref_id
    ||Number(row.operation_credential_ref_version)!==Number(row.credential_ref_version)
    ||!same(row.operation_account_fingerprint,row.account_fingerprint)
    ||Number(row.owner_user_id)!==Number(row.credential_owner_user_id)
    ||Number(row.objects_expected)!==2||Number(row.objects_activated)!==(row.status==='succeeded'?2:0)
    ||row.requires_reconciliation!==(row.status==='unknown')
    ||row.external_action_taken!==(row.status==='succeeded'?true:null)
    ||row.credential_status!=='active'||row.revoked_at||Number(row.current_credential_version)!==Number(row.credential_ref_version)
    ||!same(row.current_account_fingerprint,row.account_fingerprint))throw deny('authoritative_binding_mismatch');
  const objects=(await c.query(`SELECT object_kind,sequence_number,provider_object_id,provider_object_id_digest,
    account_fingerprint,provider_status,serving,published,activated FROM orchestrator_google_ads_provider_draft_objects
    WHERE tenant_id=$1 AND operation_id=$2 ORDER BY sequence_number ${lock}`,[o.tenantId,row.operation_id])).rows;
  return {row,objects:validateObjects(objects,row)};}
async function existing(pool,o,actor,invocationHash){return withTx(pool,async c=>{const hint=await c.query(`SELECT id FROM ${TABLE}
  WHERE tenant_id=$1 AND (activation_attempt_id=$2 OR invocation_id_hash=$3)`,[o.tenantId,o.activationAttemptId,invocationHash]);
  if(!hint.rowCount)return null;if(hint.rowCount!==1)throw deny('idempotency_conflict');await proof(c,o,actor);
  const found=await c.query(`SELECT * FROM ${TABLE} WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[o.tenantId,hint.rows[0].id]);
  if(found.rowCount!==1)throw deny('idempotency_conflict');let row=found.rows[0];sameRequest(row,o,actor,invocationHash);
  if(row.state==='observing'){const now=new Date((await c.query('SELECT clock_timestamp() now')).rows[0].now);
    if(new Date(row.observation_deadline)<=now){const done=await c.query(`UPDATE ${TABLE} SET state='failed',
      classifications=ARRAY['interrupted_observation'],completed_at=$3 WHERE tenant_id=$1 AND id=$2 AND state='observing' RETURNING *`,[o.tenantId,row.id,now]);
      if(done.rowCount!==1)throw deny('invalid_reconciliation_transition');row=done.rows[0];await audit(c,row,'google_ads_post_activation_reconciliation_failed');}}
  return publicRun(row,true);});}
async function reserve(pool,o,actor,invocationHash){return withTx(pool,async c=>{const p=await proof(c,o,actor,'FOR UPDATE');
  const now=new Date((await c.query('SELECT clock_timestamp() now')).rows[0].now),id=`gapar_${crypto.randomUUID()}`;
  const q=await c.query(`INSERT INTO ${TABLE}(tenant_id,id,activation_attempt_id,activation_status,invocation_id_hash,
    requested_by,session_id_hash,workflow_id,state,observations,classifications,audit_ref,observing_at,
    observation_deadline) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'observing','[]'::jsonb,'{}'::text[],$9,$10,$11)
    RETURNING *`,[o.tenantId,id,p.row.id,p.row.status,invocationHash,actor,hash(o.sessionId),p.row.workflow_id,
    `gapar-audit-${crypto.randomUUID()}`,now,new Date(now.getTime()+LEASE_MS)]);
  await audit(c,q.rows[0],'google_ads_post_activation_reconciliation_observing');
  return {row:q.rows[0],objects:p.objects,proof:p.row};});}
async function observe(pool,o,actor,started){return withTx(pool,async c=>{const p=await proof(c,o,actor);
  if(!same(p.row.operation_id,started.proof.operation_id)||!same(p.row.ledger_root_hash,started.proof.ledger_root_hash)
    ||!same(p.row.objects_digest,started.proof.objects_digest))throw deny('authoritative_binding_mismatch');
  return vault.withGoogleAdsPausedDraftSecretScope(c,{tenantId:o.tenantId,ownerUserId:Number(p.row.credential_owner_user_id),
    credentialRefId:p.row.credential_ref_id,credentialRefVersion:p.row.credential_ref_version,
    accountFingerprint:p.row.account_fingerprint,tokenTransport:o.tokenTransport||vault.googleAdsOAuthTokenTransport,
    tokenTimeoutMs:o.tokenTimeoutMs},handle=>observer.observePausedGoogleAdsLedger({
      credentials:{accessToken:handle.accessToken,developerToken:handle.developerToken,customerId:handle.customerId,
        loginCustomerId:handle.loginCustomerId,accountFingerprint:p.row.account_fingerprint},
      ledgerObjects:p.objects.map(x=>({object_kind:x.object_kind,provider_object_id:x.provider_object_id})),
      authorizationId:started.row.id,ledgerReference:started.row.ledger_root_hash,
      transport:o.observerTransport,allowLive:o.allowLive===true,now:o.observedNow}));});}
async function settle(pool,o,actor,started,outcome){return withTx(pool,async c=>{await proof(c,o,actor);
  const locked=await c.query(`SELECT * FROM ${TABLE} WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[o.tenantId,started.row.id]);
  if(locked.rowCount!==1||locked.rows[0].state!=='observing')throw deny('invalid_reconciliation_transition');
  const now=new Date((await c.query('SELECT clock_timestamp() now')).rows[0].now);
  const finalOutcome=new Date(locked.rows[0].observation_deadline)<=now
    ?{state:'failed',classifications:['interrupted_observation'],observations:[]}:outcome;
  const q=await c.query(`UPDATE ${TABLE} SET state=$3,observations=$4::jsonb,classifications=$5,
    completed_at=$6 WHERE tenant_id=$1 AND id=$2 AND state='observing' RETURNING *`,
   [o.tenantId,started.row.id,finalOutcome.state,JSON.stringify(finalOutcome.observations),finalOutcome.classifications,now]);
  if(q.rowCount!==1)throw deny('invalid_reconciliation_transition');await audit(c,q.rows[0],`google_ads_post_activation_reconciliation_${finalOutcome.state}`);return publicRun(q.rows[0],false);});}
async function reconcile(opts={}){const actor=human(opts),tenantId=Number(opts.tenantId),attempt=String(opts.activationAttemptId||''),invocation=String(opts.invocationId||'');
  if(!Number.isSafeInteger(tenantId)||tenantId<1||!SAFE_ID.test(attempt)||!SAFE_ID.test(invocation)
    ||(opts.observerTransport!==undefined&&typeof opts.observerTransport!=='function'))throw deny('validation_failed');
  const pool=opts.pool||db.getPool(),o={...opts,tenantId,activationAttemptId:attempt},invocationHash=hash(invocation);
  const replay=await existing(pool,o,actor,invocationHash);if(replay)return replay;
  let started;try{started=await reserve(pool,o,actor,invocationHash);}catch(e){const race=await existing(pool,o,actor,invocationHash);if(race)return race;throw e;}
  let outcome;try{outcome=evaluate(await observe(pool,o,actor,started),started.row.activation_status);}
  catch(e){outcome={state:'failed',classifications:[e.code==='credential_boundary_mismatch'?'credential_boundary_failure':'observation_failure'],observations:[]};}
  return settle(pool,o,actor,started,outcome);}
async function getRun(opts={}){const actor=human(opts),tenantId=Number(opts.tenantId),id=String(opts.runId||'');if(!Number.isSafeInteger(tenantId)||tenantId<1||!SAFE_ID.test(id))throw deny('validation_failed');
  return withTx(opts.pool||db.getPool(),async c=>{const hint=await c.query(`SELECT activation_attempt_id FROM ${TABLE} WHERE tenant_id=$1 AND id=$2`,[tenantId,id]);
    if(hint.rowCount!==1)throw deny('reconciliation_not_found');await proof(c,{...opts,tenantId,activationAttemptId:hint.rows[0].activation_attempt_id},actor);
    const q=await c.query(`SELECT * FROM ${TABLE} WHERE tenant_id=$1 AND id=$2 FOR SHARE`,[tenantId,id]);
    if(q.rowCount!==1)throw deny('reconciliation_not_found');const row=q.rows[0];if(Number(row.requested_by)!==actor||!same(row.session_id_hash,hash(opts.sessionId)))throw deny('reconciliation_not_found');
    return publicRun(row,true);});}

module.exports={TABLE,PERMISSION,KINDS,TERMINAL,LEASE_MS,reconcile,getRun,evaluate,publicRun,
  _test:{safeObservation,objectDigest,validateObjects,proof,existing,reserve,observe,settle}};
