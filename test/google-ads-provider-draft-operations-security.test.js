'use strict';
require('./helpers/env'); // vault key must exist before the vault caches it
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');
const operations=require('../services/security/google_ads_provider_draft_operations');

const source=fs.readFileSync(require.resolve('../services/security/google_ads_provider_draft_operations'),'utf8');
const vaultSource=fs.readFileSync(require.resolve('../services/credentials/vault'),'utf8');
const helper=vaultSource.slice(
  vaultSource.indexOf('async function assertGoogleAdsProviderDraftCredentialRefMetadata'),
  vaultSource.indexOf('function _pageIdOf'));
const actor={tenantId:1,actorUserId:2,actorType:'human',principalType:'user',sessionId:'sid',
  hasExplicitTenantPermission:(key)=>key===operations.PERMISSION};
const refuse={query:async()=>{throw new Error('no database work expected');}};

test('operation ledger reuses the narrow explicit provider-draft permission',()=>{
  assert.equal(operations.PERMISSION,'advertising.provider_drafts.create');
  assert.deepEqual(Object.keys(operations.RESULT_CODES).sort(),['failed','succeeded','unknown']);
  assert.equal(operations.RESULT_CODES.succeeded,'provider_create_succeeded');
  assert.deepEqual(operations.OBJECT_SEQUENCE,['campaign_budget','campaign','ad_group']);
});

