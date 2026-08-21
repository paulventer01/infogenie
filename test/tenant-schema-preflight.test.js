// test/tenant-schema-preflight.test.js — read-only closeout preflight + fail-before-DDL
//
// Covers: zero-orphan clean report, orphan fail-before-DDL (no partial schema
// change, no tenant-1 mapping, no DELETE), job_queue empty-payload CHECK, and
// vertical_playbooks system xor tenant CHECK.
// Skip the whole DB-dependent file when DATABASE_URL is unset. Do not weaken
// tenant-schema-audit.
//
// Destructive DDL (DROP TABLE brand_foundation) runs on a per-file scratch
// database, not the live QA DATABASE_URL. Parallel files that DELETE FROM
// tenants on the shared database therefore cannot take RowExclusiveLock on
// the same brand_foundation this suite DROPs (40P01). Intra-file restore
// still holds the e2c15fa advisory lock until unlock-last; 40P01 is rethrown.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const pg = require('pg');
const {
  scratchName,
  swapDatabase,
  createScratchDatabase,
  dropScratchDatabase,
  isDeadlockError,
} = require('./helpers/scratch_db');

const ADMIN_URL = process.env.DATABASE_URL || '';
const SCRATCH_DB = scratchName('preflight');
const SCRATCH_URL = ADMIN_URL ? swapDatabase(ADMIN_URL, SCRATCH_DB) : '';
// Must run before db.getPool() / ensure*Schema() — db.js reads DATABASE_URL lazily.
if (SCRATCH_URL) process.env.DATABASE_URL = SCRATCH_URL;

const db = require('../db');
const { enforceTenantIdNotNull } = require('../services/tenants/migration');
const {
  CLOSEOUT_TABLES,
  PARENT_BACKFILL,
  JOB_QUEUE_EMPTY_PAYLOAD_CHECK,
  PLAYBOOKS_XOR_CHECK,
  ID_CAP,
  _finding,
  formatPreflightReport,
  preflightTenantSchemaCloseout,
  preflightUnmappedForTable,
  ensureJobQueueEmptyPayloadCheck,
  ensureVerticalPlaybooksXorCheck,
} = require('../services/tenants/preflight');
const { ensureTenantSchema } = require('../services/tenants/schema');
const { ensureAuthSchema } = require('../services/auth/schema');
const { ensureBrandFoundationSchema } = require('../services/brand_foundation/schema');
const { ensureJobsSchema } = require('../services/jobs/schema');
const { ensureVerticalPlaybooksSchema } = require('../services/vertical_playbooks/schema');

const HAS_DB = !!ADMIN_URL;
const skip = HAS_DB ? false : 'no DATABASE_URL — preflight tests skipped';
let scratchReady = false;

before(async () => {
  if (skip) return;
  await createScratchDatabase(ADMIN_URL, SCRATCH_DB);
  scratchReady = true;
});

after(async () => {
  if (!ADMIN_URL) return;
  try {
    if (scratchReady) {
      const p = db.getPool();
      if (p) await p.end();
    }
  } catch { /* pool may already be ended */ }
  try { await dropScratchDatabase(ADMIN_URL, SCRATCH_DB); } catch { /* ignore */ }
});

const PREFLIGHT_SCRIPT = path.join(__dirname, '../scripts/tenant-schema-preflight.js');

const CLOSEOUT_ADVISORY_LOCK_KEY = crypto
  .createHash('sha256')
  .update('infogenie-tenant-schema-closeout')
  .digest()
  .readInt32BE(0);

let _mutationGate = Promise.resolve();
// Cleanups registered while a mutating test holds the advisory lock. node:test
// runs t.after hooks in registration order, so a second t.after would run
// after pg_advisory_unlock and deadlock with closeout's DROP brand_foundation
// (40P01: DELETE tenants → RowExclusiveLock CASCADE vs AccessExclusiveLock).
let _lockedCleanups = null;

async function acquireLock() {
  const client = await db.getPool().connect();
  await client.query('SELECT pg_advisory_lock($1)', [CLOSEOUT_ADVISORY_LOCK_KEY]);
  return client;
}

