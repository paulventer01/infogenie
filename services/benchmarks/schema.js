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
      -- GLOBAL by design: anonymised cross-customer network percentiles.
      -- UNIQUE(vertical, region, company_size, metric_key) has no tenant.
      -- Rebuilt from ALL benchmark_submissions (that table stays tenant-scoped).
      -- Do not add tenant_id — it would destroy the data-moat.
      id SERIAL PRIMARY KEY,
      vertical VARCHAR(100) NOT NULL,
      region VARCHAR(100),
      company_size VARCHAR(50),
      metric_key VARCHAR(100) NOT NULL,
      p25 NUMERIC(18,4),
      median NUMERIC(18,4),
      p75 NUMERIC(18,4),
      sample_count INT DEFAULT 0,
      -- contributor_count: COUNT(DISTINCT tenant_id) of submissions in this bucket.
      -- sample_count remains raw submission rows. Reads must require contributor_count >= 5.
      -- Default 0 fail-closes unpublished buckets until rebuild (no backfill by guessing).
      contributor_count INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(vertical, region, company_size, metric_key)
    );
  `);
  await p.query(`
    ALTER TABLE benchmark_aggregates
      ADD COLUMN IF NOT EXISTS contributor_count INT NOT NULL DEFAULT 0
  `);
}

module.exports = { ensureBenchmarksSchema };
