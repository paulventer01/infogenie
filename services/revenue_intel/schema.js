const _db = require('../../db');

async function ensureRevenueIntelSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS revenue_accounts (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      company_name VARCHAR(255) NOT NULL,
      domain VARCHAR(255),
      industry VARCHAR(100),
      company_size VARCHAR(50),
      pipeline_stage VARCHAR(40) DEFAULT 'awareness',
      intent_score INT DEFAULT 0,
      engagement_score INT DEFAULT 0,
      pipeline_value NUMERIC(12,2) DEFAULT 0,
      owner_name VARCHAR(255),
      buying_committee TEXT,
      tags TEXT,
      last_activity_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_revenue_accounts_tenant ON revenue_accounts(tenant_id, intent_score DESC);
    CREATE TABLE IF NOT EXISTS revenue_signals (
      id SERIAL PRIMARY KEY,
      account_id INT REFERENCES revenue_accounts(id) ON DELETE CASCADE,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      signal_type VARCHAR(60),
      source VARCHAR(80),
      description TEXT,
      score_delta INT DEFAULT 0,
      occurred_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_revenue_signals_account ON revenue_signals(account_id, occurred_at DESC);
  `);
}

module.exports = { ensureRevenueIntelSchema };
