const _db = require('../../db');

async function ensureCompanyOverviewSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool();
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS domain_journey_events (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL,
      domain TEXT NOT NULL,
      tool TEXT NOT NULL,
      meta JSONB NOT NULL DEFAULT '{}',
      completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, domain, tool)
    );
    CREATE INDEX IF NOT EXISTS idx_domain_journey_tenant_domain
      ON domain_journey_events (tenant_id, domain);
  `);
}

module.exports = { ensureCompanyOverviewSchema };
