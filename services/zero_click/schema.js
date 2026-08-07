const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');

async function ensureZeroClickSchema() {
  if (!_db.hasDb()) return false;
  const p = _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS zero_click_runs (
      id              TEXT PRIMARY KEY,
      tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      url             TEXT NOT NULL,
      score           INTEGER NOT NULL,
      grade           TEXT NOT NULL,
      clickless_pct   INTEGER,
      aeo_score       INTEGER,
      signals         JSONB NOT NULL DEFAULT '[]',
      fixes           JSONB,
      summary         JSONB,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_zero_click_tenant_time
      ON zero_click_runs(tenant_id, created_at DESC);
  `);
  try { await addTenantIdColumn('zero_click_runs'); } catch (_) { /* idempotent */ }
  return true;
}

module.exports = { ensureZeroClickSchema };
