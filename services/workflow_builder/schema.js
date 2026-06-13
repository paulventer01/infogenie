const _db = require('../../db');

async function ensureWorkflowBuilderSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS wf_workflows (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      name VARCHAR(255) NOT NULL,
      description TEXT,
      trigger_type VARCHAR(60) NOT NULL,
      trigger_config TEXT,
      nodes TEXT NOT NULL DEFAULT '[]',
      is_active BOOLEAN DEFAULT FALSE,
      run_count INT DEFAULT 0,
      success_count INT DEFAULT 0,
      fail_count INT DEFAULT 0,
      last_run_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_wf_workflows_tenant ON wf_workflows(tenant_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS wf_runs (
      id SERIAL PRIMARY KEY,
      workflow_id INT NOT NULL REFERENCES wf_workflows(id) ON DELETE CASCADE,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      trigger_data TEXT,
      status VARCHAR(20) DEFAULT 'running',
      steps_log TEXT DEFAULT '[]',
      error_message TEXT,
      started_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_wf_runs_workflow ON wf_runs(workflow_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_wf_runs_tenant ON wf_runs(tenant_id, started_at DESC);
  `);
}

module.exports = { ensureWorkflowBuilderSchema };
