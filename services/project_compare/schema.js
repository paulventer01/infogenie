const _db = require('../../db');
const { enforceTenantIdNotNull } = require('../tenants/migration');
async function ensureProjectCompareSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS project_comparisons (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      brands JSONB NOT NULL DEFAULT '[]'::jsonb,
      results JSONB NOT NULL DEFAULT '[]'::jsonb,
      winner TEXT,
      dimension_winners JSONB DEFAULT '{}'::jsonb,
      summary TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_proj_compare_at ON project_comparisons(created_at DESC);
  `);
  try { await enforceTenantIdNotNull('project_comparisons'); } catch(e) { console.error('[project-compare] fail-closed tenant_id:', e.message); }
}
module.exports = { ensureProjectCompareSchema };
