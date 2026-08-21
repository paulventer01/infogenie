// test/tenant-schema-closeout.test.js — fail-closed tenant_id closeout
//
// Covers the canonical production path (old-shape tables → ensure*Schema() →
// runPhase2Migration()) plus helper invariants: parent backfill, orphan
// fail-closed, backlink IMMUTABLE repair, and composite UNIQUE(tenant_id, domain).
// Skip the whole file when DATABASE_URL is unset. Do not weaken tenant-schema-audit.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../db');
const { enforceTenantIdNotNull } = require('../services/tenants/migration');
const { runPhase2Migration } = require('../services/tenants/phase2_migrate');
const { ensureTenantSchema } = require('../services/tenants/schema');
const { ensureAuthSchema } = require('../services/auth/schema');
const { ensureAiTracesSchema } = require('../services/ai_traces/schema');
const { ensureAiProvidersSchema } = require('../services/ai_providers/schema');
const { ensureAiVisibilitySchema } = require('../services/ai_visibility/schema');
const { ensureAnomalyDetectorSchema } = require('../services/anomaly_detector/schema');
const { ensureAveSchema } = require('../services/ave/schema');
const { ensureBrandCalendarSchema } = require('../services/brand_calendar/schema');
const { ensureBrandFoundationSchema } = require('../services/brand_foundation/schema');
const { ensureBudgetSchema } = require('../services/budget_board/schema');
const { ensureGeoAuditSchema } = require('../services/geo_audit/schema');
const { ensureGeoInsightsSchema } = require('../services/geo_insights/schema');
const { ensureHashtagTrackerSchema } = require('../services/hashtag_tracker/schema');
const { ensureInfluenceScoreSchema } = require('../services/influence_score/schema');
const { ensureIntentRadarSchema } = require('../services/intent_radar/schema');
const { ensurePresenceScoreSchema } = require('../services/presence_score/schema');
const { ensureProjectCompareSchema } = require('../services/project_compare/schema');
const { ensureReputationScoreSchema } = require('../services/reputation_score/schema');
const { ensureSeoTasksSchema } = require('../services/seo_tasks/schema');
const { ensureSignalTriggersSchema } = require('../services/signal_triggers/schema');
const { ensureUgcDiscoverySchema } = require('../services/ugc_discovery/schema');
const { ensureWeeklyReportSchema } = require('../services/weekly_report/schema');
const { ensureYoutubeMonitorSchema } = require('../services/youtube_monitor/schema');
const { ensureLaunchComplianceSchema } = require('../services/launch_compliance/schema');
const { ensurePostLaunchAuditSchema } = require('../services/post_launch_audit/schema');
const { ensureVerticalPlaybooksSchema } = require('../services/vertical_playbooks/schema');
const { ensureBenchmarksSchema } = require('../services/benchmarks/schema');
const { ensureJobsSchema } = require('../services/jobs/schema');
const { ensureDigitalTwinSchema } = require('../services/digital_twin/schema');
const { ensureBacklinkMonitorSchema } = require('../services/backlink_monitor/schema');

const HAS_DB = db.hasDb();
const skip = HAS_DB ? false : 'no DATABASE_URL — closeout tests skipped';

const CLOSEOUT_TABLES = [
  'ai_call_traces', 'ai_providers', 'ai_visibility_runs', 'anomaly_detections',
  'ave_reports', 'brand_calendar_items', 'brand_foundation', 'budgets',
  'geo_citation_checks', 'geo_insight_runs', 'hashtag_scans', 'hashtag_watches',
  'influence_scores', 'intent_radar_runs', 'presence_scores', 'project_comparisons',
  'reputation_scores', 'seo_tasks', 'signal_events', 'signal_triggers',
  'spend_events', 'ugc_items', 'weekly_report_runs', 'weekly_report_subs',
  'yt_channels', 'yt_snapshots',
  'compliance_checklist_items', 'post_launch_checks',
  'backlink_monitors', 'backlink_snapshots', 'backlink_changes',
];

