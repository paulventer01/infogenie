// test/advertising-orchestrator-schema.test.js — advertising workflow DDL + tenant isolation
//
// Gated on DATABASE_URL. When hasDb() is true there are ZERO per-test skips.
// Self-contained: ensureTenantSchema + ensureAgentOrchestratorSchema, no server.js boot.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../db');
const { ensureAgentOrchestratorSchema } = require('../services/agent_orchestrator/schema');
const { ensureTenantSchema } = require('../services/tenants/schema');

const HAS_DB = db.hasDb();
const TABLES = [
  'orchestrator_workflows',
  'orchestrator_steps',
  'orchestrator_approvals',
  'orchestrator_audit_events',
  'orchestrator_idempotency_keys',
  'orchestrator_execution_leases',
];

const STATE_SPOT_CHECK = [
  'draft',
  'research_approval_required',
  'optimization_applied',
  'cancelled',
];

const SUFFIX = `ao-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

test('ensureAgentOrchestratorSchema is registered in BOOT_TASKS and run when backgroundEnabled', () => {
  const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const routesSrc = fs.readFileSync(
    path.join(__dirname, '..', 'services/cloudflare_status/routes.js'),
    'utf8'
  );

  const orchIdx = serverSrc.indexOf('ensureAgentOrchestratorSchema');
  assert.ok(orchIdx >= 0, 'server.js must call ensureAgentOrchestratorSchema');
  const pushIdx = serverSrc.lastIndexOf('BOOT_TASKS.push', orchIdx);
  assert.ok(pushIdx >= 0 && pushIdx < orchIdx,
    'ensureAgentOrchestratorSchema must sit inside a BOOT_TASKS.push');
  const nextPushIdx = serverSrc.indexOf('BOOT_TASKS.push', pushIdx + 1);
  const window = serverSrc.slice(pushIdx, nextPushIdx > 0 ? nextPushIdx : orchIdx + 'ensureAgentOrchestratorSchema'.length);
  assert.match(window, /BOOT_TASKS\.push\s*\(/);
  assert.match(window, /ensureAgentOrchestratorSchema/);
  assert.match(window, /process\.exit\(1\)/);
  assert.match(window, /NODE_ENV === 'production'/);
  assert.match(window, /captureException/);
  assert.doesNotMatch(window, /\[tier28-32\] schema init failed/);

  assert.match(routesSrc, /backgroundEnabled\s*\(\s*\)/);
  assert.match(routesSrc, /for\s*\(\s*const\s+_bootTask\s+of\s+BOOT_TASKS\s*\)/);

  const mountIdx = serverSrc.indexOf("require('./services/cloudflare_status/routes')");
  assert.ok(mountIdx >= 0, 'cloudflare_status/routes must still be the BOOT_TASKS runner mount');
  assert.doesNotMatch(
    serverSrc.slice(mountIdx),
    /for\s*\(\s*const\s+_bootTask\s+of\s+BOOT_TASKS\s*\)/,
    'must not add a second BOOT_TASKS runner at the end of server.js'
  );
});

let tenantA = null;
let tenantB = null;

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

if (!HAS_DB) {
  test('advertising-orchestrator schema skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else {
  before(async () => {
    await ensureTenantSchema();
    await ensureAgentOrchestratorSchema();
    const p = db.getPool();
    const mk = async (label, slug) => (await p.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [label, slug]
    )).rows[0].id;
    tenantA = await mk(`AO A ${SUFFIX}`, `ao-a-${SUFFIX}`);
    tenantB = await mk(`AO B ${SUFFIX}`, `ao-b-${SUFFIX}`);
  });

  after(async () => {
    const p = db.getPool();
    const ids = [tenantA, tenantB].filter(Boolean);
    if (!ids.length) return;
    await p.query(`DELETE FROM tenants WHERE id = ANY($1)`, [ids]);
  });

  test('all six advertising orchestrator tables exist with NOT NULL tenant_id and a PK', async () => {
    const p = db.getPool();
    const present = (await p.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' AND table_name = ANY($1)`,
      [TABLES]
    )).rows.map((r) => r.table_name).sort();
    assert.deepStrictEqual(present, [...TABLES].sort(), 'all six tables must exist');

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
    }
  });

  test('idempotency unique is (tenant_id, key); leases unique is (tenant_id, workflow_id); no bare-key uniques', async () => {
    const idempCons = await constraints('orchestrator_idempotency_keys');
    const idempUnique = idempCons.filter((c) => c.constraint_type === 'UNIQUE');
    assert.ok(
      idempUnique.some((c) => c.constraint_name === 'orchestrator_idempotency_keys_tenant_unique_key'
        && c.cols === 'tenant_id,key'),
      'orchestrator_idempotency_keys_tenant_unique_key UNIQUE (tenant_id, key) must exist'
    );
    assert.ok(
      !idempCons.some((c) => c.cols === 'key'),
      'idempotency keys must not have UNIQUE/PK on key alone'
    );

    const leaseCons = await constraints('orchestrator_execution_leases');
    const leaseUnique = leaseCons.filter((c) => c.constraint_type === 'UNIQUE');
    assert.ok(
      leaseUnique.some((c) => c.constraint_name === 'orchestrator_execution_leases_tenant_unique_workflow_id'
        && c.cols === 'tenant_id,workflow_id'),
      'orchestrator_execution_leases_tenant_unique_workflow_id UNIQUE (tenant_id, workflow_id) must exist'
    );
    assert.ok(
      !leaseCons.some((c) => c.cols === 'workflow_id'),
      'leases must not have UNIQUE/PK on workflow_id alone'
    );

    const idempIdx = await uniqueIndexCols('orchestrator_idempotency_keys');
    assert.ok(
      !idempIdx.some((i) => i.cols.length === 1 && i.cols[0] === 'key'),
      'no unique index on idempotency key alone'
    );
    const leaseIdx = await uniqueIndexCols('orchestrator_execution_leases');
    assert.ok(
      !leaseIdx.some((i) => i.cols.length === 1 && i.cols[0] === 'workflow_id'),
      'no unique index on leases workflow_id alone'
    );

    const stepIdx = (await db.getPool().query(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname='public'
          AND indexname='orchestrator_steps_tenant_unique_idempotency_key'`
    )).rows[0];
    assert.ok(stepIdx, 'orchestrator_steps_tenant_unique_idempotency_key must exist');
    assert.match(stepIdx.indexdef, /UNIQUE/i);
    assert.match(stepIdx.indexdef, /tenant_id/);
    assert.match(stepIdx.indexdef, /idempotency_key/);
    assert.match(stepIdx.indexdef, /WHERE/i);
  });

  test('current_state CHECK accepts the full enum spot-check and rejects invalid states', async () => {
    const p = db.getPool();
    for (const state of STATE_SPOT_CHECK) {
      const id = `owf-state-${state}-${SUFFIX}`;
      await p.query(
        `INSERT INTO orchestrator_workflows (id, tenant_id, name, current_state)
         VALUES ($1,$2,$3,$4)`,
        [id, tenantA, `state ${state}`, state]
      );
      const row = (await p.query(
        `SELECT current_state FROM orchestrator_workflows WHERE id=$1 AND tenant_id=$2`,
        [id, tenantA]
      )).rows[0];
      assert.strictEqual(row.current_state, state);
    }

    await assert.rejects(
      () => p.query(
        `INSERT INTO orchestrator_workflows (id, tenant_id, name, current_state)
         VALUES ($1,$2,$3,$4)`,
        [`owf-bad-state-${SUFFIX}`, tenantA, 'bad', 'not_a_real_state']
      ),
      /current_state|check/i,
      'invalid current_state must be rejected'
    );
  });

  test('approvals and audit_events reject UPDATE and direct DELETE while the parent workflow exists', async () => {
    const p = db.getPool();
    const wfId = `owf-immut-${SUFFIX}`;
    await p.query(
      `INSERT INTO orchestrator_workflows (id, tenant_id, name) VALUES ($1,$2,$3)`,
      [wfId, tenantA, 'immutable host']
    );

    const approval = (await p.query(
      `INSERT INTO orchestrator_approvals
         (tenant_id, workflow_id, gate, content_hash, decision)
       VALUES ($1,$2,'research_execution',$3,'approved')
       RETURNING id`,
      [tenantA, wfId, 'sha256-test-hash']
    )).rows[0];

    const audit = (await p.query(
      `INSERT INTO orchestrator_audit_events (tenant_id, workflow_id, event, detail)
       VALUES ($1,$2,'workflow_created','{}')
       RETURNING id`,
      [tenantA, wfId]
    )).rows[0];

    await assert.rejects(
      () => p.query(`UPDATE orchestrator_approvals SET comment='x' WHERE id=$1`, [approval.id]),
      /orchestrator_approvals_immutable/
    );
    await assert.rejects(
      () => p.query(`DELETE FROM orchestrator_approvals WHERE id=$1`, [approval.id]),
      /orchestrator_approvals_immutable/
    );
    await assert.rejects(
      () => p.query(`UPDATE orchestrator_audit_events SET event='tamper' WHERE id=$1`, [audit.id]),
      /orchestrator_audit_events_immutable/
    );
    await assert.rejects(
      () => p.query(`DELETE FROM orchestrator_audit_events WHERE id=$1`, [audit.id]),
      /orchestrator_audit_events_immutable/
    );

    const still = await p.query(
      `SELECT
         (SELECT COUNT(*)::int FROM orchestrator_approvals WHERE id=$1) AS approvals,
         (SELECT COUNT(*)::int FROM orchestrator_audit_events WHERE id=$2) AS audit`,
      [approval.id, audit.id]
    );
    assert.strictEqual(still.rows[0].approvals, 1, 'direct delete must not remove the approval');
    assert.strictEqual(still.rows[0].audit, 1, 'direct delete must not remove the audit event');
  });

  test('DELETE FROM orchestrator_workflows cascades approvals and audit_events', async () => {
    const p = db.getPool();
    const wfId = `owf-wfcascade-${SUFFIX}`;
    await p.query(
      `INSERT INTO orchestrator_workflows (id, tenant_id, name) VALUES ($1,$2,$3)`,
      [wfId, tenantA, 'workflow cascade host']
    );
    const approval = (await p.query(
      `INSERT INTO orchestrator_approvals
         (tenant_id, workflow_id, gate, content_hash, decision)
       VALUES ($1,$2,'research_execution',$3,'approved')
       RETURNING id`,
      [tenantA, wfId, 'sha256-wf-cascade']
    )).rows[0];
    const audit = (await p.query(
      `INSERT INTO orchestrator_audit_events (tenant_id, workflow_id, event)
       VALUES ($1,$2,'workflow_created')
       RETURNING id`,
      [tenantA, wfId]
    )).rows[0];

    await p.query(`DELETE FROM orchestrator_workflows WHERE id=$1 AND tenant_id=$2`, [wfId, tenantA]);

    const left = await p.query(
      `SELECT
         (SELECT COUNT(*)::int FROM orchestrator_workflows WHERE id=$1) AS workflows,
         (SELECT COUNT(*)::int FROM orchestrator_approvals WHERE id=$2) AS approvals,
         (SELECT COUNT(*)::int FROM orchestrator_audit_events WHERE id=$3) AS audit`,
      [wfId, approval.id, audit.id]
    );
    assert.strictEqual(left.rows[0].workflows, 0);
    assert.strictEqual(left.rows[0].approvals, 0, 'workflow DELETE must cascade approvals');
    assert.strictEqual(left.rows[0].audit, 0, 'workflow DELETE must cascade audit events');
  });

  test('DELETE FROM tenants cascades workflows, approvals, and audit_events', async () => {
    const p = db.getPool();
    const tenantC = (await p.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [`AO C ${SUFFIX}`, `ao-c-${SUFFIX}`]
    )).rows[0].id;
    const wfId = `owf-tenantcascade-${SUFFIX}`;
    await p.query(
      `INSERT INTO orchestrator_workflows (id, tenant_id, name) VALUES ($1,$2,$3)`,
      [wfId, tenantC, 'tenant cascade host']
    );
    await p.query(
      `INSERT INTO orchestrator_approvals
         (tenant_id, workflow_id, gate, content_hash, decision)
       VALUES ($1,$2,'research_execution',$3,'approved')`,
      [tenantC, wfId, 'sha256-tenant-cascade']
    );
    await p.query(
      `INSERT INTO orchestrator_audit_events (tenant_id, workflow_id, event)
       VALUES ($1,$2,'workflow_created')`,
      [tenantC, wfId]
    );

    await p.query(`DELETE FROM tenants WHERE id=$1`, [tenantC]);

    const left = await p.query(
      `SELECT
         (SELECT COUNT(*)::int FROM tenants WHERE id=$1) AS tenants,
         (SELECT COUNT(*)::int FROM orchestrator_workflows WHERE tenant_id=$1) AS workflows,
         (SELECT COUNT(*)::int FROM orchestrator_approvals WHERE tenant_id=$1) AS approvals,
         (SELECT COUNT(*)::int FROM orchestrator_audit_events WHERE tenant_id=$1) AS audit`,
      [tenantC]
    );
    assert.strictEqual(left.rows[0].tenants, 0);
    assert.strictEqual(left.rows[0].workflows, 0, 'tenant DELETE must cascade workflows');
    assert.strictEqual(left.rows[0].approvals, 0, 'tenant DELETE must cascade approvals');
    assert.strictEqual(left.rows[0].audit, 0, 'tenant DELETE must cascade audit events');
  });

  test('second ensureAgentOrchestratorSchema is idempotent', async () => {
    await ensureAgentOrchestratorSchema();
  });

  test('SELECT WHERE tenant_id=$B does not return tenant A workflows', async () => {
    const p = db.getPool();
    const idA = `owf-iso-a-${SUFFIX}`;
    const idB = `owf-iso-b-${SUFFIX}`;
    await p.query(
      `INSERT INTO orchestrator_workflows (id, tenant_id, name) VALUES ($1,$2,$3)`,
      [idA, tenantA, 'tenant A workflow']
    );
    await p.query(
      `INSERT INTO orchestrator_workflows (id, tenant_id, name) VALUES ($1,$2,$3)`,
      [idB, tenantB, 'tenant B workflow']
    );

    const bRows = (await p.query(
      `SELECT id FROM orchestrator_workflows WHERE tenant_id=$1`,
      [tenantB]
    )).rows;
    assert.ok(bRows.every((r) => r.id !== idA), 'tenant B query must not return tenant A row');
    assert.ok(bRows.some((r) => r.id === idB), 'tenant B query must return its own row');

    const aOnly = (await p.query(
      `SELECT id FROM orchestrator_workflows WHERE id=$1 AND tenant_id=$2`,
      [idA, tenantB]
    )).rows;
    assert.strictEqual(aOnly.length, 0, 'id + tenant B must not fetch tenant A workflow');
  });
}
