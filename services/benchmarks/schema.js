const _db = require('../../db');

async function ensureBenchmarksSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS benchmark_submissions (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      vertical VARCHAR(100) NOT NULL,
      region VARCHAR(100),
      company_size VARCHAR(50),
      metric_key VARCHAR(100) NOT NULL,
      metric_value NUMERIC(18,4) NOT NULL,
      currency VARCHAR(10) DEFAULT 'USD',
      submitted_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS benchmark_aggregates (
      id SERIAL PRIMARY KEY,
      vertical VARCHAR(100) NOT NULL,
      region VARCHAR(100),
      company_size VARCHAR(50),
      metric_key VARCHAR(100) NOT NULL,
      p25 NUMERIC(18,4),
      median NUMERIC(18,4),
      p75 NUMERIC(18,4),
      sample_count INT DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(vertical, region, company_size, metric_key)
    );
  `);
}

module.exports = { ensureBenchmarksSchema };
