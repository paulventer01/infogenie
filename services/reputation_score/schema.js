const _db = require('../../db');
const { enforceTenantIdNotNull } = require('../tenants/migration');
async function ensureReputationScoreSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS reputation_scores (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      brand TEXT NOT NULL,
      overall_score INTEGER NOT NULL DEFAULT 0,
      grade TEXT NOT NULL DEFAULT 'F',
      sentiment_score INTEGER DEFAULT 0,
      volume_score INTEGER DEFAULT 0,
      sov_score INTEGER DEFAULT 0,
      crisis_score INTEGER DEFAULT 0,
      reach_score INTEGER DEFAULT 0,
      trend TEXT DEFAULT 'stable',
      summary TEXT,
      recommendations JSONB DEFAULT '[]'::jsonb,
      components JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_rep_score_brand ON reputation_scores(brand, created_at DESC);
  `);
  try { await enforceTenantIdNotNull('reputation_scores'); } catch(e) { console.error('[reputation-score] fail-closed tenant_id:', e.message); }
}
module.exports = { ensureReputationScoreSchema };
