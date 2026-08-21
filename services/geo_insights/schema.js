const _db = require('../../db');
const { enforceTenantIdNotNull } = require('../tenants/migration');
async function ensureGeoInsightsSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS geo_insight_runs (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      brand TEXT NOT NULL,
      regions JSONB NOT NULL DEFAULT '[]'::jsonb,
      breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
      top_region TEXT,
      top_region_sentiment TEXT,
      strategic_notes JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_geo_brand ON geo_insight_runs(brand, created_at DESC);
  `);
  try { await enforceTenantIdNotNull('geo_insight_runs'); } catch(e) { console.error('[geo-insights] fail-closed tenant_id:', e.message); }
}
module.exports = { ensureGeoInsightsSchema };
