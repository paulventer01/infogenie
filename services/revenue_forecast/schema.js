const _db = require('../../db');

async function ensureRevenueForecastSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS revenue_forecasts (
      id            SERIAL PRIMARY KEY,
      tenant_id     INT NOT NULL REFERENCES tenants(id),
      scenario_name TEXT NOT NULL,
      inputs        JSONB NOT NULL DEFAULT '{}',
      results       JSONB NOT NULL DEFAULT '{}',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS revenue_forecasts_tenant_idx ON revenue_forecasts(tenant_id);
  `);
}

module.exports = { ensureRevenueForecastSchema };
