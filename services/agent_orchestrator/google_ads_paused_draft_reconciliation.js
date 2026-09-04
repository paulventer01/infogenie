'use strict';

// Durable PR10C.2 coordinator.  The security module owns all authority and
// credential access; this module owns only the immutable run lifecycle and the
// sanitized provider result.
const crypto = require('crypto');
const authority = require('../security/google_ads_paused_draft_reconciliation');

const TABLE = 'orchestrator_google_ads_reconciliation_runs';
const STATES = Object.freeze(['observing','verified','discrepancy_detected','failed']);
const TERMINAL_STATES = Object.freeze(['verified','discrepancy_detected','failed']);
const KINDS = Object.freeze(['campaign_budget','campaign','ad_group']);
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const OUTCOMES = Object.freeze(['observed','missing','unauthorized','transient_failure','malformed','permanent_failure']);
const STATUS_CLASSES = Object.freeze(['paused','active','unsafe','inactive','unknown']);
const ERROR_CLASSES = Object.freeze(['not_found','provider_unauthorized','rate_limited','provider_unavailable',
  'response_too_large','redirect_rejected','invalid_provider_response','provider_rejected']);
// Three sequential GAQL requests are bounded to eight seconds each.  This
// deliberately generous lease also covers token exchange, credential and DB
// overhead without making an ordinary slow request recoverable concurrently.
const OBSERVATION_LEASE_MS = authority.MAX_RECONCILIATION_LEASE_MS;

function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function fail(code) { const e=new Error(code);e.code=code;e.blocked=true;e.external_action_taken=false;return e; }
function validateActor(opts) { authority._human(opts); }
function safeMatch(value,sentinel) { return value===true||value===false?value:(value===sentinel?sentinel:'unknown'); }
function safeTimestamp(value) {
  if(typeof value!=='string'||value.length>40)return '';
  const parsed=new Date(value);
  return Number.isFinite(parsed.getTime())&&parsed.toISOString()===value?value:'';
}
function safeObservation(input={}) {
  return Object.freeze({
    object_kind: KINDS.includes(input.object_kind)?input.object_kind:'unknown',
    outcome:OUTCOMES.includes(input.outcome)?input.outcome:'malformed',
    status_classification:STATUS_CLASSES.includes(input.status_classification)?input.status_classification:'unknown',
    account_binding_matches:safeMatch(input.account_binding_matches,'not_applicable'),
    campaign_parent_matches:safeMatch(input.campaign_parent_matches,'not_applicable'),
    budget_parent_matches:safeMatch(input.budget_parent_matches,'not_applicable'),
    error_classification:ERROR_CLASSES.includes(input.error_classification)?input.error_classification:undefined,
    observed_at:safeTimestamp(input.observed_at),
  });
}

function evaluate(result) {
  const observations=Array.isArray(result&&result.observations)?result.observations.map(safeObservation):[];
  if(Number(result&&result.attempted_observations)!==3||Number(result&&result.completed_observations)!==3
    ||observations.length!==3||new Set(observations.map((x)=>x.object_kind)).size!==3
    ||KINDS.some((kind)=>!observations.some((x)=>x.object_kind===kind))) {
    return {state:'failed',classifications:['partial_observation'],observations};
  }
  const discrepancies=[],failures=[];
  for(const observation of observations) {
    const kind=observation.object_kind;
    if(observation.outcome==='missing')discrepancies.push(`${kind}_missing`);
    else if(observation.outcome!=='observed')failures.push(`${kind}_${observation.error_classification||observation.outcome}`);
    if(observation.outcome!=='observed')continue;
    if(observation.account_binding_matches!==true)discrepancies.push(`${kind}_account_mismatch`);
    if(!['paused','inactive'].includes(observation.status_classification)) {
      discrepancies.push(`${kind}_${['active','delivering','unsafe'].includes(observation.status_classification)
        ?observation.status_classification:'unsafe_status'}`);
    }
    if(kind==='campaign'&&observation.budget_parent_matches!==true)discrepancies.push('campaign_budget_mismatch');
    if(kind==='ad_group'&&observation.campaign_parent_matches!==true)discrepancies.push('ad_group_campaign_mismatch');
  }
  if(failures.length)return {state:'failed',classifications:[...new Set(failures)].sort(),observations};
  if(discrepancies.length)return {state:'discrepancy_detected',classifications:[...new Set(discrepancies)].sort(),observations};
  return {state:'verified',classifications:[],observations};
}

function publicRun(row) {
  return Object.freeze({
    reconciliation_run_id:row.id,state:row.state,object_kinds:KINDS,
    observations:Array.isArray(row.observations)?row.observations.map(safeObservation):[],
    discrepancy_classifications:row.state==='discrepancy_detected'?(row.classifications||[]):[],
    failure_classifications:row.state==='failed'?(row.classifications||[]):[],
    audit_reference:row.audit_ref,created_at:row.created_at,completed_at:row.completed_at||null,
    external_action_taken:false,
  });
}

