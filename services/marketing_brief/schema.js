const _db = require('../../db');

async function ensureMarketingBriefSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketing_briefs (
      id            SERIAL PRIMARY KEY,
      tenant_id     INT NOT NULL REFERENCES tenants(id),
      brand         TEXT NOT NULL DEFAULT '',
      cadence       TEXT NOT NULL DEFAULT 'daily',
      headline      TEXT NOT NULL DEFAULT '',
      greeting      TEXT NOT NULL DEFAULT '',
      signals       JSONB NOT NULL DEFAULT '[]',
      actions       JSONB NOT NULL DEFAULT '[]',
      sections      JSONB NOT NULL DEFAULT '[]',
      active_pillars JSONB NOT NULL DEFAULT '[]',
      generated_by  TEXT NOT NULL DEFAULT 'template',
      delivered_to  JSONB NOT NULL DEFAULT '[]',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS marketing_briefs_tenant_created
    ON marketing_briefs(tenant_id, created_at DESC)`);

  // Per-tenant cadence preference: weekly (Solo) · daily (Growth) · daily-per-client (Agency)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketing_brief_settings (
      tenant_id  INT PRIMARY KEY REFERENCES tenants(id),
      cadence    TEXT NOT NULL DEFAULT 'daily'
                   CHECK (cadence IN ('weekly','daily','daily-per-client')),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

module.exports = { ensureMarketingBriefSchema };
