const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');

async function ensureAutoclawSchema() {
  if (!_db.hasDb()) return false;
  const p = _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS autoclaw_settings (
      tenant_id       INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
      gateway_url     TEXT,
      hooks_token     TEXT,
      endpoint_mode   TEXT DEFAULT 'auto',
      preferred_model TEXT DEFAULT 'glm-5.2',
      enabled         BOOLEAN DEFAULT false,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS autoclaw_tasks (
      id              BIGSERIAL PRIMARY KEY,
      tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      source          TEXT NOT NULL DEFAULT 'infogenie',
      task_type       TEXT,
      message         TEXT NOT NULL,
      status          TEXT DEFAULT 'dispatched',
      gateway_url     TEXT,
      response        JSONB,
      error           TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_autoclaw_tasks_tenant_time
      ON autoclaw_tasks(tenant_id, created_at DESC);
  `);
  try { await addTenantIdColumn('autoclaw_tasks'); } catch (e) { /* column exists */ }
  return true;
}

module.exports = { ensureAutoclawSchema };