async function releaseLock(client) {
  if (!client) return;
  try {
    await client.query('SELECT pg_advisory_unlock($1)', [CLOSEOUT_ADVISORY_LOCK_KEY]);
  } finally {
    client.release();
  }
}

async function guardMutatingTest(t) {
  let releaseGate = () => {};
  const gate = new Promise((resolve) => { releaseGate = resolve; });
  const prev = _mutationGate;
  _mutationGate = gate;
  await prev;
  let lockClient;
  try {
    lockClient = await acquireLock();
  } catch (err) {
    releaseGate();
    throw err;
  }
  const lockedCleanups = [];
  _lockedCleanups = lockedCleanups;
  t.after(async () => {
    try {
      await restorePreflightFixtures(lockedCleanups);
    } finally {
      if (_lockedCleanups === lockedCleanups) _lockedCleanups = null;
      await releaseLock(lockClient);
      releaseGate();
    }
  });
}

function addLockedCleanup(fn) {
  if (!_lockedCleanups) {
    throw new Error('addLockedCleanup requires an active guardMutatingTest');
  }
  _lockedCleanups.push(fn);
}

async function tableExists(name) {
  const r = await db.getPool().query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name=$1`, [name]);
  return r.rowCount > 0;
}

async function colNullable(table, column) {
  const r = await db.getPool().query(
    `SELECT is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
    [table, column]);
  return r.rows[0] || null;
}

async function constraintExists(table, name) {
  const r = await db.getPool().query(
    `SELECT 1 FROM information_schema.table_constraints
      WHERE table_schema='public' AND table_name=$1 AND constraint_name=$2`,
    [table, name]);
  return r.rowCount > 0;
}

async function seedTenant(label) {
  const slug = `preflight-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const r = await db.getPool().query(
    `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
    [`Preflight ${label}`, slug]);
  const id = r.rows[0].id;
  addLockedCleanup(async (p) => {
    await p.query(`DELETE FROM tenants WHERE id=$1`, [id]);
  });
  return id;
}

async function restorePreflightFixtures(lockedCleanups) {
  const p = db.getPool();
  // Probe DROPs and tenant DELETEs must stay in this function: it runs from
  // guardMutatingTest's t.after while the advisory lock is still held.
  await p.query('DROP TABLE IF EXISTS preflight_child_probe CASCADE');
  await p.query('DROP TABLE IF EXISTS preflight_parent_probe CASCADE');
  // Scratch DBs start empty — do not assume live QA tables already exist.
  if (await tableExists('job_queue')) {
    await p.query(`DELETE FROM job_queue WHERE name LIKE 'preflight-%'`);
  }
  if (await tableExists('vertical_playbooks')) {
    await p.query(`DELETE FROM vertical_playbooks WHERE vertical LIKE 'preflight_%'`);
  }
  try {
    const extras = lockedCleanups || _lockedCleanups || [];
    for (const fn of extras) {
      await fn(p);
    }
    if (await tableExists('tenants')) {
      await p.query(`DELETE FROM tenants WHERE slug LIKE $1`, ['preflight-%']);
    }
  } catch (err) {
    // Deadlocks (40P01) and serialization failures (40001) must fail the test —
    // warn-and-pass hid the DROP vs DELETE tenants lock-order cycle.
    if (isDeadlockError(err)) throw err;
    // Best-effort otherwise: missing tables or already-deleted fixture rows
    // during teardown must not fail a passing assertion.
    console.warn('[preflight-test] tenant fixture cleanup failed:', err.message);
  }
  if (await tableExists('brand_foundation')) {
    const col = await colNullable('brand_foundation', 'tenant_id');
    if (!col || col.is_nullable === 'YES') {
      await p.query('DROP TABLE IF EXISTS brand_foundation CASCADE');
    }
  }
  await ensureAuthSchema();
  await ensureTenantSchema();
  await ensureBrandFoundationSchema();
  await ensureJobsSchema();
  await ensureVerticalPlaybooksSchema();
}

function withQuerySpy() {
  const orig = pg.Client.prototype.query;
  const calls = [];
  pg.Client.prototype.query = function spyQuery(config) {
    const text = typeof config === 'string' ? config : (config && config.text) || '';
    calls.push(String(text));
    return orig.apply(this, arguments);
  };
  return {
    calls,
    restore() { pg.Client.prototype.query = orig; },
  };
}

