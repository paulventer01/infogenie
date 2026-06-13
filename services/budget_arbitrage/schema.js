const _db = require('../../db');

async function ensureBudgetArbitrageSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS budget_arb_rules (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      name VARCHAR(255) NOT NULL,
      platforms TEXT NOT NULL,
      total_daily_budget NUMERIC(12,2) NOT NULL,
      min_platform_budget NUMERIC(12,2) DEFAULT 10,
      max_shift_pct INT DEFAULT 30,
      reallocation_logic VARCHAR(60) DEFAULT 'roas_weighted',
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_budget_arb_rules_tenant ON budget_arb_rules(tenant_id);
    CREATE TABLE IF NOT EXISTS budget_arb_history (
      id SERIAL PRIMARY KEY,
      rule_id INT REFERENCES budget_arb_rules(id) ON DELETE SET NULL,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      input_metrics TEXT,
      analysis TEXT,
      recommended_shifts TEXT,
      total_shifted NUMERIC(12,2) DEFAULT 0,
      projected_roas_uplift NUMERIC(6,2),
      is_executed BOOLEAN DEFAULT FALSE,
      executed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_budget_arb_history_tenant ON budget_arb_history(tenant_id, created_at DESC);
  `);
}

module.exports = { ensureBudgetArbitrageSchema };
