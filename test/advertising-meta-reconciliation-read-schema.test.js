'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const { ensureAuthSchema } = require('../services/auth/schema');
const { ensureTenantSchema } = require('../services/tenants/schema');
const { ensureAgentOrchestratorSchema } = require('../services/agent_orchestrator/schema');

const TABLE = 'orchestrator_campaign_reconciliation_read_authorizations';
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const hex = (c) => c.repeat(64);

if (!db.hasDb()) {
  test('Meta reconciliation-read schema skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else {
  let tenantId; let userId; let workflowId; let draftId;
  const ids = [`mra-a-${suffix}`, `mra-b-${suffix}`];
  const seedExecutionParent = async (p, authorizationId) => {
    const tag = authorizationId.replace(/[^a-z0-9-]/gi,'-');
    const approvalId=(await p.query(`INSERT INTO orchestrator_approvals
      (tenant_id,workflow_id,gate,content_hash,decision,object_version,approved_platforms)
      VALUES($1,$2,'campaign_publishing',$3,'approved',1,'["meta"]'::jsonb) RETURNING id`,
    [tenantId,workflowId,hex('9')])).rows[0].id;
    await p.query(`INSERT INTO orchestrator_campaign_draft_revisions
      (id,tenant_id,draft_id,revision,contract_json,contract_hash)
      VALUES($1,$2,$3,1,'{"ok":true}'::jsonb,$4)`,[`revision-${tag}`,tenantId,draftId,hex('9')]);
    const publishApprovalId=`publish-approval-${tag}`;
    await p.query(`INSERT INTO orchestrator_campaign_publish_approvals
      (id,tenant_id,draft_id,revision,contract_hash,snapshot_json,workflow_approval_id,
       actor_user_id,idempotency_key,expires_at)
      VALUES($1,$2,$3,1,$4,'{"ok":true}'::jsonb,$5,$6,$7,now()+interval '1 hour')`,
    [publishApprovalId,tenantId,draftId,hex('9'),approvalId,userId,`publish-approval-idemp-${tag}`]);
    const requestId=`request-${suffix}`;
    await p.query(`INSERT INTO orchestrator_campaign_publish_requests
      (id,tenant_id,draft_id,publish_approval_id,workflow_approval_id,revision,contract_hash,
       snapshot_hash,requested_by,idempotency_key,request_hash)
      VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10)`,
    [requestId,tenantId,draftId,publishApprovalId,approvalId,hex('9'),hex('3'),userId,
      `request-idemp-${tag}`,hex('8')]);
    const outboxId=`outbox-${tag}`;
    await p.query(`INSERT INTO orchestrator_outbox
      (id,tenant_id,workflow_id,destination,operation,payload,state,idempotency_key)
      VALUES($1,$2,$3,'internal','create_provider_draft','{}'::jsonb,'pending',$4)`,
    [outboxId,tenantId,workflowId,`outbox-idemp-${tag}`]);
    const intentId=`intent-${suffix}`;
    await p.query(`INSERT INTO orchestrator_campaign_delivery_intents
      (id,tenant_id,publishing_request_id,draft_id,publish_approval_id,workflow_approval_id,
       outbox_id,revision,contract_hash,snapshot_hash,intent_hash,idempotency_key,requested_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10,$11,$12)`,
    [intentId,tenantId,requestId,draftId,publishApprovalId,approvalId,outboxId,hex('9'),hex('3'),
      hex('4'),`intent-idemp-${tag}`,userId]);
    const attemptId=`attempt-${tag}`;
    await p.query(`INSERT INTO orchestrator_campaign_delivery_attempts
      (id,tenant_id,intent_id,outbox_id,draft_id,publishing_request_id,attempt_number,generation,
       claim_token,lease_holder,lease_expires_at,platform,intent_hash,connector,status)
      VALUES($1,$2,$3,$4,$5,$6,1,1,$7,'reconciliation-schema-test',now()+interval '5 minutes',
             'meta',$8,'fake','started')`,
    [attemptId,tenantId,intentId,outboxId,draftId,requestId,`claim-${tag}`,hex('4')]);
    const credentialRefId=`cred-${suffix}`;
    await p.query(`INSERT INTO orchestrator_tenant_meta_credential_refs
      (id,tenant_id,platform,environment,status,account_fingerprint,page_id,version,owner_user_id)
      VALUES($1,$2,'meta','sandbox','active',$3,'1122334455667',1,$4)`,
    [credentialRefId,tenantId,hex('5'),userId]);
    const challengeId=`challenge-${tag}`;
    await p.query(`INSERT INTO orchestrator_campaign_provider_challenges
      (id,tenant_id,draft_id,revision,publish_approval_id,workflow_approval_id,publishing_request_id,
       intent_id,outbox_id,attempt_id,credential_ref_id,generation,contract_hash,snapshot_hash,
       intent_hash,request_hash,claim_token_hash,phrase_salt,status,idempotency_key,requested_by,expires_at)
      VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14,$15,$16,'open',$17,$18,
             now()+interval '5 minutes')`,
    [challengeId,tenantId,draftId,publishApprovalId,approvalId,requestId,intentId,outboxId,attemptId,
      credentialRefId,hex('9'),hex('3'),hex('4'),hex('8'),hex('7'),hex('6'),`challenge-idemp-${tag}`,userId]);
    const confirmationId=`confirmation-${tag}`;
    await p.query(`INSERT INTO orchestrator_campaign_provider_confirmations
      (id,tenant_id,challenge_id,draft_id,revision,publish_approval_id,workflow_approval_id,
       publishing_request_id,intent_id,outbox_id,attempt_id,credential_ref_id,generation,contract_hash,
       snapshot_hash,intent_hash,request_hash,claim_token_hash,phrase_salt,phrase_digest,status,
       idempotency_key,requested_by,expires_at)
      VALUES($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10,$11,1,$12,$13,$14,$15,$16,$17,$18,'confirmed',
             $19,$20,now()+interval '2 minutes')`,
    [confirmationId,tenantId,challengeId,draftId,publishApprovalId,approvalId,requestId,intentId,outboxId,
      attemptId,credentialRefId,hex('9'),hex('3'),hex('4'),hex('8'),hex('7'),hex('6'),hex('5'),
      `confirmation-idemp-${tag}`,userId]);
    await p.query(`INSERT INTO orchestrator_campaign_provider_draft_executions
      (id,tenant_id,confirmation_id,challenge_id,draft_id,revision,publish_approval_id,
       workflow_approval_id,publishing_request_id,intent_id,outbox_id,attempt_id,credential_ref_id,
       credential_ref_version,account_fingerprint,generation,contract_hash,snapshot_hash,intent_hash,
       request_hash,claim_token_hash,idempotency_key,requested_by)
      VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10,$11,$12,1,$13,1,$14,$15,$16,$17,$18,$19,$20)`,
    [`execution-${suffix}-${authorizationId}`,tenantId,confirmationId,challengeId,draftId,publishApprovalId,
      approvalId,requestId,intentId,outboxId,attemptId,credentialRefId,hex('5'),hex('9'),hex('3'),hex('4'),
      hex('8'),hex('7'),`execution-idemp-${tag}`,userId]);
  };
  const insertAuthorization = async (p, id) => {
    // Only the authorization row is synthetic. Replica mode bypasses lineage
    // FKs for this trigger-focused test; production issuance never does this.
    await p.query(`SET session_replication_role = replica`);
    try {
      await p.query(`INSERT INTO ${TABLE}
        (tenant_id,id,nonce_hash,requested_by,workflow_id,draft_id,publishing_request_id,
         execution_id,snapshot_hash,intent_id,intent_hash,credential_ref_id,
         credential_ref_version,account_fingerprint,ledger_root_hash,expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,$13,$14,now()+interval '5 minutes')`,
      [tenantId,id,hex(id === ids[0] ? '1' : '2'),userId,workflowId,
        draftId,`request-${suffix}`,`execution-${suffix}-${id}`,hex('3'),
        `intent-${suffix}`,hex('4'),`cred-${suffix}`,hex('5'),hex('6')]);
    } finally { await p.query(`SET session_replication_role = origin`); }
  };

  before(async () => {
    await ensureAuthSchema(); await ensureTenantSchema();
    await ensureAgentOrchestratorSchema();
    const p = db.getPool();
    tenantId = (await p.query(`INSERT INTO tenants(name,slug,status) VALUES($1,$2,'active') RETURNING id`,
      [`CRRA ${suffix}`, `crra-${suffix}`])).rows[0].id;
    userId = (await p.query(`INSERT INTO users(email,password_hash,name) VALUES($1,'x','crra') RETURNING id`,
      [`crra-${suffix}@example.test`])).rows[0].id;
    workflowId = `wf-${suffix}`;
    await p.query(`INSERT INTO orchestrator_workflows(id,tenant_id,name) VALUES($1,$2,$1)`, [workflowId,tenantId]);
    draftId = `draft-${suffix}`;
    await p.query(`INSERT INTO orchestrator_campaign_drafts
      (id,tenant_id,workflow_id,contract_hash,idempotency_key)
      VALUES($1,$2,$3,$4,$5)`,[draftId,tenantId,workflowId,hex('9'),`draft-idemp-${suffix}`]);
  });

  after(async () => {
    const p=db.getPool();
    await p.query(`SET session_replication_role=replica`);
    try { await p.query(`DELETE FROM ${TABLE} WHERE tenant_id=$1`,[tenantId]); } finally {
      await p.query(`SET session_replication_role=origin`);
    }
    await p.query(`DELETE FROM tenants WHERE id=$1`,[tenantId]);
    await p.query(`DELETE FROM users WHERE id=$1`,[userId]);
  });

  test('initialization is populated-safe and idempotent; schema is tenant-leading', async () => {
    await insertAuthorization(db.getPool(), ids[0]);
    await ensureAgentOrchestratorSchema(); await ensureAgentOrchestratorSchema();
    assert.equal((await db.getPool().query(`SELECT count(*)::int n FROM ${TABLE} WHERE tenant_id=$1`,[tenantId])).rows[0].n,1);
    const pk=(await db.getPool().query(`SELECT pg_get_constraintdef(oid) def FROM pg_constraint
      WHERE conrelid=$1::regclass AND contype='p'`,[TABLE])).rows[0].def;
    assert.match(pk,/PRIMARY KEY \(tenant_id, id\)/);
    const fks=(await db.getPool().query(`SELECT conname,pg_get_constraintdef(oid) def FROM pg_constraint
      WHERE conrelid=$1::regclass AND contype='f'`,[TABLE])).rows;
    const lineage=fks.filter(({conname})=>conname.startsWith('orchestrator_crra_'));
    assert.equal(lineage.length,8,lineage.map(x=>`${x.conname}: ${x.def}`).join('\n'));
    assert.ok(lineage.every(({def})=>/^FOREIGN KEY \(tenant_id, /.test(def)),
      lineage.map(x=>`${x.conname}: ${x.def}`).join('\n'));
  });

  test('immutable bindings and terminal lifecycle are database-enforced', async () => {
    const p=db.getPool();
    await assert.rejects(p.query(`UPDATE ${TABLE} SET workflow_id='changed' WHERE tenant_id=$1 AND id=$2`,[tenantId,ids[0]]),/immutable_binding/);
    await p.query(`UPDATE ${TABLE} SET status='reserved',invocation_id_hash=$3,reserved_at=now() WHERE tenant_id=$1 AND id=$2`,[tenantId,ids[0],hex('7')]);
    await p.query(`UPDATE ${TABLE} SET status='consumed',consumed_at=now() WHERE tenant_id=$1 AND id=$2`,[tenantId,ids[0]]);
    await assert.rejects(p.query(`UPDATE ${TABLE} SET status='revoked',revoked_at=now() WHERE tenant_id=$1 AND id=$2`,[tenantId,ids[0]]),/invalid_transition/);
  });

  test('row lock serializes concurrent consumption and exposes consumed state to loser', async () => {
    const pool=db.getPool(); await seedExecutionParent(pool,ids[1]); await insertAuthorization(pool,ids[1]);
    const a=await pool.connect(); const b=await pool.connect();
    try {
      await a.query('BEGIN'); await b.query('BEGIN');
      await a.query(`SELECT status FROM ${TABLE} WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[tenantId,ids[1]]);
      const waiting=b.query(`SELECT status FROM ${TABLE} WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[tenantId,ids[1]]);
      await a.query(`UPDATE ${TABLE} SET status='reserved',invocation_id_hash=$3,reserved_at=now() WHERE tenant_id=$1 AND id=$2`,[tenantId,ids[1],hex('8')]);
      await a.query(`UPDATE ${TABLE} SET status='consumed',consumed_at=now() WHERE tenant_id=$1 AND id=$2`,[tenantId,ids[1]]);
      await a.query('COMMIT');
      assert.equal((await waiting).rows[0].status,'consumed');
      await b.query('ROLLBACK');
    } finally { a.release(); b.release(); }
  });
}
