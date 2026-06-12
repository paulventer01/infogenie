const _db = require('../../db');

async function ensureBrandSafetySchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS brand_safety_checks (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      check_type VARCHAR(50) NOT NULL,
      content_snippet TEXT NOT NULL,
      vertical VARCHAR(100),
      jurisdictions TEXT[],
      results JSONB NOT NULL DEFAULT '{}',
      overall_verdict VARCHAR(20),
      risk_score INT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

module.exports = { ensureBrandSafetySchema };
