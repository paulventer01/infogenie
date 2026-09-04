'use strict';
// PR10C.1 — consume-once Google Ads reconciliation READ authority. It may only
// observe PAUSED provider objects that PR10B.2b already created: the sole provider
// surface it can reach is the dedicated read-only GAQL Search observer, and it has no
// route, worker, scheduler, retry, runs table or review closure. The PR10B.2a
// paused-draft secret scope is reused unchanged and opened at the last responsible
// moment, strictly after the consume has committed, so a provider or transport
// failure can never restore the one-shot authorization. The create-side kill
// switches are deliberately not consulted: freezing new creations must not strand
// reconciliation of objects that already exist.
const crypto = require('crypto');
const vault = require('../credentials/vault');
const observer = require('../agent_orchestrator/connectors/google_ads_paused_draft_reconciliation_observer');
const TABLE='orchestrator_google_ads_reconciliation_read_authorizations';
const OPERATIONS='orchestrator_google_ads_provider_draft_operations';
const OBJECTS='orchestrator_google_ads_provider_draft_objects';
// The existing read permission. Creating drafts is a different authority and is
// deliberately not required to reconcile what already exists.
const PERMISSION='advertising.reconciliation.read';
const POST_REVIEW_PERMISSION='advertising.reconciliation.review';
const KINDS=Object.freeze(['campaign_budget','campaign','ad_group']);
const DEFAULT_TTL_MS=5*60*1000;
const MAX_TTL_MS=10*60*1000;
const MAX_RECONCILIATION_LEASE_MS=180*1000;
const SAFE_ID=/^[A-Za-z0-9_.:-]{1,128}$/;
const HEX64=/^[0-9a-f]{64}$/;
const EVENT=(phase)=>`google_ads_reconciliation_read_authorization_${phase}`;
// Optional caller bindings: they may only agree with the operation row.
const BINDINGS=Object.freeze([['workflowId','workflow_id'],['draftId','draft_id'],['intentId','intent_id'],
  ['publishingRequestId','publishing_request_id'],['snapshotHash','snapshot_hash'],['intentHash','intent_hash'],
  ['capabilityId','capability_id'],['credentialRefId','credential_ref_id'],['accountFingerprint','account_fingerprint']]);
// Active tenant, active membership and a live DB-backed read grant. No kill switch.
const GRANTED=`JOIN tenants t ON t.id=$$.tenant_id AND t.status='active'
    JOIN tenant_users tu ON tu.tenant_id=t.id AND tu.user_id=$3 AND tu.status='active'
    JOIN roles role ON role.id=tu.role_id AND (role.tenant_id=t.id OR role.tenant_id IS NULL)`;
function deny(code) { const e=new Error(code);e.code=code;e.blocked=true;e.external_action_taken=false;return e; }
function hash(v) { return crypto.createHash('sha256').update(String(v)).digest('hex'); }
function same(a,b) { if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y); }
function int(v) { const n=Number(v);return Number.isSafeInteger(n)&&n>0?n:null; }
function valid(v) { return SAFE_ID.test(String(v||'')); }
// PR10A human-session shape: no api_key, worker, service or agent principal may hold a read authorization.
function permission(o){return o&&o.authorizationPurpose==='post_review'?POST_REVIEW_PERMISSION:PERMISSION;}
function human(o) { const id=int(o&&o.actorUserId),required=permission(o);
  if(!id||o.actorType!=='human'||!valid(o.sessionId)||['api_key','worker','service','service_account','automation','autonomous','agent'].includes(String(o.principalType||'').toLowerCase()))throw deny('human_session_required');
  if(typeof o.hasExplicitTenantPermission!=='function'||o.hasExplicitTenantPermission(required)!==true)throw deny('permission_denied');return id; }
// Audit detail is exactly {authorization_id, operation_id, status}: no session, credential,
// token, customer id, fingerprint or provider object material.
async function audit(c,tenantId,actorId,workflowId,event,detail) { await c.query(`INSERT INTO orchestrator_audit_events
  (tenant_id,workflow_id,event,actor_user_id,detail) VALUES($1,$2,$3,$4,$5::jsonb)`,[tenantId,workflowId,event,actorId,
  JSON.stringify({authorization_id:detail.authorization_id,operation_id:detail.operation_id,status:detail.status})]); }
