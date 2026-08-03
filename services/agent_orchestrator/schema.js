const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');

async function ensureAgentOrchestratorSchema() {
  if (!_db.hasDb()) return false;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS agent_orchestrator_runs (
      id              TEXT PRIMARY KEY,
      tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      module          TEXT NOT NULL,
      kind            TEXT NOT NULL,
      input           JSONB NOT NULL DEFAULT '{}',
      result          JSONB NOT NULL DEFAULT '{}',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_agent_orch_tenant_time
      ON agent_orchestrator_runs(tenant_id, created_at DESC);
  `);
  try { await addTenantIdColumn('agent_orchestrator_runs'); } catch (_) { /* idempotent */ }
  return true;
}

module.exports = { ensureAgentOrchestratorSchema };
