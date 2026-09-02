'use strict';

// PR10B.1 — metadata-only Google Ads provider-operation ledger. Funds exactly one
// operation row from one consumed PR10A capability and settles it as failed or
// unknown. It performs no provider call, resolves no secret, takes no external
// action, and never claims provider success.
//
// PR10B.2a settlement authority. `settle` may now record 'succeeded' with
// 'provider_create_succeeded', but only against a confirmed paused-draft
// provider result that echoes this operation's own keys, and it writes the
// created PAUSED objects as append-only evidence in the same transaction as the
// external_action_taken flip.
//
// PR10B.2b adds `execute` at the bottom of this file: the one guarded path that
// may actually call the paused-draft connector. fund/settle/get keep their
// caller-owned-transaction contract and still take no external action; only
// `execute` owns transactions, and only because the provider call sits between
// them. Retry, activation, scheduling, workers and HTTP remain out of scope.

const crypto = require('crypto');
const capability = require('./google_ads_provider_draft_capabilities');
const vault = require('../credentials/vault');
const connector = require('../agent_orchestrator/connectors/google_ads_paused_draft');

const TABLE = 'orchestrator_google_ads_provider_draft_operations';
const OBJECTS_TABLE = 'orchestrator_google_ads_provider_draft_objects';
const PERMISSION = capability.PERMISSION;
const OPERATION_STATUSES = Object.freeze(['pending', 'in_progress', 'succeeded', 'failed', 'unknown']);
const RESULT_CODES = Object.freeze({ succeeded: 'provider_create_succeeded',
  failed: 'provider_create_failed', unknown: 'provider_outcome_unknown' });
const OBJECT_SEQUENCE = Object.freeze(['campaign_budget', 'campaign', 'ad_group']);
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const SAFE_KEY = /^[A-Za-z0-9_.:-]{1,256}$/;
const deny = capability._deny;
const human = capability._human;
function hash(v) { return crypto.createHash('sha256').update(String(v)).digest('hex'); }
function same(a,b) { if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y); }
function int(v) { const n=Number(v);return Number.isSafeInteger(n)&&n>0?n:null; }
function valid(v) { return SAFE_ID.test(String(v||'')); }
function project(x,replay) { const iso=k=>x[k]?new Date(x[k]).toISOString():null;
  return Object.freeze({operation_id:x.id,status:x.status,result_code:x.result_code||null,replay:!!replay,
    created_at:iso('created_at'),started_at:iso('started_at'),settled_at:iso('settled_at'),
    published:false,activated:false,external_action_taken:x.external_action_taken===true}); }
// Audit detail carries no session, credential, account or payload material.
async function audit(c,row,event) { await c.query(`INSERT INTO orchestrator_audit_events
  (tenant_id,workflow_id,event,actor_user_id,detail) VALUES($1,$2,$3,$4,$5::jsonb)`,
[row.tenant_id,row.workflow_id,event,row.actor_user_id,
  JSON.stringify({operation_id:row.id,capability_id:row.capability_id,status:row.status})]); }
// A savepoint is only legal inside a transaction block, so this fails closed
// when a caller forgot BEGIN and Postgres would otherwise autocommit every
// statement — including a FOR UPDATE lock that would then protect nothing.
async function requireTx(c) {
  if(!c||typeof c.query!=='function')throw deny('transaction_required');
  try { await c.query('SAVEPOINT gapdo_tx_assert');await c.query('RELEASE SAVEPOINT gapdo_tx_assert'); }
  catch(_e) { throw deny('transaction_required'); }
}
function lineage(row,o,actorId) { return same(String(row.capability_id),String(o.capabilityId))
  &&Number(row.actor_user_id)===actorId&&Number(row.requested_by)===actorId
  &&same(String(row.session_id_hash),hash(o.sessionId))
  &&same(String(row.reservation_id_hash),hash(o.reservationId))
  &&same(String(row.invocation_id_hash),hash(o.invocationId)); }

