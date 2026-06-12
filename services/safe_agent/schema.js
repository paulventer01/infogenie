const _db = require('../../db');

async function ensureSafeAgentSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS safe_agent_proposals (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      title VARCHAR(300) NOT NULL,
      proposal JSONB NOT NULL DEFAULT '{}',
      simulation JSONB NOT NULL DEFAULT '{}',
      status VARCHAR(30) NOT NULL DEFAULT 'pending_approval',
      approved_by INT REFERENCES users(id),
      approved_at TIMESTAMPTZ,
      executed_at TIMESTAMPTZ,
      rolled_back_at TIMESTAMPTZ,
      rollback_reason TEXT,
      outcome JSONB DEFAULT '{}',
      budget_guardrail NUMERIC(12,2),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS safe_agent_audit_log (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      proposal_id INT REFERENCES safe_agent_proposals(id),
      event VARCHAR(50) NOT NULL,
      actor_id INT REFERENCES users(id),
      detail JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

module.exports = { ensureSafeAgentSchema };
