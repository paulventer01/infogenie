'use strict';

// PR10B.2b — the guarded execution matrix against real PostgreSQL with a mocked
// Google client. Nothing here reaches Google: the provider transport and the
// OAuth token transport are both injected, and the live path stays opt-in.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const db = require('../../db');
const schema = require('../../services/agent_orchestrator/schema');
const authority = require('../../services/security/google_ads_provider_draft_capabilities');
const operations = require('../../services/security/google_ads_provider_draft_operations');
const connector = require('../../services/agent_orchestrator/connectors/google_ads_paused_draft');
const { makeFixtures } = require('../helpers');

const H = crypto.createHash('sha256').update('{}').digest('hex');
const CUSTOMER = '1234567890';
const FP = crypto.createHash('sha256').update(CUSTOMER).digest('hex');
const REFRESH_TOKEN = 'refresh-token-must-never-escape';
const CLIENT_SECRET = 'client-secret-must-never-escape';
const DEV_TOKEN = 'dev-token-must-never-escape';
const ACCESS_TOKEN = 'access-token-must-never-escape';
const sha = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const permit = (key) => key === operations.PERMISSION;
const denied = (code) => (error) => error && error.code === code && error.external_action_taken === false;
// Which guard fires first depends on the case; every one of them is fail-closed.
const blocked = (...codes) => (error) => error && codes.includes(error.code)
  && error.external_action_taken === false;

