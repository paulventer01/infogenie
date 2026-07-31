const _db = require('../../db');

async function ensureDecisionEngineSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS decision_recommendations (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      category VARCHAR(60) NOT NULL,
      title VARCHAR(255) NOT NULL,
      recommendation TEXT NOT NULL,
      expected_impact VARCHAR(255),
      confidence_pct INT DEFAULT 0,
      cost_estimate VARCHAR(100),
      time_to_result VARCHAR(100),
      priority_score NUMERIC(6,2) DEFAULT 0,
      data_sources TEXT,
      why_best TEXT,
      acted_at TIMESTAMPTZ,
      dismissed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_decision_rec_tenant ON decision_recommendations(tenant_id, created_at DESC);
  `);
  // Additive migration for existing installs
  await p.query(`ALTER TABLE decision_recommendations ADD COLUMN IF NOT EXISTS why_best TEXT`).catch(() => {});
}

module.exports = { ensureDecisionEngineSchema };
