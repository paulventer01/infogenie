// test/tenant-schema-audit.test.js — Task #60 schema-level isolation guard
//
// Phase 2 (per-workspace split) added a `tenant_id` column to 100+ business
// tables. The class of bug this guards against: a NEW tenant-scoped table that
// ships without its `tenant_id` column, without the NOT NULL flip, or with a
// legacy single-column UNIQUE / PRIMARY KEY that was never rewritten to include
// tenant_id (so a second workspace's INSERT … ON CONFLICT silently overwrites
// the first's row — a cross-tenant data leak / clobber).
//
// Task #45 (push-optimizer-tenant-isolation) only covered two specific tables.
// This test audits the WHOLE schema against the live Postgres so any future
// table that forgets its scoping fails loudly here instead of leaking in prod.
//
// It introspects the real database (information_schema / table_constraints). If
// DATABASE_URL is not set the audit is skipped — there is no schema to inspect.
// The phase-2 migration is idempotent and runs on boot, so by the time the
// `test` workflow runs (after `Start application`) every table exists.

const { test } = require('node:test');
const assert = require('node:assert');

const db = require('../db');
const { PLAIN_TABLES, REWRITE_UNIQUE } = require('../services/tenants/phase2_migrate');

// ── Tables intentionally GLOBAL (no tenant_id by design) ─────────────────────
// Mirrors the exclusions documented in services/tenants/phase2_migrate.js. A
// new table that lands without a tenant_id column must be either scoped or
// consciously added here — that decision should never be silent.
const KNOWN_GLOBAL = new Set([
  'kv_store',          // key-prefixed per tenant, not a column
  'tenants',           // the tenant registry itself
  'platform_users',    // cross-tenant platform admins/owners
  'users',             // cross-tenant auth identity
  'user_identities',   // OAuth identities (per user, not per tenant)
  'user_sessions',     // cross-tenant session store
  'user_integrations', // per-user credential vault
  'platform_api_keys', // platform-owned API keys, shared across all tenants
  'platform_key_tests', // last live-test verdict per platform key, platform-wide
  // Platform / network catalogs — not workspace data. See phase2_migrate.js
  // exclusion comments. Do NOT add a table here just to silence the audit.
  'benchmark_aggregates', // anonymised cross-customer percentiles; UNIQUE(vertical, region, company_size, metric_key); submissions stay tenant-scoped
  'job_schedules',        // platform cron registry; PK on name; process-level
  'job_queue',            // platform worker queue; claimed globally; not tenant business data
  'simulation_templates', // seeded 24-template catalog; UNIQUE(label); shared library
]);

// ── Tables whose tenant_id is intentionally NULLABLE ─────────────────────────
// Mirrors PHASE2E_NULLABLE_OK in phase2_migrate.js: system rows are global
// (tenant_id IS NULL) while per-tenant rows are scoped.
//   • roles              — global system roles vs per-tenant custom roles
//   • email_tokens       — only invite tokens are workspace-bound; password-reset /
//                          email-verify tokens have no tenant
//   • vertical_playbooks — MIXED (roles pattern): system catalog (tenant_id IS NULL)
//                          vs custom tenant-owned playbooks
const NULLABLE_OK = new Set([
  'roles',               // global system roles vs per-tenant custom roles
  'email_tokens',        // invite tokens are workspace-bound; reset/verify are not
  'vertical_playbooks',  // MIXED (roles pattern): is_system=TRUE catalog stays tenant_id IS NULL;
                         // custom is_system=FALSE playbooks are tenant-owned
]);

// Pull the live schema once and share it across the audit assertions.
async function loadSchema() {
  const p = db.getPool();
  const baseTables = (await p.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE'`
  )).rows.map(r => r.table_name);

  const tidCols = (await p.query(
    `SELECT table_name, is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND column_name='tenant_id'`
  )).rows;
  const tidNullable = new Map(tidCols.map(r => [r.table_name, r.is_nullable === 'YES']));

  // Every UNIQUE / PRIMARY KEY constraint with its ordered column list.
  const cons = (await p.query(
    `SELECT tc.table_name, tc.constraint_name, tc.constraint_type,
            string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS cols
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema   = kcu.table_schema
      WHERE tc.table_schema='public'
        AND tc.constraint_type IN ('UNIQUE','PRIMARY KEY')
      GROUP BY tc.table_name, tc.constraint_name, tc.constraint_type`
  )).rows;
  const constraintsByTable = new Map();
  for (const r of cons) {
    if (!constraintsByTable.has(r.table_name)) constraintsByTable.set(r.table_name, []);
    constraintsByTable.get(r.table_name).push({
      name: r.constraint_name,
      type: r.constraint_type,
      cols: r.cols ? r.cols.split(',') : [],
    });
  }

  return { baseTables, tidNullable, constraintsByTable };
}

