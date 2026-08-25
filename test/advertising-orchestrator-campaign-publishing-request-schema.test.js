'use strict';

process.env.PERMISSION_ENFORCEMENT = 'on';
process.env.MULTITENANT_ENFORCEMENT = 'on';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../db');
const { ensureAgentOrchestratorSchema } = require('../services/agent_orchestrator/schema');
const { ensureTenantSchema } = require('../services/tenants/schema');
const { ensureAuthSchema } = require('../services/auth/schema');

const HAS_DB = db.hasDb();
const TABLE = 'orchestrator_campaign_publish_requests';
const SCHEMA_SRC_PATH = path.join(__dirname, '../services/agent_orchestrator/schema.js');
const HEX = 'a'.repeat(64);
const SUFFIX = `ao6b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let seq = 0;
const nid = (p) => { seq += 1; return `${p}-${SUFFIX}-${seq}`; };
const nextHex = () => { seq += 1; return seq.toString(16).padStart(64, '0'); };

const REQUIRED_COLUMNS = [
  'id', 'tenant_id', 'draft_id', 'publish_approval_id', 'workflow_approval_id',
  'revision', 'contract_hash', 'snapshot_hash', 'requested_by', 'status',
  'confirmation_version', 'idempotency_key', 'request_hash', 'requested_at', 'created_at',
];

const FORBIDDEN_COLUMNS = [
  'credential', 'credentials', 'credential_ref', 'token', 'tokens', 'access_token',
  'refresh_token', 'secret', 'password', 'vault', 'vault_payload', 'authorization',
  'header', 'headers', 'provider', 'provider_data', 'provider_campaign_id',
  'external_campaign_id', 'external_id', 'body', 'request_body', 'raw_body',
  'confirmation_phrase', 'confirmation_text', 'confirm_phrase', 'snapshot_json',
  'snapshot', 'payload', 'api_key',
];

const FORBIDDEN_SURFACE_RE = /credential|vault|token|header|provider|external_campaign|confirmation_phrase|snapshot_json|request_body|raw_body|api_key/i;

function schemaSrc() {
  return fs.readFileSync(SCHEMA_SRC_PATH, 'utf8');
}

function extractCreateTable(src, table) {
  const start = src.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
  assert.ok(start >= 0, `${table} CREATE TABLE IF NOT EXISTS must exist`);
  const from = src.indexOf('(', start);
  let depth = 0;
  for (let i = from; i < src.length; i += 1) {
    if (src[i] === '(') depth += 1;
    else if (src[i] === ')') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unclosed CREATE TABLE for ${table}`);
}

function extractFunctionSource(src, name) {
  const start = src.indexOf(`CREATE OR REPLACE FUNCTION ${name}`);
  assert.ok(start >= 0, `${name} must exist`);
  const marker = src.indexOf('$fn$', start);
  const end = src.indexOf('$fn$ LANGUAGE plpgsql', marker + 4);
  assert.ok(end > marker, `${name} function body must close`);
  return src.slice(start, end);
}

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

async function checkDef(table, name) {
  return (await db.getPool().query(
    `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint WHERE conrelid=$1::regclass AND conname=$2`,
    [`public.${table}`, name]
  )).rows[0];
}

async function fkRows(table) {
  return (await db.getPool().query(
    `SELECT con.conname,
            string_agg(att.attname, ',' ORDER BY k.n) AS cols,
            ref.relname AS ref_table,
            con.confdeltype AS deltype,
            con.condeferrable AS deferrable,
            con.condeferred AS deferred
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
       JOIN pg_class ref ON ref.oid = con.confrelid
       JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, n) ON true
       JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = k.attnum
      WHERE nsp.nspname='public' AND rel.relname=$1 AND con.contype='f'
      GROUP BY con.oid, con.conname, ref.relname, con.confdeltype, con.condeferrable, con.condeferred`,
    [table]
  )).rows;
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
    [id, tenantId, host.wfId, hash, opts.idempotencyKey || nid('didemp'), opts.status || 'draft', opts.revision || 1]
  );
  return id;
}

