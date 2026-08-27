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
    const pool=db.getPool(); await insertAuthorization(pool,ids[1]);
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
