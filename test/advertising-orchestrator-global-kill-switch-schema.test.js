'use strict';

// Focused regression: orchestrator_advertising_global_kill_switches is a
// platform-wide GLOBAL singleton. Schema ensure must leave it without
// tenant_id, it must be documented as KNOWN_GLOBAL (not NULLABLE_OK), and
// it must not be listed in ADVERTISING_ORCH_TABLES.
//
// Mutating live ensure runs on a per-file scratch database (not the shared
// QA DATABASE_URL) plus an advisory lock, matching closeout/preflight
// discipline. Source assertions always run.
// Empty-scratch setup is self-contained: ensureAuthSchema then tenant then
// orchestrator. No server.js boot.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  scratchName,
  swapDatabase,
  createScratchDatabase,
  dropScratchDatabase,
} = require('./helpers/scratch_db');

const ADMIN_URL = process.env.DATABASE_URL || '';
const SCRATCH_DB = scratchName('agks');
const SCRATCH_URL = ADMIN_URL ? swapDatabase(ADMIN_URL, SCRATCH_DB) : '';
// Must run before db.getPool() / ensure*Schema() — db.js reads DATABASE_URL lazily.
if (SCRATCH_URL) process.env.DATABASE_URL = SCRATCH_URL;

const db = require('../db');
const { ensureAuthSchema } = require('../services/auth/schema');
const { ensureTenantSchema } = require('../services/tenants/schema');
const { ensureAgentOrchestratorSchema } = require('../services/agent_orchestrator/schema');

const HAS_DB = !!ADMIN_URL;
const GLOBAL_TABLE = 'orchestrator_advertising_global_kill_switches';
const TENANT_TABLE = 'orchestrator_advertising_tenant_kill_switches';
const TENANT_IDX = `${GLOBAL_TABLE}_tenant_idx`;
const GLOBAL_KEYS = ['google_ads_provider_draft', 'optimization_execution'];
const SCHEMA_SRC_PATH = path.join(__dirname, '../services/agent_orchestrator/schema.js');
const AUDIT_SRC_PATH = path.join(__dirname, 'tenant-schema-audit.test.js');
const PHASE2_SRC_PATH = path.join(__dirname, '../services/tenants/phase2_migrate.js');
const ADVISORY_LOCK_KEY = crypto
  .createHash('sha256')
  .update('infogenie-agks-global-schema-audit')
  .digest()
  .readInt32BE(0);

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

