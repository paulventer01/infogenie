'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const db = require('../../db');
const schema = require('../../services/agent_orchestrator/schema');
const authority = require('../../services/security/google_ads_provider_draft_capabilities');
const operations = require('../../services/security/google_ads_provider_draft_operations');
const vault = require('../../services/credentials/vault');
const { makeFixtures } = require('../helpers');

const H = crypto.createHash('sha256').update('{}').digest('hex');
const FP = crypto.createHash('sha256').update('1234567890').digest('hex');
const sha = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const permit = (key) => key === operations.PERMISSION;
const denied = (code) => (error) => error && error.code === code;

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

if (!db.hasDb()) {
  test('PR10B.1 PostgreSQL operations require DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else test('Google Ads provider operations are tenant-isolated, single-use, replay-safe and never claim provider success', async (t) => {
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
      VALUES($2,$17,'PR10B.1 operations','["advertising.provider_drafts.create"]'::jsonb);
    UPDATE tenant_users SET role_id=(SELECT id FROM roles WHERE tenant_id=$2 AND key=$17)
      WHERE tenant_id=$2 AND user_id=$3;
    INSERT INTO orchestrator_workflows(id,tenant_id,name) VALUES($1,$2,'PR10B.1 fixture');
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

  // A per-user vault blob exists so the metadata-only assertion can be proven
  // not to read, rotate or re-encrypt it.
  const stored = vault.encryptString(JSON.stringify({ customerId:'1234567890', refreshToken:'never-read' }));
  await db.getPool().query(`INSERT INTO user_integrations
    (user_id,platform,ciphertext,iv,tag,status,credential_version) VALUES($1,'google_ads',$2,$3,$4,'connected',1)`,
  [user.id, stored.ciphertext, stored.iv, stored.tag]);
  const secretState = async () => (await db.getPool().query(
    `SELECT encode(ciphertext,'hex') AS ciphertext,encode(iv,'hex') AS iv,encode(tag,'hex') AS tag,credential_version
       FROM user_integrations WHERE user_id=$1 AND platform='google_ads'`, [user.id])).rows[0];
  const secretBefore = await secretState();

  const base = { tenantId:tenant.id, actorUserId:user.id, actorType:'human', principalType:'user',
    sessionId:id('session'), hasExplicitTenantPermission:permit, draftId:ids.draft, draftRevision:1,
    publishingRequestId:ids.request, publishApprovalId:ids.approval, intentId:ids.intent,
    credentialRefId:ids.credential, credentialRefVersion:1, ttlMs:300000 };
  const mint = async () => (await tx(async (c) => {
    const confirmation = await authority.confirm(c, { ...base, finalConfirmation:authority.CONFIRMATION });
    return authority.issue(c, { ...base, finalConfirmationId:confirmation.confirmation_id });
  })).capability_id;
  const fund = (o) => tx((c) => operations.fund(c, { ...base, ...o }));
  const count = async () => (await db.getPool().query(
    `SELECT count(*)::int AS count FROM orchestrator_google_ads_provider_draft_operations WHERE tenant_id=$1`,
    [tenant.id])).rows[0].count;

  // ── fund happy path ────────────────────────────────────────────────────────
  const capability = await mint();
  const spend = { capabilityId:capability, reservationId:id('r1'), invocationId:id('i1'), idempotencyKey:id('k1') };
  const funded = await fund(spend);
  assert.equal(funded.status, 'in_progress');
  assert.equal(funded.replay, false);
  assert.equal(funded.result_code, null);
  assert.equal(funded.external_action_taken, false);
  assert.equal(funded.published, false);
  assert.equal(funded.activated, false);
  assert.deepEqual(Object.keys(funded).sort(), ['activated','created_at','external_action_taken','operation_id',
    'published','replay','result_code','settled_at','started_at','status'].sort());
  const row = (await db.getPool().query(
    `SELECT * FROM orchestrator_google_ads_provider_draft_operations WHERE tenant_id=$1 AND id=$2`,
    [tenant.id, funded.operation_id])).rows[0];
  assert.equal(row.requested_by, user.id);
  assert.equal(row.actor_user_id, user.id);
  assert.equal(row.capability_id, capability);
  assert.equal(row.published, false);
  assert.equal(row.activated, false);
  assert.equal(row.external_action_taken, false);
  assert.equal(row.provider_operation_key, sha(`${tenant.id}|${capability}|${ids.draft}|1|${ids.intent}|${FP}`));
  assert.equal(row.reservation_id_hash, sha(spend.reservationId));
  assert.equal(row.invocation_id_hash, sha(spend.invocationId));
  assert.equal((await db.getPool().query(
    `SELECT status FROM orchestrator_google_ads_provider_draft_capabilities WHERE tenant_id=$1 AND id=$2`,
    [tenant.id, capability])).rows[0].status, 'consumed');
  assert.deepEqual(await secretState(), secretBefore);

  // ── duplicate delivery replays the frozen row, mismatches are conflicts ─────
  const replayed = await fund(spend);
  assert.equal(replayed.replay, true);
  assert.equal(replayed.operation_id, funded.operation_id);
  assert.equal(replayed.status, 'in_progress');
  await assert.rejects(fund({ ...spend, sessionId:id('other-session') }), denied('operation_conflict'));
  await assert.rejects(fund({ ...spend, actorUserId:otherUser.id }), denied('operation_conflict'));
  await assert.rejects(fund({ ...spend, invocationId:id('other-invocation') }), denied('operation_conflict'));
  await assert.rejects(fund({ ...spend, tenantId:otherTenant.id, idempotencyKey:id('cross') }),
    denied('capability_rejected'));
  await assert.rejects(fund({ ...spend, idempotencyKey:id('respend') }), denied('capability_rejected'));
  assert.equal(await count(), 1);

  // ── tenant-scoped read ─────────────────────────────────────────────────────
  const view = await tx((c) => operations.get(c, { ...base, operationId:funded.operation_id }));
  assert.equal(view.operation_id, funded.operation_id);
  assert.equal(view.status, 'in_progress');
  await assert.rejects(tx((c) => operations.get(c, { ...base, tenantId:otherTenant.id, operationId:funded.operation_id })),
    denied('operation_rejected'));
  await assert.rejects(tx((c) => operations.get(c, { ...base, actorUserId:otherUser.id, operationId:funded.operation_id })),
    denied('operation_rejected'));

  // ── settlement never claims provider success ───────────────────────────────
  const settle = (o) => tx((c) => operations.settle(c, { ...base, ...o }));
  for (const attempt of [
    { status:'succeeded', resultCode:'provider_create_succeeded' },
    { status:'succeeded', resultCode:'provider_create_failed' },
    { status:'failed', resultCode:'provider_create_succeeded' },
    { status:'unknown', resultCode:'provider_create_failed' },
    { status:'in_progress', resultCode:'ready_for_provider' },
  ]) await assert.rejects(settle({ operationId:funded.operation_id, ...attempt }), denied('operation_rejected'),
    JSON.stringify(attempt));
  await assert.rejects(settle({ operationId:funded.operation_id, status:'failed',
    resultCode:'provider_create_failed', sessionId:id('other-session') }), denied('operation_rejected'));
  const failed = await settle({ operationId:funded.operation_id, status:'failed', resultCode:'provider_create_failed' });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.result_code, 'provider_create_failed');
  assert.ok(failed.settled_at);
  assert.equal(failed.external_action_taken, false);
  await assert.rejects(settle({ operationId:funded.operation_id, status:'unknown',
    resultCode:'provider_outcome_unknown' }), denied('operation_rejected'));
  await assert.rejects(db.getPool().query(
    `UPDATE orchestrator_google_ads_provider_draft_operations SET status='succeeded',result_code='provider_create_succeeded'
       WHERE tenant_id=$1 AND id=$2`, [tenant.id, funded.operation_id]), /orchestrator_gapdo_immutable/);

  // ── concurrent funding of one capability with one idempotency key ──────────
  const capabilityB = await mint();
  const spendB = { capabilityId:capabilityB, reservationId:id('r2'), invocationId:id('i2'), idempotencyKey:id('k2') };
  const sameKey = await Promise.allSettled([fund(spendB), fund(spendB)]);
  assert.equal(sameKey.filter((r) => r.status === 'fulfilled' && r.value.status === 'in_progress').length, 1,
    sameKey.map((r) => r.reason && r.reason.code).join(','));
  assert.equal(sameKey.filter((r) => r.status === 'fulfilled' && r.value.replay === false).length, 1);
  assert.equal(await count(), 2);
  await settle({ operationId:sameKey.find((r) => r.status === 'fulfilled').value.operation_id,
    status:'unknown', resultCode:'provider_outcome_unknown' });

  // ── concurrent funding of one capability with two idempotency keys ─────────
  const capabilityC = await mint();
  const forked = await Promise.allSettled([1,2].map((n) => fund({ capabilityId:capabilityC,
    reservationId:id(`r3-${n}`), invocationId:id(`i3-${n}`), idempotencyKey:id(`k3-${n}`) })));
  assert.equal(forked.filter((r) => r.status === 'fulfilled').length, 1,
    forked.map((r) => r.reason && r.reason.code).join(','));
  assert.equal(forked.filter((r) => r.status === 'rejected'
    && ['capability_rejected','operation_conflict'].includes(r.reason?.code)).length, 1);
  assert.equal(await count(), 3);
  const forkedOperation = forked.find((r) => r.status === 'fulfilled').value.operation_id;
  await settle({ operationId:forkedOperation, status:'failed', resultCode:'provider_create_failed' });

  // ── stale, revoked and disabled authority stays fail-closed ────────────────
  const capabilityD = await mint();
  const stale = (n) => ({ capabilityId:capabilityD, reservationId:id(`r4-${n}`),
    invocationId:id(`i4-${n}`), idempotencyKey:id(`k4-${n}`) });
  await replica('UPDATE orchestrator_campaign_drafts SET current_revision=2 WHERE tenant_id=$1 AND id=$2',[tenant.id,ids.draft]);
  await assert.rejects(fund(stale('revision')), denied('authoritative_binding_mismatch'));
  await replica('UPDATE orchestrator_campaign_drafts SET current_revision=1 WHERE tenant_id=$1 AND id=$2',[tenant.id,ids.draft]);
  await replica("UPDATE orchestrator_campaign_publish_approvals SET revoked_at=now(),revoke_reason='test' WHERE tenant_id=$1 AND id=$2",[tenant.id,ids.approval]);
  await assert.rejects(fund(stale('approval')), denied('authoritative_binding_mismatch'));
  await replica('UPDATE orchestrator_campaign_publish_approvals SET revoked_at=NULL,revoke_reason=NULL WHERE tenant_id=$1 AND id=$2',[tenant.id,ids.approval]);
  await replica('UPDATE orchestrator_tenant_google_ads_credential_refs SET version=2 WHERE tenant_id=$1 AND id=$2',[tenant.id,ids.credential]);
  await assert.rejects(fund(stale('credential-version')), denied('authoritative_binding_mismatch'));
  await replica('UPDATE orchestrator_tenant_google_ads_credential_refs SET version=1,account_fingerprint=$3 WHERE tenant_id=$1 AND id=$2',[tenant.id,ids.credential,'a'.repeat(64)]);
  await assert.rejects(fund(stale('fingerprint')), denied('authoritative_binding_mismatch'));
  await replica('UPDATE orchestrator_tenant_google_ads_credential_refs SET account_fingerprint=$3 WHERE tenant_id=$1 AND id=$2',[tenant.id,ids.credential,FP]);
  await db.getPool().query("UPDATE orchestrator_advertising_tenant_kill_switches SET active=true,version=version+1,updated_at=now()+interval '1 second' WHERE tenant_id=$1 AND switch_key='google_ads_provider_draft'",[tenant.id]);
  await assert.rejects(fund(stale('kill-switch')), denied('authoritative_binding_mismatch'));
  await db.getPool().query("UPDATE orchestrator_advertising_tenant_kill_switches SET active=false,version=version+1,updated_at=now()+interval '2 seconds' WHERE tenant_id=$1 AND switch_key='google_ads_provider_draft'",[tenant.id]);
  assert.equal(await count(), 3);

  // ── the vault assertion is metadata-only and fails closed ──────────────────
  const binding = { tenantId:tenant.id, ownerUserId:user.id, credentialRefId:ids.credential,
    credentialRefVersion:1, accountFingerprint:FP };
  const assertRef = (o) => tx((c) => vault.assertGoogleAdsProviderDraftCredentialRefMetadata(c, { ...binding, ...o }));
  const reference = await assertRef({});
  assert.deepEqual(reference, { credential_ref_id:ids.credential, credential_ref_version:1 });
  assert.equal(Object.isFrozen(reference), true);
  await assert.rejects(assertRef({ tenantId:otherTenant.id }), (e) => e.code === 'missing_credentials');
  await assert.rejects(assertRef({ ownerUserId:otherUser.id }), (e) => e.code === 'permission_denied');
  await assert.rejects(assertRef({ credentialRefVersion:2 }), (e) => e.code === 'context_mismatch');
  await assert.rejects(assertRef({ accountFingerprint:'a'.repeat(64) }), (e) => e.code === 'context_mismatch');
  await assert.rejects(assertRef({ accountFingerprint:'1234567890' }), (e) => e.code === 'validation_failed');
  await replica("UPDATE orchestrator_tenant_google_ads_credential_refs SET status='revoked',revoked_at=now() WHERE tenant_id=$1 AND id=$2",[tenant.id,ids.credential]);
  await assert.rejects(assertRef({}), (e) => e.code === 'missing_credentials');
  await replica('UPDATE orchestrator_tenant_google_ads_credential_refs SET status=$3,revoked_at=NULL WHERE tenant_id=$1 AND id=$2',[tenant.id,ids.credential,'active']);
  assert.deepEqual(await secretState(), secretBefore);

  // ── PR10B.2a: the secret scope re-checks live authority against real rows ──
  const full = vault.encryptString(JSON.stringify({ customerId:'1234567890', refreshToken:'rt',
    clientId:'cid', clientSecret:'cs', devToken:'dt' }));
  await replica(`UPDATE user_integrations SET ciphertext=$2,iv=$3,tag=$4
    WHERE user_id=$1 AND platform='google_ads'`, [user.id, full.ciphertext, full.iv, full.tag]);
  const scope = (o, fn) => tx((c) => vault.withGoogleAdsPausedDraftSecretScope(c, { tenantId:tenant.id,
    ownerUserId:user.id, credentialRefId:ids.credential, credentialRefVersion:1, accountFingerprint:FP,
    tokenTransport:async () => ({ access_token:'at', expires_in:600 }), ...o }, fn || (async () => 'ok')));
  assert.equal(await scope({}, async (h) => `${h.accessToken}|${h.customerId}|${h.credential_ref_version}`),
    'at|1234567890|1');
  await assert.rejects(scope({ credentialRefVersion:2 }), (e) => e.code === 'context_mismatch');
  await assert.rejects(scope({ accountFingerprint:'a'.repeat(64) }), (e) => e.code === 'context_mismatch');
  await assert.rejects(scope({ ownerUserId:otherUser.id }), (e) => e.code === 'permission_denied');
  await replica("UPDATE tenant_users SET status='suspended' WHERE tenant_id=$1 AND user_id=$2",[tenant.id,user.id]);
  await assert.rejects(scope({}), (e) => e.code === 'permission_denied');
  await replica("UPDATE tenant_users SET status='active' WHERE tenant_id=$1 AND user_id=$2",[tenant.id,user.id]);
  await replica("UPDATE user_integrations SET credential_version=2 WHERE user_id=$1 AND platform='google_ads'",[user.id]);
  await assert.rejects(scope({}), (e) => e.code === 'context_mismatch');
  await replica("UPDATE user_integrations SET credential_version=1 WHERE user_id=$1 AND platform='google_ads'",[user.id]);
  await replica("UPDATE orchestrator_tenant_google_ads_credential_refs SET status='revoked',revoked_at=now() WHERE tenant_id=$1 AND id=$2",[tenant.id,ids.credential]);
  await assert.rejects(scope({}), (e) => e.code === 'missing_credentials');
  await replica("UPDATE orchestrator_tenant_google_ads_credential_refs SET status='active',revoked_at=NULL WHERE tenant_id=$1 AND id=$2",[tenant.id,ids.credential]);

  // ── PR10B.2a: only a confirmed paused creation with a live grant succeeds ──
  await tx((c) => authority.revoke(c, { ...base, capabilityId:capabilityD }));
  const capabilityE = await mint();
  const spendE = { capabilityId:capabilityE, reservationId:id('r5'), invocationId:id('i5'), idempotencyKey:id('k5') };
  const fundedE = await fund(spendE);
  const opKey = sha(`${tenant.id}|${capabilityE}|${ids.draft}|1|${ids.intent}|${FP}`);
  const proof = (over = {}) => ({ ok:true, result_code:'provider_create_succeeded', external_action_taken:true,
    published:false, activated:false, serving:false, requires_reconciliation:false, retry:false, objects_created:3,
    objects:['campaign_budget','campaign','ad_group'].map((kind, i) => ({ object_kind:kind,
      provider_status:'PAUSED', sequence_number:i + 1, provider_object_id:String(7700 + i) })),
    provider_operation_key:opKey, idempotency_key:spendE.idempotencyKey, ...over });
  const claim = (over) => settle({ operationId:fundedE.operation_id, status:'succeeded',
    resultCode:'provider_create_succeeded', providerResult:proof(over) });
  const statusOf = async (operationId) => (await db.getPool().query(
    `SELECT status,external_action_taken FROM orchestrator_google_ads_provider_draft_operations
      WHERE tenant_id=$1 AND id=$2`, [tenant.id, operationId])).rows[0];
  // Evidence echoing another operation's keys cannot authorize this claim.
  await assert.rejects(claim({ provider_operation_key:sha('elsewhere') }), denied('operation_rejected'));
  await assert.rejects(claim({ idempotency_key:id('elsewhere') }), denied('operation_rejected'));
  const setGrant = (json) => replica('UPDATE roles SET permissions=$3::jsonb WHERE tenant_id=$1 AND key=$2',
    [tenant.id, id('role'), json]);
  // A revoked DB grant cannot claim success even though the session still says it may.
  await setGrant('[]');
  await assert.rejects(claim(), denied('permission_denied'));
  assert.deepEqual(await statusOf(fundedE.operation_id), { status:'in_progress', external_action_taken:false });
  assert.equal((await db.getPool().query(`SELECT count(*)::int AS count
    FROM orchestrator_google_ads_provider_draft_objects WHERE tenant_id=$1`, [tenant.id])).rows[0].count, 0);
  await setGrant('["advertising.provider_drafts.create"]');
  const claimed = await settle({ operationId:fundedE.operation_id, status:'succeeded',
    resultCode:'provider_create_succeeded', idempotencyKey:spendE.idempotencyKey, providerResult:proof() });
  assert.deepEqual([claimed.external_action_taken, claimed.published, claimed.activated], [true, false, false]);
  await assert.rejects(settle({ operationId:fundedE.operation_id, status:'failed',
    resultCode:'provider_create_failed' }), denied('operation_rejected'));

  // ── PR10B.2a: the object rows are truthful, paused and append-only ────────
  const objects = await db.getPool().query(`SELECT * FROM orchestrator_google_ads_provider_draft_objects
    WHERE tenant_id=$1 AND operation_id=$2 ORDER BY sequence_number`, [tenant.id, fundedE.operation_id]);
  assert.deepEqual(objects.rows.map((r) => r.object_kind), ['campaign_budget','campaign','ad_group']);
  for (const r of objects.rows) {
    assert.deepEqual([r.provider_status, r.serving, r.published, r.activated, r.capability_id,
      r.provider_object_id_digest, r.requires_reconciliation, r.reconciliation_state],
    ['PAUSED', false, false, false, capabilityE, sha(r.provider_object_id), false, 'not_required']);
  }
  await assert.rejects(db.getPool().query(`UPDATE orchestrator_google_ads_provider_draft_objects
    SET provider_status='ENABLED' WHERE tenant_id=$1 AND id=$2`, [tenant.id, objects.rows[0].id]),
  /orchestrator_gapdobj_immutable/);
  await assert.rejects(db.getPool().query(`DELETE FROM orchestrator_google_ads_provider_draft_objects
    WHERE tenant_id=$1 AND id=$2`, [tenant.id, objects.rows[0].id]), /orchestrator_gapdobj_audit_evidence/);
  const insertObject = (over) => db.getPool().query(`INSERT INTO orchestrator_google_ads_provider_draft_objects
    (tenant_id,id,operation_id,capability_id,account_fingerprint,object_kind,sequence_number,provider_object_id,
     provider_object_id_digest,provider_status,result_code,serving,recorded_at,audit_ref)
    VALUES($1,$2,$3,$4,$5,'campaign',2,$6,$7,$8,'provider_create_succeeded',$9,now(),$2)`,
  [tenant.id, id(`obj-${over.tag}`), over.operationId || fundedE.operation_id, over.capabilityId || capabilityE,
    FP, over.objectId, sha(over.objectId), over.providerStatus || 'PAUSED', over.serving === true]);
  await assert.rejects(insertObject({ tag:'serving', objectId:'8801', serving:true }),
    /orchestrator_gapdobj_paused_check/);
  await assert.rejects(insertObject({ tag:'enabled', objectId:'8802', providerStatus:'ENABLED' }),
    /orchestrator_gapdobj_paused_check/);
  await assert.rejects(insertObject({ tag:'lineage', objectId:'8803', capabilityId:capability }),
    /orchestrator_gapdobj_operation_lineage/);

  // ── PR10B.2a: a revoked grant must not strand an in_progress row ──────────
  const capabilityG = await mint();
  const fundedG = await fund({ capabilityId:capabilityG, reservationId:id('r6'),
    invocationId:id('i6'), idempotencyKey:id('k6') });
  await setGrant('[]');
  await replica("UPDATE tenant_users SET status='suspended' WHERE tenant_id=$1 AND user_id=$2",[tenant.id,user.id]);
  const stranded = await settle({ operationId:fundedG.operation_id, status:'unknown',
    resultCode:'provider_outcome_unknown' });
  assert.equal(stranded.status, 'unknown');
  assert.equal(stranded.external_action_taken, false);
  await replica("UPDATE tenant_users SET status='active' WHERE tenant_id=$1 AND user_id=$2",[tenant.id,user.id]);
  await setGrant('["advertising.provider_drafts.create"]');

  // ── audits carry no secret, account or payload material ────────────────────
  const audits = await db.getPool().query(`SELECT event,detail::text FROM orchestrator_audit_events
    WHERE tenant_id=$1 AND event LIKE 'google_ads_provider_draft_operation_%'`, [tenant.id]);
  assert.equal(audits.rowCount, 10);
  for (const audit of audits.rows) {
    assert.deepEqual(Object.keys(JSON.parse(audit.detail)).sort(), ['capability_id','operation_id','status']);
    assert.doesNotMatch(audit.detail, /123-?4567?890|token|fingerprint|googleapis|https?:/i);
    assert.equal(audit.detail.includes(FP), false);
    assert.equal(audit.detail.includes(base.sessionId), false);
  }
  const live = await db.getPool().query(`SELECT count(*)::int AS count
    FROM orchestrator_google_ads_provider_draft_operations
    WHERE tenant_id=$1 AND status IN ('pending','in_progress')`, [tenant.id]);
  assert.equal(live.rows[0].count, 0);
  // Exactly one operation ever claimed an external action, it is the confirmed
  // paused creation, and it carries exactly three PAUSED objects.
  const acted = await db.getPool().query(`SELECT id,status,result_code FROM
    orchestrator_google_ads_provider_draft_operations WHERE tenant_id=$1 AND external_action_taken`, [tenant.id]);
  assert.deepEqual(acted.rows, [{ id:fundedE.operation_id, status:'succeeded',
    result_code:'provider_create_succeeded' }]);
  assert.equal((await db.getPool().query(`SELECT count(*)::int AS count
    FROM orchestrator_google_ads_provider_draft_objects WHERE tenant_id=$1`, [tenant.id])).rows[0].count, 3);
});
