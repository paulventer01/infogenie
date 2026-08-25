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
const TABLE = 'orchestrator_campaign_delivery_intents';
const PUB_TABLE = 'orchestrator_campaign_publish_requests';
const DRAFT_TABLE = 'orchestrator_campaign_drafts';
const SCHEMA_SRC_PATH = path.join(__dirname, '../services/agent_orchestrator/schema.js');
const HEX = 'a'.repeat(64);
const SUFFIX = `ao6c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let seq = 0;
const nid = (p) => { seq += 1; return `${p}-${SUFFIX}-${seq}`; };
const nextHex = () => { seq += 1; return seq.toString(16).padStart(64, '0'); };

const REQUIRED_COLUMNS = [
  'id', 'tenant_id', 'publishing_request_id', 'draft_id', 'publish_approval_id',
  'workflow_approval_id', 'outbox_id', 'revision', 'contract_hash', 'snapshot_hash',
  'intent_hash', 'contract_version', 'operation', 'status', 'idempotency_key',
  'requested_by', 'created_at',
];

const FORBIDDEN_COLUMNS = [
  'credential', 'credentials', 'credential_ref', 'token', 'tokens', 'access_token',
  'refresh_token', 'secret', 'password', 'vault', 'vault_payload', 'authorization',
  'header', 'headers', 'provider', 'provider_data', 'provider_campaign_id',
  'external_campaign_id', 'external_id', 'body', 'request_body', 'raw_body',
  'confirmation_phrase', 'confirmation_text', 'confirm_phrase', 'snapshot_json',
  'snapshot', 'payload', 'api_key',
];

const FORBIDDEN_SURFACE_RE = /\b(credential|vault|token|header|provider|external_campaign|confirmation_phrase|snapshot_json|request_body|raw_body|api_key)\b/i;

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

async function insertOutbox(q, tenantId, host, outboxId, opts = {}) {
  await q.query(
    `INSERT INTO orchestrator_outbox
       (id, tenant_id, workflow_id, destination, operation, payload, state, idempotency_key)
     VALUES ($1,$2,$3,'internal','create_provider_draft','{}'::jsonb,'pending',$4)`,
    [outboxId, tenantId, host.wfId, opts.outboxIdempotencyKey || nid('oidemp')]
  );
  return outboxId;
}

async function insertIntent(q, tenantId, host, draftId, publishApprovalId, publishingRequestId, opts = {}) {
  const id = opts.id || nid('intent');
  const outboxId = opts.outboxId || nid('obx');
  await q.query(
    `INSERT INTO orchestrator_campaign_delivery_intents
       (id, tenant_id, publishing_request_id, draft_id, publish_approval_id, workflow_approval_id,
        outbox_id, revision, contract_hash, snapshot_hash, intent_hash, contract_version,
        operation, status, idempotency_key, requested_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      id, tenantId, publishingRequestId, draftId, publishApprovalId,
      opts.workflowApprovalId || host.approvalId, outboxId,
      opts.revision == null ? 1 : opts.revision, opts.contractHash || HEX,
      opts.snapshotHash || nextHex(), opts.intentHash || nextHex(),
      opts.contractVersion || 'campaign_delivery_v1',
      opts.operation || 'create_provider_draft',
      opts.status || 'pending',
      opts.idempotencyKey || nid('iidemp'),
      opts.requestedBy,
    ]
  );
  return { id, outboxId };
}

async function insertBoundIntent(p, tenantId, host, draftId, publishApprovalId, publishingRequestId, opts = {}) {
  const outboxId = opts.outboxId || nid('obx');
  await insertOutbox(p, tenantId, host, outboxId, opts);
  const row = await insertIntent(p, tenantId, host, draftId, publishApprovalId, publishingRequestId, {
    ...opts, outboxId,
  });
  return row;
}

