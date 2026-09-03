'use strict';
require('./helpers/env'); // vault key must exist before the vault caches it
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('fs');const crypto=require('crypto');
const authority=require('../services/security/google_ads_paused_draft_reconciliation');

const source=fs.readFileSync(require.resolve('../services/security/google_ads_paused_draft_reconciliation'),'utf8');
const sha=(v)=>crypto.createHash('sha256').update(String(v)).digest('hex');
const FP=sha('1234567890');
const SESSION='session-c1';
const actor={tenantId:7,actorUserId:11,actorType:'human',principalType:'user',sessionId:SESSION,
  hasExplicitTenantPermission:(key)=>key===authority.PERMISSION};
const refuse={query:async()=>{throw new Error('no database work expected');}};
const never=()=>{throw new Error('no secret scope, token exchange or observer expected');};
const OBJECT_IDS={campaign_budget:'9001',campaign:'9002',ad_group:'9003'};
const paused=(over={})=>authority.KINDS.map((kind)=>({object_kind:kind,
  provider_object_id:OBJECT_IDS[kind],provider_object_id_digest:sha(OBJECT_IDS[kind]),
  account_fingerprint:FP,provider_status:'PAUSED',serving:false,published:false,activated:false,...over}));
const operation=(over={})=>({id:'gapo_x',tenant_id:7,actor_user_id:11,requested_by:11,status:'succeeded',
  external_action_taken:true,workflow_id:'wf',draft_id:'dr',publishing_request_id:'rq',intent_id:'in',
  snapshot_hash:sha('{}'),intent_hash:sha('{}'),capability_id:'gac_x',credential_ref_id:'cr',
  credential_ref_version:1,account_fingerprint:FP,session_id_hash:sha('create-session'),...over});
const authRow=(over={})=>({id:'garr_x',tenant_id:7,operation_id:'gapo_x',requested_by:11,
  session_id_hash:sha(SESSION),workflow_id:'wf',status:'issued',credential_ref_id:'cr',
  credential_ref_version:1,account_fingerprint:FP,ledger_root_hash:authority.ledgerRoot(paused()),
  issued_at:new Date('2026-02-01T00:00:00Z'),expires_at:new Date('2026-02-01T00:05:00Z'),
  reserved_at:null,consumed_at:null,revoked_at:null,nonce_hash:sha('n'),...over});

// Answers only the queries this module is allowed to make. A kill-switch,
// user_integrations, capability or provider query is a test failure.
function mockPool(state={}) {
  const seen=[],audits=[];
  const client={release(){},query:async(sql,params=[])=>{
    const text=String(sql).replace(/\s+/g,' ').trim();seen.push(text);
    if(/^(BEGIN|COMMIT|ROLLBACK)/.test(text))return {rowCount:0,rows:[]};
    if(/^SELECT clock_timestamp/.test(text))return {rowCount:1,rows:[{now:new Date('2026-02-01T00:01:00Z')}]};
    if(/FROM orchestrator_google_ads_provider_draft_operations op/.test(text)) {
      const rows=state.operation===null?[]:[state.operation||operation()];
      return {rowCount:rows.length,rows};
    }
    if(/FROM orchestrator_google_ads_provider_draft_objects/.test(text)) {
      const rows=state.objects||paused();return {rowCount:rows.length,rows};
    }
    if(/^SELECT \* FROM orchestrator_google_ads_reconciliation_read_authorizations/.test(text)) {
      const rows=state.authorization===null?[]:[state.authorization||authRow()];
      return {rowCount:rows.length,rows};
    }
    if(/^INSERT INTO orchestrator_google_ads_reconciliation_read_authorizations/.test(text))return {rowCount:1,rows:[]};
    if(/^INSERT INTO orchestrator_audit_events/.test(text)) {
      audits.push(String(params[4]));return {rowCount:1,rows:[]};
    }
    throw new Error(`unexpected query: ${text}`);
  }};
  return {seen,audits,client,pool:{connect:async()=>client}};
}

