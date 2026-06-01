const _db = require('../../db');

async function ensureCreativeIntelSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS creative_intel_runs (
      id         SERIAL PRIMARY KEY,
      tenant_id  INT NOT NULL REFERENCES tenants(id),
      urls       JSONB NOT NULL DEFAULT '[]',
      analyses   JSONB NOT NULL DEFAULT '[]',
      patterns   JSONB NOT NULL DEFAULT '{}',
      brief      TEXT  NOT NULL DEFAULT '',
      url_count  INT   NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS creative_intel_runs_tenant_created
      ON creative_intel_runs(tenant_id, created_at DESC)
  `);
}

module.exports = { ensureCreativeIntelSchema };
