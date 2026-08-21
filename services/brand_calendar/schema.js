const _db = require('../../db');
const { enforceTenantIdNotNull } = require('../tenants/migration');
const hasDb = () => _db.hasDb();
const pool = { query: (...a) => _db.getPool().query(...a) };

async function ensureBrandCalendarSchema() {
  if (!hasDb()) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS brand_calendar_items (
      id           TEXT PRIMARY KEY,
      tenant_id    INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      category     TEXT NOT NULL,
      title        TEXT NOT NULL,
      scheduled_at TIMESTAMPTZ NOT NULL,
      notes        TEXT DEFAULT '',
      project_id   TEXT,
      status       TEXT NOT NULL DEFAULT 'planned',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_bcal_when ON brand_calendar_items(scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_bcal_cat  ON brand_calendar_items(category);
  `);
  await enforceTenantIdNotNull('brand_calendar_items');
}
module.exports = { ensureBrandCalendarSchema };
