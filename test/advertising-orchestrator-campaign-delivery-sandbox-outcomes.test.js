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
const sandbox = require('../services/agent_orchestrator/campaign_delivery_sandbox_outcomes');
const attempts = require('../services/agent_orchestrator/campaign_delivery_attempts');
const D = require('../services/agent_orchestrator/campaign_delivery_contracts');

const HAS_DB = db.hasDb();
const TABLE = 'orchestrator_campaign_delivery_sandbox_outcomes';
const SCHEMA_SRC_PATH = path.join(__dirname, '../services/agent_orchestrator/schema.js');
const HEX = 'a'.repeat(64);
const SUFFIX = `ao6e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let seq = 0;
const nid = (p) => { seq += 1; return `${p}-${SUFFIX}-${seq}`; };
const nextHex = () => { seq += 1; return seq.toString(16).padStart(64, '0'); };

const REQUIRED_COLUMNS = [
  'id', 'tenant_id', 'outbox_id', 'intent_id', 'scenario', 'source',
  'simulated', 'published', 'external_action_taken', 'created_at',
];
const NULLABLE_COLUMNS = ['consumed_at', 'consumed_attempt_id'];
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
            con.confdeltype AS deltype
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
       JOIN pg_class ref ON ref.oid = con.confrelid
       JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, n) ON true
       JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = k.attnum
      WHERE nsp.nspname='public' AND rel.relname=$1 AND con.contype='f'
      GROUP BY con.oid, con.conname, ref.relname, con.confdeltype`,
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
  await p.query(
    `INSERT INTO orchestrator_campaign_drafts
       (id, tenant_id, workflow_id, contract_hash, idempotency_key, status, current_revision)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, tenantId, host.wfId, HEX, opts.idempotencyKey || nid('didemp'), opts.status || 'draft', 1]
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
      id, tenantId, draftId, 1, HEX, '{"ok":true}', host.approvalId,
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
      id, tenantId, draftId, publishApprovalId, host.approvalId, 1, HEX,
      nextHex(), opts.requestedBy, 'requested', 1, nid('ridemp'), nextHex(),
    ]
  );
  return id;
}

async function insertBoundIntent(p, tenantId, host, draftId, publishApprovalId, publishingRequestId, opts = {}) {
  const outboxId = opts.outboxId || nid('obx');
  await p.query(
    `INSERT INTO orchestrator_outbox
       (id, tenant_id, workflow_id, destination, operation, payload, state, idempotency_key)
     VALUES ($1,$2,$3,'internal','create_provider_draft','{}'::jsonb,'pending',$4)`,
    [outboxId, tenantId, host.wfId, nid('oidemp')]
  );
  const id = opts.id || nid('intent');
  await p.query(
    `INSERT INTO orchestrator_campaign_delivery_intents
       (id, tenant_id, publishing_request_id, draft_id, publish_approval_id, workflow_approval_id,
        outbox_id, revision, contract_hash, snapshot_hash, intent_hash, contract_version,
        operation, status, idempotency_key, requested_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      id, tenantId, publishingRequestId, draftId, publishApprovalId, host.approvalId, outboxId,
      1, HEX, nextHex(), nextHex(), 'campaign_delivery_v1', 'create_provider_draft', 'pending',
      nid('iidemp'), opts.requestedBy,
    ]
  );
  return { id, outboxId };
}

