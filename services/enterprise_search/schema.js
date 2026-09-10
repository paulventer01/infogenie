'use strict';

const _db = require('../../db');

async function ensureEnterpriseSearchSchema() {
  if (!_db.hasDb()) return false;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS enterprise_connector_sync (
      id            SERIAL PRIMARY KEY,
      tenant_id     INTEGER NOT NULL,
      connector     TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'idle',
      last_sync_at  TIMESTAMPTZ,
      items_synced  INTEGER DEFAULT 0,
      chunks_indexed INTEGER DEFAULT 0,
      error         TEXT,
      meta_json     JSONB DEFAULT '{}'::jsonb,
      updated_at    TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (tenant_id, connector)
    )
  `);
  return true;
}

module.exports = { ensureEnterpriseSearchSchema };
