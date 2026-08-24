'use strict';

process.env.PERMISSION_ENFORCEMENT = 'on';
process.env.MULTITENANT_ENFORCEMENT = 'on';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const db = require('../db');
const { ensureAgentOrchestratorSchema } = require('../services/agent_orchestrator/schema');
const { ensureTenantSchema } = require('../services/tenants/schema');
const { ensureAuthSchema } = require('../services/auth/schema');

const HAS_DB = db.hasDb();
const TABLES = [
  'orchestrator_campaign_drafts',
  'orchestrator_campaign_draft_revisions',
  'orchestrator_campaign_draft_creatives',
  'orchestrator_campaign_publish_approvals',
];
const HEX = 'a'.repeat(64);
const SUFFIX = `ao6a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let seq = 0;
const nid = (p) => { seq += 1; return `${p}-${SUFFIX}-${seq}`; };
const nextHex = () => { seq += 1; return seq.toString(16).padStart(64, '0'); };

async function pkAndUniques(table) {
  return (await db.getPool().query(
    `SELECT tc.constraint_name, tc.constraint_type,
            string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS cols
       FROM information_schema.table_constraints tc
       LEFT JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        AND tc.table_name = kcu.table_name
      WHERE tc.table_schema='public' AND tc.table_name=$1 AND tc.constraint_type IN ('PRIMARY KEY','UNIQUE')
      GROUP BY tc.constraint_name, tc.constraint_type`, [table]
  )).rows;
}

async function checkNames(table) {
  return (await db.getPool().query(
    `SELECT conname FROM pg_constraint WHERE conrelid=$1::regclass AND contype='c'`,
    [`public.${table}`]
  )).rows.map((r) => r.conname);
}

async function seedHost(p, tenantId) {
  const wfId = nid('wf');
  await p.query(`INSERT INTO orchestrator_workflows (id, tenant_id, name) VALUES ($1,$2,$3)`, [wfId, tenantId, wfId]);
  const approvalId = (await p.query(
    `INSERT INTO orchestrator_approvals (tenant_id, workflow_id, gate, content_hash, decision, object_version, approved_platforms)
     VALUES ($1,$2,'campaign_publishing',$3,'approved',1,'["meta"]'::jsonb) RETURNING id`, [tenantId, wfId, HEX]
  )).rows[0].id;
  return { wfId, approvalId };
}

async function insertDraft(p, tenantId, host, opts = {}) {
  const id = opts.id || nid('draft');
  const hash = opts.contractHash || HEX;
  await p.query(
    `INSERT INTO orchestrator_campaign_drafts
       (id, tenant_id, workflow_id, contract_hash, idempotency_key, status, current_revision)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, tenantId, host.wfId, hash, opts.idempotencyKey || nid('idemp'), opts.status || 'draft', opts.revision || 1]
  );
  return id;
}

