const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');
async function ensureProjectCompareSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS project_comparisons (
      id SERIAL PRIMARY KEY,
      brands JSONB NOT NULL DEFAULT '[]'::jsonb,
      results JSONB NOT NULL DEFAULT '[]'::jsonb,
      winner TEXT,
      dimension_winners JSONB DEFAULT '{}'::jsonb,
      summary TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_proj_compare_at ON project_comparisons(created_at DESC);
  `);
  try { await addTenantIdColumn('project_comparisons'); } catch(e) { console.error('[project-compare] migration:', e.message); }
}
module.exports = { ensureProjectCompareSchema };