async function audit(client,row,event) {
  await client.query(`INSERT INTO orchestrator_audit_events
    (tenant_id,workflow_id,event,actor_user_id,detail) VALUES($1,$2,$3,$4,$5::jsonb)`,
  [row.tenant_id,row.workflow_id,event,row.requested_by,
    JSON.stringify({reconciliation_run_id:row.id,audit_reference:row.audit_ref})]);
}
function sameInvocation(row,authorizationId,invocationHash) {
  if(row.authorization_id!==authorizationId||row.invocation_id_hash!==invocationHash)throw fail('idempotency_conflict');
}
function assertProofBindings(row,proof) {
  if(!proof||Number(row.tenant_id)!==Number(proof.tenant_id)
    ||String(row.authorization_id)!==String(proof.authorization_id)
    ||String(row.invocation_id_hash)!==String(proof.invocation_id_hash)
    ||Number(row.requested_by)!==Number(proof.requested_by)
    ||String(row.workflow_id)!==String(proof.workflow_id)
    ||String(row.operation_id)!==String(proof.operation_id))throw fail('authorization_lineage_mismatch');
}

async function existingOrRecover(pool,opts,tenantId,authorizationId,invocationHash,_requestedAt=new Date(),auditImpl=audit) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const found=await client.query(`SELECT * FROM ${TABLE}
      WHERE tenant_id=$1 AND (authorization_id=$2 OR invocation_id_hash=$3) FOR UPDATE`,
    [tenantId,authorizationId,invocationHash]);
    if(!found.rowCount){await client.query('COMMIT');return null;}
    if(found.rowCount!==1)throw fail('idempotency_conflict');
    let row=found.rows[0];sameInvocation(row,authorizationId,invocationHash);
    // Metadata access and recovery both re-prove current tenant, membership,
    // database grant, operation/ledger lineage and credential binding.
    assertProofBindings(row,await authority.reproveMetadataAuthority(client,opts));
    if(row.state==='observing') {
      // Recovery uses the database clock after the row lock and authority
      // re-proof, so lock/re-proof delay cannot postpone an expired lease.
      const clock=await client.query('SELECT clock_timestamp() AS now');
      if(clock.rowCount!==1||!Number.isFinite(new Date(clock.rows[0].now).getTime()))throw fail('invalid_reconciliation_transition');
      const recoveredAt=new Date(clock.rows[0].now);
      if(new Date(row.observation_deadline)<=recoveredAt) {
        const recovered=await client.query(`UPDATE ${TABLE}
          SET state='failed',classifications=ARRAY['interrupted_observation']::TEXT[],completed_at=$3
          WHERE tenant_id=$1 AND id=$2 AND state='observing' RETURNING *`,[tenantId,row.id,recoveredAt]);
        if(recovered.rowCount!==1)throw fail('invalid_reconciliation_transition');
        row=recovered.rows[0];
        await auditImpl(client,row,'google_ads_paused_draft_reconciliation_failed');
      }
    }
    await client.query('COMMIT');return publicRun(row);
  } catch(error){try{await client.query('ROLLBACK');}catch(_){}throw error;}
  finally{client.release();}
}

async function createObservingRun(pool,opts,_requestedAt,consumeImpl=authority.consumeIntoReconciliationRun,
  auditImpl=audit,leaseMs=OBSERVATION_LEASE_MS) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const id=`garrun_${crypto.randomUUID()}`;
    const run={id,auditRef:`garrun-audit:${hash(id).slice(0,20)}`,observationLeaseMs:leaseMs};
    // The primitive consumes the authorization and inserts the observing run;
    // neither becomes visible unless the initial audit also succeeds.
    const started=await consumeImpl(client,opts,run);
    await auditImpl(client,started.row,'google_ads_paused_draft_reconciliation_observing');
    await client.query('COMMIT');return started;
  } catch(error) {
    // Authority rejection/expiry carries intentional state and audit evidence.
    // The primitive marks these errors commit-safe; infrastructure failures and
    // partial run creation remain fully reversible.
    try{await client.query(error&&error.commit_authority_decision===true?'COMMIT':'ROLLBACK');}catch(_){}
    throw error;
  } finally{client.release();}
}

