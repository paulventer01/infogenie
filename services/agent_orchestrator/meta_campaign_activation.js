'use strict';

const crypto=require('crypto');
const db=require('../../db');
const caps=require('../security/meta_activation_capabilities');
const vault=require('../credentials/vault');
const connector=require('./connectors/meta_activation');

const ORDER=Object.freeze(['campaign','adset','creative','ad']);
const SAFE_ID=/^[A-Za-z0-9_.:-]{1,128}$/;
const hash=(v)=>crypto.createHash('sha256').update(String(v)).digest('hex');
function deny(code){const e=new Error(code);e.code=code;return e;}
function auth(opts){return {tenantId:opts.tenantId,actorUserId:opts.actorUserId,actorType:'human',principalType:opts.principalType,
  sessionId:opts.sessionId,hasExplicitTenantPermission:opts.hasExplicitTenantPermission,now:opts.now};}

async function audit(client,row,event){await client.query(`INSERT INTO orchestrator_audit_events
  (tenant_id,workflow_id,event,actor_user_id,detail) VALUES ($1,$2,$3,$4,$5::jsonb)`,
  [row.tenant_id,row.workflow_id,event,row.actor_user_id,JSON.stringify({activation_attempt_id:row.id,audit_reference:row.audit_ref})]);}

async function reserve(opts){
  const client=await (opts.pool||db.getPool()).connect();
  try { await client.query('BEGIN');
    const reservationId=`mar_${crypto.randomUUID()}`; const common={...auth(opts),capabilityId:opts.capabilityId};
    const reserved=await caps.reserve(client,{...common,reservationId});
    if(reserved.expired) { await client.query('COMMIT'); throw deny('capability_expired'); }
    const cap=(await client.query(`SELECT c.*,r.workflow_id FROM orchestrator_campaign_activation_capabilities c
      JOIN orchestrator_campaign_reconciliation_runs r ON r.tenant_id=c.tenant_id AND r.id=c.reconciliation_run_id
      WHERE c.tenant_id=$1 AND c.id=$2 FOR UPDATE OF c,r`,[opts.tenantId,opts.capabilityId])).rows[0];
    const ref=(await client.query(`SELECT owner_user_id,version,status,revoked_at,account_fingerprint
      FROM orchestrator_tenant_meta_credential_refs WHERE tenant_id=$1 AND id=$2 AND platform='meta' FOR UPDATE`,
      [opts.tenantId,cap.credential_ref_id])).rows[0];
    if(!ref||ref.status!=='active'||ref.revoked_at||Number(ref.version)!==Number(cap.credential_ref_version)
      ||ref.account_fingerprint!==cap.account_fingerprint) throw deny('authoritative_binding_mismatch');
    const objects=(await client.query(`SELECT object_kind,provider_object_id,provider_status FROM orchestrator_campaign_provider_objects
      WHERE tenant_id=$1 AND execution_id=$2 ORDER BY sequence_number FOR KEY SHARE`,[opts.tenantId,cap.execution_id])).rows;
    if(objects.length!==4||ORDER.some((kind,i)=>objects[i].object_kind!==kind||objects[i].provider_status!=='PAUSED')) throw deny('authoritative_binding_mismatch');
    const id=`maa_${crypto.randomUUID()}`, auditRef=`maa-audit-${crypto.randomUUID()}`;
    const inserted=(await client.query(`INSERT INTO orchestrator_campaign_activation_attempts
      (tenant_id,id,capability_id,invocation_id_hash,actor_user_id,session_id_hash,publishing_request_id,snapshot_hash,
       intent_id,execution_id,reconciliation_run_id,credential_ref_id,credential_ref_version,account_fingerprint,ledger_root_hash,audit_ref)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [opts.tenantId,id,cap.id,hash(opts.invocationId),opts.actorUserId,hash(opts.sessionId),cap.publishing_request_id,cap.snapshot_hash,
       cap.intent_id,cap.execution_id,cap.reconciliation_run_id,cap.credential_ref_id,cap.credential_ref_version,cap.account_fingerprint,cap.ledger_root_hash,auditRef])).rows[0];
    await caps.consume(client,{...common,reservationId,invocationId:opts.invocationId});
    inserted.workflow_id=cap.workflow_id; await audit(client,inserted,'meta_activation_started');
    await client.query('COMMIT');
    return {attempt:inserted,objects,credentialOwner:Number(ref.owner_user_id)};
  } catch(e){try{await client.query('ROLLBACK');}catch(_){} throw e;} finally{client.release();}
}

async function addEvent(pool,row,kind,operation,outcome,errorCode){
  await pool.query(`INSERT INTO orchestrator_campaign_activation_events
    (tenant_id,attempt_id,object_kind,operation,outcome,error_code) VALUES ($1,$2,$3,$4,$5,$6)`,
  [row.tenant_id,row.id,kind,operation,outcome,errorCode||null]);
}
async function settle(pool,row,state){const client=await pool.connect();try{await client.query('BEGIN');
  const updated=(await client.query(`UPDATE orchestrator_campaign_activation_attempts SET state=$3,settled_at=now()
    WHERE tenant_id=$1 AND id=$2 AND state='started' RETURNING *`,[row.tenant_id,row.id,state])).rows[0];
  if(!updated)throw deny('activation_settlement_failed'); updated.workflow_id=row.workflow_id; await audit(client,updated,`meta_activation_${state}`);
  await client.query('COMMIT'); return updated;
}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}

function publicResult(row,outcomes){return {activation_attempt_id:row.id,state:row.state,
  object_outcomes:outcomes.map(x=>({object_kind:x.object_kind,outcome:x.outcome,occurred_at:x.occurred_at})),
  started_at:row.started_at,settled_at:row.settled_at,audit_reference:row.audit_ref};}

async function activate(opts={}){
  if(!SAFE_ID.test(String(opts.capabilityId||''))||!SAFE_ID.test(String(opts.invocationId||'')))throw deny('capability_rejected');
  const pool=opts.pool||db.getPool(); const frozen=await reserve({...opts,pool});
  // Secret resolution deliberately occurs only after the consumption transaction committed.
  const getCredentials=opts.getCredentials||vault.getCredentialsAtVersion;
  let secret=null;
  try { secret=await getCredentials(frozen.credentialOwner,'meta_ads',Number(frozen.attempt.credential_ref_version)); } catch (_) {}
  let terminal='failed';
  if(!secret||typeof secret.accessToken!=='string'||vault.accountFingerprintOfMetaAdAccount(secret.adAccountId)!==frozen.attempt.account_fingerprint){
    await addEvent(pool,frozen.attempt,'campaign','activate','failed','credential_boundary_mismatch');
  } else {
    try {
      const result=await connector.activateMetaGraph({accessToken:secret.accessToken,adAccountId:secret.adAccountId,
        ledgerObjects:frozen.objects,transport:opts.transport,now:opts.now,
        onOutcome:async(event)=>{
        const operation=event.object_kind==='creative'?'verify_unchanged':'activate';
        const normalized=event.phase==='attempted'?'attempted':
          (['activated','unchanged_non_delivering'].includes(event.outcome)?'confirmed':
            (event.outcome==='outcome_unknown'?'outcome_unknown':(event.outcome==='rejected'?'rejected':'failed')));
        await addEvent(pool,frozen.attempt,event.object_kind,operation,normalized,
          ['confirmed','attempted'].includes(normalized)?null:(normalized==='outcome_unknown'?'provider_outcome_unknown':'provider_rejected'));
        }});
      terminal=result.state;
    } catch (_) {
      // A connector contract failure after entry cannot prove that Meta did not
      // receive a write. Consume remains final and human reconciliation is required.
      await addEvent(pool,frozen.attempt,'campaign','activate','outcome_unknown','provider_outcome_unknown');
      terminal='outcome_unknown';
    }
  }
  const settled=await settle(pool,frozen.attempt,terminal);
  const events=(await pool.query(`SELECT object_kind,outcome,occurred_at FROM orchestrator_campaign_activation_events
    WHERE tenant_id=$1 AND attempt_id=$2 AND outcome<>'attempted' ORDER BY id`,[settled.tenant_id,settled.id])).rows;
  return publicResult(settled,events);
}

module.exports={ORDER,activate,_reserve:reserve,_publicResult:publicResult};