test('PR6E sandbox-outcome CREATE TABLE is tenant-leading, consume-once, and identifier-safe', () => {
  const src = schemaSrc();
  assert.match(src, /'orchestrator_campaign_delivery_sandbox_outcomes'/);
  assert.match(src, /CREATE TABLE IF NOT EXISTS orchestrator_campaign_delivery_sandbox_outcomes/);
  assert.match(src, /orchestrator_cdso_tenant_unique_unconsumed/);
  assert.match(src, /WHERE consumed_at IS NULL/);
  assert.match(src, /_ensureNamedFk\(p, 'orchestrator_campaign_delivery_sandbox_outcomes'/);
  assert.match(src, /_ensureNamedCheck\(p, 'orchestrator_campaign_delivery_sandbox_outcomes'/);

  const attemptIdx = src.indexOf('CREATE TABLE IF NOT EXISTS orchestrator_campaign_delivery_attempts');
  const sandboxIdx = src.indexOf('CREATE TABLE IF NOT EXISTS orchestrator_campaign_delivery_sandbox_outcomes');
  assert.ok(attemptIdx >= 0 && sandboxIdx > attemptIdx, 'sandbox outcomes must be created after attempts');

  const create = extractCreateTable(src, TABLE);
  assert.match(create, /PRIMARY KEY \(tenant_id, id\)/);
  assert.match(create, /REFERENCES tenants\(id\) ON DELETE CASCADE/);
  assert.match(create, /source TEXT NOT NULL DEFAULT 'sandbox'/);
  assert.match(create, /simulated BOOLEAN NOT NULL DEFAULT TRUE/);
  assert.match(create, /published BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(create, /external_action_taken BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(create, /scenario IN \(/);
  assert.match(create, /'success','duplicate','transient','rate_limit','timeout'/);
  assert.doesNotMatch(create, /credential_ref/);
  assert.doesNotMatch(create, /provider_campaign/);

  const namedIdents = src.match(/orchestrator_cdso_[a-z0-9_]+|idx_cdso_[a-z0-9_]+/g) || [];
  for (const name of new Set(namedIdents)) {
    assert.ok(name.length <= 63, `${name} exceeds Postgres 63-char identifier limit (${name.length})`);
  }

  const fn = extractFunctionSource(src, 'orchestrator_cdso_guard');
  assert.match(fn, /TG_OP = 'INSERT'/);
  assert.match(fn, /TG_OP = 'UPDATE'/);
  assert.match(fn, /NEW\.consumed_at IS NOT NULL OR NEW\.consumed_attempt_id IS NOT NULL/);
  assert.match(fn, /OLD\.consumed_at IS NOT NULL/);
  assert.match(fn, /NEW\.scenario IS DISTINCT FROM OLD\.scenario/);
  assert.match(fn, /NEW\.source IS DISTINCT FROM 'sandbox'/);
  assert.match(fn, /NEW\.simulated IS DISTINCT FROM TRUE/);
  assert.match(fn, /RAISE EXCEPTION 'orchestrator_cdso_immutable'/);
  assert.match(fn, /RAISE EXCEPTION 'orchestrator_cdso_consume_binding'/);
  assert.match(fn, /FROM tenants t WHERE t\.id = OLD\.tenant_id/);
  assert.match(src, /BEFORE INSERT OR UPDATE OR DELETE ON orchestrator_campaign_delivery_sandbox_outcomes/);
  assert.match(src, /orchestrator_cdso_tenant_outbox_intent_fkey/);
  assert.match(src, /orchestrator_cdso_tenant_consumed_attempt_fkey/);
  assert.match(src, /orchestrator_campaign_delivery_intents_tenant_unique_outbox_id/);
  assert.doesNotMatch(src, /DISABLE TRIGGER orchestrator_cdso_guard/);
  assert.doesNotMatch(src, /DELETE FROM orchestrator_campaign_delivery_sandbox_outcomes o\s+WHERE NOT EXISTS/);
});

if (!HAS_DB) {
  test('advertising-orchestrator campaign-delivery-sandbox-outcomes skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
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
    tenantA = await mk(`AO6E A ${SUFFIX}`, `ao6e-a-${SUFFIX}`);
    tenantB = await mk(`AO6E B ${SUFFIX}`, `ao6e-b-${SUFFIX}`);
    hostA = await seedHost(p, tenantA);
    hostB = await seedHost(p, tenantB);
    userId = (await p.query(
      `INSERT INTO users (email, password_hash, name) VALUES ($1,'x','pr6e') RETURNING id`,
      [`pr6e-${SUFFIX}@example.test`]
    )).rows[0].id;
  });

  after(async () => {
    const p = db.getPool();
    const ids = [tenantA, tenantB].filter(Boolean);
    if (ids.length) await p.query(`DELETE FROM tenants WHERE id = ANY($1)`, [ids]);
    if (userId) await p.query(`DELETE FROM users WHERE id=$1`, [userId]);
  });

  test('PR6E table exists with tenant-leading PK, columns, partial unique, and tenant-scoped FKs', async () => {
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
    const keys = await pkAndUniques(TABLE);
    assert.ok(keys.some((c) => c.constraint_type === 'PRIMARY KEY' && c.cols === 'tenant_id,id'));
    assert.ok(!keys.some((c) => c.constraint_type === 'UNIQUE' && c.cols === 'tenant_id,outbox_id'),
      'full UNIQUE (tenant_id, outbox_id) must not exist — only partial unconsumed');

    const indexes = (await p.query(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=$1`,
      [TABLE]
    )).rows;
    assert.ok(indexes.some((i) => i.indexname === 'orchestrator_cdso_tenant_unique_unconsumed'
      && /\(tenant_id, outbox_id\)/.test(i.indexdef)
      && /WHERE.*consumed_at IS NULL/.test(i.indexdef)));

    const forbidden = cols.filter((c) => FORBIDDEN_COLUMNS.includes(c.column_name)
      || /credential|vault|access_token|refresh_token|secret|password|provider_campaign|external_campaign|confirmation_phrase|snapshot_json/i.test(c.column_name));
    assert.deepStrictEqual(forbidden, [], `${TABLE} must not store forbidden surfaces`);

    const fks = await fkRows(TABLE);
    const outboxFk = fks.find((f) => f.conname === 'orchestrator_cdso_tenant_outbox_fkey');
    assert.ok(outboxFk);
    assert.strictEqual(outboxFk.cols, 'tenant_id,outbox_id');
    assert.strictEqual(outboxFk.ref_table, 'orchestrator_outbox');
    assert.strictEqual(outboxFk.deltype, 'c');
    const intentFk = fks.find((f) => f.conname === 'orchestrator_cdso_tenant_intent_fkey');
    assert.ok(intentFk);
    assert.strictEqual(intentFk.cols, 'tenant_id,intent_id');
    assert.strictEqual(intentFk.ref_table, 'orchestrator_campaign_delivery_intents');
    assert.strictEqual(intentFk.deltype, 'c');
    const bindFk = fks.find((f) => f.conname === 'orchestrator_cdso_tenant_outbox_intent_fkey');
    assert.ok(bindFk);
    assert.strictEqual(bindFk.cols, 'tenant_id,outbox_id,intent_id');
    assert.strictEqual(bindFk.ref_table, 'orchestrator_campaign_delivery_intents');
    assert.strictEqual(bindFk.deltype, 'c');
    const attemptFk = fks.find((f) => f.conname === 'orchestrator_cdso_tenant_consumed_attempt_fkey');
    assert.ok(attemptFk);
    assert.strictEqual(attemptFk.cols, 'tenant_id,consumed_attempt_id');
    assert.strictEqual(attemptFk.ref_table, 'orchestrator_campaign_delivery_attempts');

    const trigEvents = (await p.query(
      `SELECT event_manipulation
         FROM information_schema.triggers
        WHERE event_object_schema='public'
          AND event_object_table=$1
          AND trigger_name='orchestrator_cdso_guard'
        ORDER BY event_manipulation`,
      [TABLE]
    )).rows.map((r) => r.event_manipulation);
    assert.deepStrictEqual(trigEvents, ['DELETE', 'INSERT', 'UPDATE']);
  });

  test('direct INSERT cannot birth a consumed outcome; helper remains unconsumed', async () => {
    const p = db.getPool();
    const draftId = await insertDraft(p, tenantA, hostA);
    const pubId = await insertPublishApproval(p, tenantA, hostA, draftId, { actorUserId: userId });
    const reqId = await insertRequest(p, tenantA, hostA, draftId, pubId, { requestedBy: userId });
    const bound = await insertBoundIntent(p, tenantA, hostA, draftId, pubId, reqId, { requestedBy: userId });

    const intentRow = (await p.query(
      `SELECT * FROM orchestrator_campaign_delivery_intents WHERE tenant_id=$1 AND id=$2`,
      [tenantA, bound.id]
    )).rows[0];
    const started = await attempts.insertStartedAttempt(p, {
      tenantId: tenantA,
      intentId: bound.id,
      outboxId: bound.outboxId,
      draftId: intentRow.draft_id,
      publishingRequestId: intentRow.publishing_request_id,
      attemptNumber: 1,
      generation: 1,
      leaseHolder: 'born-consumed',
      leaseExpiresAt: new Date(Date.now() + D.LEASE_MS),
      platform: 'meta',
      intentHash: intentRow.intent_hash,
    });

    await assert.rejects(
      p.query(
        `INSERT INTO ${TABLE}
           (id, tenant_id, outbox_id, intent_id, scenario, source,
            simulated, published, external_action_taken, consumed_at, consumed_attempt_id)
         VALUES ($1,$2,$3,$4,'success','sandbox', TRUE, FALSE, FALSE, now(), $5)`,
        [nid('cdso-born'), tenantA, bound.outboxId, bound.id, started.id]
      ),
      /immutable/i,
      'born-consumed INSERT must be rejected by guard'
    );
    await assert.rejects(
      p.query(
        `INSERT INTO ${TABLE}
           (id, tenant_id, outbox_id, intent_id, scenario, source,
            simulated, published, external_action_taken, consumed_at)
         VALUES ($1,$2,$3,$4,'success','sandbox', TRUE, FALSE, FALSE, now())`,
        [nid('cdso-half'), tenantA, bound.outboxId, bound.id]
      ),
      /immutable|consume_check|check constraint/i,
      'partial consumed INSERT must be refused'
    );

    const seeded = await sandbox.seedSandboxOutcome(p, {
      tenantId: tenantA, outboxId: bound.outboxId, intentId: bound.id, scenario: 'success',
    });
    assert.equal(seeded.consumed_at, null);
    assert.equal(seeded.consumed_attempt_id, null);
  });

  test('seed + consume-once; second unconsumed seed refused; identity frozen; cross-tenant FK refused', async () => {
    const p = db.getPool();
    const draftId = await insertDraft(p, tenantA, hostA);
    const pubId = await insertPublishApproval(p, tenantA, hostA, draftId, { actorUserId: userId });
    const reqId = await insertRequest(p, tenantA, hostA, draftId, pubId, { requestedBy: userId });
    const bound = await insertBoundIntent(p, tenantA, hostA, draftId, pubId, reqId, { requestedBy: userId });

    await assert.rejects(
      () => sandbox.seedSandboxOutcome(p, {
        tenantId: tenantA, outboxId: bound.outboxId, intentId: bound.id, scenario: 'constructor',
      }),
      (e) => e && e.code === 'validation_failed',
      'prototype scenario must fail closed at seed'
    );
    await assert.rejects(
      () => sandbox.seedSandboxOutcome(p, {
        tenantId: tenantA, outboxId: bound.outboxId, intentId: bound.id, scenario: '__proto__',
      }),
      (e) => e && e.code === 'validation_failed'
    );
    await assert.rejects(
      () => sandbox.seedSandboxOutcome(p, {
        tenantId: tenantA, outboxId: bound.outboxId, intentId: bound.id, scenario: 'SUCCESS',
      }),
      (e) => e && e.code === 'validation_failed'
    );

    const seeded = await sandbox.seedSandboxOutcome(p, {
      tenantId: tenantA, outboxId: bound.outboxId, intentId: bound.id, scenario: 'success',
    });
    assert.equal(seeded.source, 'sandbox');
    assert.equal(seeded.simulated, true);
    assert.equal(seeded.published, false);
    assert.equal(seeded.external_action_taken, false);
    assert.equal(seeded.consumed_at, null);

    await assert.rejects(
      () => sandbox.seedSandboxOutcome(p, {
        tenantId: tenantA, outboxId: bound.outboxId, intentId: bound.id, scenario: 'transient',
      }),
      /unique|duplicate/i,
      'only one unconsumed outcome per (tenant, outbox)'
    );

    const locked = await sandbox.lockUnconsumedOutcome(p, {
      tenantId: tenantA, outboxId: bound.outboxId,
    });
    assert.ok(locked);
    assert.equal(locked.id, seeded.id);

    const intentRow = (await p.query(
      `SELECT * FROM orchestrator_campaign_delivery_intents WHERE tenant_id=$1 AND id=$2`,
      [tenantA, bound.id]
    )).rows[0];
    const started = await attempts.insertStartedAttempt(p, {
      tenantId: tenantA,
      intentId: bound.id,
      outboxId: bound.outboxId,
      draftId: intentRow.draft_id,
      publishingRequestId: intentRow.publishing_request_id,
      attemptNumber: 1,
      generation: 1,
      leaseHolder: 'sandbox-test',
      leaseExpiresAt: new Date(Date.now() + D.LEASE_MS),
      platform: 'meta',
      intentHash: intentRow.intent_hash,
    });

    const consumed = await sandbox.consumeOutcome(p, {
      tenantId: tenantA, outcomeId: locked.id, attemptId: started.id, consumedAt: new Date(),
    });
    assert.ok(consumed.consumed_at);
    assert.equal(consumed.consumed_attempt_id, started.id);

    const again = await sandbox.consumeOutcome(p, {
      tenantId: tenantA, outcomeId: locked.id, attemptId: started.id, consumedAt: new Date(),
    });
    assert.equal(again, null, 'consume is once');

    await assert.rejects(
      p.query(
        `UPDATE ${TABLE} SET scenario='permanent' WHERE tenant_id=$1 AND id=$2`,
        [tenantA, locked.id]
      ),
      /immutable/i
    );
    await assert.rejects(
      p.query(`DELETE FROM ${TABLE} WHERE tenant_id=$1 AND id=$2`, [tenantA, locked.id]),
      /immutable/i
    );

    await assert.rejects(
      () => sandbox.seedSandboxOutcome(p, {
        tenantId: tenantB, outboxId: bound.outboxId, intentId: bound.id, scenario: 'success',
      }),
      /foreign key|violates/i,
      'cross-tenant FK must refuse'
    );

    const pub = sandbox.publicSandboxOutcome(consumed);
    assert.equal(pub.source, 'sandbox');
    assert.equal(pub.simulated, true);
    assert.equal(pub.published, false);
    assert.equal(pub.external_action_taken, false);
    assert.strictEqual(pub.credential_ref, undefined);
  });

  test('mismatched same-tenant outbox/intent binding is rejected; consume rejects nonexistent/cross-bound attempt', async () => {
    const p = db.getPool();
    const draftA = await insertDraft(p, tenantA, hostA);
    const pubA = await insertPublishApproval(p, tenantA, hostA, draftA, { actorUserId: userId });
    const reqA = await insertRequest(p, tenantA, hostA, draftA, pubA, { requestedBy: userId });
    const boundA = await insertBoundIntent(p, tenantA, hostA, draftA, pubA, reqA, { requestedBy: userId });

    const draftB = await insertDraft(p, tenantA, hostA);
    const pubB = await insertPublishApproval(p, tenantA, hostA, draftB, { actorUserId: userId });
    const reqB = await insertRequest(p, tenantA, hostA, draftB, pubB, { requestedBy: userId });
    const boundB = await insertBoundIntent(p, tenantA, hostA, draftB, pubB, reqB, { requestedBy: userId });

    await assert.rejects(
      () => sandbox.seedSandboxOutcome(p, {
        tenantId: tenantA, outboxId: boundA.outboxId, intentId: boundB.id, scenario: 'success',
      }),
      /foreign key|violates/i,
      'seed must refuse mismatched outbox/intent binding'
    );
    await assert.rejects(
      p.query(
        `INSERT INTO ${TABLE}
           (id, tenant_id, outbox_id, intent_id, scenario, source,
            simulated, published, external_action_taken)
         VALUES ($1,$2,$3,$4,'success','sandbox', TRUE, FALSE, FALSE)`,
        [nid('cdso'), tenantA, boundA.outboxId, boundB.id]
      ),
      /foreign key|violates/i,
      'direct INSERT must refuse mismatched binding'
    );

    const seeded = await sandbox.seedSandboxOutcome(p, {
      tenantId: tenantA, outboxId: boundA.outboxId, intentId: boundA.id, scenario: 'success',
    });
    const intentA = (await p.query(
      `SELECT * FROM orchestrator_campaign_delivery_intents WHERE tenant_id=$1 AND id=$2`,
      [tenantA, boundA.id]
    )).rows[0];
    const intentB = (await p.query(
      `SELECT * FROM orchestrator_campaign_delivery_intents WHERE tenant_id=$1 AND id=$2`,
      [tenantA, boundB.id]
    )).rows[0];
    const matching = await attempts.insertStartedAttempt(p, {
      tenantId: tenantA,
      intentId: boundA.id,
      outboxId: boundA.outboxId,
      draftId: intentA.draft_id,
      publishingRequestId: intentA.publishing_request_id,
      attemptNumber: 1,
      generation: 1,
      leaseHolder: 'bind-ok',
      leaseExpiresAt: new Date(Date.now() + D.LEASE_MS),
      platform: 'meta',
      intentHash: intentA.intent_hash,
    });
    const cross = await attempts.insertStartedAttempt(p, {
      tenantId: tenantA,
      intentId: boundB.id,
      outboxId: boundB.outboxId,
      draftId: intentB.draft_id,
      publishingRequestId: intentB.publishing_request_id,
      attemptNumber: 1,
      generation: 1,
      leaseHolder: 'bind-cross',
      leaseExpiresAt: new Date(Date.now() + D.LEASE_MS),
      platform: 'meta',
      intentHash: intentB.intent_hash,
    });

    const missing = await sandbox.consumeOutcome(p, {
      tenantId: tenantA, outcomeId: seeded.id, attemptId: nid('missing-cda'), consumedAt: new Date(),
    });
    assert.equal(missing, null, 'nonexistent attempt must not consume');

    const wrong = await sandbox.consumeOutcome(p, {
      tenantId: tenantA, outcomeId: seeded.id, attemptId: cross.id, consumedAt: new Date(),
    });
    assert.equal(wrong, null, 'cross-bound attempt must not consume');

    const ok = await sandbox.consumeOutcome(p, {
      tenantId: tenantA, outcomeId: seeded.id, attemptId: matching.id, consumedAt: new Date(),
    });
    assert.ok(ok);
    assert.equal(ok.consumed_attempt_id, matching.id);
  });

  test('ensureAgentOrchestratorSchema is idempotent for sandbox outcomes', async () => {
    await ensureAgentOrchestratorSchema();
    await ensureAgentOrchestratorSchema();
    const p = db.getPool();
    const n = (await p.query(
      `SELECT COUNT(*)::int AS n FROM information_schema.tables
        WHERE table_schema='public' AND table_name=$1`,
      [TABLE]
    )).rows[0].n;
    assert.equal(n, 1);
  });
}
