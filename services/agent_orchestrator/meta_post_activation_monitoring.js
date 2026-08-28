'use strict';

const crypto = require('crypto');
const db = require('../../db');
const vault = require('../credentials/vault');
const monitor = require('./connectors/meta_delivery_monitor');

const PERMISSION = 'advertising.campaign.monitor';
const KINDS = Object.freeze(['campaign','adset','creative','ad']);
const TERMINAL = new Set(['verified_active','delivery_pending','discrepancy_detected','failed']);
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const LEASE_MS = 30000;
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
function deny(code){ const error=new Error(code); error.code=code; return error; }

function authorize(opts){
  if (!Number.isSafeInteger(opts.actorUserId)||opts.actorUserId<1||opts.actorType!=='human'||opts.principalType!=='user'
    ||!SAFE_ID.test(String(opts.sessionId||''))) throw deny('human_session_required');
  if (typeof opts.hasExplicitTenantPermission!=='function'||opts.hasExplicitTenantPermission(PERMISSION)!==true) throw deny('permission_denied');
}
function safeObservation(value={}) { return {
  object_kind: KINDS.includes(value.object_kind)?value.object_kind:'unknown',
  configured_status:value.configured_status||null,effective_status:value.effective_status||null,
  delivery_classification:value.delivery_classification||value.failure_classification||'unknown_provider_state',
  account_relationship_matches:value.account_relationship_matches===true,
  parent_relationship_matches:(value.campaign_relationship_matches==='not_applicable'&&value.adset_relationship_matches==='not_applicable')?'not_applicable':
    value.campaign_relationship_matches!==false&&value.adset_relationship_matches!==false,
  creative_relationship_matches:value.creative_relationship_matches==='not_applicable'?'not_applicable':value.creative_relationship_matches===true,
  observed_at:value.observed_at||null,
}; }
function publicRun(row){ const observations=Array.isArray(row.observations)?row.observations:[]; return {
  monitoring_run_id:row.id,activation_attempt_reference:row.activation_attempt_id,state:row.state,object_kinds:KINDS,
  observations:observations.map(safeObservation),discrepancy_classifications:row.state==='discrepancy_detected'?(row.classifications||[]):[],
  failure_classifications:row.state==='failed'?(row.classifications||[]):[],observation_started_at:row.started_at,
  observation_completed_at:row.completed_at||null,audit_reference:row.audit_ref,
}; }
async function audit(client,row,event){ await client.query(`INSERT INTO orchestrator_audit_events
  (tenant_id,workflow_id,event,actor_user_id,detail) VALUES($1,$2,$3,$4,$5::jsonb)`,
  [row.tenant_id,row.workflow_id,event,row.actor_user_id,JSON.stringify({monitoring_run_id:row.id,audit_reference:row.audit_ref})]); }

async function existing(pool,tenantId,attemptId,invocationHash,now){ const client=await pool.connect(); try{
  await client.query('BEGIN'); const found=await client.query(`SELECT * FROM orchestrator_campaign_monitoring_runs
    WHERE tenant_id=$1 AND (activation_attempt_id=$2 OR invocation_id_hash=$3) FOR UPDATE`,[tenantId,attemptId,invocationHash]);
  if(!found.rowCount){await client.query('COMMIT');return null;} if(found.rowCount!==1)throw deny('idempotency_conflict'); let row=found.rows[0];
  if(row.activation_attempt_id!==attemptId||row.invocation_id_hash!==invocationHash)throw deny('idempotency_conflict');
  if(row.state==='observing'&&new Date(row.observation_deadline)<=now){ row=(await client.query(`UPDATE orchestrator_campaign_monitoring_runs
    SET state='failed',classifications=ARRAY['interrupted_observation'],completed_at=$3 WHERE tenant_id=$1 AND id=$2 AND state='observing' RETURNING *`,[tenantId,row.id,now])).rows[0];
    await audit(client,row,'meta_post_activation_monitoring_failed'); }
  await client.query('COMMIT'); return publicRun(row);
  }catch(e){try{await client.query('ROLLBACK');}catch(_){}throw e;}finally{client.release();}}

