const _db = require('../../db');

async function ensureMapsIntelSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS maps_intel_runs (
      id             SERIAL PRIMARY KEY,
      tenant_id      INT NOT NULL REFERENCES tenants(id),
      keyword        TEXT NOT NULL,
      region         TEXT NOT NULL,
      businesses     JSONB NOT NULL DEFAULT '[]',
      market_summary JSONB NOT NULL DEFAULT '{}',
      total_count    INT NOT NULL DEFAULT 0,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS maps_intel_runs_tenant_created
      ON maps_intel_runs(tenant_id, created_at DESC)
  `);
}

module.exports = { ensureMapsIntelSchema };