async function insertPublishApproval(p, tenantId, host, draftId, opts = {}) {
  const id = opts.id || nid('pub');
  await p.query(
    `INSERT INTO orchestrator_campaign_publish_approvals
       (id, tenant_id, draft_id, revision, contract_hash, snapshot_json, workflow_approval_id,
        actor_user_id, idempotency_key, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,now()+'1 hour'::interval)`,
    [
      id, tenantId, draftId, opts.revision || 1, opts.contractHash || HEX,
      opts.snapshotJson || '{"ok":true}', opts.workflowApprovalId || host.approvalId,
      opts.actorUserId, opts.idempotencyKey || nid('pidemp'),
    ]
  );
  return id;
}

async function insertRequest(p, tenantId, host, draftId, publishApprovalId, opts = {}) {
  const id = opts.id || nid('req');
  await p.query(
    `INSERT INTO orchestrator_campaign_publish_requests
       (id, tenant_id, draft_id, publish_approval_id, workflow_approval_id, revision,
        contract_hash, snapshot_hash, requested_by, status, confirmation_version,
        idempotency_key, request_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      id, tenantId, draftId, publishApprovalId, opts.workflowApprovalId || host.approvalId,
      opts.revision == null ? 1 : opts.revision, opts.contractHash || HEX,
      opts.snapshotHash || nextHex(), opts.requestedBy, opts.status || 'requested',
      opts.confirmationVersion == null ? 1 : opts.confirmationVersion,
      opts.idempotencyKey || nid('ridemp'), opts.requestHash || nextHex(),
    ]
  );
  return id;
}

test('PR6B publish-request CREATE TABLE is tenant-leading, frozen, and omits forbidden surfaces', () => {
  const src = schemaSrc();
  assert.match(src, /'orchestrator_campaign_publish_requests'/);
  assert.match(src, /CREATE TABLE IF NOT EXISTS orchestrator_campaign_publish_requests/);
  assert.match(src, /ADD COLUMN IF NOT EXISTS publish_approval_id TEXT/);
  assert.match(src, /ADD COLUMN IF NOT EXISTS snapshot_hash TEXT/);
  assert.match(src, /ADD COLUMN IF NOT EXISTS request_hash TEXT/);
  assert.match(src, /_ensureNamedUnique\(p, 'orchestrator_campaign_publish_requests'/);
  assert.match(src, /_ensureNamedFk\(p, 'orchestrator_campaign_publish_requests'/);
  assert.match(src, /_ensureNamedCheck\(p, 'orchestrator_campaign_publish_requests'/);
  assert.match(src, /_installInTransaction\(p, `/);

  const create = extractCreateTable(src, TABLE);
  assert.match(create, /PRIMARY KEY \(tenant_id, id\)/);
  assert.match(create, /REFERENCES tenants\(id\) ON DELETE CASCADE/);
  assert.match(create, /orchestrator_campaign_publish_requests_tenant_unique_idemp/);
  assert.match(create, /UNIQUE \(tenant_id, idempotency_key\)/);
  assert.match(create, /orchestrator_campaign_publish_requests_tenant_unique_snapshot/);
  assert.match(create, /UNIQUE \(tenant_id, draft_id, revision, contract_hash, snapshot_hash\)/);
  assert.match(create, /status TEXT NOT NULL DEFAULT 'requested'/);
  assert.match(create, /CHECK \(status = 'requested'\)/);
  assert.match(create, /orchestrator_campaign_publish_requests_confirm_ver_check/);
  assert.match(create, /confirmation_version INTEGER NOT NULL DEFAULT 1/);
  assert.match(create, /CHECK \(\s*confirmation_version = 1\)/);
  const namedIdents = src.match(/orchestrator_campaign_publish_requests_[a-z0-9_]+|idx_orchestrator_campaign_publish_requests_[a-z0-9_]+/g) || [];
  for (const name of new Set(namedIdents)) {
    assert.ok(name.length <= 63, `${name} exceeds Postgres 63-char identifier limit (${name.length})`);
  }
  assert.match(create, /requested_by INTEGER NOT NULL REFERENCES users\(id\)/);
  assert.match(create, /requested_at TIMESTAMPTZ NOT NULL DEFAULT now\(\)/);
  assert.match(create, /created_at TIMESTAMPTZ NOT NULL DEFAULT now\(\)/);
  assert.match(create, /contract_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(create, /snapshot_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(create, /request_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.doesNotMatch(create, /\[0-9a-fA-F\]/);
  assert.doesNotMatch(create, FORBIDDEN_SURFACE_RE);
  for (const col of FORBIDDEN_COLUMNS) {
    assert.doesNotMatch(create, new RegExp(`\\b${col}\\b`, 'i'), `CREATE TABLE must not declare ${col}`);
  }

  assert.match(src, /orchestrator_campaign_publish_requests_tenant_draft_fkey/);
  assert.match(src, /orchestrator_campaign_drafts', 'tenant_id, id'/);
  assert.match(src, /orchestrator_campaign_publish_requests_tenant_pub_appr_fkey/);
  assert.match(src, /orchestrator_campaign_publish_approvals', 'tenant_id, id'/);
  assert.match(src, /orchestrator_campaign_publish_requests_tenant_wf_appr_fkey/);
  assert.match(src, /orchestrator_approvals', 'tenant_id, id'/);
  assert.match(src, /ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED/);

  const fn = extractFunctionSource(src, 'orchestrator_campaign_publish_requests_immutable');
  assert.match(fn, /TG_OP = 'UPDATE'/);
  assert.match(fn, /RAISE EXCEPTION 'orchestrator_campaign_publish_requests_immutable'/);
  assert.match(fn, /FROM tenants t WHERE t\.id = OLD\.tenant_id/);
  assert.match(src, /BEFORE UPDATE OR DELETE ON orchestrator_campaign_publish_requests/);
});

if (!HAS_DB) {
  test('advertising-orchestrator campaign-publishing-request schema skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
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
    tenantA = await mk(`AO6B A ${SUFFIX}`, `ao6b-a-${SUFFIX}`);
    tenantB = await mk(`AO6B B ${SUFFIX}`, `ao6b-b-${SUFFIX}`);
    hostA = await seedHost(p, tenantA);
    hostB = await seedHost(p, tenantB);
    userId = (await p.query(
      `INSERT INTO users (email, password_hash, name) VALUES ($1,'x','pr6b') RETURNING id`,
      [`pr6b-${SUFFIX}@example.test`]
    )).rows[0].id;
  });

  after(async () => {
    const p = db.getPool();
    const ids = [tenantA, tenantB].filter(Boolean);
    if (ids.length) await p.query(`DELETE FROM tenants WHERE id = ANY($1)`, [ids]);
    if (userId) await p.query(`DELETE FROM users WHERE id=$1`, [userId]);
  });

  test('PR6B table exists with tenant-leading PK and required columns only', async () => {
    const p = db.getPool();
    const present = (await p.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
      [TABLE]
    )).rows;
    assert.equal(present.length, 1);
    const cols = (await p.query(
      `SELECT column_name, is_nullable, data_type, column_default
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name=$1`,
      [TABLE]
    )).rows;
    const names = cols.map((c) => c.column_name).sort();
    assert.deepStrictEqual(names, [...REQUIRED_COLUMNS].sort());
    for (const name of REQUIRED_COLUMNS) {
      const col = cols.find((c) => c.column_name === name);
      assert.ok(col, `${name} must exist`);
      assert.strictEqual(col.is_nullable, 'NO', `${name} must be NOT NULL`);
    }
    const tenant = cols.find((c) => c.column_name === 'tenant_id');
    assert.strictEqual(tenant.data_type, 'integer');
    const pk = (await pkAndUniques(TABLE)).filter((c) => c.constraint_type === 'PRIMARY KEY');
    assert.ok(pk.some((c) => c.cols === 'tenant_id,id'), `${TABLE} PK must be (tenant_id, id)`);
    const forbidden = cols.filter((c) => FORBIDDEN_COLUMNS.includes(c.column_name)
      || /credential|token|secret|password|vault|header|provider|external_campaign|confirmation_phrase|snapshot_json/i.test(c.column_name));
    assert.deepStrictEqual(forbidden, [], `${TABLE} must not store forbidden surfaces`);
  });

  test('named uniques, indexes, and tenant-scoped FKs match parent keys', async () => {
    const uniques = await pkAndUniques(TABLE);
    assert.ok(uniques.some((c) => c.constraint_name === 'orchestrator_campaign_publish_requests_tenant_unique_idemp'
      && c.cols === 'tenant_id,idempotency_key'));
    assert.ok(uniques.some((c) => c.constraint_name === 'orchestrator_campaign_publish_requests_tenant_unique_snapshot'
      && c.cols === 'tenant_id,draft_id,revision,contract_hash,snapshot_hash'));

    const p = db.getPool();
    const indexes = (await p.query(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=$1`,
      [TABLE]
    )).rows;
    assert.ok(indexes.some((i) => i.indexname === 'idx_orchestrator_campaign_publish_requests_tenant_draft'
      && /\(tenant_id, draft_id\)/.test(i.indexdef)));
    assert.ok(indexes.some((i) => i.indexname === 'idx_orchestrator_campaign_publish_requests_tenant_pub_appr'
      && /\(tenant_id, publish_approval_id\)/.test(i.indexdef)));

    const fks = await fkRows(TABLE);
    const draftFk = fks.find((f) => f.conname === 'orchestrator_campaign_publish_requests_tenant_draft_fkey');
    assert.ok(draftFk);
    assert.strictEqual(draftFk.cols, 'tenant_id,draft_id');
    assert.strictEqual(draftFk.ref_table, 'orchestrator_campaign_drafts');
    assert.strictEqual(draftFk.deltype, 'c');
    const pubFk = fks.find((f) => f.conname === 'orchestrator_campaign_publish_requests_tenant_pub_appr_fkey');
    assert.ok(pubFk);
    assert.strictEqual(pubFk.cols, 'tenant_id,publish_approval_id');
    assert.strictEqual(pubFk.ref_table, 'orchestrator_campaign_publish_approvals');
    assert.strictEqual(pubFk.deltype, 'c');
    const wfFk = fks.find((f) => f.conname === 'orchestrator_campaign_publish_requests_tenant_wf_appr_fkey');
    assert.ok(wfFk);
    assert.strictEqual(wfFk.cols, 'tenant_id,workflow_approval_id');
    assert.strictEqual(wfFk.ref_table, 'orchestrator_approvals');
    assert.strictEqual(wfFk.deltype, 'a');
    assert.strictEqual(wfFk.deferrable, true);
    assert.strictEqual(wfFk.deferred, true);
  });

  test('status is frozen at requested and confirmation_version is frozen at 1', async () => {
    const checks = await checkNames(TABLE);
    assert.ok(checks.includes('orchestrator_campaign_publish_requests_status_check'));
    assert.ok(checks.includes('orchestrator_campaign_publish_requests_confirm_ver_check'));
    const statusDef = await checkDef(TABLE, 'orchestrator_campaign_publish_requests_status_check');
    assert.match(statusDef.definition, /status = 'requested'/);
    const versionDef = await checkDef(TABLE, 'orchestrator_campaign_publish_requests_confirm_ver_check');
    assert.match(versionDef.definition, /confirmation_version = 1/);

    const p = db.getPool();
    const draftId = await insertDraft(p, tenantA, hostA);
    const pubId = await insertPublishApproval(p, tenantA, hostA, draftId, { actorUserId: userId });
    await assert.rejects(
      () => insertRequest(p, tenantA, hostA, draftId, pubId, { requestedBy: userId, status: 'publishing' }),
      /status|check/i
    );
    await assert.rejects(
      () => insertRequest(p, tenantA, hostA, draftId, pubId, { requestedBy: userId, status: 'approved' }),
      /status|check/i
    );
    await assert.rejects(
      () => insertRequest(p, tenantA, hostA, draftId, pubId, { requestedBy: userId, confirmationVersion: 2 }),
      /confirmation_version|check/i
    );
    const id = await insertRequest(p, tenantA, hostA, draftId, pubId, { requestedBy: userId });
    const row = (await p.query(
      `SELECT status, confirmation_version FROM ${TABLE} WHERE tenant_id=$1 AND id=$2`,
      [tenantA, id]
    )).rows[0];
    assert.strictEqual(row.status, 'requested');
    assert.strictEqual(Number(row.confirmation_version), 1);
  });

  test('lowercase 64-character hash checks and bounded identifiers', async () => {
    const checks = await checkNames(TABLE);
    assert.ok(checks.includes('orchestrator_campaign_publish_requests_contract_hash_check'));
    assert.ok(checks.includes('orchestrator_campaign_publish_requests_snapshot_hash_check'));
    assert.ok(checks.includes('orchestrator_campaign_publish_requests_request_hash_check'));
    assert.ok(checks.includes('orchestrator_campaign_publish_requests_len_check'));
    assert.ok(checks.includes('orchestrator_campaign_publish_requests_revision_check'));
    for (const name of [
      'orchestrator_campaign_publish_requests_contract_hash_check',
      'orchestrator_campaign_publish_requests_snapshot_hash_check',
      'orchestrator_campaign_publish_requests_request_hash_check',
    ]) {
      const def = await checkDef(TABLE, name);
      assert.match(def.definition, /char_length\([a-z_]+\)\s*=\s*64/);
      assert.match(def.definition, /\^\[0-9a-f\]\{64\}\$/);
      assert.doesNotMatch(def.definition, /\[0-9a-fA-F\]/);
    }

    const p = db.getPool();
    const draftId = await insertDraft(p, tenantA, hostA);
    const pubId = await insertPublishApproval(p, tenantA, hostA, draftId, { actorUserId: userId });
    await assert.rejects(
      () => insertRequest(p, tenantA, hostA, draftId, pubId, { requestedBy: userId, contractHash: 'A'.repeat(64) }),
      /contract_hash|check/i
    );
    await assert.rejects(
      () => insertRequest(p, tenantA, hostA, draftId, pubId, { requestedBy: userId, snapshotHash: 'abc' }),
      /snapshot_hash|check/i
    );
    await assert.rejects(
      () => insertRequest(p, tenantA, hostA, draftId, pubId, { requestedBy: userId, requestHash: `${HEX}aa` }),
      /request_hash|check/i
    );
    await assert.rejects(
      () => insertRequest(p, tenantA, hostA, draftId, pubId, { requestedBy: userId, id: 'x'.repeat(129) }),
      /len_check|check/i
    );
    await assert.rejects(
      () => insertRequest(p, tenantA, hostA, draftId, pubId, { requestedBy: userId, revision: 0 }),
      /revision|check/i
    );
    await insertRequest(p, tenantA, hostA, draftId, pubId, {
      requestedBy: userId, contractHash: HEX, snapshotHash: nextHex(), requestHash: nextHex(),
    });
  });

  test('unique tenant/idempotency key and unique exact approved-snapshot request', async () => {
    const p = db.getPool();
    const draftId = await insertDraft(p, tenantA, hostA);
    const pubId = await insertPublishApproval(p, tenantA, hostA, draftId, { actorUserId: userId });
    const idemp = nid('same-idemp');
    const snapshotHash = nextHex();
    await insertRequest(p, tenantA, hostA, draftId, pubId, {
      requestedBy: userId, idempotencyKey: idemp, snapshotHash,
    });
    await assert.rejects(
      () => insertRequest(p, tenantA, hostA, draftId, pubId, {
        requestedBy: userId, idempotencyKey: idemp, snapshotHash: nextHex(),
      }),
      /unique|duplicate/i,
      'duplicate tenant/idempotency_key must be rejected'
    );
    await assert.rejects(
      () => insertRequest(p, tenantA, hostA, draftId, pubId, {
        requestedBy: userId, snapshotHash,
      }),
      /unique|duplicate/i,
      'duplicate exact approved-snapshot request must be rejected'
    );

    const draftB = await insertDraft(p, tenantB, hostB);
    const pubB = await insertPublishApproval(p, tenantB, hostB, draftB, { actorUserId: userId });
    await insertRequest(p, tenantB, hostB, draftB, pubB, {
      requestedBy: userId, idempotencyKey: idemp, snapshotHash,
    });
  });

  test('tenant-scoped FKs reject cross-tenant draft, approval, and workflow approval', async () => {
    const p = db.getPool();
    const draftA = await insertDraft(p, tenantA, hostA);
    const pubA = await insertPublishApproval(p, tenantA, hostA, draftA, { actorUserId: userId });
    const draftB = await insertDraft(p, tenantB, hostB);
    const pubB = await insertPublishApproval(p, tenantB, hostB, draftB, { actorUserId: userId });

    await assert.rejects(
      () => insertRequest(p, tenantA, hostA, draftB, pubA, { requestedBy: userId }),
      /foreign key|violates/i
    );
    await assert.rejects(
      () => insertRequest(p, tenantA, hostA, draftA, pubB, { requestedBy: userId }),
      /foreign key|violates/i
    );
    await assert.rejects(
      () => insertRequest(p, tenantA, hostB, draftA, pubA, {
        requestedBy: userId, workflowApprovalId: hostB.approvalId,
      }),
      /foreign key|violates/i
    );
    await assert.rejects(
      () => insertRequest(p, tenantA, hostA, nid('missing-draft'), pubA, { requestedBy: userId }),
      /foreign key|violates/i
    );
  });

  test('cross-tenant PK isolation allows the same request id', async () => {
    const p = db.getPool();
    const sharedId = nid('shared');
    const draftA = await insertDraft(p, tenantA, hostA);
    const pubA = await insertPublishApproval(p, tenantA, hostA, draftA, { actorUserId: userId });
    const draftB = await insertDraft(p, tenantB, hostB);
    const pubB = await insertPublishApproval(p, tenantB, hostB, draftB, { actorUserId: userId });
    await insertRequest(p, tenantA, hostA, draftA, pubA, { id: sharedId, requestedBy: userId });
    await insertRequest(p, tenantB, hostB, draftB, pubB, { id: sharedId, requestedBy: userId });
    const n = (await p.query(`SELECT COUNT(*)::int AS n FROM ${TABLE} WHERE id=$1`, [sharedId])).rows[0].n;
    assert.strictEqual(n, 2);
  });

  test('database-enforced immutability rejects UPDATE and DELETE', async () => {
    const p = db.getPool();
    const draftId = await insertDraft(p, tenantA, hostA);
    const pubId = await insertPublishApproval(p, tenantA, hostA, draftId, { actorUserId: userId });
    const id = await insertRequest(p, tenantA, hostA, draftId, pubId, { requestedBy: userId });
    await assert.rejects(
      () => p.query(`UPDATE ${TABLE} SET status='requested' WHERE tenant_id=$1 AND id=$2`, [tenantA, id]),
      /orchestrator_campaign_publish_requests_immutable/
    );
    await assert.rejects(
      () => p.query(`UPDATE ${TABLE} SET request_hash=$3 WHERE tenant_id=$1 AND id=$2`, [tenantA, id, nextHex()]),
      /orchestrator_campaign_publish_requests_immutable/
    );
    await assert.rejects(
      () => p.query(`UPDATE ${TABLE} SET snapshot_hash=$3 WHERE tenant_id=$1 AND id=$2`, [tenantA, id, nextHex()]),
      /orchestrator_campaign_publish_requests_immutable/
    );
    await assert.rejects(
      () => p.query(`UPDATE ${TABLE} SET requested_by=$3 WHERE tenant_id=$1 AND id=$2`, [tenantA, id, userId]),
      /orchestrator_campaign_publish_requests_immutable/
    );
    await assert.rejects(
      () => p.query(`DELETE FROM ${TABLE} WHERE tenant_id=$1 AND id=$2`, [tenantA, id]),
      /orchestrator_campaign_publish_requests_immutable/
    );
    const still = (await p.query(`SELECT 1 FROM ${TABLE} WHERE tenant_id=$1 AND id=$2`, [tenantA, id])).rowCount;
    assert.equal(still, 1);
  });

  test('ensureSchema restores dropped status CHECK', async () => {
    const p = db.getPool();
    const name = 'orchestrator_campaign_publish_requests_status_check';
    await p.query(`ALTER TABLE ${TABLE} DROP CONSTRAINT ${name}`);
    await ensureAgentOrchestratorSchema();
    const after = (await p.query(`SELECT 1 FROM pg_constraint WHERE conname=$1`, [name])).rowCount;
    assert.equal(after, 1, 'ensureSchema must restore dropped status CHECK');
  });
}