async function applyCanonicalCloseout() {
  await ensureAuthSchema();
  await ensureTenantSchema();
  await ensureAiTracesSchema();
  await ensureAiProvidersSchema();
  await ensureAiVisibilitySchema();
  await ensureAnomalyDetectorSchema();
  await ensureAveSchema();
  await ensureBrandCalendarSchema();
  await ensureBrandFoundationSchema();
  await ensureBudgetSchema();
  await ensureGeoAuditSchema();
  await ensureGeoInsightsSchema();
  await ensureHashtagTrackerSchema();
  await ensureInfluenceScoreSchema();
  await ensureIntentRadarSchema();
  await ensurePresenceScoreSchema();
  await ensureProjectCompareSchema();
  await ensureReputationScoreSchema();
  await ensureSeoTasksSchema();
  await ensureSignalTriggersSchema();
  await ensureUgcDiscoverySchema();
  await ensureWeeklyReportSchema();
  await ensureYoutubeMonitorSchema();
  await ensureLaunchComplianceSchema();
  await ensurePostLaunchAuditSchema();
  await ensureVerticalPlaybooksSchema();
  await ensureBenchmarksSchema();
  await ensureJobsSchema();
  await ensureDigitalTwinSchema();
  await ensureBacklinkMonitorSchema();
  return runPhase2Migration();
}

async function colNullable(table, column) {
  const r = await db.getPool().query(
    `SELECT is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
    [table, column]);
  return r.rows[0] || null;
}

async function tableExists(name) {
  const r = await db.getPool().query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name=$1`, [name]);
  return r.rowCount > 0;
}

async function uniqueCols(table) {
  const r = await db.getPool().query(
    `SELECT tc.constraint_name,
            string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS cols
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema='public' AND tc.table_name=$1
        AND tc.constraint_type IN ('UNIQUE','PRIMARY KEY')
      GROUP BY tc.constraint_name`,
    [table]);
  return r.rows;
}

async function seedTenant(label) {
  const slug = `closeout-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const r = await db.getPool().query(
    `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
    [`Closeout ${label}`, slug]);
  return r.rows[0].id;
}

test('enforceTenantIdNotNull source never assigns a default tenant', () => {
  const src = fs.readFileSync(path.join(__dirname, '../services/tenants/migration.js'), 'utf8');
  const start = src.indexOf('async function enforceTenantIdNotNull');
  const end = src.indexOf('async function addTenantIdColumn', start);
  assert.ok(start >= 0 && end > start, 'enforceTenantIdNotNull must exist before addTenantIdColumn');
  const body = src.slice(start, end);
  assert.doesNotMatch(body, /_getDefaultTenantId/);
  assert.doesNotMatch(body, /SET tenant_id = \$1 WHERE tenant_id IS NULL/);
  assert.match(body, /reason:'orphans'|reason: 'orphans'/);
});

