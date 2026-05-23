const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');

// brand_foundation — was a hard singleton (id=1, CHECK id=1) for the entire
// install. In Phase 2 it becomes one row per tenant:
//   • Add tenant_id column (nullable for migration, backfilled to default tenant)
//   • Drop the `brand_foundation_singleton` CHECK constraint
//   • Add UNIQUE (tenant_id) so each tenant still holds at most one row
//
// During the migration window the old `id=1` row is preserved and assigned
// to the default tenant. New tenants get a fresh row created lazily on first
// access by the API layer.

async function ensureBrandFoundationSchema() {
  if (!_db.hasDb()) return;
  const p = _db.getPool();

  // ── Original CREATE (idempotent — runs on fresh installs) ────────────────
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
  // Legacy seed of the singleton row — only safe on a *fresh* install where
  // tenant_id doesn't exist yet. Once Phase 2E set tenant_id NOT NULL, the
  // un-stamped INSERT would crash, so we skip it whenever tenant_id is
  // present (migration handles the row in that case).
  try {
    const hasTid = await p.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name='brand_foundation' AND column_name='tenant_id'`);
    if (!hasTid.rows.length) {
      await p.query(`INSERT INTO brand_foundation (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
    }
  } catch (_) { /* non-fatal */ }

  // ── Phase 2 migration ────────────────────────────────────────────────────
  // Add tenant_id + drop singleton CHECK + UNIQUE (tenant_id).
  // The id PRIMARY KEY stays (with its DEFAULT 1) for backwards-compat; new
  // rows from /save use id=DEFAULT — collisions caught by the UNIQUE constraint.
  // Once Phase 2 closeout happens, we'll drop the id default and use SERIAL.
  const mig = await addTenantIdColumn('brand_foundation', {
    dropCheck: 'brand_foundation_singleton',
    uniqueWithExtra: [],
  });
  if (mig.added || mig.droppedCheck || mig.uniqueAdded) {
    console.log('[brand-foundation] migration:', JSON.stringify(mig));
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
  try {
    await p.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='brand_foundation_id_seq') THEN
          CREATE SEQUENCE brand_foundation_id_seq OWNED BY brand_foundation.id;
          ALTER TABLE brand_foundation ALTER COLUMN id SET DEFAULT nextval('brand_foundation_id_seq');
        END IF;
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
