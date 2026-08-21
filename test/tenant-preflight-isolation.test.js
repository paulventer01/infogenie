// test/tenant-preflight-isolation.test.js — Security review of the tenant-schema
// closeout preflight and the two global-table CHECK constraints.
//
// Deployment-safety properties pinned here:
//
//   • the preflight completes with a SELECT-only role — it cannot write even if
//     a future edit tried to, which is stronger than spying on the SQL it emits
//   • the operator report carries identifiers only; no job payload body, no
//     playbook content/description, no brand_foundation prose, no contact data
//   • services/jobs/queue.enqueue cannot put tenant JSON in the global queue,
//     and the worker claim/complete/fail cycle still runs with the CHECK on
//   • a NULL tenant_id landing after the preflight passes still rolls back with
//     zero DDL — the last guard against a concurrent write during closeout
//   • an unsafe table identifier is refused, not interpolated
//
// This file provisions its own scratch database. Do not point it at the shared
// DATABASE_URL: test/tenant-schema-closeout.test.js and
// test/tenant-schema-preflight.test.js drop and recreate brand_foundation there,
// and node --test runs files in parallel processes against one database.

'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');

const ADMIN_URL = process.env.DATABASE_URL || '';
const SCRATCH_DB = `infogenie_sec_preflight_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
const RO_ROLE = `ig_sec_ro_${process.pid}`;
const RO_PASSWORD = crypto.randomBytes(9).toString('hex');

function swapDatabase(url, name) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

const SCRATCH_URL = ADMIN_URL ? swapDatabase(ADMIN_URL, SCRATCH_DB) : '';
const RO_URL = ADMIN_URL
  ? (() => {
    const u = new URL(swapDatabase(ADMIN_URL, SCRATCH_DB));
    u.username = RO_ROLE;
    u.password = RO_PASSWORD;
    return u.toString();
  })()
  : '';

// Must be set before anything calls db.getPool(); db.js reads it lazily.
if (SCRATCH_URL) process.env.DATABASE_URL = SCRATCH_URL;

const db = require('../db');
const { ensureAuthSchema } = require('../services/auth/schema');
const { ensureTenantSchema } = require('../services/tenants/schema');
const { ensureBrandFoundationSchema } = require('../services/brand_foundation/schema');
const { ensureJobsSchema } = require('../services/jobs/schema');
const { ensureVerticalPlaybooksSchema } = require('../services/vertical_playbooks/schema');
const {
  JOB_QUEUE_EMPTY_PAYLOAD_CHECK,
  PLAYBOOKS_XOR_CHECK,
  preflightTenantSchemaCloseout,
  preflightUnmappedForTable,
} = require('../services/tenants/preflight');
const { enforceTenantIdNotNull } = require('../services/tenants/migration');
const queue = require('../services/jobs/queue');

const PREFLIGHT_SCRIPT = path.join(__dirname, '../scripts/tenant-schema-preflight.js');

let skip = ADMIN_URL ? false : 'no DATABASE_URL — preflight isolation skipped';
let roSkip = 'read-only role not provisioned';
let TENANT_ID = null;

async function admin(sql) {
  const c = new Client({
    connectionString: swapDatabase(ADMIN_URL, 'postgres'),
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  try { return await c.query(sql); } finally { await c.end(); }
}

before(async () => {
  if (skip) return;
  try {
    await admin(`CREATE DATABASE ${SCRATCH_DB}`);
  } catch (e) {
    skip = `cannot create scratch database (${e.message}) — preflight isolation skipped`;
    return;
  }

  await ensureAuthSchema();
  await ensureTenantSchema();
  await ensureBrandFoundationSchema();
  await ensureJobsSchema();
  await ensureVerticalPlaybooksSchema();

  const p = db.getPool();
  TENANT_ID = (await p.query(
    `INSERT INTO tenants (name, slug, status) VALUES ('Sec Preflight','sec-preflight','active') RETURNING id`
  )).rows[0].id;

  try {
    await admin(`CREATE ROLE ${RO_ROLE} LOGIN PASSWORD '${RO_PASSWORD}'`);
    await p.query(`GRANT CONNECT ON DATABASE ${SCRATCH_DB} TO ${RO_ROLE}`);
    await p.query(`GRANT USAGE ON SCHEMA public TO ${RO_ROLE}`);
    await p.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${RO_ROLE}`);
    roSkip = false;
  } catch (e) {
    roSkip = `cannot create a SELECT-only role (${e.message}) — read-only proof skipped`;
  }
});

