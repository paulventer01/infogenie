const _db = require('../../db');

async function ensureExperimentSuiteSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS experiments (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      name VARCHAR(255) NOT NULL,
      type VARCHAR(40) NOT NULL,
      hypothesis TEXT,
      control_group TEXT,
      variant_group TEXT,
      channels TEXT,
      budget_split VARCHAR(100),
      start_date DATE,
      end_date DATE,
      status VARCHAR(20) DEFAULT 'draft',
      outcome TEXT,
      lift_pct NUMERIC(8,2),
      confidence_pct INT,
      p_value NUMERIC(8,4),
      institutional_learning TEXT,
      ai_analysis TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_experiments_tenant ON experiments(tenant_id, created_at DESC);
  `);
}

module.exports = { ensureExperimentSuiteSchema };
