const _db = require('../../db');

async function ensureProductLibrarySchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id             BIGSERIAL PRIMARY KEY,
      tenant_id      INT NOT NULL REFERENCES tenants(id),
      name           TEXT NOT NULL,
      tagline        TEXT NOT NULL DEFAULT '',
      category       TEXT NOT NULL DEFAULT '',
      pricing_model  TEXT NOT NULL DEFAULT 'one_time' CHECK (pricing_model IN ('one_time','subscription','freemium','usage','custom')),
      price          NUMERIC(12,2),
      currency       TEXT NOT NULL DEFAULT 'USD',
      description    TEXT NOT NULL DEFAULT '',
      usp            TEXT NOT NULL DEFAULT '',
      features       JSONB NOT NULL DEFAULT '[]',
      benefits       JSONB NOT NULL DEFAULT '[]',
      faqs           JSONB NOT NULL DEFAULT '[]',
      objections     JSONB NOT NULL DEFAULT '[]',
      cross_sell     JSONB NOT NULL DEFAULT '[]',
      upsell         JSONB NOT NULL DEFAULT '[]',
      status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_products_tenant ON products(tenant_id, status, created_at DESC);
  `);
}

module.exports = { ensureProductLibrarySchema };
