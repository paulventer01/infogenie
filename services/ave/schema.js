const _db = require('../../db');
const { enforceTenantIdNotNull } = require('../tenants/migration');
async function ensureAveSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS ave_reports (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      brand TEXT NOT NULL,
      period TEXT NOT NULL DEFAULT '30d',
      total_ave_usd NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_mentions INTEGER NOT NULL DEFAULT 0,
      channels JSONB NOT NULL DEFAULT '{}'::jsonb,
      top_mentions JSONB NOT NULL DEFAULT '[]'::jsonb,
      methodology TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_ave_brand ON ave_reports(brand, created_at DESC);
  `);
  try { await enforceTenantIdNotNull('ave_reports'); } catch(e) { console.error('[ave] fail-closed tenant_id:', e.message); }
}
module.exports = { ensureAveSchema };