// Caller owns the transaction: this never issues BEGIN/COMMIT/ROLLBACK. The
// savepoint below only unwinds the INSERT attempt, never the capability spend.
async function fund(c,o={}) {
  const tenantId=int(o.tenantId),actorId=human(o);
  if(!tenantId||![o.capabilityId,o.reservationId,o.invocationId].every(valid)
    ||!SAFE_KEY.test(String(o.idempotencyKey||'')))throw deny('operation_rejected');
  await requireTx(c);
  const idempotencyKey=String(o.idempotencyKey);
  const existing=await c.query(`SELECT * FROM ${TABLE} WHERE tenant_id=$1 AND idempotency_key=$2 FOR UPDATE`,
    [tenantId,idempotencyKey]);
  if(existing.rowCount===1) {
    if(!lineage(existing.rows[0],o,actorId))throw deny('operation_conflict');
    return project(existing.rows[0],true);
  }
  // PR10A revalidates authority, kill switches, actor lineage, credential
  // version and fingerprints inside reserve/consume.
  const reserved=await capability.reserve(c,o);if(reserved.expired)return reserved;
  const consumed=await capability.consume(c,o);if(consumed.expired)return consumed;
  const cap=(await c.query(`SELECT * FROM orchestrator_google_ads_provider_draft_capabilities
    WHERE tenant_id=$1 AND id=$2 AND status='consumed' AND actor_user_id=$3 FOR UPDATE`,
  [tenantId,o.capabilityId,actorId])).rows[0];
  if(!cap||!same(String(cap.session_id_hash),hash(o.sessionId)))throw deny('operation_rejected');
  await vault.assertGoogleAdsProviderDraftCredentialRefMetadata(c,{tenantId,ownerUserId:actorId,
    credentialRefId:cap.credential_ref_id,credentialRefVersion:cap.credential_ref_version,
    accountFingerprint:cap.account_fingerprint});
  const operationKey=hash(`${tenantId}|${cap.id}|${cap.draft_id}|${cap.draft_revision}|${cap.intent_id}|${cap.account_fingerprint}`);
  const id=`gapo_${crypto.randomUUID()}`;
  await c.query('SAVEPOINT gapdo_fund');
  try {
    await c.query(`INSERT INTO ${TABLE}
      (tenant_id,id,status,actor_user_id,session_id_hash,workflow_id,draft_id,draft_revision,contract_hash,
       publishing_request_id,publish_approval_id,workflow_approval_id,snapshot_hash,intent_id,intent_hash,
       capability_id,credential_ref_id,credential_ref_version,account_fingerprint,reservation_id_hash,
       invocation_id_hash,idempotency_key,provider_operation_key,requested_by,created_at,audit_ref)
      VALUES($1,$2,'pending',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$3,clock_timestamp(),$23)`,
    [tenantId,id,actorId,cap.session_id_hash,cap.workflow_id,cap.draft_id,cap.draft_revision,cap.contract_hash,
      cap.publishing_request_id,cap.publish_approval_id,cap.workflow_approval_id,cap.snapshot_hash,cap.intent_id,
      cap.intent_hash,cap.id,cap.credential_ref_id,cap.credential_ref_version,cap.account_fingerprint,
      hash(o.reservationId),hash(o.invocationId),idempotencyKey,operationKey,`gapo-audit-${crypto.randomUUID()}`]);
    await c.query('RELEASE SAVEPOINT gapdo_fund');
  } catch (error) {
    if(error?.code!=='23505')throw error;
    await c.query('ROLLBACK TO SAVEPOINT gapdo_fund');
    await c.query('RELEASE SAVEPOINT gapdo_fund');
    const raced=await c.query(`SELECT * FROM ${TABLE} WHERE tenant_id=$1 AND idempotency_key=$2 FOR UPDATE`,
      [tenantId,idempotencyKey]);
    if(raced.rowCount!==1||!lineage(raced.rows[0],o,actorId))throw deny('operation_conflict');
    return project(raced.rows[0],true);
  }
  const started=(await c.query(`UPDATE ${TABLE} SET status='in_progress',started_at=clock_timestamp()
    WHERE tenant_id=$1 AND id=$2 AND status='pending' RETURNING *`,[tenantId,id])).rows[0];
  if(!started)throw deny('operation_rejected');
  await audit(c,started,'google_ads_provider_draft_operation_funded');
  return project(started,false);
}

