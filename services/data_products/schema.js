const _db = require('../../db');

async function ensureDataProductsSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS creative_performance (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      format VARCHAR(60),
      hook_type VARCHAR(80),
      cta_type VARCHAR(80),
      channel VARCHAR(60),
      ctr NUMERIC(8,4),
      cvr NUMERIC(8,4),
      roas NUMERIC(8,2),
      industry VARCHAR(100),
      submitted_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS offer_benchmark_data (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      offer_type VARCHAR(80),
      pricing_model VARCHAR(80),
      free_trial BOOLEAN,
      trial_days INT,
      guarantee VARCHAR(80),
      onboarding_type VARCHAR(80),
      cvr NUMERIC(8,4),
      industry VARCHAR(100),
      submitted_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS emerging_signals (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      signal_type VARCHAR(60),
      title VARCHAR(255),
      description TEXT,
      category VARCHAR(80),
      confidence_score INT DEFAULT 0,
      source VARCHAR(80),
      detected_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_emerging_signals_tenant ON emerging_signals(tenant_id, detected_at DESC);
  `);
}

module.exports = { ensureDataProductsSchema };
