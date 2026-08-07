const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');

async function ensureAeoSchema() {
  if (!_db.hasDb()) return false;
  const p = _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS aeo_runs (
      id              TEXT PRIMARY KEY,
      tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      url             TEXT NOT NULL,
      score           INTEGER NOT NULL,
      grade           TEXT NOT NULL,
      pillars         JSONB NOT NULL DEFAULT '[]',
      checks          JSONB NOT NULL DEFAULT '[]',
      fixes           JSONB,
      summary         JSONB,
      faq_suggestions JSONB,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_aeo_runs_tenant_time
      ON aeo_runs(tenant_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_aeo_runs_url
      ON aeo_runs(tenant_id, url, created_at DESC);
  `);
  try { await addTenantIdColumn('aeo_runs'); } catch (_) { /* idempotent */ }
  return true;
}

module.exports = { ensureAeoSchema };
