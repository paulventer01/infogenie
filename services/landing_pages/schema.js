const _db = require('../../db');
async function ensureLandingPagesSchema() {
  if (!_db.hasDb()) return;
  const p = _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS landing_pages (
      id           SERIAL PRIMARY KEY,
      tenant_id    INT NOT NULL REFERENCES tenants(id),
      brand        TEXT,
      title        TEXT NOT NULL,
      goal         TEXT,
      audience     TEXT,
      brief        TEXT,
      content      JSONB NOT NULL DEFAULT '{}'::jsonb,
      html         TEXT NOT NULL,
      generated_by TEXT,
      webhook_url  TEXT,
      views        INT NOT NULL DEFAULT 0,
      conversions  INT NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_lp_tenant  ON landing_pages(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_lp_created ON landing_pages(created_at DESC);

    CREATE TABLE IF NOT EXISTS landing_page_ab_variants (
      id           SERIAL PRIMARY KEY,
      tenant_id    INT NOT NULL REFERENCES tenants(id),
      page_id      INT NOT NULL REFERENCES landing_pages(id) ON DELETE CASCADE,
      variant_name VARCHAR(50) NOT NULL DEFAULT 'B',
      angle        TEXT,
      html         TEXT NOT NULL,
      content      JSONB NOT NULL DEFAULT '{}'::jsonb,
      views        INT NOT NULL DEFAULT 0,
      conversions  INT NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_lpab_page ON landing_page_ab_variants(page_id);

    CREATE TABLE IF NOT EXISTS landing_page_leads (
      id         SERIAL PRIMARY KEY,
      tenant_id  INT NOT NULL REFERENCES tenants(id),
      page_id    INT NOT NULL REFERENCES landing_pages(id) ON DELETE CASCADE,
      name       TEXT,
      email      TEXT,
      message    TEXT,
      variant    CHAR(1) NOT NULL DEFAULT 'a',
      data       JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_lpl_page    ON landing_page_leads(page_id);
    CREATE INDEX IF NOT EXISTS idx_lpl_created ON landing_page_leads(created_at DESC);
  `);
  await p.query(`ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS tenant_id    INT REFERENCES tenants(id)`).catch(()=>{});
  await p.query(`ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS webhook_url  TEXT`).catch(()=>{});
  await p.query(`ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS views        INT NOT NULL DEFAULT 0`).catch(()=>{});
  await p.query(`ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS conversions  INT NOT NULL DEFAULT 0`).catch(()=>{});
  console.log('[landing-pages] schema ready');
}
module.exports = { ensureLandingPagesSchema };
