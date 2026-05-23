const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');
async function ensureSerpTrackerSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS serp_tracker_keywords (
      id SERIAL PRIMARY KEY,
      keyword TEXT NOT NULL,
      target_domain TEXT NOT NULL,
      country TEXT NOT NULL DEFAULT 'us',
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(keyword, target_domain, country)
    );
    CREATE TABLE IF NOT EXISTS serp_tracker_runs (
      id SERIAL PRIMARY KEY,
      keyword_id INT REFERENCES serp_tracker_keywords(id) ON DELETE CASCADE,
      target_position INT,
      target_url TEXT,
      total_results TEXT,
      results JSONB NOT NULL DEFAULT '[]'::jsonb,
      ran_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_serp_runs_keyword_at ON serp_tracker_runs(keyword_id, ran_at DESC);
  `);

  // Multi-tenancy (Phase 2B). Both tables get tenant_id; the keyword unique
  // constraint must be scoped to tenant so two tenants can each track the
  // same (keyword, domain, country) tuple.
  for (const t of ['serp_tracker_keywords', 'serp_tracker_runs']) {
    try { await addTenantIdColumn(t); }
    catch (e) { console.error(`[serp-tracker] addTenantIdColumn ${t}: ${e.message}`); }
  }

  try {
    // Create-then-drop ordering keeps dedup contract intact during migration.
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_serp_tenant_keyword ON serp_tracker_keywords(tenant_id, keyword, target_domain, country)`);
    await pool.query(`ALTER TABLE serp_tracker_keywords DROP CONSTRAINT IF EXISTS serp_tracker_keywords_keyword_target_domain_country_key`);
  } catch (e) { console.error('[serp-tracker] uniq migrate:', e.message); }

  console.log('[serp-tracker] schema ready');
}
module.exports = { ensureSerpTrackerSchema };
