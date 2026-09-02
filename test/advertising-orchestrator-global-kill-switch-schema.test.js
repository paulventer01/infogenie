'use strict';

// Focused regression: orchestrator_advertising_global_kill_switches is a
// platform-wide GLOBAL singleton. Schema ensure must leave it without
// tenant_id, it must be documented as KNOWN_GLOBAL (not NULLABLE_OK), and
// it must not be listed in ADVERTISING_ORCH_TABLES.
//
// Live ensure is gated on DATABASE_URL. Source assertions always run.
// Self-contained: ensureTenantSchema + ensureAgentOrchestratorSchema, no server.js boot.

const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../db');
const { ensureAgentOrchestratorSchema } = require('../services/agent_orchestrator/schema');
const { ensureTenantSchema } = require('../services/tenants/schema');

const HAS_DB = db.hasDb();
const GLOBAL_TABLE = 'orchestrator_advertising_global_kill_switches';
const TENANT_TABLE = 'orchestrator_advertising_tenant_kill_switches';
const TENANT_IDX = `${GLOBAL_TABLE}_tenant_idx`;
const SCHEMA_SRC_PATH = path.join(__dirname, '../services/agent_orchestrator/schema.js');
const AUDIT_SRC_PATH = path.join(__dirname, 'tenant-schema-audit.test.js');
const PHASE2_SRC_PATH = path.join(__dirname, '../services/tenants/phase2_migrate.js');

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

function extractListBlock(src, decl) {
  const start = src.indexOf(decl);
  assert.ok(start >= 0, `${decl} must exist`);
  const arrayEnd = src.indexOf('];', start);
  const setEnd = src.indexOf(']);', start);
  const end = arrayEnd >= 0 && (setEnd < 0 || arrayEnd <= setEnd) ? arrayEnd : setEnd;
  assert.ok(end > start, `${decl} must close`);
  return src.slice(start, end + (end === setEnd ? 3 : 2));
}

test('global advertising kill-switch is excluded from ADVERTISING_ORCH_TABLES and CREATE TABLE has no tenant_id', () => {
  const src = schemaSrc();
  const tablesBlock = extractListBlock(src, 'const ADVERTISING_ORCH_TABLES');
  assert.doesNotMatch(
    tablesBlock,
    /'orchestrator_advertising_global_kill_switches'/,
    'global kill-switch must not be in ADVERTISING_ORCH_TABLES (addTenantIdColumn would re-inject tenant_id)'
  );
  assert.match(
    tablesBlock,
    /'orchestrator_advertising_tenant_kill_switches'/,
    'companion tenant kill-switch must remain in ADVERTISING_ORCH_TABLES'
  );
  assert.match(src, /Do not list it here/);

  const create = extractCreateTable(src, GLOBAL_TABLE);
  assert.doesNotMatch(create, /tenant_id/);
  assert.match(create, /switch_key TEXT PRIMARY KEY/);

  const tenantCreate = extractCreateTable(src, TENANT_TABLE);
  assert.match(tenantCreate, /tenant_id INTEGER NOT NULL REFERENCES tenants\(id\)/);
  assert.match(tenantCreate, /PRIMARY KEY\(tenant_id,switch_key\)/);

  assert.match(
    src,
    /DROP INDEX IF EXISTS orchestrator_advertising_global_kill_switches_tenant_idx/
  );
  assert.match(
    src,
    /ALTER TABLE orchestrator_advertising_global_kill_switches DROP COLUMN IF EXISTS tenant_id/
  );
});