test('reconciliation read authority reuses the read permission, not the create permission',()=>{
  assert.equal(authority.PERMISSION,'advertising.reconciliation.read');
  assert.notEqual(authority.PERMISSION,'advertising.provider_drafts.create');
  assert.equal(source.includes('advertising.provider_drafts.create'),false);
  assert.deepEqual(authority.KINDS,['campaign_budget','campaign','ad_group']);
  assert.equal(authority.MAX_TTL_MS,10*60*1000);
  // The ledger root is the three kinds in their fixed order.
  assert.equal(authority.ledgerRoot(paused()),
    sha(`campaign_budget:${sha('9001')}|campaign:${sha('9002')}|ad_group:${sha('9003')}`));
});

test('the module is read-only: no provider write surface, no route, no worker',()=>{
  assert.doesNotMatch(source,/googleAds:mutate|createPausedGoogleAdsDraft|mutateOperations/);
  assert.doesNotMatch(source,/google_ads_paused_draft'\)|advertising_provider_mutations/);
  assert.doesNotMatch(source,/\bapp\.(get|post|put|patch|delete)\b|express|router|setInterval|setTimeout|cron/i);
  assert.doesNotMatch(source,/'ENABLED'|"ENABLED"|meta_campaign_activation|activation_capabilities/);
  assert.doesNotMatch(source,/console\.|process\.stdout|JSON\.stringify\(handle|\bfetch\(|https?:\/\//);
  // Exactly one provider surface: the dedicated GET-only observer.
  assert.deepEqual(source.match(/require\('\.\.\/[^']*connectors\/[^']*'\)/g),
    ["require('../agent_orchestrator/connectors/google_ads_paused_draft_reconciliation_observer')"]);
  assert.equal((source.match(/observePausedGoogleAdsLedger\(/g)||[]).length,1);
  // The PR10B.2a scope is reused; no decrypt logic is duplicated here.
  assert.equal((source.match(/vault\.withGoogleAdsPausedDraftSecretScope\(/g)||[]).length,1);
  assert.doesNotMatch(source,/getCredentials\b|_decrypt\(|decryptString|createDecipheriv/);
  // Create-side kill switches must not strand reconciliation of existing objects.
  assert.doesNotMatch(source,/kill_switches?|kill_switch_key|switch_key/);
  // Not re-exported from the security barrel: there is no route or public surface.
  assert.equal(fs.readFileSync(require.resolve('../services/security/index'),'utf8')
    .includes('google_ads_paused_draft_reconciliation'),false);
});

test('non-human principals and missing read grants are refused before any database work',async()=>{
  for(const principalType of ['api_key','worker','service','service_account','automation','autonomous','agent']) {
    await assert.rejects(authority.issue(refuse,{...actor,principalType,operationId:'gapo_x'}),
      (e)=>e.code==='human_session_required'&&e.blocked===true);
    await assert.rejects(authority.consumeAndObserve({connect:never},{...actor,principalType,
      authorizationId:'garr_x',invocationId:'inv-1',tokenTransport:never}),(e)=>e.code==='human_session_required');
  }
  for(const over of [{actorType:'agent'},{sessionId:''},{sessionId:'bad session!'},{actorUserId:0}]) {
    await assert.rejects(authority.issue(refuse,{...actor,...over,operationId:'gapo_x'}),
      (e)=>e.code==='human_session_required',JSON.stringify(over));
  }
  for(const call of [authority.issue(refuse,{...actor,hasExplicitTenantPermission:()=>false,operationId:'gapo_x'}),
    authority.get(refuse,{...actor,hasExplicitTenantPermission:()=>false,authorizationId:'garr_x'}),
    authority.revoke(refuse,{...actor,hasExplicitTenantPermission:()=>false,authorizationId:'garr_x'}),
    // The create permission is not the read permission and grants nothing here.
    authority.issue(refuse,{...actor,operationId:'gapo_x',
      hasExplicitTenantPermission:(k)=>k==='advertising.provider_drafts.create'}),
    authority.consumeAndObserve({connect:never},{...actor,hasExplicitTenantPermission:()=>false,
      authorizationId:'garr_x',invocationId:'inv-1',tokenTransport:never})]) {
    await assert.rejects(call,(e)=>e.code==='permission_denied'&&e.external_action_taken===false);
  }
  await assert.rejects(authority.consumeAndObserve({connect:never},{...actor,authorizationId:'garr_x',
    invocationId:'inv-1'}),(e)=>e.code==='validation_failed');
});

test('a ledger that is not exactly three PAUSED, digest-proved objects is refused',async()=>{
  const op=operation();
  assert.equal(authority.validateLineage(paused(),op),authority.ledgerRoot(paused()));
  const bad=[paused().slice(0,2),[...paused(),paused()[0]],
    paused().map((r,i)=>i===2?{...r,provider_status:'ENABLED'}:r),
    paused().map((r,i)=>i===1?{...r,serving:true}:r),
    paused().map((r,i)=>i===0?{...r,published:true}:r),
    paused().map((r,i)=>i===0?{...r,activated:true}:r),
    paused().map((r,i)=>i===0?{...r,provider_object_id_digest:sha('other')}:r),
    paused().map((r,i)=>i===2?{...r,account_fingerprint:sha('other-account')}:r),
    paused().map((r,i)=>i===1?{...r,object_kind:'ad_group'}:r),
    [],null,'nope'];
  for(const rows of bad) {
    assert.throws(()=>authority.validateLineage(rows,op),
      (e)=>e.code==='invalid_ledger_lineage'&&e.blocked===true,JSON.stringify(rows));
  }
  // An operation with a two-object ledger cannot be authorized at all.
  const {pool}=mockPool({objects:paused().slice(0,2)});
  await assert.rejects(authority.issue(await pool.connect(),{...actor,operationId:'gapo_x'}),
    (e)=>e.code==='invalid_ledger_lineage');
});

test('issue copies its bindings from the operation row and proceeds under create kill switches',async()=>{
  const {pool,seen,audits}=mockPool();
  const issued=await authority.issue(await pool.connect(),{...actor,operationId:'gapo_x'});
  assert.equal(issued.status,'issued');
  assert.equal(issued.replay,false);
  assert.match(issued.authorization_id,/^garr_[0-9a-f-]{36}$/);
  assert.equal(Object.isFrozen(issued),true);
  // No kill-switch, capability, confirmation or user_integrations query ran: a
  // create freeze cannot strand reconciliation of objects that already exist.
  assert.equal(seen.some((q)=>/kill_switches|draft_capabilities|draft_confirmations|user_integrations/i.test(q)),false);
  assert.equal(audits.length,1);
  assert.deepEqual(Object.keys(JSON.parse(audits[0])).sort(),['authorization_id','operation_id','status']);
  // A caller may only agree with the operation row, never substitute for it.
  for(const over of [{credentialRefId:'other-cred'},{credentialRefVersion:2},{accountFingerprint:sha('other')},
    {draftId:'other'},{workflowId:'other'},{publishingRequestId:'other'},{intentId:'other'},
    {capabilityId:'other'},{snapshotHash:sha('other')},{ledgerRootHash:sha('other')}]) {
    await assert.rejects(authority.issue((await mockPool().pool.connect()),{...actor,operationId:'gapo_x',...over}),
      (e)=>e.code==='authorization_lineage_mismatch',JSON.stringify(over));
  }
  // Only the operation's own actor holds the credential, so only they may read.
  await assert.rejects(authority.issue(await mockPool({operation:operation({actor_user_id:99})}).pool.connect(),
    {...actor,operationId:'gapo_x'}),(e)=>e.code==='authorization_lineage_mismatch');
  await assert.rejects(authority.issue(await mockPool({operation:null}).pool.connect(),
    {...actor,operationId:'gapo_x'}),(e)=>e.code==='authorization_lineage_mismatch');
  for(const over of [{ttlMs:authority.MAX_TTL_MS+1},{ttlMs:-1},{ttlMs:1.5},{operationId:'../etc'},{tenantId:0}]) {
    await assert.rejects(authority.issue(await mockPool().pool.connect(),{...actor,operationId:'gapo_x',...over}),
      (e)=>e.code==='validation_failed',JSON.stringify(over));
  }
});

test('a consumed authorization replays metadata only: no secret scope, observer or network',async()=>{
  const consumed=authRow({status:'consumed',reserved_at:new Date('2026-02-01T00:01:00Z'),
    consumed_at:new Date('2026-02-01T00:01:00Z'),invocation_id_hash:sha('inv-1')});
  const {pool,seen}=mockPool({authorization:consumed});
  const out=await authority.consumeAndObserve(pool,{...actor,authorizationId:'garr_x',invocationId:'inv-1',
    tokenTransport:never,observerTransport:never});
  assert.equal(out.replay,true);
  assert.equal(out.status,'consumed');
  assert.equal(out.authorization_id,'garr_x');
  assert.equal(Object.isFrozen(out),true);
  // Nothing transitions, nothing is observed, and no credential is resolved.
  assert.equal(seen.some((q)=>/^UPDATE|user_integrations|googleapis/i.test(q)),false);
  assert.deepEqual(Object.keys(out).sort(),['authorization_id','consumed_at','expires_at','external_action_taken',
    'issued_at','operation_id','replay','reserved_at','revoked_at','status'].sort());
  // The projection carries no session, credential, account or object material.
  const serialized=JSON.stringify(out);
  for(const secret of [FP,sha(SESSION),'cr',consumed.ledger_root_hash,'9001']) {
    assert.equal(serialized.includes(secret),false,secret);
  }
  for(const status of ['reserved','revoked','expired']) {
    await assert.rejects(authority.consumeAndObserve(mockPool({authorization:authRow({status})}).pool,
      {...actor,authorizationId:'garr_x',invocationId:'inv-1',tokenTransport:never}),
    (e)=>e.code==='authorization_rejected',status);
  }
});

test('a drifted credential or ledger binding fails closed before the secret scope',async()=>{
  for(const over of [{credential_ref_id:'other-cred'},{credential_ref_version:2},
    {account_fingerprint:sha('other-account')},{ledger_root_hash:sha('other-ledger')}]) {
    const {pool,seen}=mockPool({authorization:authRow(over)});
    await assert.rejects(authority.consumeAndObserve(pool,{...actor,authorizationId:'garr_x',
      invocationId:'inv-1',tokenTransport:never,observerTransport:never}),
    (e)=>e.code==='authorization_lineage_mismatch'&&e.external_action_taken===false,JSON.stringify(over));
    // The token transport was never reached, so nothing was ever decrypted.
    assert.equal(seen.some((q)=>/user_integrations|credential_refs/i.test(q)),false);
  }
  // A wrong actor or a different human session cannot consume the grant.
  for(const over of [{actorUserId:99},{sessionId:'other-session'}]) {
    await assert.rejects(authority.consumeAndObserve(mockPool().pool,{...actor,...over,authorizationId:'garr_x',
      invocationId:'inv-1',tokenTransport:never}),(e)=>e.code==='authorization_rejected',JSON.stringify(over));
  }
  await assert.rejects(authority.consumeAndObserve(mockPool({authorization:null}).pool,{...actor,
    authorizationId:'garr_x',invocationId:'inv-1',tokenTransport:never}),(e)=>e.code==='authorization_rejected');
});

test('the consume commits before any secret scope opens, and the handle never escapes',()=>{
  const at=(needle)=>{const i=source.indexOf(needle);assert.ok(i>0,needle);return i;};
  assert.ok(at('const consumed=await consumeAtomic(pool,o);')
    <at('const out=await observeWithConsumedCredential(c,o);'));
  assert.ok(at("status='consumed',consumed_at=$3")<at('vault.withGoogleAdsPausedDraftSecretScope'));
  assert.ok(at('vault.withGoogleAdsPausedDraftSecretScope')<at('observer.observePausedGoogleAdsLedger'));
  // Only the four credential values the GET observer needs are copied out, and
  // the sealed handle itself is never returned, stored or serialized.
  assert.match(source,/credentials:\{accessToken:handle\.accessToken,developerToken:handle\.developerToken/);
  assert.doesNotMatch(source,/return handle|=\s*handle\s*;|handle\.toJSON/);
  // consumeAtomic commits blocked decisions and rolls back infrastructure errors.
  assert.match(source,/if\(error&&error\.blocked\)await c\.query\('COMMIT'\);else await c\.query\('ROLLBACK'\)/);
  // Only kind and provider object id cross into the observer.
  assert.match(source,/object_kind:x\.object_kind,\s*provider_object_id:String\(x\.provider_object_id\)/);
  // Every audit detail is exactly the three metadata fields.
  assert.equal((source.match(/JSON\.stringify\(/g)||[]).length,1);
  assert.match(source,/JSON\.stringify\(\{authorization_id:detail\.authorization_id,\s*operation_id:detail\.operation_id,status:detail\.status\}\)/);
});
