const _db = require('../../db');

async function ensureDigitalTwinSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS digital_twin_scenarios (
      id            SERIAL PRIMARY KEY,
      tenant_id     INT NOT NULL REFERENCES tenants(id),
      scenario      TEXT NOT NULL,
      question      TEXT NOT NULL,
      results       JSONB NOT NULL DEFAULT '{}',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS digital_twin_scenarios_tenant_idx ON digital_twin_scenarios(tenant_id);
  `);
}

module.exports = { ensureDigitalTwinSchema };
