const _db = require('../../db');

async function ensurePixelManagerSchema() {
  if (!_db.hasDb()) return;
  const p = _db.getPool();

  await p.query(`
    CREATE TABLE IF NOT EXISTS pixel_configs (
      id          SERIAL PRIMARY KEY,
      tenant_id   INT NOT NULL REFERENCES tenants(id),
      platform    TEXT NOT NULL,
      pixel_id    TEXT NOT NULL,
      access_token TEXT,
      enabled     BOOLEAN NOT NULL DEFAULT true,
      test_result JSONB,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(tenant_id, platform)
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS capi_event_log (
      id         SERIAL PRIMARY KEY,
      tenant_id  INT NOT NULL REFERENCES tenants(id),
      platform   TEXT NOT NULL,
      event_name TEXT NOT NULL,
      payload    JSONB,
      status     TEXT NOT NULL DEFAULT 'queued',
      response   JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

module.exports = { ensurePixelManagerSchema };
