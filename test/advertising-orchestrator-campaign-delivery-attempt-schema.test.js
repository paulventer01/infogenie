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
const TABLE = 'orchestrator_campaign_delivery_attempts';
const SCHEMA_SRC_PATH = path.join(__dirname, '../services/agent_orchestrator/schema.js');
const HEX = 'a'.repeat(64);
const SUFFIX = `ao6d-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let seq = 0;
const nid = (p) => { seq += 1; return `${p}-${SUFFIX}-${seq}`; };
const nextHex = () => { seq += 1; return seq.toString(16).padStart(64, '0'); };

const REQUIRED_COLUMNS = [
  'id', 'tenant_id', 'intent_id', 'outbox_id', 'draft_id', 'publishing_request_id',
  'attempt_number', 'generation', 'claim_token', 'lease_holder', 'lease_expires_at',
  'platform', 'intent_hash', 'contract_version', 'operation', 'connector', 'status',
  'simulated', 'published', 'external_action_taken', 'started_at',
];

const NULLABLE_COLUMNS = ['scenario', 'error_code', 'retryable', 'settled_at'];

const ALL_COLUMNS = [...REQUIRED_COLUMNS, ...NULLABLE_COLUMNS];

const FORBIDDEN_COLUMNS = [
  'credential', 'credentials', 'credential_ref', 'token', 'tokens', 'access_token',
  'refresh_token', 'secret', 'password', 'vault', 'vault_payload', 'authorization',
  'header', 'headers', 'provider', 'provider_data', 'provider_campaign_id',
  'external_campaign_id', 'external_id', 'body', 'request_body', 'raw_body',
  'confirmation_phrase', 'confirmation_text', 'confirm_phrase', 'snapshot_json',
  'snapshot', 'payload', 'api_key',
];

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
  return insertIntent(p, tenantId, host, draftId, publishApprovalId, publishingRequestId, {
    ...opts, outboxId,
  });
}

async function seedBoundGraph(p, tenantId, host, userId, opts = {}) {
  const draftId = opts.draftId || await insertDraft(p, tenantId, host, opts);
  const pubId = opts.pubId || await insertPublishApproval(p, tenantId, host, draftId, {
    actorUserId: userId, ...opts,
  });
  const reqId = opts.reqId || await insertRequest(p, tenantId, host, draftId, pubId, {
    requestedBy: userId, ...opts,
  });
  const intent = await insertBoundIntent(p, tenantId, host, draftId, pubId, reqId, {
    requestedBy: userId, ...opts,
  });
  return { draftId, pubId, reqId, intentId: intent.id, outboxId: intent.outboxId };
}

async function insertAttempt(q, tenantId, graph, opts = {}) {
  const id = opts.id || nid('att');
  const n = opts.attemptNumber == null ? 1 : opts.attemptNumber;
  const generation = opts.generation == null ? n : opts.generation;
  await q.query(
    `INSERT INTO orchestrator_campaign_delivery_attempts
       (id, tenant_id, intent_id, outbox_id, draft_id, publishing_request_id,
        attempt_number, generation, claim_token, lease_holder, lease_expires_at,
        platform, intent_hash, contract_version, operation, connector, status,
        scenario, error_code, retryable, simulated, published, external_action_taken,
        started_at, settled_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::timestamptz, now()+'5 minutes'::interval),
             $12,$13,$14,$15,$16,$17,$18,$19,$20,
             COALESCE($21, TRUE), COALESCE($22, FALSE), COALESCE($23, FALSE),
             COALESCE($24::timestamptz, now()), $25)`,
    [
      id, tenantId,
      opts.intentId || graph.intentId,
      opts.outboxId || graph.outboxId,
      opts.draftId || graph.draftId,
      opts.publishingRequestId || graph.reqId,
      n, generation,
      opts.claimToken || nid('claimtok'),
      opts.leaseHolder || 'worker-fake-1',
      opts.leaseExpiresAt || null,
      opts.platform || 'meta',
      opts.intentHash || nextHex(),
      opts.contractVersion || 'campaign_delivery_v1',
      opts.operation || 'create_provider_draft',
      opts.connector || 'fake',
      opts.status || 'started',
      opts.scenario == null ? null : opts.scenario,
      opts.errorCode == null ? null : opts.errorCode,
      Object.prototype.hasOwnProperty.call(opts, 'retryable') ? opts.retryable : null,
      Object.prototype.hasOwnProperty.call(opts, 'simulated') ? opts.simulated : null,
      Object.prototype.hasOwnProperty.call(opts, 'published') ? opts.published : null,
      Object.prototype.hasOwnProperty.call(opts, 'externalActionTaken') ? opts.externalActionTaken : null,
      opts.startedAt || null,
      Object.prototype.hasOwnProperty.call(opts, 'settledAt') ? opts.settledAt : null,
    ]
  );
  return id;
}

test('PR6D delivery-attempt CREATE TABLE is tenant-leading, historical, and identifier-safe', () => {
  const src = schemaSrc();
  assert.match(src, /'orchestrator_campaign_delivery_attempts'/);
  assert.match(src, /CREATE TABLE IF NOT EXISTS orchestrator_campaign_delivery_attempts/);
  assert.match(src, /ADD COLUMN IF NOT EXISTS intent_id TEXT/);
  assert.match(src, /ADD COLUMN IF NOT EXISTS outbox_id TEXT/);
  assert.match(src, /ADD COLUMN IF NOT EXISTS claim_token TEXT/);
  assert.match(src, /ADD COLUMN IF NOT EXISTS attempt_number INTEGER/);
  assert.match(src, /ADD COLUMN IF NOT EXISTS generation INTEGER/);
  assert.match(src, /_ensureNamedUnique\(p, 'orchestrator_campaign_delivery_attempts'/);
  assert.match(src, /_ensureNamedFk\(p, 'orchestrator_campaign_delivery_attempts'/);
  assert.match(src, /_ensureNamedCheck\(p, 'orchestrator_campaign_delivery_attempts'/);
  assert.match(src, /_installInTransaction\(p, `/);

  const intentIdx = src.indexOf('CREATE TABLE IF NOT EXISTS orchestrator_campaign_delivery_intents');
  const attemptIdx = src.indexOf('CREATE TABLE IF NOT EXISTS orchestrator_campaign_delivery_attempts');
  assert.ok(intentIdx >= 0 && attemptIdx > intentIdx, 'delivery attempts must be created after PR6C delivery intents');
  assert.match(src, /'orchestrator_campaign_delivery_intents',\s*'orchestrator_campaign_delivery_attempts'/);

  const tablesBlock = src.slice(src.indexOf('const ADVERTISING_ORCH_TABLES'), src.indexOf('];', src.indexOf('const ADVERTISING_ORCH_TABLES')) + 2);
  const intentMember = tablesBlock.indexOf("'orchestrator_campaign_delivery_intents'");
  const attemptMember = tablesBlock.indexOf("'orchestrator_campaign_delivery_attempts'");
  assert.ok(intentMember >= 0 && attemptMember > intentMember, 'ADVERTISING_ORCH_TABLES must list attempts after intents');

  const create = extractCreateTable(src, TABLE);
  assert.match(create, /PRIMARY KEY \(tenant_id, id\)/);
  assert.match(create, /REFERENCES tenants\(id\) ON DELETE CASCADE/);
  assert.match(create, /orchestrator_campaign_delivery_attempts_tenant_unique_number/);
  assert.match(create, /UNIQUE \(tenant_id, outbox_id, attempt_number\)/);
  assert.match(create, /orchestrator_campaign_delivery_attempts_tenant_unique_gen/);
  assert.match(create, /UNIQUE \(tenant_id, outbox_id, generation\)/);
  assert.match(create, /orchestrator_campaign_delivery_attempts_tenant_unique_claim/);
  assert.match(create, /UNIQUE \(tenant_id, claim_token\)/);
  assert.doesNotMatch(create, /UNIQUE \(tenant_id, outbox_id\)\s*[,)]/);
  assert.doesNotMatch(create, /UNIQUE \(tenant_id, intent_id\)\s*[,)]/);
  assert.match(create, /contract_version TEXT NOT NULL DEFAULT 'campaign_delivery_v1'/);
  assert.match(create, /operation TEXT NOT NULL DEFAULT 'create_provider_draft'/);
  assert.match(create, /connector TEXT NOT NULL DEFAULT 'fake'/);
  assert.match(create, /status TEXT NOT NULL DEFAULT 'started'/);
  assert.match(create, /simulated BOOLEAN NOT NULL DEFAULT TRUE/);
  assert.match(create, /published BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(create, /external_action_taken BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(create, /char_length\(claim_token\) BETWEEN 8 AND 128/);
  assert.match(create, /intent_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.doesNotMatch(create, /\[0-9a-fA-F\]/);

  const namedIdents = src.match(/orchestrator_campaign_delivery_attempts_[a-z0-9_]+|orchestrator_cda_[a-z0-9_]+|idx_cda_[a-z0-9_]+/g) || [];
  for (const name of new Set(namedIdents)) {
    assert.ok(name.length <= 63, `${name} exceeds Postgres 63-char identifier limit (${name.length})`);
  }
  assert.ok(
    !namedIdents.includes('orchestrator_campaign_delivery_attempts_tenant_unique_generation'),
    '64-char unique_generation name must be truncated'
  );

  assert.match(src, /orchestrator_cda_tenant_intent_fkey/);
  assert.match(src, /orchestrator_campaign_delivery_intents', 'tenant_id, id'/);
  assert.match(src, /orchestrator_cda_tenant_outbox_fkey/);
  assert.match(src, /orchestrator_outbox', 'tenant_id, id'/);
  assert.match(src, /orchestrator_cda_tenant_draft_fkey/);
  assert.match(src, /orchestrator_campaign_drafts', 'tenant_id, id'/);
  assert.match(src, /orchestrator_cda_tenant_pub_req_fkey/);
  assert.match(src, /orchestrator_campaign_publish_requests', 'tenant_id, id'/);

  const fn = extractFunctionSource(src, 'orchestrator_campaign_delivery_attempts_guard');
  assert.match(fn, /TG_OP = 'UPDATE'/);
  assert.match(fn, /OLD\.status IS DISTINCT FROM 'started'/);
  assert.match(fn, /NEW\.status IS NOT DISTINCT FROM 'started'/);
  assert.match(fn, /NEW\.claim_token IS DISTINCT FROM OLD\.claim_token/);
  assert.match(fn, /NEW\.simulated IS DISTINCT FROM TRUE/);
  assert.match(fn, /NEW\.published IS DISTINCT FROM FALSE/);
  assert.match(fn, /NEW\.external_action_taken IS DISTINCT FROM FALSE/);
  assert.match(fn, /RAISE EXCEPTION 'orchestrator_campaign_delivery_attempts_immutable'/);
  assert.match(fn, /FROM tenants t WHERE t\.id = OLD\.tenant_id/);
  assert.match(src, /BEFORE UPDATE OR DELETE ON orchestrator_campaign_delivery_attempts/);
  assert.match(src, /CREATE TRIGGER orchestrator_campaign_delivery_attempts_guard/);
});

if (!HAS_DB) {
  test('advertising-orchestrator campaign-delivery-attempt schema skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
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
    tenantA = await mk(`AO6D A ${SUFFIX}`, `ao6d-a-${SUFFIX}`);
    tenantB = await mk(`AO6D B ${SUFFIX}`, `ao6d-b-${SUFFIX}`);
    hostA = await seedHost(p, tenantA);
    hostB = await seedHost(p, tenantB);
    userId = (await p.query(
      `INSERT INTO users (email, password_hash, name) VALUES ($1,'x','pr6d') RETURNING id`,
      [`pr6d-${SUFFIX}@example.test`]
    )).rows[0].id;
  });

  after(async () => {
    const p = db.getPool();
    const ids = [tenantA, tenantB].filter(Boolean);
    if (ids.length) await p.query(`DELETE FROM tenants WHERE id = ANY($1)`, [ids]);
    if (userId) await p.query(`DELETE FROM users WHERE id=$1`, [userId]);
  });

  test('PR6D table exists with tenant-leading PK, columns, uniques, and tenant-scoped FKs', async () => {
    const p = db.getPool();
    const present = (await p.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
      [TABLE]
    )).rows;
    assert.equal(present.length, 1);
    const cols = (await p.query(
      `SELECT column_name, is_nullable, data_type
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name=$1`,
      [TABLE]
    )).rows;
    const names = cols.map((c) => c.column_name).sort();
    assert.deepStrictEqual(names, [...ALL_COLUMNS].sort());
    for (const name of REQUIRED_COLUMNS) {
      const col = cols.find((c) => c.column_name === name);
      assert.ok(col, `${name} must exist`);
      assert.strictEqual(col.is_nullable, 'NO', `${name} must be NOT NULL`);
    }
    for (const name of NULLABLE_COLUMNS) {
      const col = cols.find((c) => c.column_name === name);
      assert.ok(col, `${name} must exist`);
      assert.strictEqual(col.is_nullable, 'YES', `${name} must be nullable`);
    }
    const tenant = cols.find((c) => c.column_name === 'tenant_id');
    assert.strictEqual(tenant.data_type, 'integer');
    const keys = await pkAndUniques(TABLE);
    assert.ok(keys.some((c) => c.constraint_type === 'PRIMARY KEY' && c.cols === 'tenant_id,id'),
      `${TABLE} PK must be (tenant_id, id)`);
    assert.ok(keys.some((c) => c.constraint_name === 'orchestrator_campaign_delivery_attempts_tenant_unique_number'
      && c.cols === 'tenant_id,outbox_id,attempt_number'));
    assert.ok(keys.some((c) => c.constraint_name === 'orchestrator_campaign_delivery_attempts_tenant_unique_gen'
      && c.cols === 'tenant_id,outbox_id,generation'));
    assert.ok(keys.some((c) => c.constraint_name === 'orchestrator_campaign_delivery_attempts_tenant_unique_claim'
      && c.cols === 'tenant_id,claim_token'));
    assert.ok(!keys.some((c) => c.constraint_type === 'UNIQUE' && c.cols === 'tenant_id,outbox_id'),
      'must not UNIQUE (tenant_id, outbox_id) alone');
    assert.ok(!keys.some((c) => c.constraint_type === 'UNIQUE' && c.cols === 'tenant_id,intent_id'),
      'must not UNIQUE (tenant_id, intent_id)');
    const forbidden = cols.filter((c) => FORBIDDEN_COLUMNS.includes(c.column_name)
      || /credential|vault|access_token|refresh_token|secret|password|provider_campaign|external_campaign|confirmation_phrase|snapshot_json/i.test(c.column_name));
    assert.deepStrictEqual(forbidden, [], `${TABLE} must not store forbidden surfaces`);

    const fks = await fkRows(TABLE);
    const intentFk = fks.find((f) => f.conname === 'orchestrator_cda_tenant_intent_fkey');
    assert.ok(intentFk);
    assert.strictEqual(intentFk.cols, 'tenant_id,intent_id');
    assert.strictEqual(intentFk.ref_table, 'orchestrator_campaign_delivery_intents');
    assert.strictEqual(intentFk.deltype, 'c');
    const outboxFk = fks.find((f) => f.conname === 'orchestrator_cda_tenant_outbox_fkey');
    assert.ok(outboxFk);
    assert.strictEqual(outboxFk.cols, 'tenant_id,outbox_id');
    assert.strictEqual(outboxFk.ref_table, 'orchestrator_outbox');
    assert.strictEqual(outboxFk.deltype, 'a');
    const draftFk = fks.find((f) => f.conname === 'orchestrator_cda_tenant_draft_fkey');
    assert.ok(draftFk);
    assert.strictEqual(draftFk.cols, 'tenant_id,draft_id');
    assert.strictEqual(draftFk.ref_table, 'orchestrator_campaign_drafts');
    assert.strictEqual(draftFk.deltype, 'c');
    const pubFk = fks.find((f) => f.conname === 'orchestrator_cda_tenant_pub_req_fkey');
    assert.ok(pubFk);
    assert.strictEqual(pubFk.cols, 'tenant_id,publishing_request_id');
    assert.strictEqual(pubFk.ref_table, 'orchestrator_campaign_publish_requests');
    assert.strictEqual(pubFk.deltype, 'c');
    const tenantFk = fks.find((f) => f.ref_table === 'tenants');
    assert.ok(tenantFk);
    assert.ok(tenantFk.cols.startsWith('tenant_id'), 'tenant FK must be tenant-leading');
    assert.strictEqual(tenantFk.deltype, 'c');

    const indexes = (await p.query(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=$1`,
      [TABLE]
    )).rows;
    assert.ok(indexes.some((i) => i.indexname === 'idx_cda_outbox_history'
      && /\(tenant_id, outbox_id, attempt_number DESC\)/.test(i.indexdef)));
    assert.ok(indexes.some((i) => i.indexname === 'idx_cda_active_lease'
      && /\(tenant_id, outbox_id, lease_expires_at\)/.test(i.indexdef)
      && /WHERE.*status.*=.*'started'/.test(i.indexdef)));
    assert.ok(indexes.some((i) => i.indexname === 'idx_cda_intent_history'
      && /\(tenant_id, intent_id, attempt_number DESC\)/.test(i.indexdef)));
  });

  test('started insert shape, attempt_number=generation >=1, and published/external cannot be true', async () => {
    const p = db.getPool();
    const graph = await seedBoundGraph(p, tenantA, hostA, userId);
    const id = await insertAttempt(p, tenantA, graph, { attemptNumber: 1 });
    const stored = (await p.query(
      `SELECT status, scenario, error_code, retryable, settled_at, simulated, published,
              external_action_taken, attempt_number, generation, contract_version, operation, connector
         FROM ${TABLE} WHERE tenant_id=$1 AND id=$2`,
      [tenantA, id]
    )).rows[0];
    assert.strictEqual(stored.status, 'started');
    assert.strictEqual(stored.scenario, null);
    assert.strictEqual(stored.error_code, null);
    assert.strictEqual(stored.retryable, null);
    assert.strictEqual(stored.settled_at, null);
    assert.strictEqual(stored.simulated, true);
    assert.strictEqual(stored.published, false);
    assert.strictEqual(stored.external_action_taken, false);
    assert.strictEqual(stored.attempt_number, 1);
    assert.strictEqual(stored.generation, 1);
    assert.strictEqual(stored.contract_version, 'campaign_delivery_v1');
    assert.strictEqual(stored.operation, 'create_provider_draft');
    assert.strictEqual(stored.connector, 'fake');

    await assert.rejects(
      () => insertAttempt(p, tenantA, graph, { attemptNumber: 0, generation: 0, claimToken: nid('claimtok') }),
      /number_check|check/i
    );
    await assert.rejects(
      () => insertAttempt(p, tenantA, graph, { attemptNumber: 2, generation: 3, claimToken: nid('claimtok') }),
      /number_check|check/i
    );
    await assert.rejects(
      () => insertAttempt(p, tenantA, graph, { published: true, claimToken: nid('claimtok') }),
      /sim_check|check/i
    );
    await assert.rejects(
      () => insertAttempt(p, tenantA, graph, { externalActionTaken: true, claimToken: nid('claimtok') }),
      /sim_check|check/i
    );
    await assert.rejects(
      () => insertAttempt(p, tenantA, graph, { simulated: false, claimToken: nid('claimtok') }),
      /sim_check|check/i
    );
    await assert.rejects(
      () => insertAttempt(p, tenantA, graph, {
        status: 'started', settledAt: new Date().toISOString(), retryable: false, claimToken: nid('claimtok'),
      }),
      /terminal_check|check/i
    );
    await assert.rejects(
      () => insertAttempt(p, tenantA, graph, { claimToken: 'short', attemptNumber: 3 }),
      /len_check|check/i
    );
  });

  test('multiple historical attempts share outbox+intent; number/generation/claim uniques hold', async () => {
    const p = db.getPool();
    const graph = await seedBoundGraph(p, tenantA, hostA, userId);
    const first = await insertAttempt(p, tenantA, graph, { attemptNumber: 1, claimToken: nid('claimtok') });
    await p.query(
      `UPDATE ${TABLE} SET status='simulated_ok', settled_at=now(), retryable=false, scenario='ok'
        WHERE tenant_id=$1 AND id=$2`,
      [tenantA, first]
    );
    const second = await insertAttempt(p, tenantA, graph, { attemptNumber: 2, claimToken: nid('claimtok') });
    const n = (await p.query(
      `SELECT COUNT(*)::int AS n FROM ${TABLE} WHERE tenant_id=$1 AND outbox_id=$2 AND intent_id=$3`,
      [tenantA, graph.outboxId, graph.intentId]
    )).rows[0].n;
    assert.strictEqual(n, 2, 'historical attempts must share the same outbox and intent');
    assert.notStrictEqual(first, second);

    await assert.rejects(
      () => insertAttempt(p, tenantA, graph, { attemptNumber: 2, claimToken: nid('claimtok') }),
      /unique|duplicate/i,
      'duplicate tenant/outbox_id/attempt_number must be rejected'
    );
    const graph2 = await seedBoundGraph(p, tenantA, hostA, userId);
    const sharedClaim = nid('claimtok');
    await insertAttempt(p, tenantA, graph2, { attemptNumber: 1, claimToken: sharedClaim });
    await assert.rejects(
      () => insertAttempt(p, tenantA, graph, { attemptNumber: 3, claimToken: sharedClaim }),
      /unique|duplicate/i,
      'duplicate tenant/claim_token must be rejected'
    );

    const graphB = await seedBoundGraph(p, tenantB, hostB, userId);
    await insertAttempt(p, tenantB, graphB, { attemptNumber: 1, claimToken: sharedClaim });
  });

  test('started can terminalize once; identity/claim fields and terminal rows cannot change', async () => {
    const p = db.getPool();
    const graph = await seedBoundGraph(p, tenantA, hostA, userId);
    const id = await insertAttempt(p, tenantA, graph, { attemptNumber: 1, claimToken: nid('claimtok') });
    await p.query(
      `UPDATE ${TABLE}
          SET status='retry_timeout', settled_at=now(), retryable=true, error_code='timeout', scenario='lease'
        WHERE tenant_id=$1 AND id=$2`,
      [tenantA, id]
    );
    const after = (await p.query(
      `SELECT status, retryable, error_code, scenario, settled_at IS NOT NULL AS settled
         FROM ${TABLE} WHERE tenant_id=$1 AND id=$2`,
      [tenantA, id]
    )).rows[0];
    assert.strictEqual(after.status, 'retry_timeout');
    assert.strictEqual(after.retryable, true);
    assert.strictEqual(after.error_code, 'timeout');
    assert.strictEqual(after.scenario, 'lease');
    assert.strictEqual(after.settled, true);

    await assert.rejects(
      () => p.query(
        `UPDATE ${TABLE} SET status='simulated_ok', settled_at=now(), retryable=false
          WHERE tenant_id=$1 AND id=$2`,
        [tenantA, id]
      ),
      /orchestrator_campaign_delivery_attempts_immutable/,
      'terminal rows cannot change'
    );

    const graph2 = await seedBoundGraph(p, tenantA, hostA, userId);
    const live = await insertAttempt(p, tenantA, graph2, { attemptNumber: 1, claimToken: nid('claimtok') });
    await assert.rejects(
      () => p.query(
        `UPDATE ${TABLE} SET claim_token=$3, status='simulated_ok', settled_at=now(), retryable=false
          WHERE tenant_id=$1 AND id=$2`,
        [tenantA, live, nid('claimtok')]
      ),
      /orchestrator_campaign_delivery_attempts_immutable/,
      'claim_token cannot change on terminalize'
    );
    await assert.rejects(
      () => p.query(
        `UPDATE ${TABLE} SET lease_holder='other-worker', status='simulated_ok', settled_at=now(), retryable=false
          WHERE tenant_id=$1 AND id=$2`,
        [tenantA, live]
      ),
      /orchestrator_campaign_delivery_attempts_immutable/
    );
    await assert.rejects(
      () => p.query(
        `UPDATE ${TABLE} SET attempt_number=2, generation=2, status='simulated_ok', settled_at=now(), retryable=false
          WHERE tenant_id=$1 AND id=$2`,
        [tenantA, live]
      ),
      /orchestrator_campaign_delivery_attempts_immutable/
    );
    await assert.rejects(
      () => p.query(
        `UPDATE ${TABLE} SET published=TRUE, status='simulated_ok', settled_at=now(), retryable=false
          WHERE tenant_id=$1 AND id=$2`,
        [tenantA, live]
      ),
      /orchestrator_campaign_delivery_attempts_immutable|sim_check|check/i
    );
    await assert.rejects(
      () => p.query(
        `UPDATE ${TABLE} SET external_action_taken=TRUE, status='simulated_ok', settled_at=now(), retryable=false
          WHERE tenant_id=$1 AND id=$2`,
        [tenantA, live]
      ),
      /orchestrator_campaign_delivery_attempts_immutable|sim_check|check/i
    );
    await assert.rejects(
      () => p.query(
        `UPDATE ${TABLE} SET status='started' WHERE tenant_id=$1 AND id=$2`,
        [tenantA, live]
      ),
      /orchestrator_campaign_delivery_attempts_immutable/
    );
    const stillStarted = (await p.query(
      `SELECT status FROM ${TABLE} WHERE tenant_id=$1 AND id=$2`, [tenantA, live]
    )).rows[0].status;
    assert.strictEqual(stillStarted, 'started');
  });

  test('live-tenant DELETE refused; tenant teardown cascades attempts', async () => {
    const p = db.getPool();
    const graph = await seedBoundGraph(p, tenantA, hostA, userId);
    const id = await insertAttempt(p, tenantA, graph, { attemptNumber: 1, claimToken: nid('claimtok') });
    await assert.rejects(
      () => p.query(`DELETE FROM ${TABLE} WHERE tenant_id=$1 AND id=$2`, [tenantA, id]),
      /orchestrator_campaign_delivery_attempts_immutable/
    );
    const still = (await p.query(`SELECT 1 FROM ${TABLE} WHERE tenant_id=$1 AND id=$2`, [tenantA, id])).rowCount;
    assert.equal(still, 1);

    const tenantC = (await p.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [`AO6D C ${SUFFIX}`, `ao6d-c-${SUFFIX}`]
    )).rows[0].id;
    const hostC = await seedHost(p, tenantC);
    const graphC = await seedBoundGraph(p, tenantC, hostC, userId);
    const row = await insertAttempt(p, tenantC, graphC, { attemptNumber: 1, claimToken: nid('claimtok') });
    await assert.rejects(
      () => p.query(`DELETE FROM ${TABLE} WHERE tenant_id=$1 AND id=$2`, [tenantC, row]),
      /orchestrator_campaign_delivery_attempts_immutable/
    );
    await p.query(`DELETE FROM tenants WHERE id=$1`, [tenantC]);
    const gone = (await p.query(`SELECT 1 FROM ${TABLE} WHERE tenant_id=$1`, [tenantC])).rowCount;
    assert.equal(gone, 0);
  });

  test('tenant-scoped FKs reject cross-tenant intent, outbox, draft, and publish request', async () => {
    const p = db.getPool();
    const graphA = await seedBoundGraph(p, tenantA, hostA, userId);
    const graphB = await seedBoundGraph(p, tenantB, hostB, userId);

    await assert.rejects(
      () => insertAttempt(p, tenantA, graphA, { intentId: graphB.intentId, claimToken: nid('claimtok') }),
      /foreign key|violates/i
    );
    await assert.rejects(
      () => insertAttempt(p, tenantA, graphA, { outboxId: graphB.outboxId, claimToken: nid('claimtok') }),
      /foreign key|violates/i
    );
    await assert.rejects(
      () => insertAttempt(p, tenantA, graphA, { draftId: graphB.draftId, claimToken: nid('claimtok') }),
      /foreign key|violates/i
    );
    await assert.rejects(
      () => insertAttempt(p, tenantA, graphA, { publishingRequestId: graphB.reqId, claimToken: nid('claimtok') }),
      /foreign key|violates/i
    );
    await insertAttempt(p, tenantA, graphA, { attemptNumber: 1, claimToken: nid('claimtok') });
    await insertAttempt(p, tenantB, graphB, { attemptNumber: 1, claimToken: nid('claimtok') });
  });

  test('ensureAgentOrchestratorSchema is idempotent and restores dropped CHECKs', async () => {
    const p = db.getPool();
    await ensureAgentOrchestratorSchema();
    await ensureAgentOrchestratorSchema();
    const present = (await p.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
      [TABLE]
    )).rowCount;
    assert.equal(present, 1);
    const name = 'orchestrator_campaign_delivery_attempts_status_check';
    await p.query(`ALTER TABLE ${TABLE} DROP CONSTRAINT ${name}`);
    await ensureAgentOrchestratorSchema();
    const after = (await p.query(`SELECT 1 FROM pg_constraint WHERE conname=$1`, [name])).rowCount;
    assert.equal(after, 1, 'ensureSchema must restore dropped status CHECK');
    const keys = await pkAndUniques(TABLE);
    assert.ok(keys.some((c) => c.constraint_name === 'orchestrator_campaign_delivery_attempts_tenant_unique_number'));
    assert.ok(keys.some((c) => c.constraint_name === 'orchestrator_campaign_delivery_attempts_tenant_unique_gen'));
    assert.ok(keys.some((c) => c.constraint_name === 'orchestrator_campaign_delivery_attempts_tenant_unique_claim'));
  });
}
