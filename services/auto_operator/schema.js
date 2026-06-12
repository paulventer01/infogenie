const _db = require('../../db');

async function ensureAutoOperatorSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS auto_operator_runs (
      id            SERIAL PRIMARY KEY,
      tenant_id     INT NOT NULL REFERENCES tenants(id),
      trigger       TEXT NOT NULL,
      actions_taken JSONB NOT NULL DEFAULT '[]',
      summary       TEXT,
      status        TEXT NOT NULL DEFAULT 'completed',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS auto_operator_runs_tenant_idx ON auto_operator_runs(tenant_id);
  `);
}

module.exports = { ensureAutoOperatorSchema };
