const _db = require('../../db');
const { enforceTenantIdNotNull } = require('../tenants/migration');
async function ensureInfluenceScoreSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS influence_scores (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      brand TEXT NOT NULL,
      sources JSONB NOT NULL DEFAULT '[]'::jsonb,
      top_source TEXT,
      top_source_score INTEGER DEFAULT 0,
      total_potential_reach BIGINT DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_influence_brand ON influence_scores(brand, created_at DESC);
  `);
  try { await enforceTenantIdNotNull('influence_scores'); } catch(e) { console.error('[influence-score] fail-closed tenant_id:', e.message); }
}
module.exports = { ensureInfluenceScoreSchema };