// A confirmed paused creation is the only evidence that may flip
// external_action_taken. Anything ambiguous, serving, retryable, or short of
// the full PAUSED object set is rejected before any transition.
function confirmed(r) {
  if(!r||typeof r!=='object'||r.ok!==true||r.result_code!==RESULT_CODES.succeeded
    ||r.external_action_taken!==true||r.published!==false||r.activated!==false||r.serving!==false
    ||r.requires_reconciliation!==false||r.retry!==false||!Array.isArray(r.objects)
    ||r.objects.length!==OBJECT_SEQUENCE.length
    ||Number(r.objects_created)!==OBJECT_SEQUENCE.length)throw deny('operation_rejected');
  return OBJECT_SEQUENCE.map((kind,i)=>{const x=r.objects[i];
    if(!x||typeof x!=='object'||x.object_kind!==kind||x.provider_status!=='PAUSED'
      ||Number(x.sequence_number)!==i+1
      ||!/^[0-9]{1,32}$/.test(String(x.provider_object_id||'')))throw deny('operation_rejected');
    return {kind,sequence:i+1,objectId:String(x.provider_object_id)};});
}
// Claiming success needs a live DB-backed grant in the initiating tenant, not
// just the caller's in-memory claim. failed/unknown deliberately skip this: a
// revoked membership or permission must never strand an in_progress row.
async function grant(c,tenantId,actorId) {
  const r=await c.query(`SELECT 1 FROM tenants t
    JOIN tenant_users tu ON tu.tenant_id=t.id AND tu.user_id=$2 AND tu.status='active'
    JOIN roles role ON role.id=tu.role_id AND (role.tenant_id=t.id OR role.tenant_id IS NULL)
    WHERE t.id=$1 AND t.status='active' AND role.permissions ? $3 FOR UPDATE OF t,tu,role`,
  [tenantId,actorId,PERMISSION]);
  if(r.rowCount!==1)throw deny('permission_denied');
}
// Append-only provider evidence, written before the status flip so a
// succeeded row can never exist without its PAUSED objects.
async function record(c,row,objects) {
  for(const x of objects) await c.query(`INSERT INTO ${OBJECTS_TABLE}
    (tenant_id,id,operation_id,capability_id,account_fingerprint,object_kind,sequence_number,
     provider_object_id,provider_object_id_digest,provider_status,result_code,recorded_at,audit_ref)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'PAUSED',$10,clock_timestamp(),$11)`,
  [row.tenant_id,`gapdobj_${crypto.randomUUID()}`,row.id,row.capability_id,row.account_fingerprint,
    x.kind,x.sequence,x.objectId,hash(x.objectId),RESULT_CODES.succeeded,
    `gapdobj-audit-${crypto.randomUUID()}`]);
}

