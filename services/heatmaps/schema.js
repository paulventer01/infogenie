const _db = require('../../db');

// Heatmap config used to be a singleton (id=1). Phase 2D rewrites it to be
// per-tenant: drop the id PK + CHECK constraint, add tenant_id (PK), migrate
// the single legacy row to platform tenant 1. Idempotent on every boot.
async function ensureHeatmapsSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  // Fresh installs land directly on the per-tenant shape; legacy installs go
  // through the conditional migration block below. Either way the post-state
  // is identical, so subsequent boots are no-ops.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS heatmap_config (
      tenant_id          INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
      clarity_project_id TEXT,
      clarity_api_token  TEXT,
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const cols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='heatmap_config'`);
  const hasTid = cols.rows.some(r => r.column_name === 'tenant_id');
  const hasId  = cols.rows.some(r => r.column_name === 'id');

  // Legacy table (pre-2D) had `id INT PK DEFAULT 1 CHECK id=1` and no tenant_id.
  // The CREATE IF NOT EXISTS above was a no-op for it, so we still see hasId=true.
  // Only touch the id column / CHECK if it's actually present — otherwise we'd
  // crash on re-boots after migration completed.
  if (hasId) {
    try {
      // Seed the legacy row first so we have something to migrate.
      await pool.query(`INSERT INTO heatmap_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
      if (!hasTid) {
        await pool.query(`ALTER TABLE heatmap_config ADD COLUMN tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE`);
        await pool.query(`UPDATE heatmap_config SET tenant_id=1 WHERE id=1 AND tenant_id IS NULL`);
      }
      await pool.query(`ALTER TABLE heatmap_config DROP CONSTRAINT IF EXISTS heatmap_config_id_check`);
      await pool.query(`ALTER TABLE heatmap_config DROP CONSTRAINT IF EXISTS heatmap_config_pkey`);
      await pool.query(`ALTER TABLE heatmap_config ALTER COLUMN tenant_id SET NOT NULL`);
      await pool.query(`ALTER TABLE heatmap_config ADD PRIMARY KEY (tenant_id)`);
      await pool.query(`ALTER TABLE heatmap_config DROP COLUMN IF EXISTS id`);
    } catch (e) { console.error('[heatmaps] pk swap:', e.message); }
  }

  console.log('[heatmaps] schema ready (per-tenant)');
}

module.exports = { ensureHeatmapsSchema };
