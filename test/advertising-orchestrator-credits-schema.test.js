// test/advertising-orchestrator-credits-schema.test.js — PR 2 credit/outbox DDL
//
// Gated on DATABASE_URL. When hasDb() is true there are ZERO per-test skips.
// Self-contained: ensureTenantSchema + ensureAgentOrchestratorSchema, no server.js boot.

const { test, before, after } = require('node:test');
const assert = require('node:assert');

const db = require('../db');
const { ensureAgentOrchestratorSchema } = require('../services/agent_orchestrator/schema');
const { ensureTenantSchema } = require('../services/tenants/schema');

const HAS_DB = db.hasDb();
const TABLES = [
  'orchestrator_credit_accounts',
  'orchestrator_credit_ledger',
  'orchestrator_credit_reservations',
  'orchestrator_tenant_limits',
  'orchestrator_pricing_catalog',
  'orchestrator_usage_records',
  'orchestrator_ai_inflight',
  'orchestrator_ai_request_ticks',
  'orchestrator_outbox',
];

const MONEY_COLUMNS = [
  ['orchestrator_workflows', 'credit_ceiling_micros'],
  ['orchestrator_approvals', 'approved_credit_ceiling_micros'],
  ['orchestrator_credit_accounts', 'available_micros'],
  ['orchestrator_credit_accounts', 'reserved_micros'],
  ['orchestrator_credit_accounts', 'consumed_micros'],
  ['orchestrator_credit_ledger', 'amount_micros'],
  ['orchestrator_credit_reservations', 'amount_micros'],
  ['orchestrator_credit_reservations', 'committed_micros'],
  ['orchestrator_credit_reservations', 'estimated_cost_micros'],
  ['orchestrator_credit_reservations', 'actual_cost_micros'],
  ['orchestrator_tenant_limits', 'credit_ceiling_micros'],
  ['orchestrator_tenant_limits', 'daily_ai_cost_micros'],
  ['orchestrator_tenant_limits', 'monthly_ai_cost_micros'],
  ['orchestrator_tenant_limits', 'per_workflow_cost_micros'],
  ['orchestrator_pricing_catalog', 'input_price_micros_per_million'],
  ['orchestrator_pricing_catalog', 'output_price_micros_per_million'],
  ['orchestrator_usage_records', 'estimated_cost_micros'],
  ['orchestrator_usage_records', 'actual_cost_micros'],
];

const TENANT_UNIQUE_CONSTRAINTS = [
  ['orchestrator_credit_reservations', 'orchestrator_credit_reservations_tenant_unique_idempotency_key', 'tenant_id,idempotency_key'],
  ['orchestrator_pricing_catalog', 'orchestrator_pricing_catalog_tenant_unique_price', 'tenant_id,provider,model_or_service,unit_type,pricing_version'],
  ['orchestrator_outbox', 'orchestrator_outbox_tenant_unique_dest_op_idemp', 'tenant_id,destination,operation,idempotency_key'],
];