async function insertRevision(p, tenantId, draftId, opts = {}) {
  const id = opts.id || nid('rev');
  await p.query(
    `INSERT INTO orchestrator_campaign_draft_revisions
       (id, tenant_id, draft_id, revision, contract_json, contract_hash)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
    [id, tenantId, draftId, opts.revision || 1, opts.contractJson || '{"ok":true}', opts.contractHash || HEX]
  );
  return id;
}

if (!HAS_DB) {
  test('advertising-orchestrator campaign-draft schema skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else {
  let tenantA = null; let tenantB = null; let hostA = null; let hostB = null; let userId = null;

  before(async () => {
    await ensureAuthSchema();
    await ensureTenantSchema();
    await ensureAgentOrchestratorSchema();
    const p = db.getPool();
    const mk = async (label, slug) => (await p.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`, [label, slug]
    )).rows[0].id;
    tenantA = await mk(`AO6A A ${SUFFIX}`, `ao6a-a-${SUFFIX}`);
    tenantB = await mk(`AO6A B ${SUFFIX}`, `ao6a-b-${SUFFIX}`);
    hostA = await seedHost(p, tenantA);
    hostB = await seedHost(p, tenantB);
    userId = (await p.query(
      `INSERT INTO users (email, password_hash, name) VALUES ($1,'x','pr6a') RETURNING id`,
      [`pr6a-${SUFFIX}@example.test`]
    )).rows[0].id;
  });

  after(async () => {
    const p = db.getPool();
    const ids = [tenantA, tenantB].filter(Boolean);
    if (ids.length) await p.query(`DELETE FROM tenants WHERE id = ANY($1)`, [ids]);
    if (userId) await p.query(`DELETE FROM users WHERE id=$1`, [userId]);
  });

  test('PR6A tables exist with tenant_id on PK; drafts unique (tenant_id, idempotency_key)', async () => {
    const p = db.getPool();
    const present = (await p.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1)`,
      [TABLES]
    )).rows.map((r) => r.table_name).sort();
    assert.deepStrictEqual(present, [...TABLES].sort());
    for (const table of TABLES) {
      const col = (await p.query(
        `SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name='tenant_id'`,
        [table]
      )).rows[0];
      assert.ok(col); assert.strictEqual(col.is_nullable, 'NO');
      const pk = (await pkAndUniques(table)).filter((c) => c.constraint_type === 'PRIMARY KEY');
      assert.ok(pk.some((c) => c.cols.split(',')[0] === 'tenant_id'), `${table} PK must start with tenant_id`);
      const cred = (await p.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
        [table]
      )).rows.map((r) => r.column_name);
      assert.ok(!cred.some((c) => /credential|token|secret|password/i.test(c)), `${table} must not store credentials`);
    }
    const drafts = await pkAndUniques('orchestrator_campaign_drafts');
    assert.ok(drafts.some((c) => c.constraint_type === 'PRIMARY KEY' && c.cols === 'tenant_id,id'));
    assert.ok(drafts.some((c) => c.constraint_name === 'orchestrator_campaign_drafts_tenant_unique_idemp'
      && c.cols === 'tenant_id,idempotency_key'));
    const pubs = await pkAndUniques('orchestrator_campaign_publish_approvals');
    assert.ok(pubs.some((c) => c.constraint_name === 'orchestrator_campaign_publish_approvals_tenant_unique_idemp'
      && c.cols === 'tenant_id,idempotency_key'));
  });

  test('CREATE TABLE CHECKs exist for status, hashes, kind, validation_status', async () => {
    const drafts = await checkNames('orchestrator_campaign_drafts');
    assert.ok(drafts.includes('orchestrator_campaign_drafts_status_check'));
    assert.ok(drafts.includes('orchestrator_campaign_drafts_contract_hash_check'));
    assert.ok(drafts.includes('orchestrator_campaign_drafts_approval_hash_check'));
    const revs = await checkNames('orchestrator_campaign_draft_revisions');
    assert.ok(revs.includes('orchestrator_campaign_draft_revisions_contract_hash_check'));
    assert.ok(revs.includes('orchestrator_campaign_draft_revisions_validation_status_check'));
    const creatives = await checkNames('orchestrator_campaign_draft_creatives');
    assert.ok(creatives.includes('orchestrator_campaign_draft_creatives_kind_check'));
    assert.ok(creatives.includes('orchestrator_campaign_draft_creatives_content_hash_check'));
    const p = db.getPool();
    const name = 'orchestrator_campaign_drafts_status_check';
    await p.query(`ALTER TABLE orchestrator_campaign_drafts DROP CONSTRAINT ${name}`);
    await ensureAgentOrchestratorSchema();
    const after = (await p.query(`SELECT 1 FROM pg_constraint WHERE conname=$1`, [name])).rowCount;
    assert.equal(after, 1, 'ensureSchema must restore dropped status CHECK');
  });

  test('illegal status transition into publishing raises', async () => {
    const p = db.getPool();
    const id = await insertDraft(p, tenantA, hostA);
    await p.query(`UPDATE orchestrator_campaign_drafts SET status='validating' WHERE tenant_id=$1 AND id=$2`, [tenantA, id]);
    await p.query(`UPDATE orchestrator_campaign_drafts SET status='ready_for_approval' WHERE tenant_id=$1 AND id=$2`, [tenantA, id]);
    await p.query(
      `UPDATE orchestrator_campaign_drafts
          SET status='approved_for_publish', approval_id=$3, approval_hash=$4, approval_expires_at=now()+'1 hour'::interval
        WHERE tenant_id=$1 AND id=$2`,
      [tenantA, id, hostA.approvalId, HEX]
    );
    await assert.rejects(
      () => p.query(`UPDATE orchestrator_campaign_drafts SET status='publishing' WHERE tenant_id=$1 AND id=$2`, [tenantA, id]),
      /orchestrator_campaign_drafts_immutable/
    );
    await assert.rejects(
      () => p.query(`UPDATE orchestrator_campaign_drafts SET status='published' WHERE tenant_id=$1 AND id=$2`, [tenantA, id]),
      /orchestrator_campaign_drafts_immutable/
    );
  });

  test('revision row cannot UPDATE contract_json; validation pending→passed is allowed', async () => {
    const p = db.getPool();
    const draftId = await insertDraft(p, tenantA, hostA);
    const revId = await insertRevision(p, tenantA, draftId);
    await assert.rejects(
      () => p.query(
        `UPDATE orchestrator_campaign_draft_revisions SET contract_json='{"tampered":true}'::jsonb WHERE tenant_id=$1 AND id=$2`,
        [tenantA, revId]
      ),
      /orchestrator_campaign_draft_revisions_immutable/
    );
    await p.query(
      `UPDATE orchestrator_campaign_draft_revisions SET validation_status='passed', validation_json='{"ok":true}'::jsonb
        WHERE tenant_id=$1 AND id=$2`,
      [tenantA, revId]
    );
  });

  test('publish approval cannot UPDATE snapshot_json; can set revoked_at', async () => {
    const p = db.getPool();
    const draftId = await insertDraft(p, tenantA, hostA);
    const pubId = nid('pub');
    await p.query(
      `INSERT INTO orchestrator_campaign_publish_approvals
         (id, tenant_id, draft_id, revision, contract_hash, snapshot_json, workflow_approval_id,
          actor_user_id, idempotency_key, expires_at)
       VALUES ($1,$2,$3,1,$4,'{"ok":true}'::jsonb,$5,$6,$7,now()+'1 hour'::interval)`,
      [pubId, tenantA, draftId, HEX, hostA.approvalId, userId, nid('pidemp')]
    );
    await assert.rejects(
      () => p.query(
        `UPDATE orchestrator_campaign_publish_approvals SET snapshot_json='{"tampered":true}'::jsonb WHERE tenant_id=$1 AND id=$2`,
        [tenantA, pubId]
      ),
      /orchestrator_campaign_publish_approvals_immutable/
    );
    await p.query(
      `UPDATE orchestrator_campaign_publish_approvals SET revoked_at=now() WHERE tenant_id=$1 AND id=$2`,
      [tenantA, pubId]
    );
    const row = (await p.query(
      `SELECT revoked_at FROM orchestrator_campaign_publish_approvals WHERE tenant_id=$1 AND id=$2`,
      [tenantA, pubId]
    )).rows[0];
    assert.ok(row.revoked_at);
    await assert.rejects(
      () => p.query(
        `UPDATE orchestrator_campaign_publish_approvals SET revoked_at=now() WHERE tenant_id=$1 AND id=$2`,
        [tenantA, pubId]
      ),
      /orchestrator_campaign_publish_approvals_immutable/
    );
  });

  test('cross-tenant PK isolation and unique idempotency_key', async () => {
    const p = db.getPool();
    const sharedId = nid('shared');
    await insertDraft(p, tenantA, hostA, { id: sharedId, idempotencyKey: nid('ia') });
    await insertDraft(p, tenantB, hostB, { id: sharedId, idempotencyKey: nid('ib') });
    const n = (await p.query(`SELECT COUNT(*)::int AS n FROM orchestrator_campaign_drafts WHERE id=$1`, [sharedId])).rows[0].n;
    assert.strictEqual(n, 2);
    const idemp = nid('dup');
    await insertDraft(p, tenantA, hostA, { idempotencyKey: idemp });
    await assert.rejects(() => insertDraft(p, tenantA, hostA, { idempotencyKey: idemp }), /unique|duplicate/i);
  });
}
