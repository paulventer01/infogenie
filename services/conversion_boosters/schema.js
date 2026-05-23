const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');

async function ensureConversionBoostersSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool();
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cb_widgets (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      owner_email TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS cb_events (
      id BIGSERIAL PRIMARY KEY,
      widget_id TEXT NOT NULL REFERENCES cb_widgets(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      email TEXT,
      data JSONB,
      ip_hash TEXT,
      ua TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_cb_events_widget ON cb_events(widget_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cb_events_type ON cb_events(widget_id, event_type);
  `);
  await addTenantIdColumn('cb_widgets');
  await addTenantIdColumn('cb_events');
}

module.exports = { ensureConversionBoostersSchema };