function extractFunctionSource(src, name) {
  const start = src.indexOf(`CREATE OR REPLACE FUNCTION ${name}`);
  assert.ok(start >= 0, `${name} must exist`);
  const marker = src.indexOf('$fn$', start);
  const end = src.indexOf('$fn$ LANGUAGE plpgsql', marker + 4);
  assert.ok(end > marker, `${name} function body must close`);
  return src.slice(start, end);
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

  const guard = extractFunctionSource(src, 'orchestrator_advertising_kill_switch_guard');
  const tenantGate = guard.indexOf("IF TG_TABLE_NAME='orchestrator_advertising_tenant_kill_switches' THEN");
  assert.ok(tenantGate >= 0, 'tenant_id must be gated by a nested TG_TABLE_NAME IF');
  const tenantIdRef = guard.indexOf('NEW.tenant_id', tenantGate);
  assert.ok(tenantIdRef > tenantGate, 'NEW.tenant_id must sit inside the tenant-table IF');
  assert.equal(
    guard.indexOf('NEW.tenant_id'),
    tenantIdRef,
    'NEW.tenant_id must appear only inside the nested tenant-table IF'
  );
  assert.doesNotMatch(
    guard,
    /TG_TABLE_NAME='orchestrator_advertising_tenant_kill_switches' AND NEW\.tenant_id/
  );
  assert.match(guard, /orchestrator_advertising_kill_switch_delete_prohibited/);
  assert.match(guard, /orchestrator_advertising_kill_switch_identity_immutable/);
  assert.match(guard, /orchestrator_advertising_kill_switch_invalid_version/);

  const cleanupStart = src.indexOf('Undo accidental addTenantIdColumn');
  const cleanupEnd = src.indexOf('for (const t of ADVERTISING_ORCH_TABLES)', cleanupStart);
  assert.ok(cleanupStart >= 0 && cleanupEnd > cleanupStart, 'accidental-column cleanup must exist');
  const cleanup = src.slice(cleanupStart, cleanupEnd);
  assert.match(cleanup, /_columnExists/);
  assert.match(src, /async function _columnExists[\s\S]*information_schema\.columns/);
  assert.match(cleanup, /hasAccidentalTenantId/);
  assert.match(cleanup, /hasAccidentalTenantIdx/);
  assert.ok(
    cleanup.indexOf('_columnExists') < cleanup.indexOf('DROP COLUMN'),
    'information_schema column check must precede DROP COLUMN'
  );
  assert.ok(
    cleanup.indexOf('hasAccidentalTenantIdx') < cleanup.indexOf('DROP INDEX'),
    'index existence check must precede DROP INDEX'
  );
  assert.match(cleanup, /DROP INDEX IF EXISTS orchestrator_advertising_global_kill_switches_tenant_idx/);
  assert.match(cleanup, /ALTER TABLE orchestrator_advertising_global_kill_switches DROP COLUMN IF EXISTS tenant_id/);
  assert.match(cleanup, /must not issue no-op DROP\/ALTER/);
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

test('mutating global kill-switch regression uses scratch DB, advisory lock, and auth-first setup', () => {
  const src = fs.readFileSync(__filename, 'utf8');
  assert.match(src, /scratchName\('agks'\)/);
  assert.match(src, /createScratchDatabase/);
  assert.match(src, /dropScratchDatabase/);
  assert.match(src, /pg_advisory_lock/);
  const authIdx = src.indexOf('await ensureAuthSchema()');
  const tenantIdx = src.indexOf('await ensureTenantSchema()');
  const orchIdx = src.indexOf('await ensureAgentOrchestratorSchema()');
  assert.ok(authIdx >= 0 && tenantIdx > authIdx && orchIdx > tenantIdx,
    'empty-DB setup must be ensureAuthSchema then ensureTenantSchema then ensureAgentOrchestratorSchema');
});

if (!HAS_DB) {
  test('advertising-orchestrator global kill-switch schema skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else {
  let scratchReady = false;
  let lockClient = null;

  before(async () => {
    await createScratchDatabase(ADMIN_URL, SCRATCH_DB);
    scratchReady = true;
    await ensureAuthSchema();
    await ensureTenantSchema();
    await ensureAgentOrchestratorSchema();
    lockClient = await db.getPool().connect();
    await lockClient.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
  });

  after(async () => {
    if (lockClient) {
      try { await lockClient.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]); } catch { /* ignore */ }
      try { lockClient.release(); } catch { /* ignore */ }
    }
    try {
      if (scratchReady) {
        const p = db.getPool();
        if (p) await p.end();
      }
    } catch { /* pool may already be ended */ }
    try { await dropScratchDatabase(ADMIN_URL, SCRATCH_DB); } catch { /* ignore */ }
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

  async function flipGlobal(p, key, active) {
    const beforeRow = (await p.query(
      `SELECT active, version FROM ${GLOBAL_TABLE} WHERE switch_key=$1`,
      [key]
    )).rows[0];
    assert.ok(beforeRow, `${key} must exist`);
    await p.query(
      `UPDATE ${GLOBAL_TABLE}
          SET active=$2, version=version+1, updated_at=clock_timestamp()
        WHERE switch_key=$1`,
      [key, active]
    );
    const afterRow = (await p.query(
      `SELECT active, version FROM ${GLOBAL_TABLE} WHERE switch_key=$1`,
      [key]
    )).rows[0];
    assert.equal(afterRow.active, active, `${key} active=${active}`);
    assert.equal(Number(afterRow.version), Number(beforeRow.version) + 1, `${key} version increment`);
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
      GLOBAL_KEYS
    );

    for (const key of GLOBAL_KEYS) {
      await flipGlobal(p, key, true);
      await flipGlobal(p, key, false);
    }
    await assert.rejects(
      p.query(
        `UPDATE ${GLOBAL_TABLE} SET version=version+2, updated_at=clock_timestamp()
          WHERE switch_key='optimization_execution'`
      ),
      /invalid_version/
    );
    await assert.rejects(
      p.query(`DELETE FROM ${GLOBAL_TABLE} WHERE switch_key='optimization_execution'`),
      /delete_prohibited/
    );
  });
}
