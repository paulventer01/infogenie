'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const db = require('../../db');
const schema = require('../../services/agent_orchestrator/schema');
const authority = require('../../services/security/google_ads_provider_draft_capabilities');
const operations = require('../../services/security/google_ads_provider_draft_operations');
const { makeFixtures } = require('../helpers');

const H = crypto.createHash('sha256').update('{}').digest('hex');
const FP = crypto.createHash('sha256').update('1234567890').digest('hex');
const permit = (key) => key === operations.PERMISSION;

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
  test('PR10B.2 PostgreSQL schema fence requires DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else test('PR10B.2 Google Ads provider-operation fence allows confirmed external action only', async (t) => {
  const fx = makeFixtures();
  await fx.ensureSchemas();
  await schema.ensureAgentOrchestratorSchema();
  const tenant = await fx.seedTenant();
  const user = await fx.seedUser({ tenantId: tenant.id, owner: false });
  const tag = crypto.randomUUID();
  const workflowApprovalId = 200000000 + parseInt(tag.slice(0, 7), 16);
  const id = (kind) => `${kind}-${tag}`;
  const ids = { workflow:id('workflow'), draft:id('draft'), approval:id('approval'),
    request:id('request'), intent:id('intent'), credential:id('credential') };

  t.after(async () => replica(`
    DELETE FROM orchestrator_google_ads_provider_draft_operations WHERE tenant_id=$1;
    DELETE FROM orchestrator_google_ads_provider_draft_capabilities WHERE tenant_id=$1;
    DELETE FROM orchestrator_google_ads_provider_draft_confirmations WHERE tenant_id=$1;
    DELETE FROM orchestrator_campaign_delivery_intents WHERE tenant_id=$1;
    DELETE FROM orchestrator_campaign_publish_requests WHERE tenant_id=$1;
    DELETE FROM orchestrator_campaign_publish_approvals WHERE tenant_id=$1;
    DELETE FROM orchestrator_campaign_draft_revisions WHERE tenant_id=$1;
    DELETE FROM orchestrator_campaign_drafts WHERE tenant_id=$1;
    DELETE FROM orchestrator_tenant_google_ads_credential_refs WHERE tenant_id=$1;
    DELETE FROM orchestrator_approvals WHERE tenant_id=$1;
    DELETE FROM orchestrator_workflows WHERE tenant_id=$1;
    DELETE FROM tenant_users WHERE tenant_id=$1;
    DELETE FROM users WHERE id=$2;
    DELETE FROM tenants WHERE id=$1`, [tenant.id, user.id]));

  await replica(`
    INSERT INTO roles(tenant_id,key,name,permissions)
      VALUES($2,$17,'PR10B.2 schema','["advertising.provider_drafts.create"]'::jsonb);
    UPDATE tenant_users SET role_id=(SELECT id FROM roles WHERE tenant_id=$2 AND key=$17)
      WHERE tenant_id=$2 AND user_id=$3;
    INSERT INTO orchestrator_workflows(id,tenant_id,name) VALUES($1,$2,'PR10B.2 schema fixture');
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

  const base = { tenantId:tenant.id, actorUserId:user.id, actorType:'human', principalType:'user',
    sessionId:id('session'), hasExplicitTenantPermission:permit, draftId:ids.draft, draftRevision:1,
    publishingRequestId:ids.request, publishApprovalId:ids.approval, intentId:ids.intent,
    credentialRefId:ids.credential, credentialRefVersion:1, ttlMs:300000 };
  const mint = async (suffix) => {
    const sessionId = id(`session-${suffix}`);
    return (await tx(async (c) => {
      const confirmation = await authority.confirm(c, { ...base, sessionId,
        finalConfirmation:authority.CONFIRMATION });
      return authority.issue(c, { ...base, sessionId, finalConfirmationId:confirmation.confirmation_id });
    })).capability_id;
  };
  const fund = (capabilityId, suffix) => tx((c) => operations.fund(c, { ...base,
    capabilityId, sessionId:id(`session-${suffix}`),
    reservationId:id(`r-${suffix}`), invocationId:id(`i-${suffix}`), idempotencyKey:id(`k-${suffix}`) }));

  const succeed = (operationId) => db.getPool().query(
    `UPDATE orchestrator_google_ads_provider_draft_operations
       SET status='succeeded',result_code='provider_create_succeeded',
           settled_at=clock_timestamp(),external_action_taken=TRUE
     WHERE tenant_id=$1 AND id=$2 AND status='in_progress' RETURNING *`,
    [tenant.id, operationId]);
  const settleFailed = (operationId) => db.getPool().query(
    `UPDATE orchestrator_google_ads_provider_draft_operations
       SET status='failed',result_code='provider_create_failed',
           settled_at=clock_timestamp(),external_action_taken=FALSE
     WHERE tenant_id=$1 AND id=$2 AND status='in_progress' RETURNING *`,
    [tenant.id, operationId]);
  const settleUnknown = (operationId) => db.getPool().query(
    `UPDATE orchestrator_google_ads_provider_draft_operations
       SET status='unknown',result_code='provider_outcome_unknown',
           settled_at=clock_timestamp(),external_action_taken=FALSE
     WHERE tenant_id=$1 AND id=$2 AND status='in_progress' RETURNING *`,
    [tenant.id, operationId]);

  const capSuccess = await mint('success');
  const fundedSuccess = await fund(capSuccess, 'success');
  const successRow = (await succeed(fundedSuccess.operation_id)).rows[0];
  assert.equal(successRow.status, 'succeeded');
  assert.equal(successRow.result_code, 'provider_create_succeeded');
  assert.equal(successRow.external_action_taken, true);
  assert.equal(successRow.published, false);
  assert.equal(successRow.activated, false);

  const capFailed = await mint('failed');
  const fundedFailed = await fund(capFailed, 'failed');
  const failedRow = (await settleFailed(fundedFailed.operation_id)).rows[0];
  assert.equal(failedRow.external_action_taken, false);
  await assert.rejects(db.getPool().query(
    `UPDATE orchestrator_google_ads_provider_draft_operations
       SET external_action_taken=TRUE WHERE tenant_id=$1 AND id=$2`,
    [tenant.id, fundedFailed.operation_id]), /orchestrator_gapdo_immutable|orchestrator_gapdo_no_mutation_check/);

  const capUnknown = await mint('unknown');
  const fundedUnknown = await fund(capUnknown, 'unknown');
  const unknownRow = (await settleUnknown(fundedUnknown.operation_id)).rows[0];
  assert.equal(unknownRow.external_action_taken, false);

  const capMismatch = await mint('mismatch');
  const fundedMismatch = await fund(capMismatch, 'mismatch');
  await assert.rejects(db.getPool().query(
    `UPDATE orchestrator_google_ads_provider_draft_operations
       SET status='succeeded',result_code='provider_create_succeeded',
           settled_at=clock_timestamp(),external_action_taken=FALSE
     WHERE tenant_id=$1 AND id=$2 AND status='in_progress'`,
    [tenant.id, fundedMismatch.operation_id]), /orchestrator_gapdo_no_mutation_check/);
  await assert.rejects(db.getPool().query(
    `UPDATE orchestrator_google_ads_provider_draft_operations
       SET status='failed',result_code='provider_create_failed',
           settled_at=clock_timestamp(),external_action_taken=TRUE
     WHERE tenant_id=$1 AND id=$2 AND status='in_progress'`,
    [tenant.id, fundedMismatch.operation_id]), /orchestrator_gapdo_no_mutation_check|orchestrator_gapdo_immutable/);
  await settleFailed(fundedMismatch.operation_id);

  const capPublished = await mint('published');
  const fundedPublished = await fund(capPublished, 'published');
  await assert.rejects(db.getPool().query(
    `UPDATE orchestrator_google_ads_provider_draft_operations
       SET published=TRUE WHERE tenant_id=$1 AND id=$2 AND status='in_progress'`,
    [tenant.id, fundedPublished.operation_id]), /orchestrator_gapdo_no_mutation_check|orchestrator_gapdo_immutable/);
  await settleFailed(fundedPublished.operation_id);

  const capActivated = await mint('activated');
  const fundedActivated = await fund(capActivated, 'activated');
  await assert.rejects(db.getPool().query(
    `UPDATE orchestrator_google_ads_provider_draft_operations
       SET activated=TRUE WHERE tenant_id=$1 AND id=$2 AND status='in_progress'`,
    [tenant.id, fundedActivated.operation_id]), /orchestrator_gapdo_no_mutation_check|orchestrator_gapdo_immutable/);

  await assert.rejects(db.getPool().query(
    `UPDATE orchestrator_google_ads_provider_draft_operations
       SET external_action_taken=FALSE
     WHERE tenant_id=$1 AND id=$2`,
    [tenant.id, fundedSuccess.operation_id]), /orchestrator_gapdo_immutable|orchestrator_gapdo_no_mutation_check/);
});
