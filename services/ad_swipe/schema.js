const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');

async function ensureAdSwipeSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ad_swipe (
      id           BIGSERIAL PRIMARY KEY,
      source       TEXT NOT NULL,
      external_id  TEXT,
      advertiser   TEXT NOT NULL,
      headline     TEXT,
      body         TEXT,
      cta          TEXT,
      snapshot_url TEXT,
      platforms    JSONB DEFAULT '[]'::jsonb,
      tags         JSONB DEFAULT '[]'::jsonb,
      notes        TEXT DEFAULT '',
      score        INT DEFAULT 0,
      saved_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS ad_swipe_advertiser_idx ON ad_swipe(advertiser)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS ad_swipe_saved_at_idx ON ad_swipe(saved_at DESC)`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS ad_swipe_source_extid_uidx ON ad_swipe(source, external_id) WHERE external_id IS NOT NULL`);
  // Phase 2B — add tenant_id and rewrite uniqueness per-tenant.
  await addTenantIdColumn('ad_swipe');
  try {
    await pool.query(`DROP INDEX IF EXISTS ad_swipe_source_extid_uidx`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS ad_swipe_tenant_source_extid_uidx
      ON ad_swipe (tenant_id, source, external_id) WHERE external_id IS NOT NULL`);
  } catch (e) { console.warn('[ad-swipe] unique rewrite skipped:', e.message); }
  console.log('[ad-swipe] schema ready');
}

module.exports = { ensureAdSwipeSchema };
