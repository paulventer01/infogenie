const _db = require('../../db');

async function ensureHashtagIntelSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hashtag_intel_runs (
      id           SERIAL PRIMARY KEY,
      tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      platform     TEXT NOT NULL DEFAULT 'instagram',
      seed_keyword TEXT NOT NULL,
      hashtags     JSONB NOT NULL DEFAULT '[]',
      clusters     JSONB NOT NULL DEFAULT '[]',
      total_count  INTEGER NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hashtag_intel_tenant ON hashtag_intel_runs(tenant_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_hashtag_intel_platform ON hashtag_intel_runs(tenant_id, platform);
  `);
}

module.exports = { ensureHashtagIntelSchema };
