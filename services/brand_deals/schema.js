const _db = require('../../db');
async function ensureBrandDealsSchema() {
  if (!_db.hasDb()) return;
  const p = _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS brand_deals (
      id               SERIAL PRIMARY KEY,
      tenant_id        INT NOT NULL REFERENCES tenants(id),
      brand_name       TEXT NOT NULL,
      contact_name     TEXT,
      contact_email    TEXT,
      product          TEXT,
      deal_type        TEXT NOT NULL DEFAULT 'sponsored_post',
      offered_rate     NUMERIC(10,2),
      negotiated_rate  NUMERIC(10,2),
      currency         TEXT NOT NULL DEFAULT 'USD',
      status           TEXT NOT NULL DEFAULT 'inquiry',
      deliverables     TEXT,
      notes            TEXT,
      follow_up_date   DATE,
      deadline         DATE,
      persona_id       INT REFERENCES ai_personas(id) ON DELETE SET NULL,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_brand_deals_tenant ON brand_deals(tenant_id)`);
  console.log('[brand-deals] schema ready');
}
module.exports = { ensureBrandDealsSchema };