function project(row,replay) { const iso=(k)=>row[k]?new Date(row[k]).toISOString():null;
  return Object.freeze({authorization_id:row.id,operation_id:row.operation_id,status:row.status,replay:!!replay,
    issued_at:iso('issued_at'),expires_at:iso('expires_at'),reserved_at:iso('reserved_at'),
    consumed_at:iso('consumed_at'),revoked_at:iso('revoked_at'),external_action_taken:false}); }
function ledgerRoot(rows) { return hash(KINDS.map((kind)=>`${kind}:${(Array.isArray(rows)
  ?rows.find((r)=>r&&r.object_kind===kind)||{}:{}).provider_object_id_digest}`).join('|')); }
// Exactly the three PAUSED, non-serving objects of this operation, each digest
// proving its own provider object id, all bound to the operation's account.
function validateLineage(rows,operation) {
  if(!Array.isArray(rows)||rows.length!==KINDS.length)throw deny('invalid_ledger_lineage');
  const by=Object.create(null);
  for(const r of rows) {
    if(!r||!KINDS.includes(r.object_kind)||by[r.object_kind]||typeof r.provider_object_id!=='string'
      ||!HEX64.test(String(r.provider_object_id_digest||''))
      ||!same(hash(r.provider_object_id),String(r.provider_object_id_digest))
      ||!same(String(r.account_fingerprint||''),String(operation&&operation.account_fingerprint||''))
      ||r.provider_status!=='PAUSED'||r.serving!==false||r.published!==false||r.activated!==false)throw deny('invalid_ledger_lineage');
    by[r.object_kind]=r; }
  if(KINDS.some((k)=>!by[k]))throw deny('invalid_ledger_lineage');return ledgerRoot(rows); }
// The operation row is the only authority, and only one that actually acted may
// be observed. A create freeze cannot strand this read.
async function loadOperation(c,tenantId,actorId,operationId,requiredPermission=PERMISSION) {
  const r=await c.query(`SELECT op.* FROM ${OPERATIONS} op ${GRANTED.replaceAll('$$','op')}
    WHERE op.tenant_id=$1 AND op.id=$2 AND op.external_action_taken=TRUE
      AND role.permissions ? $4 FOR SHARE OF op,t,tu,role`,[tenantId,operationId,actorId,requiredPermission]);
  if(r.rowCount!==1)throw deny('authorization_lineage_mismatch');const operation=r.rows[0];
  const objects=await c.query(`SELECT object_kind,provider_object_id,provider_object_id_digest,account_fingerprint,
      provider_status,serving,published,activated FROM ${OBJECTS} WHERE tenant_id=$1 AND operation_id=$2
    ORDER BY sequence_number FOR SHARE`,[tenantId,operation.id]);
  return {operation,objects:objects.rows,ledgerRoot:validateLineage(objects.rows,operation)}; }
