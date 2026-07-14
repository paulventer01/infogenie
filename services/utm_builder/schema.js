const _db = require('../../db');

async function ensureUtmBuilderSchema() {
  if (!_db.hasDb()) return;
  const p = _db.getPool();

  await p.query(`
    CREATE TABLE IF NOT EXISTS utm_links (
      id          SERIAL PRIMARY KEY,
      tenant_id   INT NOT NULL REFERENCES tenants(id),
      label       TEXT NOT NULL,
      destination TEXT NOT NULL,
      utm_source  TEXT NOT NULL,
      utm_medium  TEXT NOT NULL,
      utm_campaign TEXT NOT NULL,
      utm_content TEXT,
      utm_term    TEXT,
      full_url    TEXT NOT NULL,
      click_count INT NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS utm_presets (
      id        SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      label     TEXT NOT NULL,
      source    TEXT NOT NULL,
      medium    TEXT NOT NULL,
      campaign  TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(tenant_id, label)
    );
  `);
}

module.exports = { ensureUtmBuilderSchema };
