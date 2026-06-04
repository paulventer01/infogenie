const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');

async function ensureContentModesSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS content_mode_runs (
      id         SERIAL PRIMARY KEY,
      tenant_id  INT NOT NULL REFERENCES tenants(id),
      mode       TEXT NOT NULL,
      keyword    TEXT,
      brand      TEXT,
      location   TEXT,
      result     JSONB NOT NULL DEFAULT '{}'::jsonb,
      source     TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_cm_runs_tenant ON content_mode_runs(tenant_id, created_at DESC);
  `);
  console.log('[content-modes] schema ready');
}

module.exports = { ensureContentModesSchema };
