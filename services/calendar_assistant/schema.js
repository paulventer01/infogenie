const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');

async function ensureCalendarAssistantSchema() {
  if (!_db.hasDb()) return false;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS calendar_assistant_runs (
      id              TEXT PRIMARY KEY,
      tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      kind            TEXT NOT NULL,
      input           JSONB NOT NULL DEFAULT '{}',
      result          JSONB NOT NULL DEFAULT '{}',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_cal_asst_tenant_time
      ON calendar_assistant_runs(tenant_id, created_at DESC);
  `);
  try { await addTenantIdColumn('calendar_assistant_runs'); } catch (_) { /* idempotent */ }
  return true;
}

module.exports = { ensureCalendarAssistantSchema };
