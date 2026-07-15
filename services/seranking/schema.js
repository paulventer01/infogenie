const _db = require('../../db');

async function ensureSERankingSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS seranking_settings (
      id          SERIAL PRIMARY KEY,
      tenant_id   INT NOT NULL REFERENCES tenants(id),
      site_id     INT NOT NULL,
      site_title  TEXT,
      site_url    TEXT,
      engine_id   INT,
      engine_label TEXT,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_id)
    );
    CREATE INDEX IF NOT EXISTS seranking_settings_tid ON seranking_settings(tenant_id);
  `);
}

module.exports = { ensureSERankingSchema };
