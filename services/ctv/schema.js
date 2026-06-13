const _db = require('../../db');

async function ensureCtvSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS ctv_campaigns (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      name VARCHAR(255) NOT NULL,
      platform VARCHAR(60) NOT NULL,
      campaign_type VARCHAR(40) NOT NULL,
      objective VARCHAR(80),
      budget NUMERIC(12,2),
      daily_budget NUMERIC(12,2),
      targeting TEXT,
      creative_brief TEXT,
      ad_copy TEXT,
      status VARCHAR(20) DEFAULT 'draft',
      projected_reach INT,
      projected_cpm NUMERIC(8,2),
      start_date DATE,
      end_date DATE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_ctv_campaigns_tenant ON ctv_campaigns(tenant_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS ctv_performance (
      id SERIAL PRIMARY KEY,
      campaign_id INT REFERENCES ctv_campaigns(id) ON DELETE CASCADE,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      impressions INT DEFAULT 0,
      reach INT DEFAULT 0,
      frequency NUMERIC(6,2),
      completion_rate NUMERIC(6,2),
      cost NUMERIC(12,2),
      cpm NUMERIC(8,2),
      date_recorded DATE DEFAULT CURRENT_DATE
    );
    CREATE INDEX IF NOT EXISTS idx_ctv_perf_campaign ON ctv_performance(campaign_id, date_recorded DESC);
  `);
}

module.exports = { ensureCtvSchema };
