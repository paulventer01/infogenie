const _db = require('../../db');
const { enforceTenantIdNotNull } = require('../tenants/migration');
async function ensureIntentRadarSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS intent_radar_runs (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      brand TEXT NOT NULL,
      total_signals INTEGER NOT NULL DEFAULT 0,
      early_research INTEGER NOT NULL DEFAULT 0,
      comparing INTEGER NOT NULL DEFAULT 0,
      ready_to_buy INTEGER NOT NULL DEFAULT 0,
      churned INTEGER NOT NULL DEFAULT 0,
      signals JSONB NOT NULL DEFAULT '[]'::jsonb,
      top_opportunity TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_intent_brand ON intent_radar_runs(brand, created_at DESC);
  `);
  try { await enforceTenantIdNotNull('intent_radar_runs'); } catch(e) { console.error('[intent-radar] fail-closed tenant_id:', e.message); }
}
module.exports = { ensureIntentRadarSchema };
