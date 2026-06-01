const _db = require('../../db');

async function ensureLinkProspectorSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS link_prospector_runs (
      id          SERIAL PRIMARY KEY,
      tenant_id   INT NOT NULL REFERENCES tenants(id),
      keyword     TEXT NOT NULL,
      domain      TEXT NOT NULL,
      prospects   JSONB NOT NULL DEFAULT '[]',
      total_found INT  NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS link_prospector_runs_tenant_created
      ON link_prospector_runs(tenant_id, created_at DESC)
  `);
}

module.exports = { ensureLinkProspectorSchema };
