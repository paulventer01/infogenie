const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');

async function ensureWordpressSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS wordpress_sites (
      id           SERIAL PRIMARY KEY,
      tenant_id    INT NOT NULL REFERENCES tenants(id),
      name         TEXT NOT NULL,
      site_url     TEXT NOT NULL,
      username     TEXT NOT NULL,
      app_password TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'active',
      last_tested_at TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_wp_sites_tenant ON wordpress_sites(tenant_id, status);

    CREATE TABLE IF NOT EXISTS wordpress_publish_log (
      id         SERIAL PRIMARY KEY,
      tenant_id  INT NOT NULL REFERENCES tenants(id),
      site_id    INT REFERENCES wordpress_sites(id) ON DELETE SET NULL,
      wp_post_id INT,
      title      TEXT,
      status     TEXT,
      post_url   TEXT,
      source     TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_wp_log_tenant ON wordpress_publish_log(tenant_id, created_at DESC);
  `);
  console.log('[wordpress] schema ready');
}

module.exports = { ensureWordpressSchema };