async function reserve(pool,opts,now,invocationHash){ const client=await pool.connect(); try{await client.query('BEGIN');
  const lineage=(await client.query(`SELECT a.*,r.workflow_id,ref.owner_user_id,ref.status credential_status,ref.revoked_at,
    ref.version current_credential_version,ref.account_fingerprint current_account_fingerprint,c.status capability_state,r.state reconciliation_state
    FROM orchestrator_campaign_activation_attempts a
    JOIN orchestrator_campaign_activation_capabilities c ON c.tenant_id=a.tenant_id AND c.id=a.capability_id
    JOIN orchestrator_campaign_reconciliation_runs r ON r.tenant_id=a.tenant_id AND r.id=a.reconciliation_run_id
    JOIN orchestrator_tenant_meta_credential_refs ref ON ref.tenant_id=a.tenant_id AND ref.id=a.credential_ref_id
    WHERE a.tenant_id=$1 AND a.id=$2 FOR UPDATE OF a,c,r,ref`,[opts.tenantId,opts.activationAttemptId])).rows[0];
  if(!lineage)throw deny('activation_attempt_not_found');
  if(lineage.state!=='activated')throw deny('activation_attempt_ineligible');
  if(lineage.capability_state!=='consumed'||lineage.reconciliation_state!=='verified'||lineage.credential_status!=='active'||lineage.revoked_at
    ||Number(lineage.current_credential_version)!==Number(lineage.credential_ref_version)
    ||lineage.current_account_fingerprint!==lineage.account_fingerprint)throw deny('authoritative_binding_mismatch');
  const objects=(await client.query(`SELECT object_kind,provider_object_id,provider_object_id_digest,parent_campaign_digest,parent_adset_digest,parent_creative_digest
    FROM orchestrator_campaign_provider_objects WHERE tenant_id=$1 AND execution_id=$2 ORDER BY sequence_number FOR KEY SHARE`,[opts.tenantId,lineage.execution_id])).rows;
  if(objects.length!==4||KINDS.some((kind,i)=>objects[i].object_kind!==kind))throw deny('authoritative_binding_mismatch');
  const id=`mmr_${crypto.randomUUID()}`,auditRef=`mmr-audit:${hash(id).slice(0,20)}`;
  const row=(await client.query(`INSERT INTO orchestrator_campaign_monitoring_runs
    (tenant_id,id,activation_attempt_id,invocation_id_hash,actor_user_id,session_id_hash,capability_id,publishing_request_id,snapshot_hash,intent_id,execution_id,reconciliation_run_id,credential_ref_id,credential_ref_version,account_fingerprint,ledger_root_hash,workflow_id,state,audit_ref,started_at,observation_deadline)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'observing',$18,$19,$20) RETURNING *`,
    [opts.tenantId,id,lineage.id,invocationHash,opts.actorUserId,hash(opts.sessionId),lineage.capability_id,lineage.publishing_request_id,lineage.snapshot_hash,lineage.intent_id,lineage.execution_id,lineage.reconciliation_run_id,lineage.credential_ref_id,lineage.credential_ref_version,lineage.account_fingerprint,lineage.ledger_root_hash,lineage.workflow_id,auditRef,now,new Date(now.getTime()+LEASE_MS)])).rows[0];
  await audit(client,row,'meta_post_activation_monitoring_observing');await client.query('COMMIT');return {row,objects,credentialOwner:Number(lineage.owner_user_id)};
  }catch(e){try{await client.query('ROLLBACK');}catch(_){}throw e;}finally{client.release();}}

