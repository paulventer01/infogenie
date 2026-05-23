const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');

async function ensureAlertRoutingSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS alert_rules (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT true,
      trigger_kind TEXT NOT NULL,
      trigger_filter JSONB NOT NULL DEFAULT '{}'::jsonb,
      channels JSONB NOT NULL DEFAULT '[]'::jsonb,
      last_fired_at TIMESTAMPTZ,
      fire_count INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS alert_dispatches (
      id SERIAL PRIMARY KEY,
      rule_id INT REFERENCES alert_rules(id) ON DELETE CASCADE,
      event_kind TEXT NOT NULL,
      event_ref JSONB NOT NULL DEFAULT '{}'::jsonb,
      channels_sent JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_alert_rules_kind_enabled ON alert_rules(trigger_kind, enabled);
    CREATE INDEX IF NOT EXISTS idx_alert_dispatches_rule_created ON alert_dispatches(rule_id, created_at DESC);
  `);
  await addTenantIdColumn('alert_rules');
  await addTenantIdColumn('alert_dispatches');
  console.log('[alert-routing] schema ready');
}

module.exports = { ensureAlertRoutingSchema };