function assertSelectOnly(calls) {
  const writes = calls.filter((sql) => {
    const trimmed = sql.replace(/^\s+/, '');
    if (/^(BEGIN|ROLLBACK|COMMIT|START\s+TRANSACTION|SET|SHOW|SELECT|DEALLOCATE|DISCARD)\b/i.test(trimmed)) {
      return false;
    }
    return /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE|COPY)\b/i.test(trimmed);
  });
  assert.deepStrictEqual(writes, [], `preflight issued write SQL:\n${writes.join('\n')}`);
  assert.ok(calls.some((s) => /^\s*BEGIN\s+READ\s+ONLY/i.test(s)), 'preflight must BEGIN READ ONLY');
  assert.ok(calls.some((s) => /^\s*ROLLBACK\b/i.test(s)), 'preflight must ROLLBACK');
}

async function snapshotCounts() {
  const p = db.getPool();
  const out = {};
  for (const t of [...CLOSEOUT_TABLES, 'vertical_playbooks', 'job_queue']) {
    const exists = await p.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [t]);
    if (!exists.rowCount) { out[t] = null; continue; }
    const n = await p.query(`SELECT COUNT(*)::bigint AS n FROM ${t}`);
    out[t] = String(n.rows[0].n);
  }
  return out;
}

test('preflight script exits 2 when DATABASE_URL is unset', () => {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  const r = spawnSync(process.execPath, [PREFLIGHT_SCRIPT], { env, encoding: 'utf8' });
  assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}\n${r.stdout}\n${r.stderr}`);
  assert.match(`${r.stderr}\n${r.stdout}`, /DATABASE_URL/);
});

test('preflight source never maps default tenant and never writes', () => {
  const src = fs.readFileSync(path.join(__dirname, '../services/tenants/preflight.js'), 'utf8');
  assert.doesNotMatch(src, /_getDefaultTenantId/);
  assert.doesNotMatch(src, /SET\s+tenant_id\s*=/);
  assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE)\s+INTO\b/i);
  assert.match(src, /BEGIN READ ONLY/);
  assert.match(src, /brand_foundation/);
  assert.match(src, /truncated:\s*!!u\.truncated/);
  for (const child of Object.keys(PARENT_BACKFILL)) {
    assert.match(src, new RegExp(child));
  }
});

test('preflight _finding sets truncated from extras when ids are already sliced', () => {
  assert.strictEqual(ID_CAP, 500, 'ID_CAP must stay 500');
  const sliced = Array.from({ length: ID_CAP }, (_, i) => ({ id: i + 1 }));
  const fromExtras = _finding('ugc_items', 'unmapped_tenant_id', sliced, {
    count: ID_CAP + 7,
    truncated: true,
  });
  assert.strictEqual(fromExtras.truncated, true, 'pre-sliced path must honor extra.truncated');
  assert.strictEqual(fromExtras.ids.length, ID_CAP);
  assert.strictEqual(fromExtras.count, ID_CAP + 7);

  const fromCap = _finding('ugc_items', 'unmapped_tenant_id', sliced.concat({ id: ID_CAP + 1 }), {
    count: ID_CAP + 1,
  });
  assert.strictEqual(fromCap.truncated, true, 'overflow ids must still set truncated');
  assert.strictEqual(fromCap.ids.length, ID_CAP);

  const clean = _finding('ugc_items', 'unmapped_tenant_id', [{ id: 1 }], { count: 1 });
  assert.ok(!clean.truncated, 'small findings must not be marked truncated');

  const text = formatPreflightReport({ ok: false, tables: [fromExtras] });
  assert.match(text, /\(truncated\)/);
  assert.match(text, /"truncated":\s*true/);
  assert.match(text, new RegExp(`"count":\\s*${ID_CAP + 7}`));
});

test('package.json exposes tenant:preflight', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  assert.strictEqual(pkg.scripts['tenant:preflight'], 'node scripts/tenant-schema-preflight.js');
});

test('zero-orphan database: preflight ok, CHECKs apply, second preflight still clean, no writes', { skip }, async (t) => {
  await guardMutatingTest(t);
  await restorePreflightFixtures();

  const before = await snapshotCounts();
  const spy = withQuerySpy();
  let report;
  try {
    report = await preflightTenantSchemaCloseout();
  } finally {
    spy.restore();
  }
  assertSelectOnly(spy.calls);
  const after = await snapshotCounts();
  assert.deepStrictEqual(after, before, 'preflight must not change row counts');

  assert.strictEqual(report.ok, true, `expected clean preflight, got ${JSON.stringify(report)}`);
  assert.deepStrictEqual(report.tables, []);

  const jobCheck = await ensureJobQueueEmptyPayloadCheck();
  assert.ok(jobCheck.ok, `job_queue CHECK should apply on a clean queue: ${JSON.stringify(jobCheck)}`);
  assert.ok(await constraintExists('job_queue', JOB_QUEUE_EMPTY_PAYLOAD_CHECK));

  const playCheck = await ensureVerticalPlaybooksXorCheck();
  assert.ok(playCheck.ok, `playbook xor CHECK should apply when clean: ${JSON.stringify(playCheck)}`);
  assert.ok(await constraintExists('vertical_playbooks', PLAYBOOKS_XOR_CHECK));

  const bf = await colNullable('brand_foundation', 'tenant_id');
  if (bf) {
    const close = await enforceTenantIdNotNull('brand_foundation', {
      dropCheck: 'brand_foundation_singleton',
      uniqueWithExtra: [],
    });
    assert.ok(close.ok, `closeout on clean brand_foundation: ${JSON.stringify(close)}`);
    const afterCol = await colNullable('brand_foundation', 'tenant_id');
    assert.strictEqual(afterCol.is_nullable, 'NO');
  }

  const second = await preflightTenantSchemaCloseout();
  assert.strictEqual(second.ok, true, `second preflight must stay clean: ${JSON.stringify(second)}`);

  const spawned = spawnSync(process.execPath, [PREFLIGHT_SCRIPT], {
    env: process.env,
    encoding: 'utf8',
  });
  assert.strictEqual(spawned.status, 0, `script exit 0, got ${spawned.status}\n${spawned.stdout}\n${spawned.stderr}`);
  assert.match(`${spawned.stdout}\n${spawned.stderr}`, /--- JSON ---/);
  assert.match(`${spawned.stdout}\n${spawned.stderr}`, /"ok":\s*true/);
});

test('orphan-present: preflight lists ids; enforceTenantIdNotNull performs zero DDL; no tenant 1 mapping', { skip }, async (t) => {
  await guardMutatingTest(t);
  const p = db.getPool();
  await ensureAuthSchema();
  await ensureTenantSchema();

  await p.query(`DROP TABLE IF EXISTS brand_foundation CASCADE`);
  await p.query(`
    CREATE TABLE brand_foundation (
      id INTEGER PRIMARY KEY DEFAULT 1,
      purpose_why TEXT DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT brand_foundation_singleton CHECK (id = 1)
    )
  `);
  await p.query(`INSERT INTO brand_foundation (id) VALUES (1)`);

  const report = await preflightTenantSchemaCloseout({ tables: ['brand_foundation'] });
  assert.strictEqual(report.ok, false);
  const bf = report.tables.find((x) => x.table === 'brand_foundation');
  assert.ok(bf, `brand_foundation must be listed: ${JSON.stringify(report)}`);
  assert.ok(bf.count >= 1);
  assert.strictEqual(bf.reason, 'unmapped_tenant_id');
  const bfIds = (bf.ids || []).map((x) => (x && typeof x === 'object' ? x.id : x));
  assert.ok(bfIds.map(String).includes('1'), `ids must include 1, got ${JSON.stringify(bf.ids)}`);

  const beforeUnique = await p.query(
    `SELECT constraint_name FROM information_schema.table_constraints
      WHERE table_schema='public' AND table_name='brand_foundation'
        AND constraint_type='UNIQUE'`);

  const r = await enforceTenantIdNotNull('brand_foundation', {
    dropCheck: 'brand_foundation_singleton',
    uniqueWithExtra: [],
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'preflight');
  assert.strictEqual(r.added, false);
  assert.strictEqual(r.notNullSet, false);
  assert.strictEqual(r.uniqueAdded, false);
  assert.strictEqual(r.droppedCheck, false);

  const col = await colNullable('brand_foundation', 'tenant_id');
  assert.strictEqual(col, null, 'column still absent — no partial ADD COLUMN');

  const kept = await p.query(`SELECT id FROM brand_foundation`);
  assert.strictEqual(kept.rowCount, 1);
  assert.strictEqual(kept.rows[0].id, 1);

  const singleton = await constraintExists('brand_foundation', 'brand_foundation_singleton');
  assert.ok(singleton, 'singleton CHECK must survive preflight abort');

  const afterUnique = await p.query(
    `SELECT constraint_name FROM information_schema.table_constraints
      WHERE table_schema='public' AND table_name='brand_foundation'
        AND constraint_type='UNIQUE'`);
  assert.deepStrictEqual(
    afterUnique.rows.map((x) => x.constraint_name).sort(),
    beforeUnique.rows.map((x) => x.constraint_name).sort(),
    'UNIQUE must not be added on preflight abort'
  );

  // Nullable-column fixture: SET NOT NULL must not flip; row stays NULL (not tenant 1).
  await p.query(`DROP TABLE IF EXISTS brand_foundation CASCADE`);
  await p.query(`
    CREATE TABLE brand_foundation (
      id INTEGER PRIMARY KEY,
      tenant_id INT,
      purpose_why TEXT DEFAULT '',
      CONSTRAINT brand_foundation_singleton CHECK (id = 1)
    )
  `);
  await p.query(`INSERT INTO brand_foundation (id, tenant_id) VALUES (1, NULL)`);

  const r2 = await enforceTenantIdNotNull('brand_foundation', {
    dropCheck: 'brand_foundation_singleton',
    uniqueWithExtra: [],
  });
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(r2.reason, 'preflight');
  const col2 = await colNullable('brand_foundation', 'tenant_id');
  assert.ok(col2);
  assert.strictEqual(col2.is_nullable, 'YES');
  const row2 = await p.query(`SELECT id, tenant_id FROM brand_foundation WHERE id=1`);
  assert.strictEqual(row2.rows[0].tenant_id, null, 'must not map to tenant 1');
  assert.ok(await constraintExists('brand_foundation', 'brand_foundation_singleton'));
  assert.ok(!(await constraintExists('brand_foundation', 'brand_foundation_tenant_unique')));

  // Custom playbook with NULL tenant_id (and inverse) must be reported, never auto-assigned.
  await ensureVerticalPlaybooksSchema();
  await p.query(`ALTER TABLE vertical_playbooks DROP CONSTRAINT IF EXISTS ${PLAYBOOKS_XOR_CHECK}`);
  const custom = await p.query(`
    INSERT INTO vertical_playbooks (vertical, title, is_system, tenant_id)
    VALUES ('preflight_custom_unmapped', 'x', FALSE, NULL)
    RETURNING id
  `);
  const customId = custom.rows[0].id;
  const pbReport = await preflightTenantSchemaCloseout({ tables: ['vertical_playbooks'] });
  assert.strictEqual(pbReport.ok, false);
  const customHit = pbReport.tables.find((x) => x.reason === 'playbook_custom_unmapped');
  assert.ok(customHit, `custom unmapped playbook must be listed: ${JSON.stringify(pbReport)}`);
  assert.ok((customHit.ids || []).some((x) => Number(x.id) === Number(customId)));
  const blob = JSON.stringify(pbReport);
  assert.doesNotMatch(blob, /purpose_why|alert_email|"content"|description/);

  const afterPb = await p.query(`SELECT tenant_id FROM vertical_playbooks WHERE id=$1`, [customId]);
  assert.strictEqual(afterPb.rows[0].tenant_id, null, 'must not auto-assign playbook tenant_id');

  const spawned = spawnSync(process.execPath, [PREFLIGHT_SCRIPT], {
    env: process.env,
    encoding: 'utf8',
  });
  assert.notStrictEqual(spawned.status, 0, 'script must exit non-zero when mapping is required');
  assert.notStrictEqual(spawned.status, 2);
});

test('parent-mappable child is not reported; enforce then SET NOT NULL together', { skip }, async (t) => {
  await guardMutatingTest(t);
  const p = db.getPool();
  await ensureTenantSchema();
  const tenantA = await seedTenant('map');

  await p.query(`DROP TABLE IF EXISTS preflight_child_probe CASCADE`);
  await p.query(`DROP TABLE IF EXISTS preflight_parent_probe CASCADE`);
  await p.query(`
    CREATE TABLE preflight_parent_probe (
      id SERIAL PRIMARY KEY,
      tenant_id INT REFERENCES tenants(id)
    )
  `);
  await p.query(`
    CREATE TABLE preflight_child_probe (
      id SERIAL PRIMARY KEY,
      parent_id INT REFERENCES preflight_parent_probe(id),
      tenant_id INT
    )
  `);
  const parent = await p.query(
    `INSERT INTO preflight_parent_probe (tenant_id) VALUES ($1) RETURNING id`, [tenantA]);
  await p.query(
    `INSERT INTO preflight_child_probe (parent_id, tenant_id) VALUES ($1, NULL)`,
    [parent.rows[0].id]);

  const u = await preflightUnmappedForTable('preflight_child_probe', {
    backfillFrom: {
      parentTable: 'preflight_parent_probe',
      parentIdColumn: 'id',
      childFkColumn: 'parent_id',
    },
  });
  assert.strictEqual(u.count, 0, `parent-mappable row must not be reported: ${JSON.stringify(u)}`);

  const r = await enforceTenantIdNotNull('preflight_child_probe', {
    backfillFrom: {
      parentTable: 'preflight_parent_probe',
      parentIdColumn: 'id',
      childFkColumn: 'parent_id',
    },
  });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.backfilled, 1);
  const col = await colNullable('preflight_child_probe', 'tenant_id');
  assert.strictEqual(col.is_nullable, 'NO');
  const row = await p.query(`SELECT tenant_id FROM preflight_child_probe`);
  assert.strictEqual(row.rows[0].tenant_id, tenantA);
});

test('job_queue empty-payload CHECK: {} succeeds, non-empty fails; violators skip ADD CONSTRAINT', { skip }, async (t) => {
  await guardMutatingTest(t);
  const p = db.getPool();
  await ensureJobsSchema();

  await p.query(`ALTER TABLE job_queue DROP CONSTRAINT IF EXISTS ${JOB_QUEUE_EMPTY_PAYLOAD_CHECK}`);
  const violator = await p.query(`
    INSERT INTO job_queue (name, payload, status)
    VALUES ('preflight-payload-violator', '{"tenant_id":1}'::jsonb, 'pending')
    RETURNING id
  `);
  const vid = violator.rows[0].id;

  const skipped = await ensureJobQueueEmptyPayloadCheck();
  assert.strictEqual(skipped.ok, false);
  assert.strictEqual(skipped.reason, 'preflight');
  assert.ok(!(await constraintExists('job_queue', JOB_QUEUE_EMPTY_PAYLOAD_CHECK)),
    'CHECK must not be added while violators exist');

  const report = await preflightTenantSchemaCloseout({ tables: ['job_queue'] });
  assert.strictEqual(report.ok, false);
  const hit = report.tables.find((x) => x.table === 'job_queue' && x.reason === 'job_queue_payload');
  assert.ok(hit, JSON.stringify(report));
  assert.ok((hit.ids || []).some((x) => Number(x.id) === Number(vid)));
  assert.ok((hit.ids || []).every((x) => x.name && x.status != null));

  const still = await p.query(`SELECT payload FROM job_queue WHERE id=$1`, [vid]);
  assert.deepStrictEqual(still.rows[0].payload, { tenant_id: 1 }, 'must not strip payload');

  await p.query(`DELETE FROM job_queue WHERE id=$1`, [vid]);
  const added = await ensureJobQueueEmptyPayloadCheck();
  assert.ok(added.ok, JSON.stringify(added));
  assert.ok(await constraintExists('job_queue', JOB_QUEUE_EMPTY_PAYLOAD_CHECK));

  const ok = await p.query(`
    INSERT INTO job_queue (name, payload) VALUES ('preflight-empty', '{}'::jsonb) RETURNING id
  `);
  await p.query(`DELETE FROM job_queue WHERE id=$1`, [ok.rows[0].id]);

  let blocked = false;
  try {
    await p.query(`
      INSERT INTO job_queue (name, payload) VALUES ('preflight-bad', '{"tenant_id":1}'::jsonb)
    `);
  } catch (e) {
    blocked = /job_queue_global_empty_payload|check constraint/i.test(e.message);
  }
  assert.ok(blocked, 'non-empty payload must fail once CHECK is in place');
});

test('playbook xor CHECK: catalog true+NULL and custom false+tid succeed; invalid shapes fail', { skip }, async (t) => {
  await guardMutatingTest(t);
  const p = db.getPool();
  await ensureAuthSchema();
  await ensureTenantSchema();
  await ensureVerticalPlaybooksSchema();

  await p.query(`ALTER TABLE vertical_playbooks DROP CONSTRAINT IF EXISTS ${PLAYBOOKS_XOR_CHECK}`);
  const tid = await seedTenant('playbook');
  const inverse = await p.query(`
    INSERT INTO vertical_playbooks (vertical, title, is_system, tenant_id)
    VALUES ('preflight_system_with_tenant', 'x', TRUE, $1)
    RETURNING id
  `, [tid]);

  const skipped = await ensureVerticalPlaybooksXorCheck();
  assert.strictEqual(skipped.ok, false);
  assert.strictEqual(skipped.reason, 'preflight');
  assert.ok(!(await constraintExists('vertical_playbooks', PLAYBOOKS_XOR_CHECK)));

  const report = await preflightTenantSchemaCloseout({ tables: ['vertical_playbooks'] });
  assert.strictEqual(report.ok, false);
  const hit = report.tables.find((x) => x.reason === 'playbook_system_with_tenant');
  assert.ok(hit, JSON.stringify(report));
  assert.ok((hit.ids || []).some((x) => Number(x.id) === Number(inverse.rows[0].id)));
  assert.ok((hit.ids || []).every((x) => Object.prototype.hasOwnProperty.call(x, 'is_system')));
  assert.ok((hit.ids || []).every((x) => Object.prototype.hasOwnProperty.call(x, 'vertical')));

  const unchanged = await p.query(
    `SELECT tenant_id, is_system FROM vertical_playbooks WHERE id=$1`, [inverse.rows[0].id]);
  assert.strictEqual(unchanged.rows[0].tenant_id, tid);
  assert.strictEqual(unchanged.rows[0].is_system, true);

  await p.query(`DELETE FROM vertical_playbooks WHERE id=$1`, [inverse.rows[0].id]);
  const added = await ensureVerticalPlaybooksXorCheck();
  assert.ok(added.ok, JSON.stringify(added));
  assert.ok(await constraintExists('vertical_playbooks', PLAYBOOKS_XOR_CHECK));

  const catalog = await p.query(`
    INSERT INTO vertical_playbooks (vertical, title, is_system, tenant_id)
    VALUES ('preflight_catalog_ok', 'x', TRUE, NULL) RETURNING id
  `);
  const custom = await p.query(`
    INSERT INTO vertical_playbooks (vertical, title, is_system, tenant_id)
    VALUES ('preflight_custom_ok', 'x', FALSE, $1) RETURNING id
  `, [tid]);

  let sysWithTid = false;
  try {
    await p.query(`
      INSERT INTO vertical_playbooks (vertical, title, is_system, tenant_id)
      VALUES ('preflight_sys_tid', 'x', TRUE, $1)
    `, [tid]);
  } catch (e) {
    sysWithTid = /vertical_playbooks_system_xor_tenant|check constraint/i.test(e.message);
  }
  assert.ok(sysWithTid, 'is_system=true AND tenant_id=5 must fail');

  let customNull = false;
  try {
    await p.query(`
      INSERT INTO vertical_playbooks (vertical, title, is_system, tenant_id)
      VALUES ('preflight_custom_null', 'x', FALSE, NULL)
    `);
  } catch (e) {
    customNull = /vertical_playbooks_system_xor_tenant|check constraint/i.test(e.message);
  }
  assert.ok(customNull, 'is_system=false AND tenant_id NULL must fail');

  await p.query(`DELETE FROM vertical_playbooks WHERE id IN ($1,$2)`, [catalog.rows[0].id, custom.rows[0].id]);
});
