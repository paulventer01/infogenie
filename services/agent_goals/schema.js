const _db = require('../../db');
async function ensureAgentGoalsSchema() {
  if (!_db.hasDb()) return;
  const p = _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS agent_goals (
      id               SERIAL PRIMARY KEY,
      tenant_id        INT NOT NULL REFERENCES tenants(id),
      title            TEXT NOT NULL,
      description      TEXT,
      success_criteria TEXT,
      deadline         DATE,
      status           TEXT NOT NULL DEFAULT 'active',
      progress_pct     INT NOT NULL DEFAULT 0,
      ai_plan          JSONB NOT NULL DEFAULT '[]',
      last_evaluation  JSONB,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS agent_tasks (
      id          SERIAL PRIMARY KEY,
      tenant_id   INT NOT NULL REFERENCES tenants(id),
      goal_id     INT NOT NULL REFERENCES agent_goals(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      description TEXT,
      action_type TEXT NOT NULL DEFAULT 'manual',
      priority    INT NOT NULL DEFAULT 2,
      status      TEXT NOT NULL DEFAULT 'pending',
      due_date    DATE,
      completed_at TIMESTAMPTZ,
      notes       TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_agent_goals_tenant ON agent_goals(tenant_id)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_agent_tasks_goal ON agent_tasks(goal_id)`);
  console.log('[agent-goals] schema ready');
}
module.exports = { ensureAgentGoalsSchema };