async function tx(fn) {
  const client = await db.getPool().connect();
  try { await client.query('BEGIN'); const out = await fn(client); await client.query('COMMIT'); return out; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function replica(sql, params = []) {
  const client = await db.getPool().connect();
  try {
    await client.query("SET session_replication_role='replica'");
    if (sql.split(';').filter((part) => part.trim()).length > 1 && params.length) {
      const literal = (value) => typeof value === 'number'
        ? String(value)
        : `'${String(value).replaceAll("'", "''")}'`;
      return await client.query(sql.replace(/\$(\d+)/g, (_m, index) => literal(params[Number(index) - 1])));
    }
    return await client.query(sql, params);
  } finally {
    await client.query("SET session_replication_role='origin'");
    client.release();
  }
}

// A PAUSED googleAds:mutate response for three freshly created objects.
const created = (base) => ({ status: 200, json: { mutateOperationResponses: [
  { campaignBudgetResult: { resourceName: `customers/${CUSTOMER}/campaignBudgets/${base}1` } },
  { campaignResult: { resourceName: `customers/${CUSTOMER}/campaigns/${base}2` } },
  { adGroupResult: { resourceName: `customers/${CUSTOMER}/adGroups/${base}3` } },
] } });

if (!db.hasDb()) {
  test('PR10B.2b PostgreSQL execution requires DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else test('Google Ads paused-draft execution is authorized, single-shot, replay-safe and leaks no secret', async (t) => {
  const fx = makeFixtures();
  await fx.ensureSchemas();
  await schema.ensureAgentOrchestratorSchema();
  const tenant = await fx.seedTenant();
  const otherTenant = await fx.seedTenant();
  const user = await fx.seedUser({ tenantId: tenant.id, owner: false });
  const otherUser = await fx.seedUser({ tenantId: tenant.id, owner: false });
  const tag = crypto.randomUUID();
  const workflowApprovalId = 100000000 + parseInt(tag.slice(0, 7), 16);
  const id = (kind) => `${kind}-${tag}`;
  const ids = { workflow:id('workflow'), draft:id('draft'), approval:id('approval'),
    request:id('request'), intent:id('intent'), credential:id('credential') };

  t.after(async () => replica(`
    DELETE FROM orchestrator_audit_events WHERE tenant_id IN ($1,$2);
    DELETE FROM orchestrator_google_ads_provider_draft_objects WHERE tenant_id IN ($1,$2);
    DELETE FROM orchestrator_google_ads_provider_draft_operations WHERE tenant_id IN ($1,$2);
    DELETE FROM orchestrator_google_ads_provider_draft_capabilities WHERE tenant_id IN ($1,$2);
    DELETE FROM orchestrator_google_ads_provider_draft_confirmations WHERE tenant_id IN ($1,$2);
    DELETE FROM orchestrator_campaign_delivery_intents WHERE tenant_id IN ($1,$2);
    DELETE FROM orchestrator_campaign_publish_requests WHERE tenant_id IN ($1,$2);
    DELETE FROM orchestrator_campaign_publish_approvals WHERE tenant_id IN ($1,$2);
    DELETE FROM orchestrator_campaign_draft_revisions WHERE tenant_id IN ($1,$2);
    DELETE FROM orchestrator_campaign_drafts WHERE tenant_id IN ($1,$2);
    DELETE FROM orchestrator_tenant_google_ads_credential_refs WHERE tenant_id IN ($1,$2);
    DELETE FROM orchestrator_approvals WHERE tenant_id IN ($1,$2);
    DELETE FROM orchestrator_workflows WHERE tenant_id IN ($1,$2);
    DELETE FROM user_integrations WHERE user_id IN ($3,$4);
    DELETE FROM tenant_users WHERE tenant_id IN ($1,$2);
    DELETE FROM users WHERE id IN ($3,$4);
    DELETE FROM tenants WHERE id IN ($1,$2)`, [tenant.id, otherTenant.id, user.id, otherUser.id]));

  await replica(`
    INSERT INTO roles(tenant_id,key,name,permissions)
      VALUES($2,$17,'PR10B.2b execution','["advertising.provider_drafts.create"]'::jsonb);
    UPDATE tenant_users SET role_id=(SELECT id FROM roles WHERE tenant_id=$2 AND key=$17)
      WHERE tenant_id=$2 AND user_id=$3;
    INSERT INTO orchestrator_workflows(id,tenant_id,name) VALUES($1,$2,'PR10B.2b fixture');
    INSERT INTO orchestrator_approvals(id,tenant_id,workflow_id,gate,content_hash,decision,actor_user_id)
      VALUES(${workflowApprovalId},$2,$1,'campaign_publishing',$5,'approved',$3);
    INSERT INTO orchestrator_campaign_drafts
      (id,tenant_id,workflow_id,status,current_revision,contract_hash,idempotency_key)
      VALUES($4,$2,$1,'approved_for_publish',1,$5,$6);
    INSERT INTO orchestrator_campaign_draft_revisions
      (id,tenant_id,draft_id,revision,contract_json,contract_hash,validation_status)
      VALUES($7,$2,$4,1,'{}',$5,'passed');
    INSERT INTO orchestrator_campaign_publish_approvals
      (id,tenant_id,draft_id,revision,contract_hash,snapshot_json,workflow_approval_id,actor_user_id,idempotency_key,expires_at)
      VALUES($8,$2,$4,1,$5,'{}',${workflowApprovalId},$3,$9,now()+interval '1 hour');
    INSERT INTO orchestrator_campaign_publish_requests
      (id,tenant_id,draft_id,publish_approval_id,workflow_approval_id,revision,contract_hash,snapshot_hash,requested_by,idempotency_key,request_hash)
      VALUES($10,$2,$4,$8,${workflowApprovalId},1,$5,$5,$3,$11,$5);
    INSERT INTO orchestrator_campaign_delivery_intents
      (id,tenant_id,publishing_request_id,draft_id,publish_approval_id,workflow_approval_id,outbox_id,revision,contract_hash,snapshot_hash,intent_hash,idempotency_key,requested_by)
      VALUES($12,$2,$10,$4,$8,${workflowApprovalId},$13,1,$5,$5,$5,$14,$3);
    INSERT INTO orchestrator_tenant_google_ads_credential_refs
      (tenant_id,id,account_fingerprint,version,owner_user_id) VALUES($2,$15,$16,1,$3)`,
  [ids.workflow,tenant.id,user.id,ids.draft,H,id('draft-key'),id('revision'),ids.approval,
    id('approval-key'),ids.request,id('request-key'),ids.intent,id('outbox'),id('intent-key'),ids.credential,FP,id('role')]);

  const vault = require('../../services/credentials/vault');
  const blob = vault.encryptString(JSON.stringify({ customerId: CUSTOMER, refreshToken: REFRESH_TOKEN,
    clientId: 'client-id', clientSecret: CLIENT_SECRET, devToken: DEV_TOKEN }));
  await db.getPool().query(`INSERT INTO user_integrations
    (user_id,platform,ciphertext,iv,tag,status,credential_version) VALUES($1,'google_ads',$2,$3,$4,'connected',1)`,
  [user.id, blob.ciphertext, blob.iv, blob.tag]);
  const secretState = async () => (await db.getPool().query(
    `SELECT encode(ciphertext,'hex') AS ciphertext,encode(iv,'hex') AS iv,encode(tag,'hex') AS tag,credential_version
       FROM user_integrations WHERE user_id=$1 AND platform='google_ads'`, [user.id])).rows[0];
  const secretBefore = await secretState();

  // ── mocked Google client and OAuth token transport ─────────────────────────
  const sent = [];
  let response = created('9910');
  const providerTransport = async (request) => { sent.push(request);
    return typeof response === 'function' ? response(request) : response; };
  const exchanges = [];
  const tokenTransport = async (request) => { exchanges.push(request);
    return { access_token: ACCESS_TOKEN, expires_in: 600 }; };

  const base = { tenantId:tenant.id, actorUserId:user.id, actorType:'human', principalType:'user',
    sessionId:id('session'), hasExplicitTenantPermission:permit, draftId:ids.draft, draftRevision:1,
    publishingRequestId:ids.request, publishApprovalId:ids.approval, intentId:ids.intent,
    credentialRefId:ids.credential, credentialRefVersion:1, ttlMs:300000 };
  const snapshot = { name:'PR10B.2b paused draft', budget:{ amount_micros:2500000 } };
  const mint = async () => (await tx(async (c) => {
    const confirmation = await authority.confirm(c, { ...base, finalConfirmation:authority.CONFIRMATION });
    return authority.issue(c, { ...base, finalConfirmationId:confirmation.confirmation_id });
  })).capability_id;
  const spendFor = async (n) => ({ capabilityId:await mint(), reservationId:id(`r-${n}`),
    invocationId:id(`i-${n}`), idempotencyKey:id(`k-${n}`) });
  const run = (over = {}) => operations.execute(db.getPool(), { ...base, snapshot,
    tokenTransport, providerTransport, ...over });
  const rowFor = async (key) => (await db.getPool().query(
    `SELECT * FROM orchestrator_google_ads_provider_draft_operations WHERE tenant_id=$1 AND idempotency_key=$2`,
    [tenant.id, key])).rows[0];
  const objectsFor = async (operationId) => (await db.getPool().query(
    `SELECT * FROM orchestrator_google_ads_provider_draft_objects
      WHERE tenant_id=$1 AND operation_id=$2 ORDER BY sequence_number`, [tenant.id, operationId])).rows;
  const liveRows = async () => (await db.getPool().query(`SELECT count(*)::int AS count
    FROM orchestrator_google_ads_provider_draft_operations
    WHERE tenant_id=$1 AND status IN ('pending','in_progress')`, [tenant.id])).rows[0].count;
  const setGrant = (json) => replica('UPDATE roles SET permissions=$3::jsonb WHERE tenant_id=$1 AND key=$2',
    [tenant.id, id('role'), json]);

  // ── 1. one authorized, PAUSED, single-shot creation ────────────────────────
  const spendA = await spendFor('a');
  const okA = await run(spendA);
  assert.equal(okA.status, 'succeeded');
  assert.equal(okA.result_code, 'provider_create_succeeded');
  assert.equal(okA.external_action_taken, true);
  assert.equal(okA.published, false);
  assert.equal(okA.activated, false);
  assert.equal(okA.replay, false);
  assert.equal(okA.requires_reconciliation, false);
  assert.equal(Object.isFrozen(okA), true);
  assert.equal(sent.length, 1, 'the connector is invoked exactly once');
  assert.equal(exchanges.length, 1, 'one token exchange, at the last responsible moment');

  const rowA = await rowFor(spendA.idempotencyKey);
  assert.equal(rowA.status, 'succeeded');
  assert.equal(rowA.external_action_taken, true);
  // The provider request is the connector's PAUSED mutate, labelled with this
  // operation's own stable keys.
  const request = sent[0];
  assert.equal(request.method, 'POST');
  assert.equal(request.url, `${connector.API_ORIGIN}/${connector.API_VERSION}/customers/${CUSTOMER}/googleAds:mutate`);
  assert.equal(request.provider_operation_key, rowA.provider_operation_key);
  assert.equal(request.idempotency_key, spendA.idempotencyKey);
  assert.equal(request.body.validateOnly, false);
  assert.equal(request.body.partialFailure, false);
  assert.equal(request.body.mutateOperations.length, 3);
  assert.equal(request.body.mutateOperations[1].campaignOperation.create.status, 'PAUSED');
  assert.equal(request.body.mutateOperations[2].adGroupOperation.create.status, 'PAUSED');
  const wire = JSON.stringify(request);
  for (const secret of [REFRESH_TOKEN, CLIENT_SECRET, DEV_TOKEN, ACCESS_TOKEN]) {
    assert.equal(wire.includes(secret), false, 'no credential material on the wire body');
  }
  assert.doesNotMatch(wire, /ENABLED|SERVING|ACTIVATE|PUBLISH|LAUNCH/);
  // The token request goes to the boundary-pinned endpoint and stays sealed:
  // it cannot be serialized, enumerated or inspected into a log line.
  assert.equal(exchanges[0].url, 'https://oauth2.googleapis.com/token');
  assert.throws(() => JSON.stringify(exchanges[0]), (e) => e.code === 'validation_failed');
  assert.equal(Object.keys(exchanges[0]).some((k) => /token|secret/i.test(k)), false);
  assert.equal(Object.values(exchanges[0]).includes(REFRESH_TOKEN), false);
  assert.equal(require('util').inspect(exchanges[0]).includes(REFRESH_TOKEN), false);

  const objectsA = await objectsFor(rowA.id);
  assert.deepEqual(objectsA.map((r) => r.object_kind), ['campaign_budget','campaign','ad_group']);
  assert.deepEqual(objectsA.map((r) => r.provider_object_id), ['99101','99102','99103']);
  for (const r of objectsA) {
    assert.deepEqual([r.provider_status, r.serving, r.published, r.activated, r.capability_id],
      ['PAUSED', false, false, false, spendA.capabilityId]);
  }
  assert.deepEqual(await secretState(), secretBefore, 'the vault blob is never rotated or re-encrypted');

  // ── 2. duplicate delivery replays metadata, never the provider ─────────────
  const replayed = await run(spendA);
  assert.equal(replayed.replay, true);
  assert.equal(replayed.status, 'succeeded');
  assert.equal(replayed.operation_id, rowA.id);
  assert.equal(sent.length, 1, 'a settled operation is never re-sent');
  assert.equal(exchanges.length, 1, 'a replay decrypts nothing and exchanges no token');
  assert.equal((await objectsFor(rowA.id)).length, 3);
  // A replay whose lineage disagrees with the stored row is a conflict.
  await assert.rejects(run({ ...spendA, sessionId:id('other-session') }), denied('operation_conflict'));
  await assert.rejects(run({ ...spendA, actorUserId:otherUser.id }), denied('operation_conflict'));
  assert.equal(sent.length, 1);

  // ── 3. an in-flight duplicate is refused the provider, not re-invoked ──────
  const spendB = await spendFor('b');
  const funded = await tx((c) => operations.fund(c, { ...base, ...spendB }));
  assert.equal(funded.status, 'in_progress');
  const inflight = await run(spendB);
  assert.equal(inflight.replay, true);
  assert.equal(inflight.status, 'in_progress');
  assert.equal(inflight.external_action_taken, false);
  assert.equal(sent.length, 1, 'an in-flight operation is never blindly invoked again');
  assert.equal(exchanges.length, 1);
  await tx((c) => operations.settle(c, { ...base, operationId:funded.operation_id, status:'unknown',
    resultCode:'provider_outcome_unknown' }));

  // ── 4. provider rejection is determinate: failed, no evidence, no retry ────
  const spendC = await spendFor('c');
  response = { status:400, json:{ error:{ code:400, message:'INVALID_ARGUMENT' } } };
  const failed = await run(spendC);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.result_code, 'provider_create_failed');
  assert.equal(failed.external_action_taken, false);
  assert.equal(failed.requires_reconciliation, false);
  assert.equal(sent.length, 2, 'one attempt, no retry');
  const rowC = await rowFor(spendC.idempotencyKey);
  assert.equal((await objectsFor(rowC.id)).length, 0);

  // ── 5. an ambiguous outcome is unknown and must be reconciled ──────────────
  const spendD = await spendFor('d');
  response = { transportError:'timeout', mayHaveActed:true };
  const unknown = await run(spendD);
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.result_code, 'provider_outcome_unknown');
  assert.equal(unknown.external_action_taken, false);
  assert.equal(unknown.requires_reconciliation, true);
  assert.equal(sent.length, 3, 'an ambiguous attempt is never retried');
  assert.equal((await objectsFor((await rowFor(spendD.idempotencyKey)).id)).length, 0);

  // ── 5b. a transport that never answers is bounded, and is also ambiguous ───
  const spendDd = await spendFor('dd');
  response = () => new Promise(() => {});
  const hung = await run({ ...spendDd, providerTimeoutMs:50 });
  assert.equal(hung.status, 'unknown');
  assert.equal(hung.external_action_taken, false);
  assert.equal(hung.requires_reconciliation, true);
  assert.equal(sent.length, 4, 'the deadline does not send a second request');
  assert.equal((await objectsFor((await rowFor(spendDd.idempotencyKey)).id)).length, 0);

  // ── 6. evidence is persisted before settlement: if it cannot be written the
  //      operation cannot claim success and becomes unknown ───────────────────
  const spendE = await spendFor('e');
  response = created('9910'); // same provider object ids as the successful run
  const contested = await run(spendE);
  assert.equal(contested.status, 'unknown');
  assert.equal(contested.external_action_taken, false);
  assert.equal(contested.requires_reconciliation, true);
  assert.equal(sent.length, 5);
  const rowE = await rowFor(spendE.idempotencyKey);
  assert.equal((await objectsFor(rowE.id)).length, 0);
  assert.equal((await objectsFor(rowA.id)).length, 3, 'the earlier evidence is untouched');

  // ── 7. serving-state requests never reach authority or the provider ────────
  const before = await liveRows();
  const spendF = { capabilityId:await mint(), reservationId:id('r-f'), invocationId:id('i-f'),
    idempotencyKey:id('k-f') };
  for (const bad of [{ ...snapshot, status:'ENABLED' }, { ...snapshot, serving:true },
    { ...snapshot, activate:true }, { ...snapshot, budget:{ amount_micros:1000, budget_increase:1 } }]) {
    await assert.rejects(run({ ...spendF, snapshot:bad }), denied('serving_request_rejected'));
  }
  assert.equal(await rowFor(spendF.idempotencyKey), undefined);
  assert.equal(await liveRows(), before);
  assert.equal(sent.length, 5);

  // ── 8. live Google is opt-in and off by default ────────────────────────────
  delete process.env[connector.LIVE_OPT_IN_ENV];
  await assert.rejects(run({ ...spendF, providerTransport:undefined }), denied('live_google_ads_disabled'));
  await assert.rejects(run({ ...spendF, providerTransport:undefined, allowLive:true }),
    denied('live_google_ads_disabled'));
  assert.equal(await rowFor(spendF.idempotencyKey), undefined);

  // ── 9. revoked permission, inactive membership, wrong tenant and wrong actor
  response = created('7710');
  await setGrant('[]');
  await assert.rejects(run(spendF),
    blocked('permission_denied','authoritative_binding_mismatch','authority_not_found'));
  await setGrant('["advertising.provider_drafts.create"]');
  await replica("UPDATE tenant_users SET status='suspended' WHERE tenant_id=$1 AND user_id=$2",[tenant.id,user.id]);
  await assert.rejects(run(spendF), (e) => e.code === 'authority_not_found');
  await replica("UPDATE tenant_users SET status='active' WHERE tenant_id=$1 AND user_id=$2",[tenant.id,user.id]);
  await assert.rejects(run({ ...spendF, tenantId:otherTenant.id }), denied('capability_rejected'));
  await assert.rejects(run({ ...spendF, actorUserId:otherUser.id }),
    blocked('capability_rejected','authoritative_binding_mismatch','authority_not_found'));
  await assert.rejects(run({ ...spendF, hasExplicitTenantPermission:()=>false }), denied('permission_denied'));
  await assert.rejects(run({ ...spendF, principalType:'worker' }), denied('human_session_required'));
  assert.equal(await rowFor(spendF.idempotencyKey), undefined);
  assert.equal(sent.length, 5);

  // ── 10. stale authority: expired approval, stale revision, credential drift,
  //       reused capability and an expired capability ────────────────────────
  // An approval whose window has closed (the row keeps expires_at > created_at).
  await replica("UPDATE orchestrator_campaign_publish_approvals SET created_at=now()-interval '3 hours',expires_at=now()-interval '1 minute' WHERE tenant_id=$1 AND id=$2",[tenant.id,ids.approval]);
  await assert.rejects(run(spendF), denied('authoritative_binding_mismatch'));
  await replica("UPDATE orchestrator_campaign_publish_approvals SET created_at=now(),expires_at=now()+interval '1 hour' WHERE tenant_id=$1 AND id=$2",[tenant.id,ids.approval]);
  await replica('UPDATE orchestrator_campaign_drafts SET current_revision=2 WHERE tenant_id=$1 AND id=$2',[tenant.id,ids.draft]);
  await assert.rejects(run(spendF), denied('authoritative_binding_mismatch'));
  await replica('UPDATE orchestrator_campaign_drafts SET current_revision=1 WHERE tenant_id=$1 AND id=$2',[tenant.id,ids.draft]);
  await replica('UPDATE orchestrator_tenant_google_ads_credential_refs SET version=2 WHERE tenant_id=$1 AND id=$2',[tenant.id,ids.credential]);
  await assert.rejects(run(spendF), denied('authoritative_binding_mismatch'));
  await replica('UPDATE orchestrator_tenant_google_ads_credential_refs SET version=1 WHERE tenant_id=$1 AND id=$2',[tenant.id,ids.credential]);
  await assert.rejects(run({ ...spendF, capabilityId:spendA.capabilityId, idempotencyKey:id('k-reuse') }),
    denied('capability_rejected'));
  await replica(`UPDATE orchestrator_google_ads_provider_draft_capabilities
    SET confirmed_at=now()-interval '20 minutes',issued_at=now()-interval '20 minutes',
        expires_at=now()-interval '15 minutes' WHERE tenant_id=$1 AND id=$2`,[tenant.id,spendF.capabilityId]);
  const expired = await run(spendF);
  assert.equal(expired.expired, true);
  assert.equal(expired.external_action_taken, false);
  assert.equal(await rowFor(spendF.idempotencyKey), undefined);
  assert.equal(sent.length, 5);

  // ── 11. both kill switches stop the operation before it is even funded ─────
  const spendG = await spendFor('g');
  await db.getPool().query("UPDATE orchestrator_advertising_tenant_kill_switches SET active=true,version=version+1,updated_at=now()+interval '1 second' WHERE tenant_id=$1 AND switch_key='google_ads_provider_draft'",[tenant.id]);
  await assert.rejects(run(spendG), denied('authoritative_binding_mismatch'));
  await db.getPool().query("UPDATE orchestrator_advertising_tenant_kill_switches SET active=false,version=version+1,updated_at=now()+interval '2 seconds' WHERE tenant_id=$1 AND switch_key='google_ads_provider_draft'",[tenant.id]);
  await db.getPool().query("UPDATE orchestrator_advertising_global_kill_switches SET active=true,version=version+1,updated_at=now()+interval '1 second' WHERE switch_key='google_ads_provider_draft'");
  try {
    await assert.rejects(run(spendG), denied('authoritative_binding_mismatch'));
  } finally {
    await db.getPool().query("UPDATE orchestrator_advertising_global_kill_switches SET active=false,version=version+1,updated_at=now()+interval '2 seconds' WHERE switch_key='google_ads_provider_draft'");
  }
  assert.equal(await rowFor(spendG.idempotencyKey), undefined);
  assert.equal(sent.length, 5);

  // ── 12. vault credential drift fails closed before any provider call ───────
  await replica("UPDATE user_integrations SET credential_version=2 WHERE user_id=$1 AND platform='google_ads'",[user.id]);
  await assert.rejects(run(spendG), (e) => e.code === 'context_mismatch');
  assert.equal(sent.length, 5, 'a drifted credential never reaches the provider');
  const rowG = await rowFor(spendG.idempotencyKey);
  assert.equal(rowG.status, 'failed', 'no external action, so the row settles determinately');
  assert.equal(rowG.external_action_taken, false);
  assert.equal((await objectsFor(rowG.id)).length, 0);
  await replica("UPDATE user_integrations SET credential_version=1 WHERE user_id=$1 AND platform='google_ads'",[user.id]);

  // ── 13. settlement refuses to run outside an open transaction ──────────────
  const raw = await db.getPool().connect();
  try {
    await assert.rejects(operations.settle(raw, { ...base, operationId:rowA.id, status:'failed',
      resultCode:'provider_create_failed' }), denied('transaction_required'));
  } finally { raw.release(); }

  // ── 14. ledger, evidence and audit hygiene ─────────────────────────────────
  assert.equal(await liveRows(), 0, 'no operation is left in flight');
  const acted = await db.getPool().query(`SELECT id,status,result_code FROM
    orchestrator_google_ads_provider_draft_operations WHERE tenant_id=$1 AND external_action_taken`, [tenant.id]);
  assert.deepEqual(acted.rows, [{ id:rowA.id, status:'succeeded', result_code:'provider_create_succeeded' }]);
  const allObjects = await db.getPool().query(`SELECT provider_status,serving,published,activated
    FROM orchestrator_google_ads_provider_draft_objects WHERE tenant_id=$1`, [tenant.id]);
  assert.equal(allObjects.rowCount, 3);
  for (const r of allObjects.rows) {
    assert.deepEqual([r.provider_status, r.serving, r.published, r.activated], ['PAUSED', false, false, false]);
  }
  const audits = await db.getPool().query(`SELECT event,detail::text FROM orchestrator_audit_events
    WHERE tenant_id=$1`, [tenant.id]);
  for (const audit of audits.rows) {
    for (const secret of [REFRESH_TOKEN, CLIENT_SECRET, DEV_TOKEN, ACCESS_TOKEN, CUSTOMER, FP, base.sessionId]) {
      assert.equal(audit.detail.includes(secret), false, `${audit.event} leaked material`);
    }
    assert.doesNotMatch(audit.detail, /googleapis|oauth2|bearer/i);
  }
  const ledger = await db.getPool().query(`SELECT to_jsonb(op)::text AS row FROM
    orchestrator_google_ads_provider_draft_operations op WHERE tenant_id=$1`, [tenant.id]);
  for (const r of ledger.rows) {
    for (const secret of [REFRESH_TOKEN, CLIENT_SECRET, DEV_TOKEN, ACCESS_TOKEN, CUSTOMER]) {
      assert.equal(r.row.includes(secret), false);
    }
  }
  assert.deepEqual(await secretState(), secretBefore);
});
