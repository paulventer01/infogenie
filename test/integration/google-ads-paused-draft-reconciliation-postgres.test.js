'use strict';
// PR10C.1 — the consume-once reconciliation READ authority against real
// PostgreSQL with a mocked Google client. Both the OAuth token transport and the
// GAQL Search observer transport is injected, so nothing here reaches Google and no
// object is created, enabled, published or activated.
const test=require('node:test');const assert=require('node:assert/strict');const crypto=require('crypto');
const db=require('../../db');
const schema=require('../../services/agent_orchestrator/schema');
const authority=require('../../services/security/google_ads_paused_draft_reconciliation');
const coordinator=require('../../services/agent_orchestrator/google_ads_paused_draft_reconciliation');
const {makeFixtures}=require('../helpers');
const CUSTOMER='1234567890';
const REFRESH='refresh-token-must-never-escape';const CLIENT_SECRET='client-secret-must-never-escape';
const DEV='dev-token-must-never-escape';const ACCESS='access-token-must-never-escape';
const sha=(v)=>crypto.createHash('sha256').update(String(v)).digest('hex');
const FP=sha(CUSTOMER);const H=sha('{}');
const permit=(key)=>key===authority.PERMISSION;
const denied=(...codes)=>(e)=>e&&codes.includes(e.code)&&e.external_action_taken===false;
const OBJECTS={campaign_budget:'7710001',campaign:'7710002',ad_group:'7710003'};
async function replica(sql,params=[]) {
  const client=await db.getPool().connect();
  try {
    await client.query("SET session_replication_role='replica'");
    if(sql.split(';').filter((part)=>part.trim()).length>1&&params.length) {
      const literal=(v)=>(typeof v==='number'?String(v):`'${String(v).replaceAll("'","''")}'`);
      return await client.query(sql.replace(/\$(\d+)/g,(_m,i)=>literal(params[Number(i)-1])));
    }
    return await client.query(sql,params);
  } finally { await client.query("SET session_replication_role='origin'");client.release(); }
}
async function tx(fn) {
  const client=await db.getPool().connect();
  try { await client.query('BEGIN');const out=await fn(client);await client.query('COMMIT');return out; }
  catch(error) { await client.query('ROLLBACK');throw error; }
  finally { client.release(); }
}
if (!db.hasDb()) {
  test('PR10C.1 PostgreSQL reconciliation read authority requires DATABASE_URL',{skip:'no DATABASE_URL'},()=>{});
} else test('Google Ads reconciliation reads are tenant-bound, consume-once, read-only and leak no secret',async(t)=>{
  const fx=makeFixtures();
  await fx.ensureSchemas();
  await schema.ensureAgentOrchestratorSchema();
  const tenant=await fx.seedTenant(),other=await fx.seedTenant();
  const user=await fx.seedUser({tenantId:tenant.id,owner:false});
  const otherUser=await fx.seedUser({tenantId:tenant.id,owner:false});
  const tag=crypto.randomUUID(),id=(kind)=>`${kind}-${tag}`;
  const wa=500000000+parseInt(tag.slice(0,7),16);
  const ids={workflow:id('wf'),draft:id('dr'),approval:id('ap'),request:id('rq'),intent:id('in'),
    cred:id('cr'),cap:id('cp'),op:id('op')};
  t.after(async()=>replica(['orchestrator_audit_events',coordinator.TABLE,authority.TABLE,
    'orchestrator_google_ads_provider_draft_objects','orchestrator_google_ads_provider_draft_operations',
    'orchestrator_google_ads_provider_draft_capabilities','orchestrator_campaign_delivery_intents',
    'orchestrator_campaign_publish_requests','orchestrator_campaign_publish_approvals',
    'orchestrator_campaign_draft_revisions','orchestrator_campaign_drafts',
    'orchestrator_tenant_google_ads_credential_refs','orchestrator_approvals','orchestrator_workflows']
    .map((table)=>`DELETE FROM ${table} WHERE tenant_id IN ($1,$2);`).join('')+`
    DELETE FROM user_integrations WHERE user_id IN ($3,$4);
    DELETE FROM tenant_users WHERE tenant_id IN ($1,$2);
    DELETE FROM roles WHERE tenant_id IN ($1,$2);
    DELETE FROM users WHERE id IN ($3,$4);
    DELETE FROM tenants WHERE id IN ($1,$2)`,[tenant.id,other.id,user.id,otherUser.id]));
  // The role carries the reconciliation READ grant only — never the create grant.
  await replica(`
    INSERT INTO roles(tenant_id,key,name,permissions)
      VALUES($2,$16,'PR10C.1 reconciliation','["advertising.reconciliation.read"]'::jsonb);
    UPDATE tenant_users SET role_id=(SELECT id FROM roles WHERE tenant_id=$2 AND key=$16)
      WHERE tenant_id=$2 AND user_id IN ($3,$17);
    INSERT INTO orchestrator_workflows(id,tenant_id,name) VALUES($1,$2,'PR10C.1 fixture');
    INSERT INTO orchestrator_approvals(id,tenant_id,workflow_id,gate,content_hash,decision,actor_user_id)
      VALUES(${wa},$2,$1,'campaign_publishing',$5,'approved',$3);
    INSERT INTO orchestrator_campaign_drafts
      (id,tenant_id,workflow_id,status,current_revision,contract_hash,idempotency_key)
      VALUES($4,$2,$1,'approved_for_publish',1,$5,$6);
    INSERT INTO orchestrator_campaign_draft_revisions
      (id,tenant_id,draft_id,revision,contract_json,contract_hash,validation_status)
      VALUES($7,$2,$4,1,'{}',$5,'passed');
    INSERT INTO orchestrator_campaign_publish_approvals
      (id,tenant_id,draft_id,revision,contract_hash,snapshot_json,workflow_approval_id,actor_user_id,idempotency_key,expires_at)
      VALUES($8,$2,$4,1,$5,'{}',${wa},$3,$9,now()+interval '1 hour');
    INSERT INTO orchestrator_campaign_publish_requests
      (id,tenant_id,draft_id,publish_approval_id,workflow_approval_id,revision,contract_hash,snapshot_hash,requested_by,idempotency_key,request_hash)
      VALUES($10,$2,$4,$8,${wa},1,$5,$5,$3,$11,$5);
    INSERT INTO orchestrator_campaign_delivery_intents
      (id,tenant_id,publishing_request_id,draft_id,publish_approval_id,workflow_approval_id,outbox_id,revision,contract_hash,snapshot_hash,intent_hash,idempotency_key,requested_by)
      VALUES($12,$2,$10,$4,$8,${wa},$13,1,$5,$5,$5,$14,$3);
    INSERT INTO orchestrator_tenant_google_ads_credential_refs
      (tenant_id,id,account_fingerprint,version,owner_user_id) VALUES($2,$15,$18,1,$3);
    INSERT INTO orchestrator_google_ads_provider_draft_capabilities(
      tenant_id,id,actor_user_id,session_id_hash,workflow_id,draft_id,draft_revision,contract_hash,
      publishing_request_id,publish_approval_id,workflow_approval_id,snapshot_hash,intent_id,intent_hash,
      credential_ref_id,credential_ref_version,account_fingerprint,final_confirmation_id,final_confirmation_hash,
      confirmed_at,issued_at,expires_at,audit_ref)
      VALUES($2,$19,$3,$20,$1,$4,1,$5,$10,$8,${wa},$5,$12,$5,$15,1,$18,$21,$22,now(),now(),now()+interval '5 minutes',$23);
    INSERT INTO orchestrator_google_ads_provider_draft_operations(
      tenant_id,id,status,actor_user_id,session_id_hash,workflow_id,draft_id,draft_revision,contract_hash,
      publishing_request_id,publish_approval_id,workflow_approval_id,snapshot_hash,intent_id,intent_hash,
      capability_id,credential_ref_id,credential_ref_version,account_fingerprint,reservation_id_hash,
      invocation_id_hash,idempotency_key,provider_operation_key,requested_by,created_at,started_at,settled_at,
      result_code,external_action_taken,audit_ref)
      VALUES($2,$24,'succeeded',$3,$20,$1,$4,1,$5,$10,$8,${wa},$5,$12,$5,$19,$15,1,$18,$25,$26,$27,$28,$3,
        now(),now(),now(),'provider_create_succeeded',TRUE,$29)`,
  [ids.workflow,tenant.id,user.id,ids.draft,H,id('dk'),id('rv'),ids.approval,id('ak'),ids.request,id('rk'),
    ids.intent,id('ob'),id('ik'),ids.cred,id('role'),otherUser.id,FP,ids.cap,sha(id('create-session')),
    id('cf'),sha(id('cf')),id('ca'),ids.op,sha(id('r')),sha(id('i')),id('k'),sha(id('opk')),id('oa')]);
  for(const [kind,sequence] of [['campaign_budget',1],['campaign',2],['ad_group',3]]) {
    await replica(`INSERT INTO orchestrator_google_ads_provider_draft_objects
      (tenant_id,id,operation_id,capability_id,account_fingerprint,object_kind,sequence_number,
       provider_object_id,provider_object_id_digest,provider_status,result_code,recorded_at,audit_ref)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'PAUSED','provider_create_succeeded',now(),$2)`,
    [tenant.id,id(`obj-${kind}`),ids.op,ids.cap,FP,kind,sequence,OBJECTS[kind],sha(OBJECTS[kind])]);
  }
  const vault=require('../../services/credentials/vault');
  const blob=vault.encryptString(JSON.stringify({customerId:CUSTOMER,refreshToken:REFRESH,
    clientId:'client-id',clientSecret:CLIENT_SECRET,devToken:DEV}));
  await db.getPool().query(`INSERT INTO user_integrations
    (user_id,platform,ciphertext,iv,tag,status,credential_version) VALUES($1,'google_ads',$2,$3,$4,'connected',1)`,
  [user.id,blob.ciphertext,blob.iv,blob.tag]);
  // ── mocked OAuth token and read-only GAQL Search transports ───────────
  const exchanges=[],observed=[];
  const tokenTransport=async(request)=>{exchanges.push(request);return {access_token:ACCESS,expires_in:600};};
  const observerTransport=async(request)=>{
    observed.push(request);
    const query=JSON.parse(request.body).query;
    const found=/ FROM (campaign_budget|campaign|ad_group) WHERE .*resource_name = 'customers\/(\d+)\/(campaignBudgets|campaigns|adGroups)\/(\d+)' LIMIT 1$/.exec(query);
    assert.ok(found,'caller-independent ledger-bound GAQL');
    const [,kind,customer,collection,objectId]=found;
    assert.equal(objectId,OBJECTS[kind]);
    const resource={status:'PAUSED',resourceName:`customers/${customer}/${collection}/${objectId}`};
    if(kind==='campaign')resource.campaignBudget=`customers/${customer}/campaignBudgets/${OBJECTS.campaign_budget}`;
    if(kind==='ad_group')resource.campaign=`customers/${customer}/campaigns/${OBJECTS.campaign}`;
    const resultKey={campaign_budget:'campaignBudget',campaign:'campaign',ad_group:'adGroup'}[kind];
    return {status:200,json:{results:[{[resultKey]:resource}]}}; };
  const base={tenantId:tenant.id,actorUserId:user.id,actorType:'human',principalType:'user',
    sessionId:id('read-session'),hasExplicitTenantPermission:permit};
  const setGrant=(json)=>replica('UPDATE roles SET permissions=$3::jsonb WHERE tenant_id=$1 AND key=$2',[tenant.id,id('role'),json]);
  const kill=(scope,active,seconds)=>db.getPool().query(scope==='tenant'
    ? `UPDATE orchestrator_advertising_tenant_kill_switches SET active=$1,version=version+1,
        updated_at=now()+interval '${seconds} seconds' WHERE tenant_id=$2 AND switch_key='google_ads_provider_draft'`
    : `UPDATE orchestrator_advertising_global_kill_switches SET active=$1,version=version+1,
        updated_at=now()+interval '${seconds} seconds' WHERE switch_key='google_ads_provider_draft'`,
  scope==='tenant'?[active,tenant.id]:[active]);
  const issue=(over={})=>tx((c)=>authority.issue(c,{...base,operationId:ids.op,...over}));
  const statusOf=async(aid)=>(await db.getPool().query(`SELECT * FROM ${authority.TABLE} WHERE tenant_id=$1 AND id=$2`,[tenant.id,aid])).rows[0];
  // ── 1. authority denials on issue: grant, membership, tenant, actor ────────
  await assert.rejects(issue({hasExplicitTenantPermission:()=>false}),denied('permission_denied'));
  await setGrant('["advertising.provider_drafts.create"]');
  await assert.rejects(issue(),denied('authorization_lineage_mismatch'),'the create grant is not a read grant');
  await setGrant('["advertising.reconciliation.read"]');
  await replica("UPDATE tenant_users SET status='suspended' WHERE tenant_id=$1 AND user_id=$2",[tenant.id,user.id]);
  await assert.rejects(issue(),denied('authorization_lineage_mismatch'),'inactive membership');
  await replica("UPDATE tenant_users SET status='active' WHERE tenant_id=$1 AND user_id=$2",[tenant.id,user.id]);
  await assert.rejects(issue({tenantId:other.id}),denied('authorization_lineage_mismatch'),'cross-tenant');
  await assert.rejects(issue({actorUserId:otherUser.id}),denied('authorization_lineage_mismatch'),'wrong actor');
  assert.equal((await db.getPool().query(`SELECT count(*)::int AS c FROM ${authority.TABLE} WHERE tenant_id=$1`,[tenant.id])).rows[0].c,0);
  // ── 2. a create freeze must not strand reconciliation of existing objects ──
  await kill('tenant',true,1);await kill('global',true,1);
  let issued;
  try { issued=await issue(); } finally { await kill('tenant',false,2);await kill('global',false,2); }
  assert.deepEqual([issued.status,issued.replay,issued.external_action_taken],['issued',false,false]);
  assert.match(issued.authorization_id,/^garr_/);
  // Every stored binding is copied from the operation row, not from the caller.
  const stored=await statusOf(issued.authorization_id);
  assert.deepEqual([stored.operation_id,stored.capability_id,stored.credential_ref_id,stored.account_fingerprint,
    stored.workflow_id,stored.draft_id,stored.intent_id,stored.status,stored.session_id_hash,stored.expected_object_kinds],
  [ids.op,ids.cap,ids.cred,FP,ids.workflow,ids.draft,ids.intent,'issued',sha(base.sessionId),authority.KINDS.slice()]);
  // ── 3. one authorization per operation ledger ──────────────────────────────
  await assert.rejects(issue(),denied('authorization_conflict'));
  // ── 4. a wrong actor, session or tenant cannot consume the grant ───────────
  const run=(over={})=>authority.consumeAndObserve(db.getPool(),{...base,authorizationId:issued.authorization_id,
    invocationId:id('inv-1'),tokenTransport,observerTransport,...over});
  await assert.rejects(run({actorUserId:otherUser.id}),denied('authorization_rejected'));
  await assert.rejects(run({sessionId:id('other-session')}),denied('authorization_rejected'));
  await assert.rejects(run({tenantId:other.id}),denied('authorization_rejected'));
  await assert.rejects(run({principalType:'worker'}),denied('human_session_required'));
  await assert.rejects(run({tokenTransport:undefined}),denied('validation_failed'));
  assert.deepEqual([exchanges.length,observed.length],[0,0],'no token exchange, no observation');
  assert.equal((await statusOf(issued.authorization_id)).status,'issued');
  await setGrant('[]');
  await assert.rejects(tx((c)=>authority.revoke(c,{...base,authorizationId:issued.authorization_id})),
    denied('authorization_lineage_mismatch'),'revocation re-proves the live DB grant');
  assert.equal((await statusOf(issued.authorization_id)).status,'issued');
  await setGrant('["advertising.reconciliation.read"]');
  // ── 5. consume once, then observe the existing PAUSED objects with GAQL Search ─────
  const result=await run();
  assert.deepEqual([result.replay,result.status,result.serving,result.external_action_taken,
    result.attempted_observations,result.completed_observations,Object.isFrozen(result)],
  [false,'consumed',false,false,3,3,true]);
  assert.deepEqual(result.observations.map((o)=>o.object_kind),['campaign_budget','campaign','ad_group']);
  for(const o of result.observations) assert.deepEqual([o.outcome,o.status_classification,o.account_binding_matches],['observed','paused',true]);
  assert.deepEqual([result.observations[1].budget_parent_matches,result.observations[2].campaign_parent_matches,
    exchanges.length,observed.length],[true,true,1,3],'one token exchange and exactly three Search reads');
  for(const request of observed) {
    assert.equal(request.method,'POST');
    assert.match(request.url,/^https:\/\/googleads\.googleapis\.com\/v17\/customers\/\d{10}\/googleAds:search$/);
    assert.doesNotMatch(request.url,/mutate/i);
    assert.match(JSON.parse(request.body).query,/^SELECT .* FROM .* WHERE .*resource_name = 'customers\/.*' LIMIT 1$/);
  }
  const consumed=await statusOf(issued.authorization_id);
  assert.deepEqual([consumed.status,consumed.invocation_id_hash],['consumed',sha(id('inv-1'))]);
  assert.ok(consumed.reserved_at&&consumed.consumed_at);
  // ── 6. replay re-proves DB authority, then returns metadata without provider work ──
  await setGrant('[]');
  await assert.rejects(run(),denied('authorization_lineage_mismatch'),'replay refuses a revoked DB grant');
  assert.deepEqual([exchanges.length,observed.length],[1,3]);
  await setGrant('["advertising.reconciliation.read"]');
  const replayed=await run();
  assert.deepEqual([replayed.replay,replayed.status,replayed.observations],[true,'consumed',undefined]);
  assert.deepEqual([exchanges.length,observed.length],[1,3],'a replay observes nothing');
  const fetched=await tx((c)=>authority.get(c,{...base,authorizationId:issued.authorization_id}));
  assert.deepEqual([fetched.replay,fetched.status],[true,'consumed']);
  await assert.rejects(tx((c)=>authority.revoke(c,{...base,authorizationId:issued.authorization_id})),
    denied('authorization_rejected'),'a consumed authorization cannot be revoked');
  assert.deepEqual([exchanges.length,observed.length],[1,3]);
  // ── 7. nothing changed on the provider side, and no secret was recorded ────
  const objects=await db.getPool().query(`SELECT provider_status,serving,published,activated
    FROM orchestrator_google_ads_provider_draft_objects WHERE tenant_id=$1`,[tenant.id]);
  assert.equal(objects.rowCount,3);
  for(const row of objects.rows) assert.deepEqual([row.provider_status,row.serving,row.published,row.activated],['PAUSED',false,false,false]);
  const events=await db.getPool().query(`SELECT event,detail::text FROM orchestrator_audit_events WHERE tenant_id=$1`,[tenant.id]);
  const ledger=await db.getPool().query(`SELECT to_jsonb(a)::text AS row FROM ${authority.TABLE} a WHERE tenant_id=$1`,[tenant.id]);
  assert.ok(events.rows.some((r)=>r.event==='google_ads_reconciliation_read_authorization_consumed'));
  for(const row of events.rows) assert.deepEqual(Object.keys(JSON.parse(row.detail)).sort(),['authorization_id','operation_id','status']);
  for(const text of [...events.rows.map((r)=>r.detail),...ledger.rows.map((r)=>r.row),JSON.stringify(result)]) {
    for(const secret of [REFRESH,CLIENT_SECRET,DEV,ACCESS,CUSTOMER,base.sessionId]) {
      assert.equal(text.includes(secret),false,'no credential or session material is recorded or returned');
    }
  }

  // ── 8. PR10C.2 durable coordinator uses the real schema and authority ────
  await replica(`DELETE FROM ${authority.TABLE} WHERE tenant_id=$1`,[tenant.id]);
  issued=await issue();
  const durableArgs={...base,authorizationId:issued.authorization_id,invocationId:id('durable-1'),
    tokenTransport,observerTransport};
  const beforeTraffic=[exchanges.length,observed.length];
  const durable=await coordinator.reconcile(db.getPool(),durableArgs);
  assert.deepEqual([durable.state,durable.object_kinds,durable.external_action_taken],
    ['verified',authority.KINDS,false]);
  const durableRow=(await db.getPool().query(`SELECT * FROM ${coordinator.TABLE} WHERE tenant_id=$1 AND id=$2`,
    [tenant.id,durable.reconciliation_run_id])).rows[0];
  assert.deepEqual([durableRow.authorization_id,durableRow.operation_id,durableRow.state,
    durableRow.observations.length,durableRow.classifications],
  [issued.authorization_id,ids.op,'verified',3,[]]);
  assert.ok((await db.getPool().query(`SELECT count(*)::int c FROM orchestrator_audit_events
    WHERE tenant_id=$1 AND detail->>'reconciliation_run_id'=$2`,[tenant.id,durable.reconciliation_run_id])).rows[0].c>=2);

  // Replay is metadata-only and re-proves current DB authority first.
  await setGrant('[]');
  await assert.rejects(coordinator.reconcile(db.getPool(),durableArgs),denied('authorization_lineage_mismatch'));
  assert.deepEqual([exchanges.length,observed.length],[beforeTraffic[0]+1,beforeTraffic[1]+3]);
  await setGrant('["advertising.reconciliation.read"]');
  assert.equal((await coordinator.reconcile(db.getPool(),durableArgs)).reconciliation_run_id,durable.reconciliation_run_id);
  await assert.rejects(coordinator.reconcile(db.getPool(),{...durableArgs,tenantId:other.id}),
    denied('authorization_rejected','reconciliation_not_found'));
  assert.deepEqual([exchanges.length,observed.length],[beforeTraffic[0]+1,beforeTraffic[1]+3]);

  // A real expired decision commits its own audit without creating a run.
  await replica(`DELETE FROM ${coordinator.TABLE} WHERE tenant_id=$1;DELETE FROM ${authority.TABLE} WHERE tenant_id=$1`,[tenant.id]);
  issued=await issue();
  await replica(`UPDATE ${authority.TABLE} SET expires_at=now()-interval '1 second' WHERE tenant_id=$1 AND id=$2`,
    [tenant.id,issued.authorization_id]);
  await assert.rejects(coordinator.reconcile(db.getPool(),{...durableArgs,authorizationId:issued.authorization_id,
    invocationId:id('expired')}),denied('authorization_expired'));
  assert.equal((await db.getPool().query(`SELECT count(*)::int c FROM ${coordinator.TABLE} WHERE tenant_id=$1`,[tenant.id])).rows[0].c,0);
  assert.equal((await statusOf(issued.authorization_id)).status,'expired');

  // A committed observing run models a crash; concurrent recovery is one terminal transition/audit.
  await replica(`DELETE FROM ${authority.TABLE} WHERE tenant_id=$1`,[tenant.id]);
  issued=await issue();
  const crashArgs={...durableArgs,authorizationId:issued.authorization_id,invocationId:id('crash')};
  const started=await coordinator._test.createObservingRun(db.getPool(),crashArgs,new Date(Date.now()-coordinator.OBSERVATION_LEASE_MS-1000));
  const recovered=await Promise.all([coordinator.reconcile(db.getPool(),crashArgs),coordinator.reconcile(db.getPool(),crashArgs)]);
  assert.deepEqual(recovered.map((x)=>x.state),['failed','failed']);
  assert.deepEqual(recovered[0].failure_classifications,['interrupted_observation']);
  assert.equal((await db.getPool().query(`SELECT count(*)::int c FROM orchestrator_audit_events
    WHERE tenant_id=$1 AND detail->>'reconciliation_run_id'=$2 AND event LIKE '%_failed'`,[tenant.id,started.row.id])).rows[0].c,1);

  // Persist a sanitized discrepancy classification through the real trigger.
  await replica(`DELETE FROM ${coordinator.TABLE} WHERE tenant_id=$1;DELETE FROM ${authority.TABLE} WHERE tenant_id=$1`,[tenant.id]);
  issued=await issue();
  const discrepancyArgs={...durableArgs,authorizationId:issued.authorization_id,invocationId:id('discrepancy')};
  const pending=await coordinator._test.createObservingRun(db.getPool(),discrepancyArgs,new Date());
  const discrepancy=coordinator.evaluate({attempted_observations:3,completed_observations:3,observations:
    authority.KINDS.map((kind)=>({object_kind:kind,outcome:'observed',status_classification:kind==='campaign'?'active':'paused',
      account_binding_matches:true,campaign_parent_matches:kind==='ad_group'?true:'not_applicable',
      budget_parent_matches:kind==='campaign'?true:'not_applicable',provider_object_id:'must-not-persist'}))});
  const settled=await coordinator._test.finishRun(db.getPool(),discrepancyArgs,tenant.id,pending.row.id,discrepancy);
  assert.deepEqual([settled.state,settled.discrepancy_classifications],['discrepancy_detected',['campaign_active']]);
  assert.doesNotMatch((await db.getPool().query(`SELECT to_jsonb(r)::text row FROM ${coordinator.TABLE} r
    WHERE tenant_id=$1 AND id=$2`,[tenant.id,pending.row.id])).rows[0].row,/must-not-persist/);

  const allStored=await db.getPool().query(`SELECT to_jsonb(r)::text row FROM ${coordinator.TABLE} r WHERE tenant_id=$1`,[tenant.id]);
  for(const text of [...allStored.rows.map((r)=>r.row),JSON.stringify(durable)]) for(const secret of
    [REFRESH,CLIENT_SECRET,DEV,ACCESS,CUSTOMER,base.sessionId]) assert.equal(text.includes(secret),false);
  const unchanged=await db.getPool().query(`SELECT provider_status,serving,published,activated
    FROM orchestrator_google_ads_provider_draft_objects WHERE tenant_id=$1`,[tenant.id]);
  for(const row of unchanged.rows) assert.deepEqual([row.provider_status,row.serving,row.published,row.activated],['PAUSED',false,false,false]);
});