async function settle(c,o={}) {
  const tenantId=int(o.tenantId),actorId=human(o);
  const status=String(o.status||'');
  if(!tenantId||!valid(o.operationId)||!Object.hasOwn(RESULT_CODES,status)
    ||String(o.resultCode||'')!==RESULT_CODES[status])throw deny('operation_rejected');
  const success=status==='succeeded';
  const objects=success?confirmed(o.providerResult):null;
  // Evidence, the status flip and the audit row are one unit: settlement is
  // only ever allowed to run inside the caller's open transaction.
  await requireTx(c);
  const r=await c.query(`SELECT * FROM ${TABLE} WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[tenantId,o.operationId]);
  if(r.rowCount!==1)throw deny('operation_rejected');
  const row=r.rows[0];
  if(Number(row.actor_user_id)!==actorId||!same(String(row.session_id_hash),hash(o.sessionId))
    ||row.status!=='in_progress'||row.external_action_taken!==false)throw deny('operation_rejected');
  if(o.idempotencyKey!==undefined&&!same(String(o.idempotencyKey),String(row.idempotency_key)))throw deny('operation_rejected');
  if(success) {
    // The provider result must echo this operation's own keys, so evidence
    // from another operation cannot authorize this external-action claim.
    if(!same(String(o.providerResult.provider_operation_key||''),String(row.provider_operation_key))
      ||!same(String(o.providerResult.idempotency_key||''),String(row.idempotency_key)))throw deny('operation_rejected');
    await grant(c,tenantId,actorId);
    await record(c,row,objects);
  }
  const settled=(await c.query(`UPDATE ${TABLE} SET status=$3,result_code=$4,
    external_action_taken=$5,settled_at=clock_timestamp()
    WHERE tenant_id=$1 AND id=$2 AND status='in_progress' RETURNING *`,
  [tenantId,o.operationId,status,RESULT_CODES[status],success])).rows[0];
  if(!settled)throw deny('operation_rejected');
  await audit(c,settled,'google_ads_provider_draft_operation_settled');
  return project(settled,false);
}

async function get(c,o={}) {
  const tenantId=int(o.tenantId),actorId=human(o);
  if(!tenantId||!valid(o.operationId))throw deny('operation_rejected');
  await requireTx(c);
  const r=await c.query(`SELECT op.* FROM ${TABLE} op
    JOIN tenants t ON t.id=op.tenant_id AND t.status='active'
    JOIN tenant_users tu ON tu.tenant_id=t.id AND tu.user_id=$3 AND tu.status='active'
    JOIN roles role ON role.id=tu.role_id AND (role.tenant_id=t.id OR role.tenant_id IS NULL)
    WHERE op.tenant_id=$1 AND op.id=$2 AND op.actor_user_id=$3 AND op.session_id_hash=$4
      AND role.permissions ? $5 FOR UPDATE OF op,t,tu,role`,
  [tenantId,o.operationId,actorId,hash(o.sessionId),PERMISSION]);
  if(r.rowCount!==1)throw deny('operation_rejected');
  return project(r.rows[0],false);
}

// ── PR10B.2b guarded execution ───────────────────────────────────────────────
// Everything above this line is transaction-agnostic ledger work that takes no
// external action. Below is the single guarded path that may reach Google, and
// the only code in this module that opens transactions of its own.

const PROVIDER_DEADLINE_MS = 10000;
// Serving, activation, scheduling and spend-increase controls are not the
// caller's to name; the connector derives PAUSED objects on its own.
const FORBIDDEN_SNAPSHOT = Object.freeze(['status','state','serving','servingstatus','deliverystatus','enabled',
  'enable','activate','activated','activation','publish','published','launch','schedule','scheduled',
  'startdatetime','enddatetime','startat','endat','startdate','enddate','optimize','optimization','spend',
  'budgetincrease','amountmicrosincrease','campaignstatus','adgroupstatus','bidstrategy','promote']);
function normalizeKey(k) { return String(k).toLowerCase().replace(/[^a-z0-9]/g,''); }
function outcome(x) { return Object.freeze({...x,requires_reconciliation:x.status==='unknown'}); }

// The caller may say what the paused draft is, never how it serves. Rejected
// before any authority, capability or secret work happens.
function pausedSnapshot(value) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw deny('operation_rejected');
  const walk=(node,depth)=>{ if(depth>3)throw deny('operation_rejected');
    for(const [k,v] of Object.entries(node)) {
      if(FORBIDDEN_SNAPSHOT.includes(normalizeKey(k)))throw deny('serving_request_rejected');
      if(v&&typeof v==='object')walk(v,depth+1); } };
  walk(value,1);
  const name=String(value.name||'').trim();
  const micros=Number(value.budget&&value.budget.amount_micros);
  if(!name||name.length>120||!Number.isSafeInteger(micros)||micros<=0)throw deny('operation_rejected');
  if(value.budget.currency!==undefined&&String(value.budget.currency)!=='USD')throw deny('operation_rejected');
  return Object.freeze({name,budget:Object.freeze({amount_micros:micros,currency:'USD'})});
}

async function withTx(pool,fn) {
  const c=await pool.connect();
  try { await c.query('BEGIN');const out=await fn(c);await c.query('COMMIT');return out; }
  catch(error) { try { await c.query('ROLLBACK'); } catch(_e) { /* pool discards a broken client */ } throw error; }
  finally { c.release(); }
}
// Locks are held across the provider call, so the invocation itself is bounded.
async function bounded(ms,run) {
  let timer=null;
  try { return await Promise.race([Promise.resolve().then(run),
    new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(deny('provider_deadline_exceeded')),ms);})]); }
  finally { if(timer)clearTimeout(timer); }
}

async function claim(c,tenantId,actorId,operationId,o) {
  const r=await c.query(`SELECT * FROM ${TABLE} WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[tenantId,operationId]);
  if(r.rowCount!==1)throw deny('operation_rejected');
  const row=r.rows[0];
  if(row.status!=='in_progress'||row.external_action_taken!==false||row.result_code!=null
    ||!lineage(row,o,actorId)||!same(String(row.idempotency_key),String(o.idempotencyKey)))throw deny('operation_rejected');
  return row;
}

