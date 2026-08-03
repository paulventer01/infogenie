const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');

async function ensureVoiceSeoSchema() {
  if (!_db.hasDb()) return false;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS voice_seo_runs (
      id              TEXT PRIMARY KEY,
      tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      url             TEXT NOT NULL,
      score           INTEGER NOT NULL,
      grade           TEXT NOT NULL,
      signals         JSONB NOT NULL DEFAULT '[]',
      fixes           JSONB,
      summary         JSONB,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_voice_seo_tenant_time
      ON voice_seo_runs(tenant_id, created_at DESC);
  `);
  try { await addTenantIdColumn('voice_seo_runs'); } catch (_) { /* idempotent */ }
  return true;
}

module.exports = { ensureVoiceSeoSchema };
