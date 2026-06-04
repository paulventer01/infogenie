const _db = require('../../db');

async function ensureAdCreativeSchema() {
  if (!_db.hasDb()) return;
  const p = _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS ad_creatives (
      id           SERIAL PRIMARY KEY,
      tenant_id    INT NOT NULL REFERENCES tenants(id),
      platform     TEXT NOT NULL DEFAULT 'facebook_ad',
      format       TEXT NOT NULL DEFAULT 'square',
      style        TEXT NOT NULL DEFAULT 'photorealistic',
      headline     TEXT,
      body_copy    TEXT,
      brand_name   TEXT,
      brand_colors TEXT,
      cta_text     TEXT,
      image_url    TEXT,
      image_path   TEXT,
      prompt       TEXT,
      source       TEXT NOT NULL DEFAULT 'dalle3',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_ad_creatives_tenant ON ad_creatives(tenant_id)`);
  console.log('[ad-creative] schema ready');
}

module.exports = { ensureAdCreativeSchema };