// Immediately before the provider action, every authority fact is re-proved
// from the database: tenant, actor, human session, draft revision, approval,
// intent, account fingerprint, credential ref/version, capability spend, active
// membership, the explicit permission grant, and both kill switches. The PR10A
// authoritative path is reused verbatim, and the FOR UPDATE locks it takes are
// held through the invocation and the settlement in the same transaction.
async function reauthorize(c,o,actorId,row) {
  const cap=(await c.query(`SELECT * FROM orchestrator_google_ads_provider_draft_capabilities
    WHERE tenant_id=$1 AND id=$2 AND status='consumed' AND actor_user_id=$3 FOR UPDATE`,
  [row.tenant_id,row.capability_id,actorId])).rows[0];
  if(!cap||!same(String(cap.session_id_hash),hash(o.sessionId))
    ||!same(String(cap.session_id_hash),String(row.session_id_hash))
    ||!same(String(cap.reservation_id_hash),String(row.reservation_id_hash))
    ||!same(String(cap.invocation_id_hash),String(row.invocation_id_hash))
    ||!same(String(cap.draft_id),String(row.draft_id))
    ||!same(String(cap.intent_id),String(row.intent_id)))throw deny('capability_rejected');
  const fresh=await capability._authoritative(c,row.tenant_id,{actorUserId:actorId,draftId:row.draft_id,
    draftRevision:row.draft_revision,publishingRequestId:row.publishing_request_id,
    publishApprovalId:row.publish_approval_id,intentId:row.intent_id,
    credentialRefId:row.credential_ref_id,credentialRefVersion:row.credential_ref_version});
  if(!same(String(fresh.contract_hash),String(row.contract_hash))
    ||!same(String(fresh.snapshot_hash),String(row.snapshot_hash))
    ||!same(String(fresh.intent_hash),String(row.intent_hash))
    ||!same(String(fresh.account_fingerprint),String(row.account_fingerprint))
    ||!same(String(fresh.workflow_id),String(row.workflow_id))
    ||Number(fresh.workflow_approval_id)!==Number(row.workflow_approval_id))throw deny('authoritative_binding_mismatch');
  const now=new Date((await c.query('SELECT clock_timestamp() AS now')).rows[0]?.now);
  if(!Number.isFinite(now.getTime())||!(new Date(cap.expires_at)>now)
    ||!(new Date(fresh.approval_expires_at)>now))throw deny('capability_expired');
  await grant(c,row.tenant_id,actorId);
  await vault.assertGoogleAdsProviderDraftCredentialRefMetadata(c,{tenantId:row.tenant_id,ownerUserId:actorId,
    credentialRefId:row.credential_ref_id,credentialRefVersion:row.credential_ref_version,
    accountFingerprint:row.account_fingerprint});
}

// Only a connector result that claims a confirmed paused creation is offered to
// settle() as success; settle() still re-proves the evidence and the grant.
// Ambiguity is unknown-and-reconcile, never a retry.
function classify(result) {
  if(result&&result.ok===true&&result.result_code===RESULT_CODES.succeeded)return 'succeeded';
  if(!result||result.result_code===RESULT_CODES.unknown||result.requires_reconciliation===true
    ||result.retry===true)return 'unknown';
  return 'failed';
}

/**
 * Perform exactly one guarded Google Ads paused-draft creation for one PR10A
 * capability, and settle its PR10B.1 ledger row.
 *
 * Ordering is deliberate: the ledger row is funded and committed before
 * anything can act, authority is re-proved inside the transaction that will
 * call the provider, the credential is decrypted only inside the PR10B.2a
 * secret scope at the last responsible moment, the connector is invoked once
 * with no retry, and provider evidence is persisted before the settlement that
 * may claim `external_action_taken`.
 *
 * A replay of a settled — or still in-flight — operation returns stored
 * metadata and reacquires no authority, decrypts no secret, exchanges no token
 * and calls no provider. Live Google is opt-in twice over and off by default.
 */
