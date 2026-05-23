const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');
async function ensurePricingWatchSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pricing_watch_targets (
      id SERIAL PRIMARY KEY,
      label TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      competitor TEXT,
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS pricing_watch_snapshots (
      id SERIAL PRIMARY KEY,
      target_id INT NOT NULL REFERENCES pricing_watch_targets(id) ON DELETE CASCADE,
      product_name TEXT,
      price NUMERIC(12,2),
      currency TEXT,
      original_price NUMERIC(12,2),
      in_stock BOOLEAN,
      promo TEXT,
      raw_extract JSONB,
      taken_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_pws_target_taken ON pricing_watch_snapshots(target_id, taken_at DESC);
  `);

  // Phase 2B multi-tenant migration on both tables.
  for (const t of ['pricing_watch_targets', 'pricing_watch_snapshots']) {
    try { await addTenantIdColumn(t); }
    catch (e) { console.error(`[pricing-watch] addTenantIdColumn ${t}: ${e.message}`); }
  }

  // URL uniqueness must be tenant-scoped so two tenants can each track the
  // same URL. Create-then-drop preserves the dedup contract during rollout.
  try {
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_pw_tenant_url ON pricing_watch_targets(tenant_id, url)`);
    await pool.query(`ALTER TABLE pricing_watch_targets DROP CONSTRAINT IF EXISTS pricing_watch_targets_url_key`);
  } catch (e) { console.error('[pricing-watch] uniq migrate:', e.message); }

  console.log('[pricing-watch] schema ready');
}
module.exports = { ensurePricingWatchSchema };