test('operation ledger has no provider SDK, network, secret resolution or mutation reachability',()=>{
  for(const [label,text] of [['operations',source],['vault helper',helper]]) {
    assert.ok(text.length>200,label);
    assert.doesNotMatch(text,/google-ads-api|googleapis|axios|\bfetch\s*\(|https?:\/\//i,label);
    assert.doesNotMatch(text,/\bgetCredentials\b|resolveGoogleAdsCredentials|decryptString|_decrypt\(/,label);
    assert.doesNotMatch(text,/access_token|refresh_token|developer_token|customer_id|customerId/i,label);
    assert.doesNotMatch(text,/provider_mutations|createCampaign|mutateCampaign|activateCampaign|enableCampaign/i,label);
  }
  assert.doesNotMatch(helper,/connectors?\//i);
  assert.doesNotMatch(helper,/user_integrations/);
  assert.match(helper,/FROM orchestrator_tenant_google_ads_credential_refs[\s\S]*FOR UPDATE/);
  assert.match(source,/published:false,activated:false,external_action_taken:x\.external_action_taken===true/);
  // PR10B.2b: the only reachable provider is the audited paused-draft connector,
  // it is required once, and it is invoked from exactly one call site.
  assert.deepEqual(source.match(/require\('\.\.\/[^']*connectors\/[^']*'\)/g),
    ["require('../agent_orchestrator/connectors/google_ads_paused_draft')"]);
  assert.equal((source.match(/createPausedGoogleAdsDraft\(/g)||[]).length,1);
  // The sealed vault handle is forwarded, never unpacked, so no secret or raw
  // account identifier is ever named, copied, logged or persisted here.
  assert.match(source,/credentials:handle/);
  assert.doesNotMatch(source,/accessToken|developerToken|refreshToken|loginCustomerId|clientSecret/i);
  assert.doesNotMatch(source,/console\.|process\.stdout|JSON\.stringify\(handle|log\(/);
});

test('the ledger keeps caller-owned transactions and only execute opens its own',()=>{
  const marker=source.indexOf('// ── PR10B.2b guarded execution');
  assert.ok(marker>0);
  const ledger=source.slice(0,marker),execution=source.slice(marker);
  // fund/settle/get still never issue BEGIN/COMMIT/ROLLBACK for their caller.
  assert.doesNotMatch(ledger,/'BEGIN'|'COMMIT'|'ROLLBACK'\)/);
  assert.match(ledger,/SAVEPOINT gapdo_fund/);
  // execute owns transactions in exactly one helper, because the provider call
  // sits between the funding commit and the settlement.
  for(const keyword of ['BEGIN','COMMIT','ROLLBACK']) {
    assert.equal((execution.match(new RegExp(`'${keyword}'`,'g'))||[]).length,1,keyword);
  }
  assert.match(execution,/async function withTx\(pool,fn\)/);
  // fund, settle and get each assert they are inside an open transaction.
  assert.equal((source.match(/await requireTx\(c\);/g)||[]).length,3);
  assert.match(source,/SAVEPOINT gapdo_tx_assert[\s\S]{0,120}RELEASE SAVEPOINT gapdo_tx_assert/);
});

test('the public projection is frozen and free of credential and account lineage',async()=>{
  const row={id:'gapo_x',status:'in_progress',result_code:null,capability_id:'gac_x',
    created_at:new Date('2026-01-01Z'),started_at:new Date('2026-01-01T00:00:01Z'),settled_at:null,
    account_fingerprint:'a'.repeat(64),credential_ref_id:'secret-ish',session_id_hash:'b'.repeat(64)};
  const out=await operations.get({query:async()=>({rowCount:1,rows:[row]})},{...actor,operationId:'gapo_x'});
  assert.deepEqual(Object.keys(out).sort(),['activated','created_at','external_action_taken','operation_id',
    'published','replay','result_code','settled_at','started_at','status'].sort());
  assert.equal(Object.isFrozen(out),true);
  assert.equal(out.external_action_taken,false);
  assert.equal(out.published,false);
  assert.equal(out.activated,false);
  const serialized=JSON.stringify(out);
  assert.equal(serialized.includes('credential'),false);
  assert.equal(serialized.includes('aaaa'),false);
  assert.equal(serialized.includes('bbbb'),false);
});

test('settlement admits only the matching result code and refuses unevidenced success',async()=>{
  const paused=(i)=>({object_kind:operations.OBJECT_SEQUENCE[i],provider_status:'PAUSED',
    sequence_number:i+1,provider_object_id:String(1000+i)});
  const proof={ok:true,result_code:'provider_create_succeeded',external_action_taken:true,
    published:false,activated:false,serving:false,requires_reconciliation:false,retry:false,
    objects_created:3,objects:[paused(0),paused(1),paused(2)],
    provider_operation_key:'k',idempotency_key:'i'};
  const attempts=[
    {status:'succeeded',resultCode:'provider_create_failed'},
    {status:'in_progress',resultCode:'ready_for_provider'},
    {status:'failed',resultCode:'provider_outcome_unknown'},
    {status:'unknown',resultCode:'provider_create_failed'},
    {status:'failed',resultCode:undefined},
    // Success without any provider evidence never reaches the database.
    {status:'succeeded',resultCode:'provider_create_succeeded'},
    ...[{ok:false},{serving:true},{published:true},{activated:true},{retry:true},
      {requires_reconciliation:true},{external_action_taken:false},
      {objects:[paused(0),paused(1),{...paused(2),provider_status:'ENABLED'}]},
      {objects:[paused(0),paused(1)],objects_created:2},
      {objects:[paused(1),paused(0),paused(2)]},
      {objects:[paused(0),paused(1),{...paused(2),provider_object_id:'not-numeric'}]},
    ].map((over)=>({status:'succeeded',resultCode:'provider_create_succeeded',
      providerResult:{...proof,...over}})),
  ];
  for(const attempt of attempts) {
    await assert.rejects(operations.settle(refuse,{...actor,operationId:'gapo_x',...attempt}),
      (error)=>error.code==='operation_rejected'&&error.blocked===true&&error.external_action_taken===false,
      JSON.stringify(attempt));
  }
  // The confirmed shape itself is accepted, so the rejections above are about
  // the missing/false evidence and not a permanently unreachable branch.
  assert.deepEqual(operations._confirmed(proof).map((x)=>x.kind),operations.OBJECT_SEQUENCE.slice());
});

test('only a DB-backed grant may claim success; failed and unknown cannot strand a row',()=>{
  // grant() runs for success only, and always before the status transition.
  const success=source.indexOf('if(success) {');
  const update=source.indexOf(`UPDATE ${''}\${TABLE} SET status=$3`);
  assert.ok(success>0&&update>success);
  assert.match(source,/await grant\(c,tenantId,actorId\);\s*\n\s*await record\(c,row,objects\);/);
  assert.match(source,/WHERE t\.id=\$1 AND t\.status='active' AND role\.permissions \? \$3 FOR UPDATE OF t,tu,role/);
  assert.match(source,/if\(r\.rowCount!==1\)throw deny\('permission_denied'\)/);
  // Evidence is written before the flip, and only for this operation's keys.
  assert.match(source,/INSERT INTO \$\{OBJECTS_TABLE\}/);
  assert.match(source,/providerResult\.provider_operation_key[\s\S]{0,160}row\.provider_operation_key/);
  assert.match(source,/row\.external_action_taken!==false\)throw deny\('operation_rejected'\)/);
});

test('non-human principals and missing grants are refused before any database work',async()=>{
  for(const principalType of ['api_key','worker','service','service_account','automation','autonomous','agent']) {
    await assert.rejects(operations.fund(refuse,{...actor,principalType,capabilityId:'gac_x',
      reservationId:'r',invocationId:'i',idempotencyKey:'k'}),(e)=>e.code==='human_session_required');
  }
  await assert.rejects(operations.fund(refuse,{...actor,hasExplicitTenantPermission:()=>false,
    capabilityId:'gac_x',reservationId:'r',invocationId:'i',idempotencyKey:'k'}),
  (e)=>e.code==='permission_denied');
  await assert.rejects(operations.get(refuse,{...actor,hasExplicitTenantPermission:()=>false,operationId:'gapo_x'}),
    (e)=>e.code==='permission_denied');
});

// ── PR10B.2b execute(): mocked Google client, no live default ───────────────
const crypto=require('crypto');
const sha=(v)=>crypto.createHash('sha256').update(String(v)).digest('hex');
const spend={capabilityId:'gac_x',reservationId:'r1',invocationId:'i1',idempotencyKey:'k1'};
const snapshot={name:'paused draft',budget:{amount_micros:1000000}};
const never=()=>{throw new Error('the provider must not be reached');};
function ledgerRow(over={}) {
  return {id:'gapo_x',tenant_id:1,status:'succeeded',result_code:'provider_create_succeeded',
    capability_id:spend.capabilityId,actor_user_id:2,requested_by:2,session_id_hash:sha(actor.sessionId),
    reservation_id_hash:sha(spend.reservationId),invocation_id_hash:sha(spend.invocationId),
    idempotency_key:spend.idempotencyKey,provider_operation_key:sha('op'),external_action_taken:true,
    created_at:new Date('2026-01-01Z'),started_at:new Date('2026-01-01Z'),settled_at:new Date('2026-01-01Z'),...over};
}
// Answers only transaction control and the replay lookup. Any capability,
// vault, user_integrations or settlement query is a test failure.
function replayPool(rows) {
  const seen=[];
  const client={release(){},query:async(sql)=>{
    const text=String(sql).replace(/\s+/g,' ').trim();seen.push(text);
    if(/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE SAVEPOINT)/.test(text))return {rowCount:0,rows:[]};
    if(text==='SELECT * FROM orchestrator_google_ads_provider_draft_operations '
      +'WHERE tenant_id=$1 AND idempotency_key=$2 FOR UPDATE')return {rowCount:rows.length,rows};
    throw new Error(`unexpected query: ${text}`);
  }};
  return {seen,pool:{connect:async()=>client}};
}
const request=(over={})=>({...actor,...spend,snapshot,tokenTransport:never,providerTransport:never,...over});

test('a duplicate request replays stored metadata without authority, secrets or a provider call',async()=>{
  for(const [status,resultCode] of [['succeeded','provider_create_succeeded'],['failed','provider_create_failed'],
    ['unknown','provider_outcome_unknown'],['in_progress',null]]) {
    const {pool,seen}=replayPool([ledgerRow({status,result_code:resultCode,
      external_action_taken:status==='succeeded'})]);
    const out=await operations.execute(pool,request());
    assert.equal(out.status,status,status);
    assert.equal(out.replay,true);
    assert.equal(out.operation_id,'gapo_x');
    assert.equal(out.published,false);
    assert.equal(out.activated,false);
    assert.equal(out.requires_reconciliation,status==='unknown');
    assert.equal(out.external_action_taken,status==='succeeded');
    assert.equal(Object.isFrozen(out),true);
    assert.equal(JSON.stringify(out).includes('credential'),false);
    // No capability reacquisition, no secret decryption, no token exchange and
    // no connector call: only the replay lookup ran.
    assert.deepEqual(seen.filter((q)=>!/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)/.test(q)).length,1);
    assert.equal(seen.some((q)=>/capabilit|user_integrations|credential_refs|^UPDATE|^INSERT/i.test(q)),false);
  }
});

test('a replay whose lineage does not match the stored row is a conflict, not a second call',async()=>{
  for(const over of [{sessionId:'other'},{actorUserId:99},{invocationId:'other'},{reservationId:'other'},
    {capabilityId:'gac_other'}]) {
    const {pool}=replayPool([ledgerRow({status:'in_progress',result_code:null,external_action_taken:false})]);
    await assert.rejects(operations.execute(pool,request(over)),
      (e)=>['operation_conflict','human_session_required'].includes(e.code)&&e.external_action_taken===false,
      JSON.stringify(over));
  }
});

test('live Google stays opt-in and off by default, and callers cannot widen the deadline',async()=>{
  const dead={connect:()=>{throw new Error('no database work expected');}};
  delete process.env[require('../services/agent_orchestrator/connectors/google_ads_paused_draft').LIVE_OPT_IN_ENV];
  await assert.rejects(operations.execute(dead,request({providerTransport:undefined})),
    (e)=>e.code==='live_google_ads_disabled'&&e.external_action_taken===false);
  await assert.rejects(operations.execute(dead,request({providerTransport:undefined,allowLive:true})),
    (e)=>e.code==='live_google_ads_disabled');
  for(const over of [{tokenTransport:undefined},{tokenTransport:'nope'},{providerTransport:'nope'},
    {providerTimeoutMs:operations.PROVIDER_DEADLINE_MS+1},{providerTimeoutMs:0},{idempotencyKey:'bad key!'},
    {capabilityId:'../etc'},{tenantId:0}]) {
    await assert.rejects(operations.execute(dead,request(over)),(e)=>e.code==='operation_rejected',
      JSON.stringify(over));
  }
  for(const principalType of ['api_key','worker','service','service_account','automation','autonomous','agent']) {
    await assert.rejects(operations.execute(dead,request({principalType})),(e)=>e.code==='human_session_required');
  }
  await assert.rejects(operations.execute(dead,request({hasExplicitTenantPermission:()=>false})),
    (e)=>e.code==='permission_denied');
  await assert.rejects(operations.execute({},request()),(e)=>e.code==='operation_rejected');
});

test('serving-shaped draft input is refused before any database work',async()=>{
  const dead={connect:()=>{throw new Error('no database work expected');}};
  for(const bad of [{...snapshot,status:'ENABLED'},{...snapshot,serving:true},{...snapshot,'Serving-Status':'SERVING'},
    {...snapshot,activate:true},{...snapshot,publish:true},{...snapshot,schedule:{start:'now'}},
    {...snapshot,budget:{amount_micros:1000,budget_increase:5}},{...snapshot,campaign:{campaignStatus:'ENABLED'}},
    {...snapshot,launch:1},{...snapshot,optimize:true}]) {
    await assert.rejects(operations.execute(dead,request({snapshot:bad})),
      (e)=>e.code==='serving_request_rejected'&&e.external_action_taken===false,JSON.stringify(bad));
  }
  for(const bad of [undefined,null,'x',[],{},{name:'x'},{name:'',budget:{amount_micros:1}},
    {name:'x',budget:{amount_micros:0}},{name:'x',budget:{amount_micros:-5}},
    {name:'x'.repeat(121),budget:{amount_micros:5}},{name:'x',budget:{amount_micros:5,currency:'EUR'}}]) {
    await assert.rejects(operations.execute(dead,request({snapshot:bad})),(e)=>e.code==='operation_rejected',
      JSON.stringify(bad));
  }
  // Only the two named fields survive; anything else the caller attached is
  // dropped rather than forwarded to the provider.
  const bound=operations._pausedSnapshot({name:' draft ',budget:{amount_micros:250000,currency:'USD'},extra:'x'});
  assert.deepEqual(bound,{name:'draft',budget:{amount_micros:250000,currency:'USD'}});
  assert.equal(Object.isFrozen(bound),true);
  assert.equal(Object.isFrozen(bound.budget),true);
});

test('the provider call is fenced by a full reauthorization in the same transaction',()=>{
  const execution=source.slice(source.indexOf('// ── PR10B.2b guarded execution'));
  const at=(needle)=>{const i=execution.indexOf(needle);assert.ok(i>0,needle);return i;};
  // Claim the funded row, re-prove authority, only then decrypt, call, settle.
  assert.ok(at('const row=await claim(')<at('const fresh=await reauthorize(c,o,actorId,row);'));
  assert.ok(at('const fresh=await reauthorize(c,o,actorId,row);')<at('vault.withGoogleAdsPausedDraftSecretScope'));
  assert.ok(at('vault.withGoogleAdsPausedDraftSecretScope')<at('connector.createPausedGoogleAdsDraft'));
  assert.ok(at('connector.createPausedGoogleAdsDraft')<at('await settle(c,{...o,operationId:row.id'));
  // Reauthorization re-reads the consumed capability and its TTL, the PR10A
  // authoritative binding (tenant, actor, draft revision, approval and its
  // expiry, intent, credential ref/version, fingerprint, active membership and
  // both kill switches), the live DB grant, and the credential reference.
  assert.match(execution,/status='consumed' AND actor_user_id=\$3 FOR UPDATE/);
  assert.match(execution,/await capability\._authoritative\(c,row\.tenant_id/);
  assert.match(execution,/await grant\(c,row\.tenant_id,actorId\)/);
  assert.match(execution,/await vault\.assertGoogleAdsProviderDraftCredentialRefMetadata\(c,\{tenantId:row\.tenant_id/);
  assert.match(execution,/new Date\(cap\.expires_at\)>now/);
  assert.match(execution,/new Date\(fresh\.approval_expires_at\)>now/);
  // The single request is labelled with the ledger's own stable keys.
  assert.match(execution,/provider_operation_key:row\.provider_operation_key,idempotency_key:row\.idempotency_key/);
});

test('the provider payload is the approved snapshot, never the caller draft',()=>{
  const execution=source.slice(source.indexOf('// ── PR10B.2b guarded execution'));
  // reauthorize hands back the row whose snapshot_json it just proved hashes to
  // the approved snapshot_hash, and that is what the connector is given.
  assert.match(source,/const fresh=await capability\._authoritative\(/);
  assert.match(source,/same\(String\(fresh\.snapshot_hash\),String\(row\.snapshot_hash\)\)/);
  assert.match(source,/\n {2}return fresh;\n\}/);
  assert.match(execution,/const approved=pausedSnapshot\(fresh\.snapshot_json\);/);
  assert.match(execution,/credentials:handle,snapshot:approved/);
  assert.ok(execution.indexOf('const approved=pausedSnapshot(fresh.snapshot_json);')
    <execution.indexOf('connector.createPausedGoogleAdsDraft'));
  // The caller's draft is validated for shape and then dropped; it is never
  // forwarded, stored in a variable the connector call can read, or sent.
  assert.match(execution,/\n {2}pausedSnapshot\(o\.snapshot\);/);
  assert.doesNotMatch(execution,/=\s*pausedSnapshot\(o\.snapshot\)/);
  assert.doesNotMatch(execution,/snapshot:o\.snapshot|snapshot:snapshot\b/);
});

test('only a confirmed paused creation classifies as success; ambiguity is unknown, never retry',()=>{
  const ok={ok:true,result_code:'provider_create_succeeded',requires_reconciliation:false,retry:false};
  assert.equal(operations._classify(ok),'succeeded');
  assert.equal(operations._classify({...ok,ok:false}),'failed');
  assert.equal(operations._classify({...ok,result_code:'provider_create_failed',ok:false}),'failed');
  assert.equal(operations._classify({ok:false,result_code:'provider_outcome_unknown'}),'unknown');
  assert.equal(operations._classify({ok:false,result_code:'provider_create_failed',requires_reconciliation:true}),'unknown');
  assert.equal(operations._classify({ok:false,result_code:'provider_create_failed',retry:true}),'unknown');
  assert.equal(operations._classify(null),'unknown');
  assert.equal(operations._classify(undefined),'unknown');
});

test('settlement refuses to run outside an open transaction',async()=>{
  const autocommit={query:async(sql)=>{
    if(/^SAVEPOINT/.test(String(sql)))throw Object.assign(new Error('no transaction'),{code:'25P01'});
    throw new Error('settlement must stop at the transaction assertion');
  }};
  for(const call of [operations.settle(autocommit,{...actor,operationId:'gapo_x',status:'failed',
    resultCode:'provider_create_failed'}),operations.fund(autocommit,{...actor,...spend}),
  operations.get(autocommit,{...actor,operationId:'gapo_x'})]) {
    await assert.rejects(call,(e)=>e.code==='transaction_required'&&e.external_action_taken===false);
  }
});

test('funding validates identifiers and the capability spend before the ledger insert',()=>{
  assert.match(source,/const reserved=await capability\.reserve\(c,o\);/);
  assert.match(source,/const consumed=await capability\.consume\(c,o\);/);
  assert.match(source,/status='consumed'[\s\S]*FOR UPDATE/);
  assert.match(source,/await vault\.assertGoogleAdsProviderDraftCredentialRefMetadata\(c,\{tenantId,ownerUserId:actorId/);
  // The ledger row is funded inside the caller's transaction; a savepoint keeps
  // a duplicate-key race recoverable without committing or aborting it.
  assert.doesNotMatch(source.slice(0,source.indexOf('// ── PR10B.2b guarded execution')),
    /'BEGIN'|'COMMIT'|'ROLLBACK'\)/);
  assert.match(source,/SAVEPOINT gapdo_fund/);
  assert.match(source,/error\?\.code!=='23505'\)throw error/);
  assert.match(source,/VALUES\(\$1,\$2,'pending'/);
});
