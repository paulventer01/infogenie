'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const db = require('../../db');
const schema = require('../../services/agent_orchestrator/schema');
const { makeFixtures } = require('../helpers');

const TABLE = 'orchestrator_google_ads_reconciliation_read_authorizations';
const META = 'orchestrator_campaign_reconciliation_read_authorizations';
const sha = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const H = sha('{}');
const FP = sha('1234567890');

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
  test('PR10C.1 PostgreSQL reconciliation-read schema requires DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else test('Google Ads reconciliation read-authorizations are tenant-bound, issued-only, and Meta-unchanged', async (t) => {
  const fx = makeFixtures();
  await fx.ensureSchemas();
  await schema.ensureAgentOrchestratorSchema();
  await schema.ensureAgentOrchestratorSchema();
  const tenant = await fx.seedTenant();
  const other = await fx.seedTenant();
  const user = await fx.seedUser({ tenantId: tenant.id, owner: false });
  const otherUser = await fx.seedUser({ tenantId: other.id, owner: false });
  const tag = crypto.randomUUID();
  const id = (kind) => `${kind}-${tag}`;

  t.after(async () => replica(`
    DELETE FROM ${TABLE} WHERE tenant_id IN ($1,$2);
    DELETE FROM ${META} WHERE tenant_id IN ($1,$2);
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
    DELETE FROM tenant_users WHERE tenant_id IN ($1,$2);
    DELETE FROM users WHERE id IN ($3,$4);
    DELETE FROM tenants WHERE id IN ($1,$2)`, [tenant.id, other.id, user.id, otherUser.id]));

  async function seedGraph(tid, uid, suffix, objectKinds) {
    const wa = 400000000 + parseInt(suffix.replace(/-/g, '').slice(0, 7), 16);
    const ids = {
      workflow: id(`wf-${suffix}`), draft: id(`dr-${suffix}`), revision: id(`rv-${suffix}`),
      approval: id(`ap-${suffix}`), request: id(`rq-${suffix}`), intent: id(`in-${suffix}`),
      cred: id(`cr-${suffix}`), cap: id(`cp-${suffix}`), op: id(`op-${suffix}`),
      session: sha(`session-${suffix}`), ledger: sha(`ledger-${suffix}`),
    };
    await replica(`
      INSERT INTO orchestrator_workflows(id,tenant_id,name) VALUES($1,$2,'garr');
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
        (tenant_id,id,account_fingerprint,version,owner_user_id) VALUES($2,$15,$16,1,$3);
      INSERT INTO orchestrator_google_ads_provider_draft_capabilities(
        tenant_id,id,actor_user_id,session_id_hash,workflow_id,draft_id,draft_revision,contract_hash,
        publishing_request_id,publish_approval_id,workflow_approval_id,snapshot_hash,intent_id,intent_hash,
        credential_ref_id,credential_ref_version,account_fingerprint,final_confirmation_id,final_confirmation_hash,
        confirmed_at,issued_at,expires_at,audit_ref)
        VALUES($2,$17,$3,$18,$1,$4,1,$5,$10,$8,${wa},$5,$12,$5,$15,1,$16,$19,$20,now(),now(),now()+interval '5 minutes',$21);
      INSERT INTO orchestrator_google_ads_provider_draft_operations(
        tenant_id,id,status,actor_user_id,session_id_hash,workflow_id,draft_id,draft_revision,contract_hash,
        publishing_request_id,publish_approval_id,workflow_approval_id,snapshot_hash,intent_id,intent_hash,
        capability_id,credential_ref_id,credential_ref_version,account_fingerprint,reservation_id_hash,
        invocation_id_hash,idempotency_key,provider_operation_key,requested_by,created_at,started_at,settled_at,
        result_code,external_action_taken,audit_ref)
        VALUES($2,$22,'succeeded',$3,$18,$1,$4,1,$5,$10,$8,${wa},$5,$12,$5,$17,$15,1,$16,$23,$24,$25,$26,$3,
          now(),now(),now(),'provider_create_succeeded',TRUE,$27)`,
    [ids.workflow, tid, uid, ids.draft, H, id(`dk-${suffix}`), ids.revision, ids.approval,
      id(`ak-${suffix}`), ids.request, id(`rk-${suffix}`), ids.intent, id(`ob-${suffix}`),
      id(`ik-${suffix}`), ids.cred, FP, ids.cap, ids.session, id(`cf-${suffix}`), sha(`cf-${suffix}`),
      id(`ca-${suffix}`), ids.op, sha(`r-${suffix}`), sha(`i-${suffix}`), id(`k-${suffix}`),
      sha(`opk-${suffix}`), id(`oa-${suffix}`)]);
    const seq = { campaign_budget: 1, campaign: 2, ad_group: 3 };
    for (const kind of objectKinds) {
      const oid = String(900000 + suffix.charCodeAt(0) * 10 + seq[kind]);
      await replica(`INSERT INTO orchestrator_google_ads_provider_draft_objects
        (tenant_id,id,operation_id,capability_id,account_fingerprint,object_kind,sequence_number,
         provider_object_id,provider_object_id_digest,provider_status,result_code,recorded_at,audit_ref)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'PAUSED','provider_create_succeeded',now(),$2)`,
      [tid, id(`obj-${suffix}-${kind}`), ids.op, ids.cap, FP, kind, seq[kind], oid, sha(oid)]);
    }
    return ids;
  }

  const graph = await seedGraph(tenant.id, user.id, 'a', ['campaign_budget', 'campaign', 'ad_group']);
  const otherGraph = await seedGraph(other.id, otherUser.id, 'b', ['campaign_budget', 'campaign', 'ad_group']);
  const incomplete = await seedGraph(tenant.id, user.id, 'c', ['campaign_budget', 'campaign']);

  const insertAuth = (over = {}) => db.getPool().query(`INSERT INTO ${TABLE}
    (tenant_id,id,nonce_hash,requested_by,session_id_hash,workflow_id,draft_id,publishing_request_id,
     intent_id,snapshot_hash,intent_hash,operation_id,capability_id,credential_ref_id,credential_ref_version,
     account_fingerprint,ledger_root_hash,expires_at,audit_ref,expected_object_kinds,status)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,1,$15,$16,now()+interval '5 minutes',$17,$18,$19)`,
  [over.tenantId ?? tenant.id, over.id ?? `garr_${over.tag || 'ok'}`, over.nonce ?? sha(over.tag || 'ok'),
    over.userId ?? user.id, over.session ?? graph.session, over.workflow ?? graph.workflow,
    over.draft ?? graph.draft, over.request ?? graph.request, over.intent ?? graph.intent,
    over.snapshot ?? H, over.intentHash ?? H, over.operationId ?? graph.op, over.capabilityId ?? graph.cap,
    over.cred ?? graph.cred, over.fp ?? FP, over.ledger ?? graph.ledger, over.audit ?? id(over.tag || 'ok-audit'),
    over.kinds || ['campaign_budget', 'campaign', 'ad_group'], over.status || 'issued']);

  const pk = (await db.getPool().query(
    `SELECT pg_get_constraintdef(oid) def FROM pg_constraint WHERE conrelid=$1::regclass AND contype='p'`,
    [TABLE])).rows[0].def;
  assert.match(pk, /PRIMARY KEY \(tenant_id, id\)/);
  assert.equal((await db.getPool().query(
    `SELECT to_regclass('orchestrator_google_ads_reconciliation_runs') IS NULL AS missing`)).rows[0].missing, true);
  const cols = (await db.getPool().query(
    `SELECT column_name FROM information_schema.columns WHERE table_name=$1`, [TABLE]))
    .rows.map((r) => r.column_name);
  for (const forbidden of ['access_token', 'customer_id', 'serving', 'purpose', 'review_case_id']) {
    assert.equal(cols.includes(forbidden), false, forbidden);
  }

  await insertAuth({ tag: 'ok' });
  assert.equal((await db.getPool().query(
    `SELECT status FROM ${TABLE} WHERE tenant_id=$1 AND id=$2`, [tenant.id, 'garr_ok'])).rows[0].status, 'issued');

  await assert.rejects(insertAuth({ tag: 'kinds', kinds: ['campaign', 'adset', 'creative'] }),
    /orchestrator_garr_kinds_check/);
  await assert.rejects(db.getPool().query(`INSERT INTO orchestrator_google_ads_provider_draft_objects
    (tenant_id,id,operation_id,capability_id,account_fingerprint,object_kind,sequence_number,
     provider_object_id,provider_object_id_digest,provider_status,result_code,serving,recorded_at,audit_ref)
    VALUES($1,$2,$3,$4,$5,'ad_group',3,'9901',$6,'ENABLED','provider_create_succeeded',TRUE,now(),$2)`,
  [tenant.id, id('obj-enabled'), incomplete.op, incomplete.cap, FP, sha('9901')]),
  /orchestrator_gapdobj_paused_check/);
  await assert.rejects(insertAuth({ tag: 'missing', operationId: incomplete.op, capabilityId: incomplete.cap,
    workflow: incomplete.workflow, draft: incomplete.draft, request: incomplete.request,
    intent: incomplete.intent, cred: incomplete.cred, session: incomplete.session,
    ledger: incomplete.ledger }), /orchestrator_garr_object_lineage/);
  await assert.rejects(insertAuth({ tag: 'xtenant', operationId: otherGraph.op }),
    /orchestrator_garr_operation|foreign key/i);
  await assert.rejects(insertAuth({ tag: 'reserved-insert', status: 'reserved' }),
    /orchestrator_garr_invalid_insert|orchestrator_garr_lifecycle_check/);

  await assert.rejects(db.getPool().query(
    `UPDATE ${TABLE} SET workflow_id=$3 WHERE tenant_id=$1 AND id=$2`,
    [tenant.id, 'garr_ok', incomplete.workflow]), /orchestrator_garr_immutable_binding/);
  await assert.rejects(db.getPool().query(
    `UPDATE ${TABLE} SET status='consumed',invocation_id_hash=$3,reserved_at=now(),consumed_at=now()
     WHERE tenant_id=$1 AND id=$2`, [tenant.id, 'garr_ok', sha('skip')]),
  /orchestrator_garr_invalid_transition/);
  await db.getPool().query(
    `UPDATE ${TABLE} SET status='reserved',invocation_id_hash=$3,reserved_at=now() WHERE tenant_id=$1 AND id=$2`,
    [tenant.id, 'garr_ok', sha('inv')]);
  await db.getPool().query(
    `UPDATE ${TABLE} SET status='consumed',consumed_at=now() WHERE tenant_id=$1 AND id=$2`,
    [tenant.id, 'garr_ok']);
  await assert.rejects(db.getPool().query(
    `UPDATE ${TABLE} SET status='revoked',revoked_at=now() WHERE tenant_id=$1 AND id=$2`,
    [tenant.id, 'garr_ok']), /orchestrator_garr_invalid_transition/);
  await assert.rejects(db.getPool().query(
    `DELETE FROM ${TABLE} WHERE tenant_id=$1 AND id=$2`, [tenant.id, 'garr_ok']),
  /orchestrator_garr_audit_evidence/);

  await assert.rejects(insertAuth({ tag: 'dup', ledger: graph.ledger }),
    /orchestrator_garr_tenant_unique_operation_ledger|duplicate key/i);

  await replica(`INSERT INTO ${META}
    (tenant_id,id,nonce_hash,requested_by,workflow_id,draft_id,publishing_request_id,execution_id,
     snapshot_hash,intent_id,intent_hash,credential_ref_id,credential_ref_version,account_fingerprint,
     ledger_root_hash,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,$13,$14,now()+interval '5 minutes')`,
  [tenant.id, `mra-${tag}`, sha('meta-nonce'), user.id, graph.workflow, graph.draft, graph.request,
    `execution-${tag}`, H, graph.intent, H, graph.cred, FP, sha('meta-ledger')]);
  assert.equal((await db.getPool().query(
    `SELECT status,expected_object_kinds FROM ${META} WHERE tenant_id=$1 AND id=$2`,
    [tenant.id, `mra-${tag}`])).rows[0].status, 'issued');
  await assert.rejects(replica(`INSERT INTO ${META}
    (tenant_id,id,nonce_hash,requested_by,workflow_id,draft_id,publishing_request_id,execution_id,
     snapshot_hash,intent_id,intent_hash,credential_ref_id,credential_ref_version,account_fingerprint,
     ledger_root_hash,expires_at,expected_object_kinds)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,$13,$14,now()+interval '5 minutes',
           ARRAY['campaign_budget','campaign','ad_group']::TEXT[])`,
  [tenant.id, `mra-bad-${tag}`, sha('meta-bad'), user.id, graph.workflow, graph.draft, graph.request,
    `execution-bad-${tag}`, H, graph.intent, H, graph.cred, FP, sha('meta-bad-ledger')]),
  /orchestrator_crra_kinds_check/);
  const metaKinds = (await db.getPool().query(
    `SELECT pg_get_constraintdef(oid) def FROM pg_constraint
      WHERE conrelid=$1::regclass AND conname='orchestrator_crra_kinds_check'`, [META])).rows[0].def;
  assert.match(metaKinds, /campaign','adset','creative','ad'/);
  const metaFrozen = (await db.getPool().query(
    `SELECT pg_get_constraintdef(oid) def FROM pg_constraint
      WHERE conname='orchestrator_tmcr_platform_check'`)).rows[0].def;
  assert.match(metaFrozen, /platform = 'meta'/);
});