test('global advertising kill-switch is KNOWN_GLOBAL and documented, not NULLABLE_OK', () => {
  const auditSrc = fs.readFileSync(AUDIT_SRC_PATH, 'utf8');
  const knownBlock = extractListBlock(auditSrc, 'const KNOWN_GLOBAL');
  assert.match(
    knownBlock,
    /'orchestrator_advertising_global_kill_switches'/,
    'global kill-switch must be an explicit KNOWN_GLOBAL with justification'
  );
  assert.match(knownBlock, /Do NOT add this table to NULLABLE_OK/);
  assert.match(knownBlock, /PK\(switch_key\)/);

  const nullableBlock = extractListBlock(auditSrc, 'const NULLABLE_OK');
  assert.doesNotMatch(
    nullableBlock,
    /orchestrator_advertising_global_kill_switches/,
    'do not silence the audit by adding the global singleton to NULLABLE_OK'
  );

  const phase2Src = fs.readFileSync(PHASE2_SRC_PATH, 'utf8');
  assert.match(
    phase2Src,
    /Tables intentionally EXCLUDED[\s\S]*orchestrator_advertising_global_kill_switches/,
    'phase2_migrate.js must document the GLOBAL exclusion'
  );
  const plainBlock = extractListBlock(phase2Src, 'const PLAIN_TABLES');
  assert.doesNotMatch(plainBlock, /orchestrator_advertising_global_kill_switches/);
  const nullableOkBlock = extractListBlock(phase2Src, 'const PHASE2E_NULLABLE_OK');
  assert.doesNotMatch(nullableOkBlock, /orchestrator_advertising_global_kill_switches/);
});

if (!HAS_DB) {
  test('advertising-orchestrator global kill-switch schema skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else {
  before(async () => {
    await ensureTenantSchema();
    await ensureAgentOrchestratorSchema();
  });

  async function tenantIdColumn(table) {
    const r = await db.getPool().query(
      `SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_schema='public' AND table_name=$1 AND column_name='tenant_id'`,
      [table]
    );
    return r.rows[0] || null;
  }

  async function indexExists(name) {
    const r = await db.getPool().query(
      `SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=$1 LIMIT 1`,
      [name]
    );
    return r.rowCount > 0;
  }

  test('ensureAgentOrchestratorSchema leaves the global kill-switch without tenant_id and undoes accidental injection', async () => {
    const p = db.getPool();
    await ensureAgentOrchestratorSchema();
    assert.equal(await tenantIdColumn(GLOBAL_TABLE), null,
      'global kill-switch must have no tenant_id after ensure');
    assert.equal(await indexExists(TENANT_IDX), false,
      'accidental *_tenant_idx must not remain on the global table');

    let tenantCol = await tenantIdColumn(TENANT_TABLE);
    assert.ok(tenantCol, 'companion tenant kill-switch must keep tenant_id');
    assert.equal(tenantCol.is_nullable, 'NO');

    const pk = await p.query(
      `SELECT string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS cols
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
          AND tc.table_name = kcu.table_name
        WHERE tc.table_schema='public' AND tc.table_name=$1 AND tc.constraint_type='PRIMARY KEY'
        GROUP BY tc.constraint_name`,
      [GLOBAL_TABLE]
    );
    assert.equal(pk.rows[0] && pk.rows[0].cols, 'switch_key');

    await p.query(
      `ALTER TABLE ${GLOBAL_TABLE} ADD COLUMN tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE`
    );
    await p.query(`CREATE INDEX ${TENANT_IDX} ON ${GLOBAL_TABLE} (tenant_id)`);
    assert.ok(await tenantIdColumn(GLOBAL_TABLE), 'precondition: injected tenant_id');
    assert.equal(await indexExists(TENANT_IDX), true, 'precondition: injected tenant index');

    await ensureAgentOrchestratorSchema();

    assert.equal(await tenantIdColumn(GLOBAL_TABLE), null,
      'ensure must drop the accidental tenant_id');
    assert.equal(await indexExists(TENANT_IDX), false,
      'ensure must drop the accidental tenant index');
    tenantCol = await tenantIdColumn(TENANT_TABLE);
    assert.ok(tenantCol);
    assert.equal(tenantCol.is_nullable, 'NO');
    const keys = await p.query(
      `SELECT switch_key FROM ${GLOBAL_TABLE} ORDER BY switch_key`
    );
    assert.deepStrictEqual(
      keys.rows.map((r) => r.switch_key),
      ['google_ads_provider_draft', 'optimization_execution']
    );
  });
}
