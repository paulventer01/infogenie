const _db = require('../../db');

async function ensureSERankingSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS seranking_settings (
      id                    SERIAL PRIMARY KEY,
      tenant_id             INT NOT NULL REFERENCES tenants(id),
      site_id               INT NOT NULL DEFAULT 0,
      site_title            TEXT,
      site_url              TEXT,
      engine_id             INT,
      engine_label          TEXT,
      mcp_client_id         TEXT,
      mcp_access_token      TEXT,
      mcp_refresh_token     TEXT,
      mcp_token_expires_at  TIMESTAMPTZ,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_id)
    );
    CREATE INDEX IF NOT EXISTS seranking_settings_tid ON seranking_settings(tenant_id);
  `);
  // Add MCP columns if they don't exist (idempotent migration)
  await pool.query(`
    ALTER TABLE seranking_settings ADD COLUMN IF NOT EXISTS mcp_client_id        TEXT;
    ALTER TABLE seranking_settings ADD COLUMN IF NOT EXISTS mcp_access_token     TEXT;
    ALTER TABLE seranking_settings ADD COLUMN IF NOT EXISTS mcp_refresh_token    TEXT;
    ALTER TABLE seranking_settings ADD COLUMN IF NOT EXISTS mcp_token_expires_at TIMESTAMPTZ;
  `);
}

module.exports = { ensureSERankingSchema };