async function finishRun(pool,opts,tenantId,id,evaluation,_requestedAt=new Date(),auditImpl=audit) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const hint=await client.query(`SELECT operation_id FROM ${TABLE} WHERE tenant_id=$1 AND id=$2`,[tenantId,id]);
    if(hint.rowCount!==1)throw fail('invalid_reconciliation_transition');
    await client.query(`SELECT id FROM orchestrator_google_ads_provider_draft_operations WHERE tenant_id=$1 AND id=$2 FOR SHARE`,[tenantId,hint.rows[0].operation_id]);
    const locked=await client.query(`SELECT * FROM ${TABLE} WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[tenantId,id]);
    if(locked.rowCount!==1)throw fail('invalid_reconciliation_transition');
    assertProofBindings(locked.rows[0],await authority.reproveMetadataAuthority(client,opts));
    if(TERMINAL_STATES.includes(locked.rows[0].state)){await client.query('COMMIT');return publicRun(locked.rows[0]);}
    if(locked.rows[0].state!=='observing')throw fail('invalid_reconciliation_transition');
    // The lease decision uses the database clock after the run row is locked.
    // A timestamp captured before lock acquisition cannot authorize a terminal
    // observation that waited past its deadline.
    const clock=await client.query('SELECT clock_timestamp() AS now');
    if(clock.rowCount!==1||!Number.isFinite(new Date(clock.rows[0].now).getTime()))throw fail('invalid_reconciliation_transition');
    const settledAt=new Date(clock.rows[0].now);
    if(new Date(locked.rows[0].observation_deadline)<=settledAt) {
      const expired=await client.query(`UPDATE ${TABLE}
        SET state='failed',classifications=ARRAY['interrupted_observation']::TEXT[],completed_at=$3
        WHERE tenant_id=$1 AND id=$2 AND state='observing' RETURNING *`,[tenantId,id,settledAt]);
      if(expired.rowCount!==1)throw fail('invalid_reconciliation_transition');
      await auditImpl(client,expired.rows[0],'google_ads_paused_draft_reconciliation_failed');
      await client.query('COMMIT');return publicRun(expired.rows[0]);
    }
    const done=await client.query(`UPDATE ${TABLE}
      SET state=$3,observations=$4::jsonb,classifications=$5,completed_at=$6
      WHERE tenant_id=$1 AND id=$2 AND state='observing' RETURNING *`,
    [tenantId,id,evaluation.state,JSON.stringify(evaluation.observations),evaluation.classifications,settledAt]);
    if(done.rowCount!==1)throw fail('invalid_reconciliation_transition');
    await auditImpl(client,done.rows[0],`google_ads_paused_draft_reconciliation_${evaluation.state}`);
    await client.query('COMMIT');return publicRun(done.rows[0]);
  } catch(error){try{await client.query('ROLLBACK');}catch(_){}throw error;}
  finally{client.release();}
}

async function observe(pool,opts) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const result=await authority.observeWithConsumedCredential(client,opts);
    await client.query('COMMIT');return result;
  } catch(error){try{await client.query('ROLLBACK');}catch(_){}throw error;}
  finally{client.release();}
}

async function reconcile(pool,opts={}) {
  validateActor(opts);
  const tenantId=Number(opts.tenantId),authorizationId=String(opts.authorizationId||''),invocationId=String(opts.invocationId||'');
  if(!Number.isSafeInteger(tenantId)||tenantId<1||!SAFE_ID.test(authorizationId)||!SAFE_ID.test(invocationId))throw fail('validation_failed');
  const invocationHash=hash(invocationId),now=opts.now instanceof Date?opts.now:new Date();
  const existing=await existingOrRecover(pool,opts,tenantId,authorizationId,invocationHash,now);
  if(existing)return existing;
  let started;
  try{started=await createObservingRun(pool,opts,now);}
  catch(error){const replay=await existingOrRecover(pool,opts,tenantId,authorizationId,invocationHash,now);if(replay)return replay;throw error;}
  let evaluation;
  try{evaluation=evaluate(await observe(pool,opts));}
  catch(error){evaluation={state:'failed',classifications:[error&&error.code==='credential_boundary_mismatch'
    ?'credential_boundary_failure':'observation_failure'],observations:[]};}
  return finishRun(pool,opts,tenantId,started.row.id,evaluation,opts.now instanceof Date?opts.now:new Date());
}

async function getRun(pool,opts={}) {
  validateActor(opts);const tenantId=Number(opts.tenantId),id=String(opts.runId||'');
  if(!Number.isSafeInteger(tenantId)||tenantId<1||!SAFE_ID.test(id))throw fail('validation_failed');
  const client=await pool.connect();
  try{await client.query('BEGIN');const hint=await client.query(`SELECT operation_id FROM ${TABLE} WHERE tenant_id=$1 AND id=$2`,[tenantId,id]);
    if(hint.rowCount!==1)throw fail('reconciliation_not_found');
    await client.query(`SELECT id FROM orchestrator_google_ads_provider_draft_operations WHERE tenant_id=$1 AND id=$2 FOR SHARE`,[tenantId,hint.rows[0].operation_id]);
    const found=await client.query(`SELECT * FROM ${TABLE} WHERE tenant_id=$1 AND id=$2 FOR SHARE`,[tenantId,id]);
    if(found.rowCount!==1)throw fail('reconciliation_not_found');
    assertProofBindings(found.rows[0],await authority.reproveMetadataAuthority(client,opts));
    await client.query('COMMIT');return publicRun(found.rows[0]);
  }catch(error){try{await client.query('ROLLBACK');}catch(_){}throw error;}finally{client.release();}
}

module.exports={TABLE,STATES,TERMINAL_STATES,KINDS,OBSERVATION_LEASE_MS,evaluate,publicRun,reconcile,getRun,
  _test:{safeObservation,assertProofBindings,existingOrRecover,createObservingRun,finishRun,observe}};