async function execute(pool,o={}) {
  if(!pool||typeof pool.connect!=='function')throw deny('operation_rejected');
  const tenantId=int(o.tenantId),actorId=human(o);
  if(!tenantId||![o.capabilityId,o.reservationId,o.invocationId].every(valid)
    ||!SAFE_KEY.test(String(o.idempotencyKey||'')))throw deny('operation_rejected');
  if(typeof o.tokenTransport!=='function')throw deny('operation_rejected');
  const transport=o.providerTransport;
  if(transport!==undefined&&typeof transport!=='function')throw deny('operation_rejected');
  const live=transport===undefined;
  if(live&&!(o.allowLive===true&&process.env[connector.LIVE_OPT_IN_ENV]==='1'))throw deny('live_google_ads_disabled');
  const deadline=o.providerTimeoutMs===undefined?PROVIDER_DEADLINE_MS:int(o.providerTimeoutMs);
  if(!deadline||deadline>PROVIDER_DEADLINE_MS)throw deny('operation_rejected');
  const snapshot=pausedSnapshot(o.snapshot);

  const funded=await withTx(pool,(c)=>fund(c,o));
  if(funded.expired)return funded;
  // Duplicate delivery: terminal rows answer from stored metadata, and an
  // in-flight row is refused the provider rather than blindly invoked again.
  if(funded.replay)return outcome(funded);

  let invoked=false;
  try {
    return await withTx(pool,async(c)=>{
      const row=await claim(c,tenantId,actorId,funded.operation_id,o);
      await reauthorize(c,o,actorId,row);
      const result=await vault.withGoogleAdsPausedDraftSecretScope(c,{tenantId,ownerUserId:actorId,
        credentialRefId:row.credential_ref_id,credentialRefVersion:row.credential_ref_version,
        accountFingerprint:row.account_fingerprint,tokenTransport:o.tokenTransport,
        tokenTimeoutMs:o.tokenTimeoutMs},async(handle)=>{
        // One send, ever. The marker flips as the request leaves, so a rejected
        // connector input stays determinate, and a second attempt inside the
        // same operation is refused rather than re-sent. The live path has no
        // wrapper to flip, so it is marked conservatively up front.
        const once=(request)=>{ if(invoked)throw deny('provider_reinvocation_rejected');
          invoked=true;return transport(request); };
        if(live)invoked=true;
        // The sealed handle is forwarded, never unpacked: no secret or raw
        // account identifier is named, copied, logged or persisted here.
        return bounded(deadline,()=>connector.createPausedGoogleAdsDraft({
          operation:{provider_operation_key:row.provider_operation_key,idempotency_key:row.idempotency_key},
          credentials:handle,snapshot,...(live?{allowLive:true}:{inject:{mutate:once}})}));
      });
      const status=classify(result);
      return outcome(await settle(c,{...o,operationId:row.id,status,resultCode:RESULT_CODES[status],
        idempotencyKey:row.idempotency_key,providerResult:status==='succeeded'?result:undefined}));
    });
  } catch(error) {
    // Nothing ever left for the provider: the operation failed determinately
    // and no external action was taken. Once a request has left, the outcome is
    // ambiguous, so the row becomes unknown and requires reconciliation.
    // Neither path retries.
    const status=invoked?'unknown':'failed';
    let settled=null;
    try { settled=await withTx(pool,(c)=>settle(c,{...o,operationId:funded.operation_id,status,
      resultCode:RESULT_CODES[status],idempotencyKey:o.idempotencyKey,providerResult:undefined})); }
    catch(_e) { settled=null; }
    if(invoked&&settled)return outcome(settled);
    throw error;
  }
}

module.exports={PERMISSION,OPERATION_STATUSES,RESULT_CODES,OBJECT_SEQUENCE,OBJECTS_TABLE,PROVIDER_DEADLINE_MS,
  fund,settle,get,execute,_project:project,_deny:deny,_confirmed:confirmed,_pausedSnapshot:pausedSnapshot,
  _classify:classify};
