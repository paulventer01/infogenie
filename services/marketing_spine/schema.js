const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');

async function ensureMarketingSpineSchema() {
  if (!_db.hasDb()) return false;
  const p = _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS marketing_spine_events (
      id              TEXT PRIMARY KEY,
      tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      source          TEXT NOT NULL,
      event_type      TEXT NOT NULL,
      entity_key      TEXT,
      payload         JSONB NOT NULL DEFAULT '{}',
      occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_spine_events_tenant_time
      ON marketing_spine_events(tenant_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_spine_events_entity
      ON marketing_spine_events(tenant_id, entity_key);

    CREATE TABLE IF NOT EXISTS marketing_actions (
      id              TEXT PRIMARY KEY,
      tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      source          TEXT NOT NULL,
      action_type     TEXT NOT NULL,
      title           TEXT NOT NULL,
      rationale       TEXT,
      priority        TEXT NOT NULL DEFAULT 'medium',
      status          TEXT NOT NULL DEFAULT 'suggested',
      target_system   TEXT,
      target_payload  JSONB NOT NULL DEFAULT '{}',
      source_ref      JSONB NOT NULL DEFAULT '{}',
      result          JSONB,
      error           TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      applied_at      TIMESTAMPTZ,
      dismissed_at    TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_marketing_actions_tenant_status
      ON marketing_actions(tenant_id, status, created_at DESC);

    CREATE TABLE IF NOT EXISTS marketing_spine_runs (
      id              TEXT PRIMARY KEY,
      tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      kind            TEXT NOT NULL,
      input           JSONB NOT NULL DEFAULT '{}',
      result          JSONB NOT NULL DEFAULT '{}',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_spine_runs_tenant_time
      ON marketing_spine_runs(tenant_id, created_at DESC);
  `);
  for (const t of ['marketing_spine_events', 'marketing_actions', 'marketing_spine_runs']) {
    try { await addTenantIdColumn(t); } catch (_) { /* idempotent */ }
  }
  return true;
}

module.exports = { ensureMarketingSpineSchema };
