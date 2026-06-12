const _db = require('../../db');

async function ensureMarketplaceSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS marketplace_listings (
      id            SERIAL PRIMARY KEY,
      tenant_id     INT NOT NULL REFERENCES tenants(id),
      title         TEXT NOT NULL,
      description   TEXT,
      category      TEXT NOT NULL DEFAULT 'template',
      tags          TEXT[] DEFAULT '{}',
      content       JSONB NOT NULL DEFAULT '{}',
      downloads     INT NOT NULL DEFAULT 0,
      is_public     BOOLEAN NOT NULL DEFAULT TRUE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS marketplace_listings_tenant_idx ON marketplace_listings(tenant_id);
    CREATE INDEX IF NOT EXISTS marketplace_listings_category_idx ON marketplace_listings(category);

    CREATE TABLE IF NOT EXISTS marketplace_downloads (
      id              SERIAL PRIMARY KEY,
      listing_id      INT NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
      tenant_id       INT NOT NULL REFERENCES tenants(id),
      downloaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS marketplace_downloads_listing_idx ON marketplace_downloads(listing_id);
  `);
}

module.exports = { ensureMarketplaceSchema };