function evaluate(result){ const observations=Array.isArray(result&&result.observations)?result.observations.map(safeObservation):[];
  if(observations.length!==4||new Set(observations.map(x=>x.object_kind)).size!==4)return {state:'failed',classifications:['partial_observation'],observations};
  const failures=[...(result.failure_classifications||[])], discrepancies=[...(result.discrepancy_classifications||[])];
  for(const raw of result.observations||[])if(raw.observation!=='observed')failures.push(raw.failure_classification||'permanent_read_failure');
  for(const o of observations){if(o.delivery_classification==='provider_review_pending')continue;
    if(o.delivery_classification==='unknown_provider_state')discrepancies.push('unknown_provider_state');
    if(!o.account_relationship_matches)discrepancies.push('unexpected_account');
    if(o.parent_relationship_matches===false)discrepancies.push('changed_parent_relationship');
    if(o.creative_relationship_matches===false)discrepancies.push('changed_or_unlinked_creative');}
  if(failures.length)return {state:'failed',classifications:[...new Set(failures)],observations};
  if(discrepancies.length)return {state:'discrepancy_detected',classifications:[...new Set(discrepancies)],observations};
  return {state:observations.some(x=>x.delivery_classification==='delivery_pending')?'delivery_pending':'verified_active',classifications:[],observations}; }
async function settle(pool,row,outcome,now){const client=await pool.connect();try{await client.query('BEGIN');
  const done=(await client.query(`UPDATE orchestrator_campaign_monitoring_runs SET state=$3,observations=$4::jsonb,classifications=$5,completed_at=$6
    WHERE tenant_id=$1 AND id=$2 AND state='observing' RETURNING *`,[row.tenant_id,row.id,outcome.state,JSON.stringify(outcome.observations),outcome.classifications,now])).rows[0];
  if(!done)throw deny('invalid_monitoring_transition');await audit(client,done,`meta_post_activation_monitoring_${done.state}`);await client.query('COMMIT');return publicRun(done);
  }catch(e){try{await client.query('ROLLBACK');}catch(_){}throw e;}finally{client.release();}}

async function observe(opts={}){authorize(opts);const tenantId=Number(opts.tenantId),attemptId=String(opts.activationAttemptId||''),invocationId=String(opts.invocationId||'');
  if(!Number.isSafeInteger(tenantId)||tenantId<1||!SAFE_ID.test(attemptId)||!SAFE_ID.test(invocationId))throw deny('validation_failed');
  const pool=opts.pool||db.getPool(),now=opts.now instanceof Date?opts.now:new Date(),invocationHash=hash(invocationId);
  const replay=await existing(pool,tenantId,attemptId,invocationHash,now);if(replay)return replay;
  let started;try{started=await reserve(pool,{...opts,tenantId,activationAttemptId:attemptId},now,invocationHash);}catch(e){const race=await existing(pool,tenantId,attemptId,invocationHash,now);if(race)return race;throw e;}
  let outcome;try{const credentials=await (opts.getCredentials||vault.getCredentialsAtVersion)(started.credentialOwner,'meta_ads',started.row.credential_ref_version);
    if(!credentials||vault.accountFingerprintOfMetaAdAccount(credentials.adAccountId)!==started.row.account_fingerprint)throw deny('credential_boundary_mismatch');
    outcome=evaluate(await monitor.observeMetaDelivery({accessToken:credentials.accessToken,adAccountId:credentials.adAccountId,ledgerObjects:started.objects,transport:opts.transport,sleep:opts.sleep,now:opts.now}));
  }catch(e){outcome={state:'failed',classifications:[e.code||'permanent_read_failure'],observations:[]};}
  return settle(pool,started.row,outcome,opts.now instanceof Date?opts.now:new Date());}
async function getRun(opts={}){authorize(opts);const id=String(opts.runId||'');if(!SAFE_ID.test(id))throw deny('validation_failed');const r=await (opts.pool||db.getPool()).query(`SELECT * FROM orchestrator_campaign_monitoring_runs WHERE tenant_id=$1 AND id=$2`,[opts.tenantId,id]);if(r.rowCount!==1)throw deny('monitoring_run_not_found');return publicRun(r.rows[0]);}

module.exports={PERMISSION,KINDS,LEASE_MS,observe,getRun,evaluate,publicRun,_test:{existing,reserve,settle}};