after(async () => {
  if (!ADMIN_URL) return;
  try { const p = db.getPool(); if (p) await p.end(); } catch { /* ignore */ }
  try { await admin(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`); } catch { /* ignore */ }
  try { await admin(`DROP ROLE IF EXISTS ${RO_ROLE}`); } catch { /* ignore */ }
});

test('preflight completes with a SELECT-only role — it needs no write privilege', async (t) => {
  if (skip) return t.skip(skip);
  if (roSkip) return t.skip(roSkip);

  const p = db.getPool();
  await p.query(`ALTER TABLE job_queue DROP CONSTRAINT IF EXISTS ${JOB_QUEUE_EMPTY_PAYLOAD_CHECK}`);
  await p.query(
    `INSERT INTO job_queue (name, payload) VALUES ('sec-ro-probe', '{"tenant_id":1}'::jsonb)`);
  await p.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${RO_ROLE}`);

  const r = spawnSync(process.execPath, [PREFLIGHT_SCRIPT], {
    env: { ...process.env, DATABASE_URL: RO_URL },
    encoding: 'utf8',
  });
  const out = `${r.stdout}\n${r.stderr}`;
  assert.strictEqual(r.status, 1, `expected exit 1 on a dirty database, got ${r.status}\n${out}`);
  assert.doesNotMatch(out, /permission denied|read-only transaction|must be owner/i,
    `preflight required a privilege it should not need:\n${out}`);
  assert.match(out, /job_queue_payload/);

  const still = await p.query(
    `SELECT count(*)::int AS n FROM job_queue WHERE payload IS DISTINCT FROM '{}'::jsonb`);
  assert.strictEqual(still.rows[0].n, 1, 'preflight must not strip the violating payload');

  await p.query(`DELETE FROM job_queue WHERE name='sec-ro-probe'`);
  const clean = spawnSync(process.execPath, [PREFLIGHT_SCRIPT], {
    env: { ...process.env, DATABASE_URL: RO_URL },
    encoding: 'utf8',
  });
  assert.strictEqual(clean.status, 0,
    `expected exit 0 once clean, got ${clean.status}\n${clean.stdout}\n${clean.stderr}`);
});

test('operator report carries identifiers only — no payload body, playbook content, or contact data', async (t) => {
  if (skip) return t.skip(skip);
  const p = db.getPool();

  await p.query(`ALTER TABLE job_queue DROP CONSTRAINT IF EXISTS ${JOB_QUEUE_EMPTY_PAYLOAD_CHECK}`);
  await p.query(`ALTER TABLE vertical_playbooks DROP CONSTRAINT IF EXISTS ${PLAYBOOKS_XOR_CHECK}`);

  await p.query(
    `INSERT INTO job_queue (name, payload) VALUES ('sec-leaky-job', $1::jsonb)`,
    [JSON.stringify({ tenant_id: TENANT_ID, owner_email: 'victim@example.test', token: 'sk-live-DONOTLEAK' })]);
  await p.query(`
    INSERT INTO vertical_playbooks (vertical, title, description, content, is_system, tenant_id)
    VALUES ('sec_legacy_custom', 'Acme Q3 growth plan',
            'reach ceo@acme.example about the spend increase',
            $1::jsonb, FALSE, NULL)`,
    [JSON.stringify({ business_description: 'confidential Acme expansion strategy' })]);

  await p.query(`DROP TABLE IF EXISTS brand_foundation CASCADE`);
  await p.query(`
    CREATE TABLE brand_foundation (
      id INTEGER PRIMARY KEY DEFAULT 1,
      tenant_id INT,
      purpose_why TEXT DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT brand_foundation_singleton CHECK (id = 1)
    )`);
  await p.query(
    `INSERT INTO brand_foundation (id, tenant_id, purpose_why) VALUES (1, NULL, $1)`,
    ['we exist to help founder@acme.example scale']);

  const report = await preflightTenantSchemaCloseout();
  assert.strictEqual(report.ok, false, 'dirty database must report ACTION REQUIRED');

  const reasons = new Set(report.tables.map((x) => x.reason));
  assert.ok(reasons.has('unmapped_tenant_id'), `brand_foundation NULL must be listed: ${JSON.stringify(report)}`);
  assert.ok(reasons.has('playbook_custom_unmapped'), `legacy custom playbook must be listed: ${JSON.stringify(report)}`);
  assert.ok(reasons.has('job_queue_payload'), `job_queue payload must be listed: ${JSON.stringify(report)}`);

  const blob = JSON.stringify(report);
  for (const secret of [
    'victim@example.test', 'ceo@acme.example', 'founder@acme.example',
    'sk-live-DONOTLEAK', 'confidential Acme expansion strategy',
    'Acme Q3 growth plan', 'reach ceo@acme.example',
    'we exist to help',
  ]) {
    assert.ok(!blob.includes(secret), `report leaked ${JSON.stringify(secret)}:\n${blob}`);
  }
  assert.doesNotMatch(blob, /[\w.+-]+@[\w-]+\.[\w.]+/, `report contains an email address:\n${blob}`);

  // Rows are reported, never repaired: no stripping, no auto-assignment.
  const job = await p.query(`SELECT payload FROM job_queue WHERE name='sec-leaky-job'`);
  assert.strictEqual(job.rows[0].payload.token, 'sk-live-DONOTLEAK', 'payload must not be stripped');
  const pb = await p.query(`SELECT tenant_id FROM vertical_playbooks WHERE vertical='sec_legacy_custom'`);
  assert.strictEqual(pb.rows[0].tenant_id, null, 'custom playbook must not be auto-assigned a tenant');
  const bf = await p.query(`SELECT tenant_id FROM brand_foundation WHERE id=1`);
  assert.strictEqual(bf.rows[0].tenant_id, null, 'brand_foundation must not be mapped to tenant 1');

  await p.query(`DELETE FROM job_queue WHERE name='sec-leaky-job'`);
  await p.query(`DELETE FROM vertical_playbooks WHERE vertical='sec_legacy_custom'`);
  await p.query(`DROP TABLE IF EXISTS brand_foundation CASCADE`);
  await ensureBrandFoundationSchema();
});

test('jobs queue: platform enqueue works, tenant JSON is refused by the global CHECK', async (t) => {
  if (skip) return t.skip(skip);
  const p = db.getPool();
  await p.query(`DELETE FROM job_queue`);
  await ensureJobsSchema();

  const id = await queue.enqueue('sec-platform-job');
  assert.ok(id, 'platform enqueue must still succeed');

  let rejected = null;
  try {
    await queue.enqueue('sec-tenant-job', { tenant_id: TENANT_ID, note: 'workspace data' });
  } catch (e) {
    rejected = e;
  }
  assert.ok(rejected, 'enqueue must not silently accept a tenant payload');
  assert.strictEqual(rejected.code, '23514');
  assert.strictEqual(rejected.constraint, JOB_QUEUE_EMPTY_PAYLOAD_CHECK);

  const stored = await p.query(
    `SELECT count(*)::int AS n FROM job_queue WHERE payload IS DISTINCT FROM '{}'::jsonb`);
  assert.strictEqual(stored.rows[0].n, 0, 'no tenant JSON may reach the global queue');

  // The CHECK is re-evaluated on every UPDATE — the worker cycle must survive it.
  const claimed = await queue.claimJobs(5);
  assert.ok(claimed.some((row) => String(row.id) === String(id)), 'worker must still claim the job');
  await queue.completeJob(id);
  await queue.failJob(id, new Error('sec probe'), { attempts: 1, maxAttempts: 3 });
  const after = await queue.queueStats();
  assert.strictEqual(after.configured, true);

  await p.query(`DELETE FROM job_queue`);
});

test('closeout rolls back with zero DDL when a NULL tenant_id lands after the preflight', async (t) => {
  if (skip) return t.skip(skip);
  const p = db.getPool();

  await p.query(`DROP TABLE IF EXISTS sec_race_child CASCADE`);
  await p.query(`DROP TABLE IF EXISTS sec_race_parent CASCADE`);
  await p.query(`CREATE TABLE sec_race_parent (id SERIAL PRIMARY KEY, tenant_id INT REFERENCES tenants(id))`);
  await p.query(`CREATE TABLE sec_race_child (id SERIAL PRIMARY KEY, parent_id INT, tenant_id INT)`);
  const parent = (await p.query(
    `INSERT INTO sec_race_parent (tenant_id) VALUES ($1) RETURNING id`, [TENANT_ID])).rows[0].id;
  await p.query(`INSERT INTO sec_race_child (parent_id, tenant_id) VALUES ($1, NULL)`, [parent]);

  // Every row is parent-mappable, so the preflight passes. The trigger models a
  // concurrent write arriving inside the migration transaction, after that pass.
  await p.query(`
    CREATE OR REPLACE FUNCTION sec_race_intruder() RETURNS trigger AS $$
    BEGIN
      INSERT INTO sec_race_child (parent_id, tenant_id) VALUES (NULL, NULL);
      RETURN NULL;
    END; $$ LANGUAGE plpgsql`);
  await p.query(`
    CREATE TRIGGER sec_race_intruder_trg AFTER UPDATE ON sec_race_child
    FOR EACH STATEMENT EXECUTE FUNCTION sec_race_intruder()`);

  const pre = await preflightUnmappedForTable('sec_race_child', {
    backfillFrom: { parentTable: 'sec_race_parent', parentIdColumn: 'id', childFkColumn: 'parent_id' },
  });
  assert.strictEqual(pre.count, 0, 'parent-mappable row must not be reported');

  const r = await enforceTenantIdNotNull('sec_race_child', {
    backfillFrom: { parentTable: 'sec_race_parent', parentIdColumn: 'id', childFkColumn: 'parent_id' },
    indexExtra: ['parent_id'],
    uniqueWithExtra: ['parent_id'],
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'orphans', `expected the in-transaction guard: ${JSON.stringify(r)}`);
  for (const flag of ['added', 'indexed', 'droppedCheck', 'uniqueAdded', 'notNullSet', 'fkAdded']) {
    assert.strictEqual(r[flag], false, `${flag} must be false after rollback: ${JSON.stringify(r)}`);
  }
  assert.strictEqual(r.backfilled, 0, 'the parent UPDATE must not be reported as applied');

  const idx = await p.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='sec_race_child'`);
  assert.deepStrictEqual(idx.rows.map((x) => x.indexname), ['sec_race_child_pkey'],
    'no index may survive the rollback');
  const nullable = await p.query(
    `SELECT is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name='sec_race_child' AND column_name='tenant_id'`);
  assert.strictEqual(nullable.rows[0].is_nullable, 'YES');
  const rows = await p.query(`SELECT id, tenant_id FROM sec_race_child ORDER BY id`);
  assert.strictEqual(rows.rowCount, 1, 'the intruder row must be rolled back, not deleted separately');
  assert.strictEqual(rows.rows[0].tenant_id, null, 'the parent backfill must roll back with the DDL');

  await p.query(`DROP TABLE IF EXISTS sec_race_child CASCADE`);
  await p.query(`DROP TABLE IF EXISTS sec_race_parent CASCADE`);
  await p.query(`DROP FUNCTION IF EXISTS sec_race_intruder()`);
});

test('preflight refuses an unsafe table identifier instead of interpolating it', async (t) => {
  if (skip) return t.skip(skip);
  const p = db.getPool();
  const injection = 'job_queue"; DROP TABLE tenants; --';

  await assert.rejects(
    () => preflightUnmappedForTable(injection),
    /unsafe SQL identifier/,
    'an unsafe identifier must be rejected before it reaches SQL');

  await assert.rejects(
    () => preflightUnmappedForTable('job_queue', {
      backfillFrom: { parentTable: injection, parentIdColumn: 'id', childFkColumn: 'name' },
    }),
    /unsafe SQL identifier/,
    'a parent table name is interpolated too and must be validated');

  const survived = await p.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='tenants'`);
  assert.strictEqual(survived.rowCount, 1, 'tenants must still exist');
});
