const _db = require('../../db');

async function ensureAgentSwarmSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS swarm_configs (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      name VARCHAR(255) NOT NULL,
      description TEXT,
      trigger_event VARCHAR(80) NOT NULL,
      trigger_conditions TEXT,
      agent_chain TEXT NOT NULL,
      notification_email VARCHAR(320),
      is_active BOOLEAN DEFAULT TRUE,
      run_count INT DEFAULT 0,
      last_run_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_swarm_configs_tenant ON swarm_configs(tenant_id, is_active);
    CREATE TABLE IF NOT EXISTS swarm_runs (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      config_id INT REFERENCES swarm_configs(id) ON DELETE SET NULL,
      config_name VARCHAR(255),
      trigger_event VARCHAR(80),
      trigger_data TEXT,
      status VARCHAR(20) DEFAULT 'running',
      steps_completed INT DEFAULT 0,
      steps_total INT DEFAULT 0,
      summary TEXT,
      started_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_swarm_runs_tenant ON swarm_runs(tenant_id, started_at DESC);
    CREATE TABLE IF NOT EXISTS swarm_steps (
      id SERIAL PRIMARY KEY,
      run_id INT NOT NULL REFERENCES swarm_runs(id) ON DELETE CASCADE,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      step_order INT NOT NULL,
      step_name VARCHAR(120),
      agent_type VARCHAR(60),
      input_summary TEXT,
      output_summary TEXT,
      status VARCHAR(20) DEFAULT 'pending',
      executed_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_swarm_steps_run ON swarm_steps(run_id, step_order);
  `);
}

module.exports = { ensureAgentSwarmSchema };
