const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');

async function ensureAiVisibilitySchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_visibility_runs (
      id TEXT PRIMARY KEY,
      brand TEXT NOT NULL,
      competitors JSONB NOT NULL DEFAULT '[]',
      prompts JSONB NOT NULL DEFAULT '[]',
      providers JSONB NOT NULL DEFAULT '[]',
      results JSONB NOT NULL DEFAULT '{}',
      summary JSONB NOT NULL DEFAULT '{}',
      cost_usd NUMERIC(8,4) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_ai_vis_brand ON ai_visibility_runs(brand, created_at DESC);
  `);
  try { await addTenantIdColumn('ai_visibility_runs'); }
  catch (e) { console.error('[ai-visibility] addTenantIdColumn:', e.message); }
}

module.exports = { ensureAiVisibilitySchema };
