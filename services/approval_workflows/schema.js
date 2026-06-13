const _db = require('../../db');

async function ensureApprovalWorkflowsSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS approval_policies (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      name VARCHAR(255) NOT NULL,
      action_types TEXT NOT NULL,
      budget_threshold NUMERIC(12,2),
      channels TEXT,
      notify_email VARCHAR(320),
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_approval_policies_tenant ON approval_policies(tenant_id);
    CREATE TABLE IF NOT EXISTS approval_requests (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      policy_id INT REFERENCES approval_policies(id),
      action_type VARCHAR(80) NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      proposed_by VARCHAR(255),
      budget_impact NUMERIC(12,2),
      channel VARCHAR(60),
      simulation_result TEXT,
      status VARCHAR(30) DEFAULT 'pending',
      reviewer_notes TEXT,
      approved_at TIMESTAMPTZ,
      executed_at TIMESTAMPTZ,
      rolled_back_at TIMESTAMPTZ,
      rollback_reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_approval_requests_tenant ON approval_requests(tenant_id, created_at DESC);
  `);
}

module.exports = { ensureApprovalWorkflowsSchema };
