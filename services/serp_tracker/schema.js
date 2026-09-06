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
      device TEXT NOT NULL DEFAULT 'desktop',
      language TEXT NOT NULL DEFAULT 'en',
      enabled BOOLEAN NOT NULL DEFAULT true,
      competitors JSONB NOT NULL DEFAULT '[]'::jsonb,
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
      serp_features JSONB NOT NULL DEFAULT '{}'::jsonb,
      competitor_positions JSONB NOT NULL DEFAULT '{}'::jsonb,
      ran_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_serp_runs_keyword_at ON serp_tracker_runs(keyword_id, ran_at DESC);
  `);

  // Additive columns for upgrades from older schemas.
  await pool.query(`ALTER TABLE serp_tracker_keywords ADD COLUMN IF NOT EXISTS competitors JSONB NOT NULL DEFAULT '[]'::jsonb`).catch(() => {});
  await pool.query(`ALTER TABLE serp_tracker_keywords ADD COLUMN IF NOT EXISTS device TEXT NOT NULL DEFAULT 'desktop'`).catch(() => {});
  await pool.query(`ALTER TABLE serp_tracker_keywords ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en'`).catch(() => {});
  await pool.query(`ALTER TABLE serp_tracker_runs ADD COLUMN IF NOT EXISTS serp_features JSONB NOT NULL DEFAULT '{}'::jsonb`).catch(() => {});
  await pool.query(`ALTER TABLE serp_tracker_runs ADD COLUMN IF NOT EXISTS competitor_positions JSONB NOT NULL DEFAULT '{}'::jsonb`).catch(() => {});

  for (const t of ['serp_tracker_keywords', 'serp_tracker_runs']) {
    try { await addTenantIdColumn(t); }
    catch (e) { console.error(`[serp-tracker] addTenantIdColumn ${t}: ${e.message}`); }
  }

  try {
    // Multitarget unique: same keyword can be tracked per country + device + language.
    await pool.query(`DROP INDEX IF EXISTS uniq_serp_tenant_keyword`);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_serp_tenant_keyword_target
      ON serp_tracker_keywords(tenant_id, keyword, target_domain, country, device, language)
    `);
    await pool.query(`ALTER TABLE serp_tracker_keywords DROP CONSTRAINT IF EXISTS serp_tracker_keywords_keyword_target_domain_country_key`);
  } catch (e) { console.error('[serp-tracker] uniq migrate:', e.message); }

  console.log('[serp-tracker] schema ready');
}

module.exports = { ensureSerpTrackerSchema };