test('PR6C delivery-intent CREATE TABLE is tenant-leading, frozen, and omits forbidden surfaces', () => {
  const src = schemaSrc();
  assert.match(src, /'orchestrator_campaign_delivery_intents'/);
  assert.match(src, /CREATE TABLE IF NOT EXISTS orchestrator_campaign_delivery_intents/);
  assert.match(src, /ADD COLUMN IF NOT EXISTS publishing_request_id TEXT/);
  assert.match(src, /ADD COLUMN IF NOT EXISTS outbox_id TEXT/);
  assert.match(src, /ADD COLUMN IF NOT EXISTS intent_hash TEXT/);
  assert.match(src, /_ensureNamedUnique\(p, 'orchestrator_campaign_delivery_intents'/);
  assert.match(src, /_ensureNamedFk\(p, 'orchestrator_campaign_delivery_intents'/);
  assert.match(src, /_ensureNamedCheck\(p, 'orchestrator_campaign_delivery_intents'/);
  assert.match(src, /_installInTransaction\(p, `/);

  const pubIdx = src.indexOf('CREATE TABLE IF NOT EXISTS orchestrator_campaign_publish_requests');
  const intentIdx = src.indexOf('CREATE TABLE IF NOT EXISTS orchestrator_campaign_delivery_intents');
  assert.ok(pubIdx >= 0 && intentIdx > pubIdx, 'delivery intents must be created after PR6B publish requests');
  assert.match(src, /'orchestrator_campaign_publish_requests',\s*'orchestrator_campaign_delivery_intents'/);

  const create = extractCreateTable(src, TABLE);
  assert.match(create, /PRIMARY KEY \(tenant_id, id\)/);
  assert.match(create, /REFERENCES tenants\(id\) ON DELETE CASCADE/);
  assert.match(create, /orchestrator_campaign_delivery_intents_tenant_unique_pub_req/);
  assert.match(create, /UNIQUE \(tenant_id, publishing_request_id\)/);
  assert.match(create, /orchestrator_campaign_delivery_intents_tenant_unique_outbox/);
  assert.match(create, /UNIQUE \(tenant_id, outbox_id\)/);
  assert.match(create, /orchestrator_campaign_delivery_intents_tenant_unique_idemp/);
  assert.match(create, /UNIQUE \(tenant_id, idempotency_key\)/);
  assert.match(create, /contract_version TEXT NOT NULL DEFAULT 'campaign_delivery_v1'/);
  assert.match(create, /CHECK \(contract_version = 'campaign_delivery_v1'\)/);
  assert.match(create, /operation TEXT NOT NULL DEFAULT 'create_provider_draft'/);
  assert.match(create, /CHECK \(operation = 'create_provider_draft'\)/);
  assert.match(create, /status TEXT NOT NULL DEFAULT 'pending'/);
  assert.match(create, /CHECK \(status = 'pending'\)/);
  const namedIdents = src.match(/orchestrator_campaign_delivery_intents_[a-z0-9_]+|idx_orchestrator_campaign_delivery_intents_[a-z0-9_]+/g) || [];
  for (const name of new Set(namedIdents)) {
    assert.ok(name.length <= 63, `${name} exceeds Postgres 63-char identifier limit (${name.length})`);
  }
  assert.match(create, /requested_by INTEGER NOT NULL REFERENCES users\(id\)/);
  assert.match(create, /created_at TIMESTAMPTZ NOT NULL DEFAULT now\(\)/);
  assert.match(create, /contract_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(create, /snapshot_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(create, /intent_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.doesNotMatch(create, /\[0-9a-fA-F\]/);
  assert.doesNotMatch(create, FORBIDDEN_SURFACE_RE);
  for (const col of FORBIDDEN_COLUMNS) {
    assert.doesNotMatch(create, new RegExp(`\\b${col}\\b`, 'i'), `CREATE TABLE must not declare ${col}`);
  }

  assert.match(src, /orchestrator_campaign_delivery_intents_tenant_pub_req_fkey/);
  assert.match(src, /orchestrator_campaign_publish_requests', 'tenant_id, id'/);
  assert.match(src, /orchestrator_campaign_delivery_intents_tenant_draft_fkey/);
  assert.match(src, /orchestrator_campaign_drafts', 'tenant_id, id'/);
  assert.match(src, /orchestrator_campaign_delivery_intents_tenant_pub_appr_fkey/);
  assert.match(src, /orchestrator_campaign_publish_approvals', 'tenant_id, id'/);
  assert.match(src, /orchestrator_campaign_delivery_intents_tenant_wf_appr_fkey/);
  assert.match(src, /orchestrator_approvals', 'tenant_id, id'/);
  assert.match(src, /orchestrator_campaign_delivery_intents_tenant_outbox_fkey/);
  assert.match(src, /orchestrator_outbox', 'tenant_id, id'/);
  assert.match(src, /'tenant_id, outbox_id', 'orchestrator_outbox', 'tenant_id, id',\s*'ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED'/);

  const fn = extractFunctionSource(src, 'orchestrator_campaign_delivery_intents_immutable');
  assert.match(fn, /TG_OP = 'UPDATE'/);
  assert.match(fn, /RAISE EXCEPTION 'orchestrator_campaign_delivery_intents_immutable'/);
  assert.match(fn, /FROM tenants t WHERE t\.id = OLD\.tenant_id/);
  assert.match(src, /BEFORE UPDATE OR DELETE ON orchestrator_campaign_delivery_intents/);
});

if (!HAS_DB) {
  test('advertising-orchestrator campaign-delivery-intent schema skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
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
    tenantA = await mk(`AO6C A ${SUFFIX}`, `ao6c-a-${SUFFIX}`);
    tenantB = await mk(`AO6C B ${SUFFIX}`, `ao6c-b-${SUFFIX}`);
    hostA = await seedHost(p, tenantA);
    hostB = await seedHost(p, tenantB);
    userId = (await p.query(
      `INSERT INTO users (email, password_hash, name) VALUES ($1,'x','pr6c') RETURNING id`,
      [`pr6c-${SUFFIX}@example.test`]
    )).rows[0].id;
  });

  after(async () => {
    const p = db.getPool();
    const ids = [tenantA, tenantB].filter(Boolean);
    if (ids.length) await p.query(`DELETE FROM tenants WHERE id = ANY($1)`, [ids]);
    if (userId) await p.query(`DELETE FROM users WHERE id=$1`, [userId]);
  });

  test('PR6C table exists with tenant-leading PK and required columns only', async () => {
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

  test('named uniques, tenant-first indexes, and tenant-scoped FKs match parent keys', async () => {
    const uniques = await pkAndUniques(TABLE);
    assert.ok(uniques.some((c) => c.constraint_name === 'orchestrator_campaign_delivery_intents_tenant_unique_pub_req'
      && c.cols === 'tenant_id,publishing_request_id'));
    assert.ok(uniques.some((c) => c.constraint_name === 'orchestrator_campaign_delivery_intents_tenant_unique_outbox'
      && c.cols === 'tenant_id,outbox_id'));
    assert.ok(uniques.some((c) => c.constraint_name === 'orchestrator_campaign_delivery_intents_tenant_unique_idemp'
      && c.cols === 'tenant_id,idempotency_key'));

    const p = db.getPool();
    const indexes = (await p.query(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=$1`,
      [TABLE]
    )).rows;
    assert.ok(indexes.some((i) => i.indexname === 'idx_orchestrator_campaign_delivery_intents_tenant_draft'
      && /\(tenant_id, draft_id\)/.test(i.indexdef)));
    assert.ok(indexes.some((i) => i.indexname === 'idx_orchestrator_campaign_delivery_intents_tenant_pub_appr'
      && /\(tenant_id, publish_approval_id\)/.test(i.indexdef)));

    const fks = await fkRows(TABLE);
    const reqFk = fks.find((f) => f.conname === 'orchestrator_campaign_delivery_intents_tenant_pub_req_fkey');
    assert.ok(reqFk);
    assert.strictEqual(reqFk.cols, 'tenant_id,publishing_request_id');
    assert.strictEqual(reqFk.ref_table, 'orchestrator_campaign_publish_requests');
    assert.strictEqual(reqFk.deltype, 'c');
    const draftFk = fks.find((f) => f.conname === 'orchestrator_campaign_delivery_intents_tenant_draft_fkey');
    assert.ok(draftFk);
    assert.strictEqual(draftFk.cols, 'tenant_id,draft_id');
    assert.strictEqual(draftFk.ref_table, 'orchestrator_campaign_drafts');
    assert.strictEqual(draftFk.deltype, 'c');
    const pubFk = fks.find((f) => f.conname === 'orchestrator_campaign_delivery_intents_tenant_pub_appr_fkey');
    assert.ok(pubFk);
    assert.strictEqual(pubFk.cols, 'tenant_id,publish_approval_id');
    assert.strictEqual(pubFk.ref_table, 'orchestrator_campaign_publish_approvals');
    assert.strictEqual(pubFk.deltype, 'c');
    const wfFk = fks.find((f) => f.conname === 'orchestrator_campaign_delivery_intents_tenant_wf_appr_fkey');
    assert.ok(wfFk);
    assert.strictEqual(wfFk.cols, 'tenant_id,workflow_approval_id');
    assert.strictEqual(wfFk.ref_table, 'orchestrator_approvals');
    assert.strictEqual(wfFk.deltype, 'a');
    assert.strictEqual(wfFk.deferrable, true);
    assert.strictEqual(wfFk.deferred, true);
    const outboxFk = fks.find((f) => f.conname === 'orchestrator_campaign_delivery_intents_tenant_outbox_fkey');
    assert.ok(outboxFk);
    assert.strictEqual(outboxFk.cols, 'tenant_id,outbox_id');
    assert.strictEqual(outboxFk.ref_table, 'orchestrator_outbox');
    assert.strictEqual(outboxFk.deltype, 'a');
    assert.strictEqual(outboxFk.deferrable, true);
    assert.strictEqual(outboxFk.deferred, true);
  });

  test('contract_version, operation, and status are frozen at campaign_delivery_v1/create_provider_draft/pending', async () => {
    const checks = await checkNames(TABLE);
    assert.ok(checks.includes('orchestrator_campaign_delivery_intents_contract_ver_check'));
    assert.ok(checks.includes('orchestrator_campaign_delivery_intents_operation_check'));
    assert.ok(checks.includes('orchestrator_campaign_delivery_intents_status_check'));
    const versionDef = await checkDef(TABLE, 'orchestrator_campaign_delivery_intents_contract_ver_check');
    assert.match(versionDef.definition, /contract_version = 'campaign_delivery_v1'/);
    const opDef = await checkDef(TABLE, 'orchestrator_campaign_delivery_intents_operation_check');
    assert.match(opDef.definition, /operation = 'create_provider_draft'/);
    const statusDef = await checkDef(TABLE, 'orchestrator_campaign_delivery_intents_status_check');
    assert.match(statusDef.definition, /status = 'pending'/);

    const p = db.getPool();
    const draftId = await insertDraft(p, tenantA, hostA);
    const pubId = await insertPublishApproval(p, tenantA, hostA, draftId, { actorUserId: userId });
    const reqId = await insertRequest(p, tenantA, hostA, draftId, pubId, { requestedBy: userId });
    await assert.rejects(
      () => insertBoundIntent(p, tenantA, hostA, draftId, pubId, reqId, {
        requestedBy: userId, contractVersion: 'campaign_delivery_v2',
      }),
      /contract_version|check/i
    );
    await assert.rejects(
      () => insertBoundIntent(p, tenantA, hostA, draftId, pubId, reqId, {
        requestedBy: userId, operation: 'activate_campaign',
      }),
      /operation|check/i
    );
    await assert.rejects(
      () => insertBoundIntent(p, tenantA, hostA, draftId, pubId, reqId, {
        requestedBy: userId, status: 'enqueued',
      }),
      /status|check/i
    );
    const row = await insertBoundIntent(p, tenantA, hostA, draftId, pubId, reqId, { requestedBy: userId });
    const stored = (await p.query(
      `SELECT contract_version, operation, status FROM ${TABLE} WHERE tenant_id=$1 AND id=$2`,
      [tenantA, row.id]
    )).rows[0];
    assert.strictEqual(stored.contract_version, 'campaign_delivery_v1');
    assert.strictEqual(stored.operation, 'create_provider_draft');
    assert.strictEqual(stored.status, 'pending');
  });

  test('lowercase 64-character hash checks and bounded identifiers', async () => {
    const checks = await checkNames(TABLE);
    assert.ok(checks.includes('orchestrator_campaign_delivery_intents_contract_hash_check'));
    assert.ok(checks.includes('orchestrator_campaign_delivery_intents_snapshot_hash_check'));
    assert.ok(checks.includes('orchestrator_campaign_delivery_intents_intent_hash_check'));
    assert.ok(checks.includes('orchestrator_campaign_delivery_intents_len_check'));
    assert.ok(checks.includes('orchestrator_campaign_delivery_intents_revision_check'));
    for (const name of [
      'orchestrator_campaign_delivery_intents_contract_hash_check',
      'orchestrator_campaign_delivery_intents_snapshot_hash_check',
      'orchestrator_campaign_delivery_intents_intent_hash_check',
    ]) {
      const def = await checkDef(TABLE, name);
      assert.match(def.definition, /char_length\([a-z_]+\)\s*=\s*64/);
      assert.match(def.definition, /\^\[0-9a-f\]\{64\}\$/);
      assert.doesNotMatch(def.definition, /\[0-9a-fA-F\]/);
    }

    const p = db.getPool();
    const draftId = await insertDraft(p, tenantA, hostA);
    const pubId = await insertPublishApproval(p, tenantA, hostA, draftId, { actorUserId: userId });
    const reqId = await insertRequest(p, tenantA, hostA, draftId, pubId, { requestedBy: userId });
    await assert.rejects(
      () => insertBoundIntent(p, tenantA, hostA, draftId, pubId, reqId, {
        requestedBy: userId, contractHash: 'A'.repeat(64),
      }),
      /contract_hash|check/i
    );
    await assert.rejects(
      () => insertBoundIntent(p, tenantA, hostA, draftId, pubId, reqId, {
        requestedBy: userId, snapshotHash: 'abc',
      }),
      /snapshot_hash|check/i
    );
    await assert.rejects(
      () => insertBoundIntent(p, tenantA, hostA, draftId, pubId, reqId, {
        requestedBy: userId, intentHash: `${HEX}aa`,
      }),
      /intent_hash|check/i
    );
    await assert.rejects(
      () => insertBoundIntent(p, tenantA, hostA, draftId, pubId, reqId, {
        requestedBy: userId, id: 'x'.repeat(129),
      }),
      /len_check|check/i
    );
    await assert.rejects(
      () => insertBoundIntent(p, tenantA, hostA, draftId, pubId, reqId, {
        requestedBy: userId, revision: 0,
      }),
      /revision|check/i
    );
    await insertBoundIntent(p, tenantA, hostA, draftId, pubId, reqId, {
      requestedBy: userId, contractHash: HEX, snapshotHash: nextHex(), intentHash: nextHex(),
    });
  });

  test('unique tenant/idempotency key, one intent per publish request, unique outbox binding', async () => {
    const p = db.getPool();
    const draftId = await insertDraft(p, tenantA, hostA);
    const pubId = await insertPublishApproval(p, tenantA, hostA, draftId, { actorUserId: userId });
    const reqId = await insertRequest(p, tenantA, hostA, draftId, pubId, { requestedBy: userId });
    const idemp = nid('same-idemp');
    const first = await insertBoundIntent(p, tenantA, hostA, draftId, pubId, reqId, {
      requestedBy: userId, idempotencyKey: idemp,
    });
    await assert.rejects(
      () => insertBoundIntent(p, tenantA, hostA, draftId, pubId, reqId, {
        requestedBy: userId, idempotencyKey: nid('other-idemp'),
      }),
      /unique|duplicate/i,
      'duplicate tenant/publishing_request_id must be rejected'
    );

    const draft2 = await insertDraft(p, tenantA, hostA);
    const pub2 = await insertPublishApproval(p, tenantA, hostA, draft2, { actorUserId: userId });
    const req2 = await insertRequest(p, tenantA, hostA, draft2, pub2, { requestedBy: userId });
    await assert.rejects(
      () => insertBoundIntent(p, tenantA, hostA, draft2, pub2, req2, {
        requestedBy: userId, idempotencyKey: idemp,
      }),
      /unique|duplicate/i,
      'duplicate tenant/idempotency_key must be rejected'
    );
    await assert.rejects(
      () => insertIntent(p, tenantA, hostA, draft2, pub2, req2, {
        requestedBy: userId, outboxId: first.outboxId,
      }),
      /unique|duplicate/i,
      'duplicate tenant/outbox_id must be rejected'
    );

    const draftB = await insertDraft(p, tenantB, hostB);
    const pubB = await insertPublishApproval(p, tenantB, hostB, draftB, { actorUserId: userId });
    const reqB = await insertRequest(p, tenantB, hostB, draftB, pubB, { requestedBy: userId });
    await insertBoundIntent(p, tenantB, hostB, draftB, pubB, reqB, {
      requestedBy: userId, idempotencyKey: idemp,
    });
  });

  test('tenant-scoped FKs reject cross-tenant publish request, draft, approval, workflow approval, and outbox', async () => {
    const p = db.getPool();
    const draftA = await insertDraft(p, tenantA, hostA);
    const pubA = await insertPublishApproval(p, tenantA, hostA, draftA, { actorUserId: userId });
    const reqA = await insertRequest(p, tenantA, hostA, draftA, pubA, { requestedBy: userId });
    const draftB = await insertDraft(p, tenantB, hostB);
    const pubB = await insertPublishApproval(p, tenantB, hostB, draftB, { actorUserId: userId });
    const reqB = await insertRequest(p, tenantB, hostB, draftB, pubB, { requestedBy: userId });
    const outboxB = nid('obx-b');
    await insertOutbox(p, tenantB, hostB, outboxB);

    await assert.rejects(
      () => insertBoundIntent(p, tenantA, hostA, draftA, pubA, reqB, { requestedBy: userId }),
      /foreign key|violates/i
    );
    await assert.rejects(
      () => insertBoundIntent(p, tenantA, hostA, draftB, pubA, reqA, { requestedBy: userId }),
      /foreign key|violates/i
    );
    await assert.rejects(
      () => insertBoundIntent(p, tenantA, hostA, draftA, pubB, reqA, { requestedBy: userId }),
      /foreign key|violates/i
    );
    await assert.rejects(
      () => insertBoundIntent(p, tenantA, hostB, draftA, pubA, reqA, {
        requestedBy: userId, workflowApprovalId: hostB.approvalId,
      }),
      /foreign key|violates/i
    );
    await assert.rejects(
      () => insertIntent(p, tenantA, hostA, draftA, pubA, reqA, {
        requestedBy: userId, outboxId: outboxB,
      }),
      /foreign key|violates/i
    );
    await assert.rejects(
      () => insertBoundIntent(p, tenantA, hostA, nid('missing-draft'), pubA, reqA, { requestedBy: userId }),
      /foreign key|violates/i
    );
  });

  test('pregenerated outbox id deferred FK allows intent-then-outbox in one TX and rejects missing outbox at commit', async () => {
    const p = db.getPool();
    const draftId = await insertDraft(p, tenantA, hostA);
    const pubId = await insertPublishApproval(p, tenantA, hostA, draftId, { actorUserId: userId });
    const reqId = await insertRequest(p, tenantA, hostA, draftId, pubId, { requestedBy: userId });
    const client = await p.connect();
    try {
      await client.query('BEGIN');
      const missing = await insertIntent(client, tenantA, hostA, draftId, pubId, reqId, { requestedBy: userId });
      await assert.rejects(() => client.query('COMMIT'), /foreign key|violates/i);
      try { await client.query('ROLLBACK'); } catch (_) { /* already aborted */ }

      const draft2 = await insertDraft(p, tenantA, hostA);
      const pub2 = await insertPublishApproval(p, tenantA, hostA, draft2, { actorUserId: userId });
      const req2 = await insertRequest(p, tenantA, hostA, draft2, pub2, { requestedBy: userId });
      await client.query('BEGIN');
      const bound = await insertIntent(client, tenantA, hostA, draft2, pub2, req2, { requestedBy: userId });
      await insertOutbox(client, tenantA, hostA, bound.outboxId);
      await client.query('COMMIT');
      const still = (await p.query(
        `SELECT 1 FROM ${TABLE} WHERE tenant_id=$1 AND id=$2`, [tenantA, bound.id]
      )).rowCount;
      assert.equal(still, 1);
      assert.ok(missing.id);
    } finally {
      client.release();
    }
  });

  test('cross-tenant PK isolation allows the same intent id', async () => {
    const p = db.getPool();
    const sharedId = nid('shared');
    const draftA = await insertDraft(p, tenantA, hostA);
    const pubA = await insertPublishApproval(p, tenantA, hostA, draftA, { actorUserId: userId });
    const reqA = await insertRequest(p, tenantA, hostA, draftA, pubA, { requestedBy: userId });
    const draftB = await insertDraft(p, tenantB, hostB);
    const pubB = await insertPublishApproval(p, tenantB, hostB, draftB, { actorUserId: userId });
    const reqB = await insertRequest(p, tenantB, hostB, draftB, pubB, { requestedBy: userId });
    await insertBoundIntent(p, tenantA, hostA, draftA, pubA, reqA, { id: sharedId, requestedBy: userId });
    await insertBoundIntent(p, tenantB, hostB, draftB, pubB, reqB, { id: sharedId, requestedBy: userId });
    const n = (await p.query(`SELECT COUNT(*)::int AS n FROM ${TABLE} WHERE id=$1`, [sharedId])).rows[0].n;
    assert.strictEqual(n, 2);
  });

  test('database-enforced immutability rejects UPDATE and ordinary DELETE', async () => {
    const p = db.getPool();
    const draftId = await insertDraft(p, tenantA, hostA);
    const pubId = await insertPublishApproval(p, tenantA, hostA, draftId, { actorUserId: userId });
    const reqId = await insertRequest(p, tenantA, hostA, draftId, pubId, { requestedBy: userId });
    const row = await insertBoundIntent(p, tenantA, hostA, draftId, pubId, reqId, { requestedBy: userId });
    await assert.rejects(
      () => p.query(`UPDATE ${TABLE} SET status='pending' WHERE tenant_id=$1 AND id=$2`, [tenantA, row.id]),
      /orchestrator_campaign_delivery_intents_immutable/
    );
    await assert.rejects(
      () => p.query(`UPDATE ${TABLE} SET intent_hash=$3 WHERE tenant_id=$1 AND id=$2`, [tenantA, row.id, nextHex()]),
      /orchestrator_campaign_delivery_intents_immutable/
    );
    await assert.rejects(
      () => p.query(`UPDATE ${TABLE} SET snapshot_hash=$3 WHERE tenant_id=$1 AND id=$2`, [tenantA, row.id, nextHex()]),
      /orchestrator_campaign_delivery_intents_immutable/
    );
    await assert.rejects(
      () => p.query(`UPDATE ${TABLE} SET requested_by=$3 WHERE tenant_id=$1 AND id=$2`, [tenantA, row.id, userId]),
      /orchestrator_campaign_delivery_intents_immutable/
    );
    await assert.rejects(
      () => p.query(`DELETE FROM ${TABLE} WHERE tenant_id=$1 AND id=$2`, [tenantA, row.id]),
      /orchestrator_campaign_delivery_intents_immutable/
    );
    const still = (await p.query(`SELECT 1 FROM ${TABLE} WHERE tenant_id=$1 AND id=$2`, [tenantA, row.id])).rowCount;
    assert.equal(still, 1);
  });

  test('DELETE FROM tenants cascades delivery intents while ordinary DELETE stays blocked', async () => {
    const p = db.getPool();
    const tenantC = (await p.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [`AO6C C ${SUFFIX}`, `ao6c-c-${SUFFIX}`]
    )).rows[0].id;
    const hostC = await seedHost(p, tenantC);
    const draftId = await insertDraft(p, tenantC, hostC);
    const pubId = await insertPublishApproval(p, tenantC, hostC, draftId, { actorUserId: userId });
    const reqId = await insertRequest(p, tenantC, hostC, draftId, pubId, { requestedBy: userId });
    const row = await insertBoundIntent(p, tenantC, hostC, draftId, pubId, reqId, { requestedBy: userId });
    await assert.rejects(
      () => p.query(`DELETE FROM ${TABLE} WHERE tenant_id=$1 AND id=$2`, [tenantC, row.id]),
      /orchestrator_campaign_delivery_intents_immutable/
    );
    await p.query(`DELETE FROM tenants WHERE id=$1`, [tenantC]);
    const gone = (await p.query(`SELECT 1 FROM ${TABLE} WHERE tenant_id=$1`, [tenantC])).rowCount;
    assert.equal(gone, 0);
    const outboxGone = (await p.query(
      `SELECT 1 FROM orchestrator_outbox WHERE tenant_id=$1`, [tenantC]
    )).rowCount;
    assert.equal(outboxGone, 0);
  });

  test('PR6A draft and PR6B publish-request status constraints stay frozen', async () => {
    const draftStatus = await checkDef(DRAFT_TABLE, 'orchestrator_campaign_drafts_status_check');
    assert.match(draftStatus.definition, /approved_for_publish/);
    assert.match(draftStatus.definition, /'draft'/);
    const reqStatus = await checkDef(PUB_TABLE, 'orchestrator_campaign_publish_requests_status_check');
    assert.match(reqStatus.definition, /status = 'requested'/);
    const reqConfirm = await checkDef(PUB_TABLE, 'orchestrator_campaign_publish_requests_confirm_ver_check');
    assert.match(reqConfirm.definition, /confirmation_version = 1/);
  });

  test('ensureSchema restores dropped status CHECK', async () => {
    const p = db.getPool();
    const name = 'orchestrator_campaign_delivery_intents_status_check';
    await p.query(`ALTER TABLE ${TABLE} DROP CONSTRAINT ${name}`);
    await ensureAgentOrchestratorSchema();
    const after = (await p.query(`SELECT 1 FROM pg_constraint WHERE conname=$1`, [name])).rowCount;
    assert.equal(after, 1, 'ensureSchema must restore dropped status CHECK');
  });
}
