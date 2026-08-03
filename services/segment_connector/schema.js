const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');

async function ensureSegmentSchema() {
  if (!_db.hasDb()) return false;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS segment_event_log (
      id              TEXT PRIMARY KEY,
      tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      event_name      TEXT NOT NULL,
      user_id         TEXT,
      anonymous_id    TEXT,
      properties      JSONB NOT NULL DEFAULT '{}',
      status          TEXT NOT NULL DEFAULT 'queued',
      response        JSONB,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_segment_log_tenant_time
      ON segment_event_log(tenant_id, created_at DESC);
  `);
  try { await addTenantIdColumn('segment_event_log'); } catch (_) { /* idempotent */ }
  return true;
}

module.exports = { ensureSegmentSchema };