test('canonical old-shape → ensure* + phase2 yields scoped NOT NULL tables', { skip }, async () => {
  const p = db.getPool();
  await ensureAuthSchema();
  await ensureTenantSchema();

  // Old-shape backlink: UNIQUE(domain) + the non-immutable index that used to
  // abort the implicit transaction so the three tables never existed.
  await p.query(`DROP TABLE IF EXISTS backlink_changes CASCADE`);
  await p.query(`DROP TABLE IF EXISTS backlink_snapshots CASCADE`);
  await p.query(`DROP TABLE IF EXISTS backlink_monitors CASCADE`);
  await p.query(`
    CREATE TABLE backlink_monitors (
      id BIGSERIAL PRIMARY KEY,
      domain TEXT NOT NULL UNIQUE,
      alert_email TEXT,
      frequency TEXT NOT NULL DEFAULT 'daily',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_run_at TIMESTAMPTZ,
      last_total_referring INTEGER NOT NULL DEFAULT 0
    )
  `);
  await p.query(`
    CREATE TABLE backlink_snapshots (
      id BIGSERIAL PRIMARY KEY,
      monitor_id BIGINT NOT NULL REFERENCES backlink_monitors(id) ON DELETE CASCADE,
      referring_domain TEXT NOT NULL,
      snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (monitor_id, referring_domain)
    )
  `);
  await p.query(`
    CREATE TABLE backlink_changes (
      id BIGSERIAL PRIMARY KEY,
      monitor_id BIGINT NOT NULL REFERENCES backlink_monitors(id) ON DELETE CASCADE,
      change_type TEXT NOT NULL,
      referring_domain TEXT NOT NULL,
      detected_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  let immutableFailed = false;
  try {
    await p.query(`
      CREATE UNIQUE INDEX idx_blc_dedupe_legacy
        ON backlink_changes (monitor_id, change_type, referring_domain, (date_trunc('day', detected_at)))
    `);
  } catch (e) {
    immutableFailed = /immutable/i.test(e.message);
  }
  assert.ok(immutableFailed, 'legacy date_trunc(timestamptz) index must be rejected as not IMMUTABLE');

  // Old-shape children: no tenant_id column.
  await p.query(`ALTER TABLE compliance_checklist_items DROP COLUMN IF EXISTS tenant_id`);
  await p.query(`ALTER TABLE post_launch_checks DROP COLUMN IF EXISTS tenant_id`);

  const phase2 = await applyCanonicalCloseout();
  assert.ok(phase2 && (phase2.ok === true || phase2.reason !== 'no_db'), 'phase2 must run');

  for (const t of CLOSEOUT_TABLES) {
    assert.ok(await tableExists(t), `${t} must exist after canonical closeout`);
    const col = await colNullable(t, 'tenant_id');
    assert.ok(col, `${t} must have tenant_id`);
    assert.strictEqual(col.is_nullable, 'NO', `${t}.tenant_id must be NOT NULL`);
  }

  const playbooks = await colNullable('vertical_playbooks', 'tenant_id');
  assert.ok(playbooks, 'vertical_playbooks must have nullable tenant_id (roles pattern)');
  assert.strictEqual(playbooks.is_nullable, 'YES');

  const cons = await uniqueCols('backlink_monitors');
  assert.ok(cons.some(c => c.cols === 'tenant_id,domain'),
    `backlink_monitors must have UNIQUE(tenant_id, domain); found ${cons.map(c => c.cols).join(' | ')}`);
  assert.ok(!cons.some(c => c.cols === 'domain'),
    'legacy UNIQUE(domain) must be gone from backlink_monitors');
});

test('ensure* closeout is idempotent (second run does not throw)', { skip }, async () => {
  await applyCanonicalCloseout();
  await applyCanonicalCloseout();
  const col = await colNullable('backlink_monitors', 'tenant_id');
  assert.ok(col);
  assert.strictEqual(col.is_nullable, 'NO');
});

test('parent backfill copies parent tenant, never tenant 1', { skip }, async () => {
  const p = db.getPool();
  await ensureTenantSchema();
  const tenantA = await seedTenant('parent-a');
  assert.notStrictEqual(tenantA, 1, 'fixture tenant must not be id 1');

  await p.query(`DROP TABLE IF EXISTS closeout_child_probe CASCADE`);
  await p.query(`DROP TABLE IF EXISTS closeout_parent_probe CASCADE`);
  await p.query(`
    CREATE TABLE closeout_parent_probe (
      id SERIAL PRIMARY KEY,
      tenant_id INT REFERENCES tenants(id)
    )
  `);
  await p.query(`
    CREATE TABLE closeout_child_probe (
      id SERIAL PRIMARY KEY,
      parent_id INT REFERENCES closeout_parent_probe(id),
      tenant_id INT
    )
  `);
  const parent = await p.query(
    `INSERT INTO closeout_parent_probe (tenant_id) VALUES ($1) RETURNING id`, [tenantA]);
  const child = await p.query(
    `INSERT INTO closeout_child_probe (parent_id, tenant_id) VALUES ($1, NULL) RETURNING id`,
    [parent.rows[0].id]);

  const r = await enforceTenantIdNotNull('closeout_child_probe', {
    backfillFrom: {
      parentTable: 'closeout_parent_probe',
      parentIdColumn: 'id',
      childFkColumn: 'parent_id',
    },
  });
  assert.strictEqual(r.ok, true, `expected ok, got ${JSON.stringify(r)}`);
  assert.strictEqual(r.backfilled, 1);

  const row = await p.query(`SELECT tenant_id FROM closeout_child_probe WHERE id=$1`, [child.rows[0].id]);
  assert.strictEqual(row.rows[0].tenant_id, tenantA);
  assert.notStrictEqual(row.rows[0].tenant_id, 1);

  const col = await colNullable('closeout_child_probe', 'tenant_id');
  assert.strictEqual(col.is_nullable, 'NO');

  await p.query(`DROP TABLE IF EXISTS closeout_child_probe CASCADE`);
  await p.query(`DROP TABLE IF EXISTS closeout_parent_probe CASCADE`);
  await p.query(`DELETE FROM tenants WHERE id=$1`, [tenantA]);
});

test('orphaned child fail-closed: NOT NULL skipped, row kept, orphans reported', { skip }, async () => {
  const p = db.getPool();
  await ensureTenantSchema();
  const tenantA = await seedTenant('orphan-a');

  await p.query(`DROP TABLE IF EXISTS closeout_orphan_child CASCADE`);
  await p.query(`DROP TABLE IF EXISTS closeout_orphan_parent CASCADE`);
  await p.query(`
    CREATE TABLE closeout_orphan_parent (
      id SERIAL PRIMARY KEY,
      tenant_id INT REFERENCES tenants(id)
    )
  `);
  await p.query(`
    CREATE TABLE closeout_orphan_child (
      id SERIAL PRIMARY KEY,
      parent_id INT,
      payload TEXT NOT NULL,
      tenant_id INT
    )
  `);

  // Parent exists but tenant_id is NULL — child cannot be mapped.
  const parent = await p.query(`INSERT INTO closeout_orphan_parent (tenant_id) VALUES (NULL) RETURNING id`);
  const mappedParent = await p.query(
    `INSERT INTO closeout_orphan_parent (tenant_id) VALUES ($1) RETURNING id`, [tenantA]);
  await p.query(
    `INSERT INTO closeout_orphan_child (parent_id, payload, tenant_id) VALUES ($1,'orphan',NULL), ($2,'ok',NULL)`,
    [parent.rows[0].id, mappedParent.rows[0].id]);
  // Child with missing parent.
  const missing = await p.query(
    `INSERT INTO closeout_orphan_child (parent_id, payload, tenant_id) VALUES (NULL,'no-parent',NULL) RETURNING id`);

  const r = await enforceTenantIdNotNull('closeout_orphan_child', {
    backfillFrom: {
      parentTable: 'closeout_orphan_parent',
      parentIdColumn: 'id',
      childFkColumn: 'parent_id',
    },
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'orphans');
  assert.ok(r.orphanCount >= 2, `expected >=2 orphans, got ${r.orphanCount}`);

  const col = await colNullable('closeout_orphan_child', 'tenant_id');
  assert.strictEqual(col.is_nullable, 'YES', 'NOT NULL must not be applied when orphans remain');

  const kept = await p.query(`SELECT COUNT(*)::int AS n FROM closeout_orphan_child`);
  assert.strictEqual(kept.rows[0].n, 3, 'fail-closed must not DELETE rows');

  const mapped = await p.query(
    `SELECT tenant_id FROM closeout_orphan_child WHERE payload='ok'`);
  assert.strictEqual(mapped.rows[0].tenant_id, tenantA);

  const stillNull = await p.query(
    `SELECT COUNT(*)::int AS n FROM closeout_orphan_child WHERE tenant_id IS NULL`);
  assert.ok(stillNull.rows[0].n >= 2);

  const missingRow = await p.query(
    `SELECT 1 FROM closeout_orphan_child WHERE id=$1`, [missing.rows[0].id]);
  assert.strictEqual(missingRow.rowCount, 1);

  await p.query(`DROP TABLE IF EXISTS closeout_orphan_child CASCADE`);
  await p.query(`DROP TABLE IF EXISTS closeout_orphan_parent CASCADE`);
  await p.query(`DELETE FROM tenants WHERE id=$1`, [tenantA]);
});

test('backlink initializer succeeds and UNIQUE(tenant_id, domain) is per-tenant', { skip }, async () => {
  const p = db.getPool();
  await ensureAuthSchema();
  await ensureTenantSchema();
  await ensureBacklinkMonitorSchema();
  await ensureBacklinkMonitorSchema(); // idempotent

  assert.ok(await tableExists('backlink_monitors'));
  assert.ok(await tableExists('backlink_snapshots'));
  assert.ok(await tableExists('backlink_changes'));

  const fn = await p.query(
    `SELECT prosecdef, provolatile FROM pg_proc WHERE proname='infogenie_timestamptz_utc_date'`);
  assert.ok(fn.rowCount > 0, 'IMMUTABLE utc-date function must exist');
  assert.strictEqual(fn.rows[0].provolatile, 'i', 'function must be IMMUTABLE');

  const idx = await p.query(
    `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='idx_blc_dedupe'`);
  assert.ok(idx.rowCount > 0, 'idx_blc_dedupe must exist');
  assert.match(idx.rows[0].indexdef, /infogenie_timestamptz_utc_date/);
  assert.doesNotMatch(idx.rows[0].indexdef, /date_trunc\('day', detected_at\)/);

  const tenantA = await seedTenant('bl-a');
  const tenantB = await seedTenant('bl-b');
  assert.notStrictEqual(tenantA, tenantB);

  await p.query(
    `INSERT INTO backlink_monitors (tenant_id, domain) VALUES ($1,'example.com')`, [tenantA]);
  await p.query(
    `INSERT INTO backlink_monitors (tenant_id, domain) VALUES ($1,'example.com')`, [tenantB]);

  let sameTenantBlocked = false;
  try {
    await p.query(
      `INSERT INTO backlink_monitors (tenant_id, domain) VALUES ($1,'example.com')`, [tenantA]);
  } catch (e) {
    sameTenantBlocked = /unique|duplicate/i.test(e.message);
  }
  assert.ok(sameTenantBlocked, 'same tenant cannot insert the same domain twice');

  const counts = await p.query(
    `SELECT tenant_id, COUNT(*)::int AS n FROM backlink_monitors
      WHERE domain='example.com' AND tenant_id IN ($1,$2) GROUP BY tenant_id`,
    [tenantA, tenantB]);
  assert.strictEqual(counts.rowCount, 2);
  assert.ok(counts.rows.every(r => r.n === 1));

  await p.query(`DELETE FROM backlink_monitors WHERE tenant_id IN ($1,$2)`, [tenantA, tenantB]);
  await p.query(`DELETE FROM tenants WHERE id IN ($1,$2)`, [tenantA, tenantB]);
});

test('tenant-schema-audit still has four unweakened assertions', () => {
  const src = fs.readFileSync(path.join(__dirname, 'tenant-schema-audit.test.js'), 'utf8');
  assert.match(src, /every business table has a tenant_id column/);
  assert.match(src, /every tenant_id column is NOT NULL/);
  assert.match(src, /every table named in the phase-2 migration lists exists and is scoped/);
  assert.match(src, /every REWRITE_UNIQUE table has a composite/);
  assert.doesNotMatch(src, /skip:\s*true/);
  assert.match(src, /KNOWN_GLOBAL[\s\S]*benchmark_aggregates/);
  assert.match(src, /NULLABLE_OK[\s\S]*vertical_playbooks/);
});
