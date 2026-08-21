const _db = require('../../db');
const { enforceTenantIdNotNull } = require('../tenants/migration');

// brand_foundation — was a hard singleton (id=1, CHECK id=1) for the entire
// install. In Phase 2 it becomes one row per tenant:
//   • Add tenant_id column
//   • Drop the `brand_foundation_singleton` CHECK constraint
//   • Add UNIQUE (tenant_id) so each tenant still holds at most one row
//
// The unscoped legacy seed (`INSERT INTO brand_foundation (id) VALUES (1)`)
// is retired. That INSERT ran when tenant_id did not yet exist, so
// enforceTenantIdNotNull saw an unowned row, fail-closed, and never set
// NOT NULL — which broke a fresh install (audit check 2). The API already
// lazy-creates a per-tenant row on first access via resolveTenantId.
//
// Closeout is fail-closed (`enforceTenantIdNotNull`):
//   • Fresh install (empty table after CREATE): tenant_id ends NOT NULL.
//   • Rows that already have tenant_id: SET NOT NULL as usual. Those rows
//     are never deleted.
//   • Rows with tenant_id NULL (the old unscoped singleton): FAIL BEFORE DDL —
//     preflight aborts with zero ADD COLUMN / UNIQUE / DROP CHECK. Leave the
//     rows in place; do NOT map to tenant 1 / a default tenant. Operator
//     must stamp a real tenant_id or delete. Do not add this table to
//     NULLABLE_OK — a per-tenant singleton has no legitimate global row.

async function ensureBrandFoundationSchema() {
  if (!_db.hasDb()) return;
  const p = _db.getPool();

  // ── Original CREATE (idempotent — runs on fresh installs) ────────────────
  // Shape stays pre-tenant so CREATE TABLE IF NOT EXISTS is a no-op on
  // existing installs. Do not seed an id=1 row here: an unowned row would
  // block the fail-closed NOT NULL flip. Closeout runs on the empty table
  // (fresh) or on whatever rows already exist (production).
  await p.query(`
    CREATE TABLE IF NOT EXISTS brand_foundation (
      id INTEGER PRIMARY KEY DEFAULT 1,
      purpose_why TEXT DEFAULT '',
      purpose_beyond_money TEXT DEFAULT '',
      icp_name TEXT DEFAULT '',
      icp_role TEXT DEFAULT '',
      icp_pain TEXT DEFAULT '',
      icp_tried_cheap TEXT DEFAULT '',
      icp_dream_outcome TEXT DEFAULT '',
      voice_tone_warm INTEGER DEFAULT 5,
      voice_tone_witty INTEGER DEFAULT 5,
      voice_tone_bold INTEGER DEFAULT 5,
      voice_we_say TEXT DEFAULT '',
      voice_we_dont_say TEXT DEFAULT '',
      voice_banned_words TEXT DEFAULT '',
      positioning_statement TEXT DEFAULT '',
      positioning_proof TEXT DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT brand_foundation_singleton CHECK (id = 1)
    );
  `);

  // ── Phase 2 closeout ─────────────────────────────────────────────────────
  // Add tenant_id + drop singleton CHECK + UNIQUE (tenant_id).
  // The id PRIMARY KEY stays (with its DEFAULT 1) for backwards-compat; new
  // rows from /save use id=DEFAULT — collisions caught by the UNIQUE constraint.
  // Once Phase 2 closeout happens, we'll drop the id default and use SERIAL.
  const mig = await enforceTenantIdNotNull('brand_foundation', {
    dropCheck: 'brand_foundation_singleton',
    uniqueWithExtra: [],
  });
  if (mig.added || mig.droppedCheck || mig.uniqueAdded) {
    console.log('[brand-foundation] migration:', JSON.stringify(mig));
  }
  if (mig.reason === 'preflight' || mig.reason === 'orphans') {
    console.error(
      '[brand-foundation] FAIL-BEFORE-DDL: ' + (mig.orphanCount || 0) +
      ' unmapped row(s) (legacy unscoped singleton). Zero tenant_id DDL applied. ' +
      'Left in place; not assigned to tenant 1. ' +
      'Operator must stamp a real tenant_id or delete those rows explicitly. ' +
      'DATABASE_URL=postgres://… node scripts/tenant-schema-preflight.js'
    );
  }

  // The legacy id=1 row's DEFAULT keeps colliding on new tenant inserts. Drop
  // the column DEFAULT so new rows get a unique id (we use the application
  // layer to allocate the next id, or change to SERIAL in closeout).
  try {
    await p.query(`ALTER TABLE brand_foundation ALTER COLUMN id DROP DEFAULT`);
  } catch (_) { /* already dropped — ignore */ }

  // Ensure the id column is a real autoincrement now that the singleton is gone.
  // CREATE SEQUENCE IF NOT EXISTS — owned by the column so it's dropped with it.
  // Always re-syncs setval on every boot so the sequence cannot drift behind
  // the real MAX(id) (a known cause of duplicate-key errors after manual
  // inserts or restores).
  // NOTE: SET DEFAULT is applied unconditionally (not only at sequence creation
  // time) so that re-runs after a partial migration always fix the column default.
  try {
    await p.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='brand_foundation_id_seq') THEN
          CREATE SEQUENCE brand_foundation_id_seq OWNED BY brand_foundation.id;
        END IF;
        -- Always re-apply SET DEFAULT in case a previous run created the sequence
        -- but crashed before or after the ALTER TABLE (leaves id with no default).
        ALTER TABLE brand_foundation ALTER COLUMN id SET DEFAULT nextval('brand_foundation_id_seq');
      END $$;
    `);
    // Safety re-sync on every boot — cheap and guards against drift.
    await p.query(`SELECT setval('brand_foundation_id_seq',
      COALESCE((SELECT MAX(id) FROM brand_foundation), 1), true)`);
  } catch (e) {
    console.warn('[brand-foundation] sequence setup skipped:', e.message);
  }

  console.log('[brand-foundation] schema ready');
}

module.exports = { ensureBrandFoundationSchema };
