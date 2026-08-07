const crypto = require('crypto');
const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');

async function ensureAiGovernanceSchema() {
  if (!_db.hasDb()) return false;
  const p = _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS ai_governance_policies (
      id               TEXT PRIMARY KEY,
      tenant_id        INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      default_mode     TEXT NOT NULL DEFAULT 'shadow',
      risk_appetite    TEXT NOT NULL DEFAULT 'aggressive',
      action_tiers     JSONB NOT NULL DEFAULT '{}',
      block_on_caution BOOLEAN NOT NULL DEFAULT false,
      require_context  BOOLEAN NOT NULL DEFAULT false,
      policy_document  TEXT,
      policy_version   INTEGER NOT NULL DEFAULT 1,
      ethics_contact   TEXT,
      updated_by       INTEGER REFERENCES users(id),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (tenant_id)
    );

    CREATE TABLE IF NOT EXISTS ai_governance_events (
      id              TEXT PRIMARY KEY,
      tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      user_id         INTEGER REFERENCES users(id),
      surface         TEXT NOT NULL,
      action          TEXT NOT NULL,
      execution_tier  TEXT,
      status          TEXT NOT NULL,
      context_pack_id TEXT,
      input_hash      TEXT,
      output_preview  TEXT,
      block_reason    TEXT,
      warnings        JSONB NOT NULL DEFAULT '[]',
      meta            JSONB NOT NULL DEFAULT '{}',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolved_at     TIMESTAMPTZ,
      resolved_by     INTEGER REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_ai_gov_events_tenant_time
      ON ai_governance_events(tenant_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_gov_events_status
      ON ai_governance_events(tenant_id, status);

    CREATE TABLE IF NOT EXISTS ai_governance_output_checks (
      id                   TEXT PRIMARY KEY,
      tenant_id            INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      governance_event_id  TEXT REFERENCES ai_governance_events(id) ON DELETE SET NULL,
      check_type           TEXT NOT NULL,
      verdict              TEXT NOT NULL,
      risk_score           INTEGER,
      detail               JSONB,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_ai_gov_checks_event
      ON ai_governance_output_checks(governance_event_id);
  `);
  try { await addTenantIdColumn('ai_governance_policies'); } catch (_) { /* idempotent */ }
  try { await addTenantIdColumn('ai_governance_events'); } catch (_) { /* idempotent */ }
  try { await addTenantIdColumn('ai_governance_output_checks'); } catch (_) { /* idempotent */ }
  return true;
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

module.exports = { ensureAiGovernanceSchema, newId };
