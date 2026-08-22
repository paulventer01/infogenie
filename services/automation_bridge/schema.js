'use strict';

const _db = require('../../db');

async function ensureAutomationBridgeSchema() {
  if (!_db.hasDb()) return false;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS automation_bridge_targets (
      id            SERIAL PRIMARY KEY,
      tenant_id     INTEGER NOT NULL,
      provider      TEXT NOT NULL,
      name          TEXT NOT NULL,
      target_url    TEXT NOT NULL,
      secret        TEXT,
      triggers      JSONB DEFAULT '[]'::jsonb,
      enabled       BOOLEAN DEFAULT TRUE,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_auto_bridge_targets_tid ON automation_bridge_targets(tenant_id)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS automation_bridge_inbound (
      id            SERIAL PRIMARY KEY,
      tenant_id     INTEGER NOT NULL,
      token         TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL DEFAULT 'Default inbound',
      enabled       BOOLEAN DEFAULT TRUE,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS automation_bridge_deliveries (
      id            SERIAL PRIMARY KEY,
      tenant_id     INTEGER NOT NULL,
      direction     TEXT NOT NULL,
      provider      TEXT,
      event_type    TEXT,
      status        TEXT NOT NULL,
      payload_json  JSONB DEFAULT '{}'::jsonb,
      response_text TEXT,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_auto_bridge_del_tid ON automation_bridge_deliveries(tenant_id, created_at DESC)`);
  return true;
}

module.exports = { ensureAutomationBridgeSchema };