const HAS_DB = db.hasDb();

// ── 1. Coverage: no business table forgets its tenant_id column ──────────────
test('every business table has a tenant_id column (or is an explicit global)', { skip: HAS_DB ? false : 'no DATABASE_URL — schema audit skipped' }, async () => {
  const { baseTables, tidNullable } = await loadSchema();
  const offenders = baseTables.filter(t => !KNOWN_GLOBAL.has(t) && !tidNullable.has(t));
  assert.deepStrictEqual(
    offenders.sort(), [],
    `These tables have no tenant_id column. Add tenant scoping (resolveTenantId + ` +
    `tenant_id INT NOT NULL + WHERE tenant_id=$1), or, if genuinely global, add them ` +
    `to KNOWN_GLOBAL in this test AND to the exclusion list in phase2_migrate.js:\n  ` +
    offenders.join(', ')
  );
});

// ── 2. NOT NULL: every tenant_id column is enforced ─────────────────────────
test('every tenant_id column is NOT NULL (except the documented nullable ones)', { skip: HAS_DB ? false : 'no DATABASE_URL — schema audit skipped' }, async () => {
  const { tidNullable } = await loadSchema();
  const offenders = [...tidNullable.entries()]
    .filter(([t, nullable]) => nullable && !NULLABLE_OK.has(t))
    .map(([t]) => t);
  assert.deepStrictEqual(
    offenders.sort(), [],
    `These tables have a NULLABLE tenant_id — a null-tenant row bypasses enforcement. ` +
    `Backfill + flip NOT NULL (addTenantIdColumn(..., { notNull:true })), or add to ` +
    `NULLABLE_OK if the table legitimately holds global rows:\n  ` + offenders.join(', ')
  );
});

// ── 3. Source-list contract: phase2 migration lists match the live schema ───
test('every table named in the phase-2 migration lists exists and is scoped', { skip: HAS_DB ? false : 'no DATABASE_URL — schema audit skipped' }, async () => {
  const { baseTables, tidNullable } = await loadSchema();
  const baseSet = new Set(baseTables);
  const listed = [...PLAIN_TABLES, ...REWRITE_UNIQUE.map(r => r.table)];

  const missing = listed.filter(t => !baseSet.has(t));
  assert.deepStrictEqual(missing.sort(), [],
    `Listed in phase2_migrate.js but absent from the database (renamed/typo'd table ` +
    `name in the migration list?):\n  ` + missing.join(', '));

  const unscoped = listed.filter(t => baseSet.has(t) && !tidNullable.has(t));
  assert.deepStrictEqual(unscoped.sort(), [],
    `Listed for migration but the tenant_id column was never added:\n  ` + unscoped.join(', '));
});

// ── 4. UNIQUE / PK rewrite: legacy single-column keys are gone, composite is in ─
// For every REWRITE_UNIQUE spec the legacy single-column natural-key UNIQUE/PK
// must have been replaced by a composite that LEADS with tenant_id. This is the
// exact bug class from Task #45 generalised to every rewritten table.
test('every REWRITE_UNIQUE table has a composite (tenant_id, …) key and no legacy single-column natural key', { skip: HAS_DB ? false : 'no DATABASE_URL — schema audit skipped' }, async () => {
  const { constraintsByTable } = await loadSchema();
  const failures = [];

  for (const { table, uniqueExtras } of REWRITE_UNIQUE) {
    const cons = constraintsByTable.get(table) || [];
    const want = ['tenant_id', ...uniqueExtras].join(',');

    // (a) the composite per-tenant UNIQUE must exist.
    const hasComposite = cons.some(c => c.type === 'UNIQUE' && c.cols.join(',') === want);
    if (!hasComposite) {
      failures.push(`${table}: missing UNIQUE (${want}) — found: ` +
        (cons.map(c => `${c.type}(${c.cols.join(',')})`).join(' | ') || 'none'));
    }

    // (b) NO surviving UNIQUE/PK on the bare natural-key columns (no tenant_id).
    // That is the leak: a key unique across the whole install lets one tenant's
    // INSERT … ON CONFLICT clobber another's row.
    const legacy = cons.filter(c =>
      !c.cols.includes('tenant_id') &&
      c.cols.length > 0 &&
      c.cols.every(col => uniqueExtras.includes(col))
    );
    if (legacy.length) {
      failures.push(`${table}: legacy constraint(s) without tenant_id still present: ` +
        legacy.map(c => `${c.type}(${c.cols.join(',')})`).join(', '));
    }
  }

  assert.deepStrictEqual(failures, [],
    `Composite-key rewrite regressions (a second workspace can clobber the first's ` +
    `row via ON CONFLICT):\n  ` + failures.join('\n  '));
});