// Caller owns the transaction. Every stored binding is copied from the locked
// operation row; the caller's own options may only agree with it.
async function issue(c,o={}) {
  const tenantId=int(o.tenantId),actorId=human(o),ttl=int(o.ttlMs||DEFAULT_TTL_MS);
  if(!tenantId||!valid(o.operationId)||!ttl||ttl>MAX_TTL_MS)throw deny('validation_failed');
  const purpose=o.authorizationPurpose==='post_review'?'post_review':'initial';
  const g=await loadOperation(c,tenantId,actorId,String(o.operationId),permission(o)),op=g.operation;
  for(const [key,column] of BINDINGS) if(o[key]!==undefined&&!same(String(o[key]),String(op[column])))throw deny('authorization_lineage_mismatch');
  // The credential owner is the operation's actor, so only they may reconcile.
  if((o.credentialRefVersion!==undefined&&Number(o.credentialRefVersion)!==Number(op.credential_ref_version))
    ||(o.ledgerRootHash!==undefined&&!same(String(o.ledgerRootHash),g.ledgerRoot))
    ||(purpose==='initial'&&Number(op.actor_user_id)!==actorId)
    ||(purpose==='post_review'&&Number(o.credentialOwnerUserId)!==Number(op.actor_user_id)))throw deny('authorization_lineage_mismatch');
  const now=new Date((await c.query('SELECT clock_timestamp() AS now')).rows[0]?.now);
  if(!Number.isFinite(now.getTime()))throw deny('validation_failed');
  const id=`garr_${crypto.randomUUID()}`,expires=new Date(now.getTime()+ttl);
  try { await c.query(`INSERT INTO ${TABLE}
    (tenant_id,id,nonce_hash,requested_by,credential_owner_user_id,session_id_hash,purpose,review_case_id,review_version,closure_event_id,workflow_id,draft_id,publishing_request_id,intent_id,
     snapshot_hash,intent_hash,operation_id,capability_id,credential_ref_id,credential_ref_version,
     account_fingerprint,ledger_root_hash,issued_at,expires_at,audit_ref)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
  [tenantId,id,hash(crypto.randomBytes(32)),actorId,Number(op.actor_user_id),hash(o.sessionId),purpose,o.reviewCaseId||null,o.reviewVersion||null,o.closureEventId||null,op.workflow_id,op.draft_id,
    op.publishing_request_id,op.intent_id,op.snapshot_hash,op.intent_hash,op.id,op.capability_id,op.credential_ref_id,
    op.credential_ref_version,op.account_fingerprint,g.ledgerRoot,now,expires,`garr-audit-${crypto.randomUUID()}`]); }
  catch(error) { if(error?.code==='23505')throw deny('authorization_conflict');throw error; }
  await audit(c,tenantId,actorId,op.workflow_id,EVENT('issued'),{authorization_id:id,operation_id:op.id,status:'issued'});
  return Object.freeze({authorization_id:id,operation_id:op.id,status:'issued',
    expires_at:expires.toISOString(),replay:false,external_action_taken:false}); }
// Locks the authorization and re-proves actor, human session, expiry, ledger and
// credential binding before any transition is offered.
async function prepare(c,o) {
  const tenantId=int(o.tenantId),actorId=human(o);
  if(!tenantId||!valid(o.authorizationId)||!valid(o.invocationId))throw deny('validation_failed');
  const r=await c.query(`SELECT * FROM ${TABLE} WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[tenantId,String(o.authorizationId)]);
  if(r.rowCount!==1)throw deny('authorization_rejected');const row=r.rows[0];
  const reject=async(code)=>{await audit(c,tenantId,actorId,row.workflow_id,EVENT('rejected'),
    {authorization_id:row.id,operation_id:row.operation_id,status:row.status});throw deny(code);};
  if(String(row.purpose||'initial')!==String(o.authorizationPurpose||'initial')
    ||Number(row.requested_by)!==actorId||!same(String(row.session_id_hash),hash(o.sessionId))
    ||!['issued','consumed'].includes(row.status))return reject('authorization_rejected');
  const now=row.status==='issued'?(o.now instanceof Date?o.now:new Date((await c.query('SELECT clock_timestamp() AS now')).rows[0]?.now)):null;
  if(row.status==='issued'&&!(new Date(row.expires_at)>now)) {
    await c.query(`UPDATE ${TABLE} SET status='expired' WHERE tenant_id=$1 AND id=$2 AND status='issued'`,[tenantId,row.id]);
    return reject('authorization_expired'); }
  let g;
  try { g=await loadOperation(c,tenantId,actorId,row.operation_id,permission(o)); }
  catch(error) { if(error&&error.blocked)return reject(error.code);throw error; }
  if(!bound(g,row))return reject('authorization_lineage_mismatch');
  // Replay is metadata-only, but still requires a live tenant, membership and DB role grant.
  if(row.status==='consumed')return {replay:true,row};
  return {replay:false,row,tenantId,actorId,graph:g,now,invocationHash:hash(o.invocationId)}; }
function bound(g,row) { return same(g.ledgerRoot,String(row.ledger_root_hash))
  &&same(String(g.operation.account_fingerprint),String(row.account_fingerprint))
  &&same(String(g.operation.credential_ref_id),String(row.credential_ref_id))
  &&Number(g.operation.credential_ref_version)===Number(row.credential_ref_version); }
async function markConsumed(c,p) {
  const {tenantId,actorId,row,invocationHash,now}=p,detail=(status)=>({authorization_id:row.id,operation_id:row.operation_id,status});
  await c.query(`UPDATE ${TABLE} SET status='reserved',invocation_id_hash=$3,reserved_at=$4
    WHERE tenant_id=$1 AND id=$2 AND status='issued'`,[tenantId,row.id,invocationHash,now]);
  await audit(c,tenantId,actorId,row.workflow_id,EVENT('reserved'),detail('reserved'));
  const done=await c.query(`UPDATE ${TABLE} SET status='consumed',consumed_at=$3
    WHERE tenant_id=$1 AND id=$2 AND status='reserved' RETURNING *`,[tenantId,row.id,now]);
  if(done.rowCount!==1)throw deny('authorization_rejected');
  await audit(c,tenantId,actorId,row.workflow_id,EVENT('consumed'),detail('consumed'));return done.rows[0]; }
async function consume(c,o={}) { const p=await prepare(c,o);
  return p.replay?project(p.row,true):project(await markConsumed(c,p),false); }
// Narrow PR10C.2 primitive. The caller owns the transaction so the locked
// authorization, immutable observing run and initial audit can commit as one
// unit. No provider material is accepted here and the account fingerprint is
// deliberately not copied into the run table.
async function consumeIntoReconciliationRun(c,o={},run={}) {
  if(!c||typeof c.query!=='function')throw deny('validation_failed');
  let p;
  try { p=await prepare(c,o); }
  catch(error) {
    // prepare() may have durably classified an expired/rejected authority and
    // written its audit evidence. Only those decisions may be committed by the
    // transaction owner; validation, insert and infrastructure failures below
    // must continue to roll the whole transaction back.
    if(error&&error.blocked)error.commit_authority_decision=true;
    throw error;
  }
  if(p.replay)throw deny('authorization_rejected');
  if(!valid(run.id)||!valid(run.auditRef)||!Number.isSafeInteger(run.observationLeaseMs)
    ||run.observationLeaseMs<1||run.observationLeaseMs>MAX_RECONCILIATION_LEASE_MS)throw deny('validation_failed');
  const row=p.row;
  if(String(row.purpose||'initial')!==String(o.authorizationPurpose||'initial'))throw deny('authorization_lineage_mismatch');
  // prepare() already holds the authorization row lock. Establish both lease
  // timestamps from one PostgreSQL clock read inside the same transaction.
  const inserted=await c.query(`WITH lease AS (SELECT clock_timestamp() AS now)
    INSERT INTO orchestrator_google_ads_reconciliation_runs
    (tenant_id,id,authorization_id,invocation_id_hash,requested_by,workflow_id,draft_id,publishing_request_id,
     operation_id,snapshot_hash,intent_id,intent_hash,credential_ref_id,credential_ref_version,ledger_root_hash,
     state,audit_ref,observing_at,observation_deadline)
    SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'observing',$16,
      lease.now,lease.now+($17 * interval '1 millisecond') FROM lease RETURNING *`,
  [p.tenantId,run.id,row.id,p.invocationHash,p.actorId,row.workflow_id,row.draft_id,row.publishing_request_id,
    row.operation_id,row.snapshot_hash,row.intent_id,row.intent_hash,row.credential_ref_id,row.credential_ref_version,
    row.ledger_root_hash,run.auditRef,run.observationLeaseMs]);
  if(inserted.rowCount!==1)throw deny('authorization_rejected');
  const consumed=await markConsumed(c,p);
  return Object.freeze({consumed:project(consumed,false),row:inserted.rows[0]});
}
// Metadata replay/get must remain subject to current human-session authority.
// prepare() re-proves tenant, membership, DB grant, operation ledger and current
// credential binding without opening the vault. Also bind the supplied replay
// key to the invocation that originally consumed this authorization.
async function reproveMetadataAuthority(c,o={}) {
  if(!c||typeof c.query!=='function')throw deny('validation_failed');
  const p=await prepare(c,o);
  if(!p.replay||!same(String(p.row.invocation_id_hash||''),hash(o.invocationId)))throw deny('authorization_rejected');
  return Object.freeze({tenant_id:int(o.tenantId),authorization_id:p.row.id,
    invocation_id_hash:p.row.invocation_id_hash,requested_by:Number(p.row.requested_by),
    workflow_id:p.row.workflow_id,operation_id:p.row.operation_id});
}
// Owns the transaction boundary: the consume is committed before this returns, so
// nothing downstream can read while the spend is still reversible. A blocked
// decision commits its expiry/audit state; infrastructure errors roll back.
async function consumeAtomic(pool,o={}) {
  if(!pool||typeof pool.connect!=='function')throw deny('validation_failed');
  if(!int(o.tenantId)||!valid(o.authorizationId)||!valid(o.invocationId))throw deny('validation_failed');
  human(o);
  const c=await pool.connect();
  try { await c.query('BEGIN');
    try { const out=await consume(c,o);await c.query('COMMIT');return out; }
    catch(error) { if(error&&error.blocked)await c.query('COMMIT');else await c.query('ROLLBACK');throw error; } }
  finally { c.release(); } }
// Re-reads the consumed authorization, re-proves the ledger and credential
// binding, then opens the PR10B.2a secret scope. The sealed handle never leaves
// this function: only the credential values the Search observer needs are copied
// out of it, and nothing is logged or persisted.
async function observeWithConsumedCredential(c,o={}) {
  if(!c||typeof c.query!=='function')throw deny('validation_failed');
  const tenantId=int(o.tenantId),actorId=human(o);
  if(!tenantId||!valid(o.authorizationId)||!valid(o.invocationId)||typeof o.tokenTransport!=='function'
    ||(o.observerTransport!==undefined&&typeof o.observerTransport!=='function'))throw deny('validation_failed');
  const r=await c.query(`SELECT * FROM ${TABLE} WHERE tenant_id=$1 AND id=$2 AND status='consumed'
    AND requested_by=$3 AND session_id_hash=$4 AND invocation_id_hash=$5 FOR UPDATE`,
  [tenantId,String(o.authorizationId),actorId,hash(o.sessionId),hash(o.invocationId)]);
  if(r.rowCount!==1)throw deny('authorization_rejected');
  const row=r.rows[0],g=await loadOperation(c,tenantId,actorId,row.operation_id,permission(o));
  if(!bound(g,row))throw deny('credential_boundary_mismatch');
  // Kind plus provider object id only: the observer derives every URL itself.
  const ledgerObjects=g.objects.map((x)=>Object.freeze({object_kind:x.object_kind,provider_object_id:String(x.provider_object_id)}));
  const observed=await vault.withGoogleAdsPausedDraftSecretScope(c,{tenantId,ownerUserId:Number(row.credential_owner_user_id||actorId),
    credentialRefId:row.credential_ref_id,credentialRefVersion:row.credential_ref_version,
    accountFingerprint:row.account_fingerprint,tokenTransport:o.tokenTransport,
    tokenTimeoutMs:o.tokenTimeoutMs},(handle)=>observer.observePausedGoogleAdsLedger({
    credentials:{accessToken:handle.accessToken,developerToken:handle.developerToken,customerId:handle.customerId,
      loginCustomerId:handle.loginCustomerId,accountFingerprint:row.account_fingerprint},
    ledgerObjects,authorizationId:row.id,ledgerReference:row.ledger_root_hash,
    transport:o.observerTransport,allowLive:o.allowLive===true}));
  return Object.freeze({authorization_id:row.id,operation_id:row.operation_id,status:'consumed',replay:false,
    ledger_reference:row.ledger_root_hash,serving:false,external_action_taken:false,
    attempted_observations:Number(observed&&observed.attempted_observations)||0,
    completed_observations:Number(observed&&observed.completed_observations)||0,
    observations:Object.freeze(((observed&&observed.observations)||[]).map((x)=>Object.freeze({...x})))}); }
// Consume exactly once, then observe the already-created PAUSED objects with
// read-only GAQL Search requests. The consume commits in its own transaction first, so an
// observer, transport or provider failure leaves the authorization consumed —
// exactly-once holds. A replay returns metadata alone: no scope, no decryption,
// no token exchange, no network.
async function consumeAndObserve(pool,o={}) {
  if(!pool||typeof pool.connect!=='function')throw deny('validation_failed');
  human(o);
  if(typeof o.tokenTransport!=='function')throw deny('validation_failed');
  const consumed=await consumeAtomic(pool,o);
  if(consumed.replay)return consumed;
  const c=await pool.connect();
  try { await c.query('BEGIN');
    try { const out=await observeWithConsumedCredential(c,o);await c.query('COMMIT');return out; }
    catch(error) { await c.query('ROLLBACK');throw error; } }
  finally { c.release(); } }
async function get(c,o={}) {
  const tenantId=int(o.tenantId),actorId=human(o);
  if(!tenantId||!valid(o.authorizationId))throw deny('authorization_rejected');
  const r=await c.query(`SELECT a.*,CASE WHEN a.status IN ('issued','reserved')
      AND a.expires_at<=clock_timestamp() THEN 'expired' ELSE a.status END AS status
    FROM ${TABLE} a ${GRANTED.replaceAll('$$','a')}
    WHERE a.tenant_id=$1 AND a.id=$2 AND a.requested_by=$3 AND a.session_id_hash=$4
      AND role.permissions ? $5`,[tenantId,String(o.authorizationId),actorId,hash(o.sessionId),PERMISSION]);
  if(r.rowCount!==1)throw deny('authorization_rejected');
  return project(r.rows[0],r.rows[0].status==='consumed'); }
async function revoke(c,o={}) {
  const tenantId=int(o.tenantId),actorId=human(o);
  if(!tenantId||!valid(o.authorizationId))throw deny('authorization_rejected');
  const locked=await c.query(`SELECT * FROM ${TABLE} WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[tenantId,String(o.authorizationId)]);
  if(locked.rowCount!==1||Number(locked.rows[0].requested_by)!==actorId
    ||!same(String(locked.rows[0].session_id_hash),hash(o.sessionId))
    ||!['issued','reserved'].includes(locked.rows[0].status))throw deny('authorization_rejected');
  const graph=await loadOperation(c,tenantId,actorId,locked.rows[0].operation_id);
  if(!bound(graph,locked.rows[0]))throw deny('authorization_lineage_mismatch');
  const r=await c.query(`UPDATE ${TABLE} SET status='revoked',revoked_at=COALESCE($5,clock_timestamp())
    WHERE tenant_id=$1 AND id=$2 AND requested_by=$3 AND session_id_hash=$4
      AND status IN ('issued','reserved') RETURNING *`,
  [tenantId,String(o.authorizationId),actorId,hash(o.sessionId),o.now instanceof Date?o.now:null]);
  if(r.rowCount!==1)throw deny('authorization_rejected');
  await audit(c,tenantId,actorId,r.rows[0].workflow_id,EVENT('revoked'),
    {authorization_id:r.rows[0].id,operation_id:r.rows[0].operation_id,status:'revoked'});
  return project(r.rows[0],false); }
module.exports={PERMISSION,POST_REVIEW_PERMISSION,KINDS,TABLE,DEFAULT_TTL_MS,MAX_TTL_MS,MAX_RECONCILIATION_LEASE_MS,ledgerRoot,validateLineage,issue,consume,
  consumeIntoReconciliationRun,reproveMetadataAuthority,consumeAtomic,consumeAndObserve,
  observeWithConsumedCredential,get,revoke,_deny:deny,_human:human};