const SUFFIX = `aoc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function uniqueIndexCols(table) {
  const p = db.getPool();
  const rows = (await p.query(
    `SELECT i.relname AS index_name,
            ix.indisprimary,
            array_agg(a.attname ORDER BY x.n) AS cols
       FROM pg_index ix
       JOIN pg_class t ON t.oid = ix.indrelid
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN unnest(ix.indkey) WITH ORDINALITY AS x(attnum, n) ON true
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = x.attnum
      WHERE t.relname = $1
        AND ix.indisunique
        AND a.attnum > 0
      GROUP BY i.relname, ix.indisprimary`,
    [table]
  )).rows;
  return rows.map((r) => ({
    name: r.index_name,
    primary: r.indisprimary,
    cols: r.cols,
  }));
}

async function constraints(table) {
  const p = db.getPool();
  return (await p.query(
    `SELECT tc.constraint_name, tc.constraint_type,
            string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS cols
       FROM information_schema.table_constraints tc
       LEFT JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
        AND tc.table_name = kcu.table_name
      WHERE tc.table_schema = 'public' AND tc.table_name = $1
        AND tc.constraint_type IN ('PRIMARY KEY','UNIQUE')
      GROUP BY tc.constraint_name, tc.constraint_type`,
    [table]
  )).rows;
}

async function tenantFk(table) {
  const p = db.getPool();
  return (await p.query(
    `SELECT confrel.relname AS foreign_table,
            con.confdeltype AS delete_type
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
       JOIN pg_class confrel ON confrel.oid = con.confrelid
       JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, n) ON true
       JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = k.attnum
      WHERE nsp.nspname = 'public'
        AND rel.relname = $1
        AND con.contype = 'f'
        AND att.attname = 'tenant_id'
        AND k.n = 1`,
    [table]
  )).rows[0];
}

if (!HAS_DB) {
  test('advertising-orchestrator credits schema skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else {
  let tenantA = null;
  let tenantB = null;

  before(async () => {
    await ensureTenantSchema();
    await ensureAgentOrchestratorSchema();
    const p = db.getPool();
    const mk = async (label, slug) => (await p.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [label, slug]
    )).rows[0].id;
    tenantA = await mk(`AOC A ${SUFFIX}`, `aoc-a-${SUFFIX}`);
    tenantB = await mk(`AOC B ${SUFFIX}`, `aoc-b-${SUFFIX}`);
  });

  after(async () => {
    const p = db.getPool();
    const ids = [tenantA, tenantB].filter(Boolean);
    if (!ids.length) return;
    await p.query(`DELETE FROM tenants WHERE id = ANY($1)`, [ids]);
  });

  test('PR2 credit/outbox tables exist with NOT NULL tenant_id FK CASCADE and a PK', async () => {
    const p = db.getPool();
    const present = (await p.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' AND table_name = ANY($1)`,
      [TABLES]
    )).rows.map((r) => r.table_name).sort();
    assert.deepStrictEqual(present, [...TABLES].sort(), 'all PR2 tables must exist');

    for (const table of TABLES) {
      const col = (await p.query(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_schema='public' AND table_name=$1 AND column_name='tenant_id'`,
        [table]
      )).rows[0];
      assert.ok(col, `${table}.tenant_id must exist`);
      assert.strictEqual(col.is_nullable, 'NO', `${table}.tenant_id must be NOT NULL`);

      const pk = (await constraints(table)).filter((c) => c.constraint_type === 'PRIMARY KEY');
      assert.ok(pk.length >= 1, `${table} must have a PRIMARY KEY`);

      const fk = await tenantFk(table);
      assert.ok(fk, `${table}.tenant_id must be a foreign key`);
      assert.strictEqual(fk.foreign_table, 'tenants', `${table}.tenant_id must reference tenants`);
      assert.strictEqual(fk.delete_type, 'c', `${table}.tenant_id must ON DELETE CASCADE`);
    }
  });

  test('named uniques lead with tenant_id; ledger partial unique is (tenant_id, idempotency_key)', async () => {
    for (const [table, name, cols] of TENANT_UNIQUE_CONSTRAINTS) {
      const cons = await constraints(table);
      const unique = cons.filter((c) => c.constraint_type === 'UNIQUE');
      assert.ok(
        unique.some((c) => c.constraint_name === name && c.cols === cols),
        `${name} UNIQUE (${cols}) must exist on ${table}`
      );
    }

    const outboxPk = (await constraints('orchestrator_outbox'))
      .filter((c) => c.constraint_type === 'PRIMARY KEY');
    assert.ok(
      outboxPk.some((c) => c.cols === 'tenant_id,id'),
      'orchestrator_outbox PRIMARY KEY must be (tenant_id, id)'
    );

    const ledgerIdx = (await db.getPool().query(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname='public'
          AND indexname='orchestrator_credit_ledger_tenant_unique_idempotency_key'`
    )).rows[0];
    assert.ok(ledgerIdx, 'orchestrator_credit_ledger_tenant_unique_idempotency_key must exist');
    assert.match(ledgerIdx.indexdef, /UNIQUE/i);
    assert.match(ledgerIdx.indexdef, /tenant_id/);
    assert.match(ledgerIdx.indexdef, /idempotency_key/);
    assert.match(ledgerIdx.indexdef, /WHERE/i);

    for (const table of TABLES) {
      const idxs = await uniqueIndexCols(table);
      for (const idx of idxs) {
        if (idx.primary && idx.cols.length === 1 && idx.cols[0] === 'id') continue;
        assert.strictEqual(
          idx.cols[0],
          'tenant_id',
          `${table} unique index ${idx.name} must lead with tenant_id (got ${idx.cols.join(',')})`
        );
      }
    }

    const idempIdx = await uniqueIndexCols('orchestrator_idempotency_keys');
    assert.ok(
      !idempIdx.some((i) => i.cols.length === 1 && i.cols[0] === 'key'),
      'no unique index on idempotency key alone'
    );
  });

  test('credit/cost money columns are bigint, not float or numeric', async () => {
    const p = db.getPool();
    for (const [table, column] of MONEY_COLUMNS) {
      const col = (await p.query(
        `SELECT data_type, udt_name, is_nullable
           FROM information_schema.columns
          WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
        [table, column]
      )).rows[0];
      assert.ok(col, `${table}.${column} must exist`);
      assert.strictEqual(col.data_type, 'bigint', `${table}.${column} must be bigint (got ${col.data_type})`);
      assert.strictEqual(col.udt_name, 'int8', `${table}.${column} udt must be int8`);
    }

    const pr1Numeric = (await p.query(
      `SELECT table_name, column_name, data_type
         FROM information_schema.columns
        WHERE table_schema='public'
          AND (
            (table_name='orchestrator_workflows' AND column_name='advertising_budget')
            OR (table_name='orchestrator_approvals' AND column_name='approved_credit_ceiling')
          )`
    )).rows;
    assert.strictEqual(pr1Numeric.length, 2, 'PR1 NUMERIC money columns must still exist');
    for (const row of pr1Numeric) {
      assert.strictEqual(row.data_type, 'numeric', `${row.table_name}.${row.column_name} must remain numeric`);
    }

    const bad = (await p.query(
      `SELECT table_name, column_name, data_type
         FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name LIKE 'orchestrator_%'
          AND column_name LIKE '%micros%'
          AND data_type <> 'bigint'`
    )).rows;
    assert.deepStrictEqual(bad, [], 'no micros column may use a non-bigint type');
  });

  test('credit_ceiling_micros and tenant limits default to 0 (fail-closed)', async () => {
    const p = db.getPool();
    const wfId = `owf-ceil-${SUFFIX}`;
    await p.query(
      `INSERT INTO orchestrator_workflows (id, tenant_id, name) VALUES ($1,$2,$3)`,
      [wfId, tenantA, 'ceiling default']
    );
    const wf = (await p.query(
      `SELECT credit_ceiling_micros FROM orchestrator_workflows WHERE id=$1 AND tenant_id=$2`,
      [wfId, tenantA]
    )).rows[0];
    assert.strictEqual(Number(wf.credit_ceiling_micros), 0, 'workflow credit_ceiling_micros DEFAULT 0');

    await p.query(
      `INSERT INTO orchestrator_tenant_limits (tenant_id) VALUES ($1)`,
      [tenantA]
    );
    const limits = (await p.query(
      `SELECT credit_ceiling_micros, requests_per_minute, max_concurrent_ai,
              daily_ai_cost_micros, monthly_ai_cost_micros, per_workflow_cost_micros
         FROM orchestrator_tenant_limits WHERE tenant_id=$1`,
      [tenantA]
    )).rows[0];
    assert.strictEqual(Number(limits.credit_ceiling_micros), 0);
    assert.strictEqual(limits.requests_per_minute, 0);
    assert.strictEqual(limits.max_concurrent_ai, 0);
    assert.strictEqual(Number(limits.daily_ai_cost_micros), 0);
    assert.strictEqual(Number(limits.monthly_ai_cost_micros), 0);
    assert.strictEqual(Number(limits.per_workflow_cost_micros), 0);

    await p.query(
      `INSERT INTO orchestrator_credit_accounts (tenant_id) VALUES ($1)`,
      [tenantA]
    );
    const acct = (await p.query(
      `SELECT available_micros, reserved_micros, consumed_micros
         FROM orchestrator_credit_accounts WHERE tenant_id=$1`,
      [tenantA]
    )).rows[0];
    assert.strictEqual(Number(acct.available_micros), 0);
    assert.strictEqual(Number(acct.reserved_micros), 0);
    assert.strictEqual(Number(acct.consumed_micros), 0);
  });

  test('idempotency lease columns exist (status, owner_token, lease_expires_at, updated_at)', async () => {
    const p = db.getPool();
    const cols = (await p.query(
      `SELECT column_name, udt_name, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name='orchestrator_idempotency_keys'
          AND column_name = ANY($1)`,
      [['status', 'owner_token', 'lease_expires_at', 'updated_at']]
    )).rows;
    const byName = Object.fromEntries(cols.map((r) => [r.column_name, r]));
    assert.ok(byName.status, 'status must exist');
    assert.strictEqual(byName.status.is_nullable, 'NO');
    assert.strictEqual(byName.status.udt_name, 'text');
    assert.match(String(byName.status.column_default || ''), /pending/);
    assert.ok(byName.owner_token, 'owner_token must exist');
    assert.strictEqual(byName.owner_token.is_nullable, 'YES');
    assert.ok(byName.lease_expires_at, 'lease_expires_at must exist');
    assert.strictEqual(byName.lease_expires_at.udt_name, 'timestamptz');
    assert.ok(byName.updated_at, 'updated_at must exist');
    assert.strictEqual(byName.updated_at.is_nullable, 'NO');

    const idx = (await p.query(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname='public'
          AND indexname='idx_orchestrator_idempotency_keys_tenant_status_lease'`
    )).rows[0];
    assert.ok(idx, 'stale-pending reclaim index must exist');
    assert.match(idx.indexdef, /tenant_id/);
    assert.match(idx.indexdef, /status/);
    assert.match(idx.indexdef, /lease_expires_at/);
  });

  test('ledger and usage_records reject UPDATE and direct DELETE while the tenant exists', async () => {
    const p = db.getPool();
    const ledger = (await p.query(
      `INSERT INTO orchestrator_credit_ledger
         (tenant_id, entry_type, amount_micros, reason_code)
       VALUES ($1,'grant',1000000,'test_grant')
       RETURNING id`,
      [tenantA]
    )).rows[0];
    const usage = (await p.query(
      `INSERT INTO orchestrator_usage_records
         (tenant_id, cost_status, estimated_cost_micros)
       VALUES ($1,'estimated',0)
       RETURNING id`,
      [tenantA]
    )).rows[0];

    await assert.rejects(
      () => p.query(`UPDATE orchestrator_credit_ledger SET reason_code='tamper' WHERE id=$1`, [ledger.id]),
      /orchestrator_credit_ledger_immutable/
    );
    await assert.rejects(
      () => p.query(`DELETE FROM orchestrator_credit_ledger WHERE id=$1`, [ledger.id]),
      /orchestrator_credit_ledger_immutable/
    );
    await assert.rejects(
      () => p.query(`UPDATE orchestrator_usage_records SET usage_source='manual' WHERE id=$1`, [usage.id]),
      /orchestrator_usage_records_immutable/
    );
    await assert.rejects(
      () => p.query(`DELETE FROM orchestrator_usage_records WHERE id=$1`, [usage.id]),
      /orchestrator_usage_records_immutable/
    );

    const still = await p.query(
      `SELECT
         (SELECT COUNT(*)::int FROM orchestrator_credit_ledger WHERE id=$1) AS ledger,
         (SELECT COUNT(*)::int FROM orchestrator_usage_records WHERE id=$2) AS usage`,
      [ledger.id, usage.id]
    );
    assert.strictEqual(still.rows[0].ledger, 1, 'direct delete must not remove the ledger row');
    assert.strictEqual(still.rows[0].usage, 1, 'direct delete must not remove the usage row');
  });

  test('DELETE FROM tenants cascades ledger, usage_records, accounts, limits, and outbox', async () => {
    const p = db.getPool();
    const tenantC = (await p.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [`AOC C ${SUFFIX}`, `aoc-c-${SUFFIX}`]
    )).rows[0].id;

    const ledger = (await p.query(
      `INSERT INTO orchestrator_credit_ledger
         (tenant_id, entry_type, amount_micros)
       VALUES ($1,'grant',1)
       RETURNING id`,
      [tenantC]
    )).rows[0];
    const usage = (await p.query(
      `INSERT INTO orchestrator_usage_records
         (tenant_id, cost_status)
       VALUES ($1,'final')
       RETURNING id`,
      [tenantC]
    )).rows[0];
    await p.query(`INSERT INTO orchestrator_credit_accounts (tenant_id) VALUES ($1)`, [tenantC]);
    await p.query(`INSERT INTO orchestrator_tenant_limits (tenant_id) VALUES ($1)`, [tenantC]);
    await p.query(
      `INSERT INTO orchestrator_outbox
         (id, tenant_id, destination, operation, idempotency_key)
       VALUES ($1,$2,'internal','noop',$3)`,
      [`obx-cascade-${SUFFIX}`, tenantC, `idemp-cascade-${SUFFIX}`]
    );

    await p.query(`DELETE FROM tenants WHERE id=$1`, [tenantC]);

    const left = await p.query(
      `SELECT
         (SELECT COUNT(*)::int FROM tenants WHERE id=$1) AS tenants,
         (SELECT COUNT(*)::int FROM orchestrator_credit_ledger WHERE id=$2) AS ledger,
         (SELECT COUNT(*)::int FROM orchestrator_usage_records WHERE id=$3) AS usage,
         (SELECT COUNT(*)::int FROM orchestrator_credit_accounts WHERE tenant_id=$1) AS accounts,
         (SELECT COUNT(*)::int FROM orchestrator_tenant_limits WHERE tenant_id=$1) AS limits,
         (SELECT COUNT(*)::int FROM orchestrator_outbox WHERE tenant_id=$1) AS outbox`,
      [tenantC, ledger.id, usage.id]
    );
    assert.strictEqual(left.rows[0].tenants, 0);
    assert.strictEqual(left.rows[0].ledger, 0, 'tenant DELETE must cascade ledger');
    assert.strictEqual(left.rows[0].usage, 0, 'tenant DELETE must cascade usage_records');
    assert.strictEqual(left.rows[0].accounts, 0, 'tenant DELETE must cascade credit_accounts');
    assert.strictEqual(left.rows[0].limits, 0, 'tenant DELETE must cascade tenant_limits');
    assert.strictEqual(left.rows[0].outbox, 0, 'tenant DELETE must cascade outbox');
  });

  test('CHECK rejects available_micros=-1 and ledger amount_micros=0', async () => {
    const p = db.getPool();
    await assert.rejects(
      () => p.query(
        `INSERT INTO orchestrator_credit_accounts (tenant_id, available_micros)
         VALUES ($1, -1)`,
        [tenantB]
      ),
      /available_micros|check/i,
      'negative available_micros must be rejected'
    );
    await assert.rejects(
      () => p.query(
        `INSERT INTO orchestrator_credit_ledger
           (tenant_id, entry_type, amount_micros)
         VALUES ($1,'grant',0)`,
        [tenantB]
      ),
      /amount_micros|check/i,
      'ledger amount_micros=0 must be rejected'
    );
  });

  test('cross-tenant: same idempotency_key and outbox id are allowed in two tenants', async () => {
    const p = db.getPool();
    const sharedKey = `shared-idemp-${SUFFIX}`;
    const sharedOutboxId = `shared-obx-${SUFFIX}`;

    await p.query(
      `INSERT INTO orchestrator_credit_reservations
         (id, tenant_id, amount_micros, status, estimated_cost_micros, idempotency_key)
       VALUES ($1,$2,100,'reserved',100,$3)`,
      [`res-a-${SUFFIX}`, tenantA, sharedKey]
    );
    await p.query(
      `INSERT INTO orchestrator_credit_reservations
         (id, tenant_id, amount_micros, status, estimated_cost_micros, idempotency_key)
       VALUES ($1,$2,100,'reserved',100,$3)`,
      [`res-b-${SUFFIX}`, tenantB, sharedKey]
    );

    await p.query(
      `INSERT INTO orchestrator_credit_ledger
         (tenant_id, entry_type, amount_micros, idempotency_key)
       VALUES ($1,'reservation',100,$2)`,
      [tenantA, sharedKey]
    );
    await p.query(
      `INSERT INTO orchestrator_credit_ledger
         (tenant_id, entry_type, amount_micros, idempotency_key)
       VALUES ($1,'reservation',100,$2)`,
      [tenantB, sharedKey]
    );

    await p.query(
      `INSERT INTO orchestrator_outbox
         (id, tenant_id, destination, operation, idempotency_key)
       VALUES ($1,$2,'meta','publish',$3)`,
      [sharedOutboxId, tenantA, sharedKey]
    );
    await p.query(
      `INSERT INTO orchestrator_outbox
         (id, tenant_id, destination, operation, idempotency_key)
       VALUES ($1,$2,'meta','publish',$3)`,
      [sharedOutboxId, tenantB, sharedKey]
    );

    const counts = await p.query(
      `SELECT
         (SELECT COUNT(*)::int FROM orchestrator_credit_reservations
           WHERE idempotency_key=$1) AS reservations,
         (SELECT COUNT(*)::int FROM orchestrator_outbox
           WHERE id=$2) AS outbox`,
      [sharedKey, sharedOutboxId]
    );
    assert.strictEqual(counts.rows[0].reservations, 2);
    assert.strictEqual(counts.rows[0].outbox, 2);

    await assert.rejects(
      () => p.query(
        `INSERT INTO orchestrator_credit_reservations
           (id, tenant_id, amount_micros, status, estimated_cost_micros, idempotency_key)
         VALUES ($1,$2,50,'reserved',50,$3)`,
        [`res-a-dup-${SUFFIX}`, tenantA, sharedKey]
      ),
      /unique|duplicate/i,
      'same tenant + idempotency_key on reservations must be rejected'
    );
    await assert.rejects(
      () => p.query(
        `INSERT INTO orchestrator_outbox
           (id, tenant_id, destination, operation, idempotency_key)
         VALUES ($1,$2,'google','publish',$3)`,
        [`obx-dup-${SUFFIX}`, tenantA, sharedKey]
      ),
      /unique|duplicate/i,
      'same tenant + dest/op/idemp on outbox must be rejected'
    );
  });

  test('second ensureAgentOrchestratorSchema is idempotent', async () => {
    await ensureAgentOrchestratorSchema();
  });
}
