const _db = require('../../db');

async function ensureSelfHealingSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS ad_rejections (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      platform VARCHAR(40) NOT NULL,
      ad_id VARCHAR(255),
      ad_name VARCHAR(255),
      rejection_reason TEXT,
      rejection_code VARCHAR(80),
      policy_violated VARCHAR(255),
      original_copy TEXT,
      original_headline VARCHAR(500),
      status VARCHAR(30) DEFAULT 'detected',
      heal_attempts INT DEFAULT 0,
      detected_at TIMESTAMPTZ DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_ad_rejections_tenant ON ad_rejections(tenant_id, detected_at DESC);
    CREATE TABLE IF NOT EXISTS heal_attempts (
      id SERIAL PRIMARY KEY,
      rejection_id INT NOT NULL REFERENCES ad_rejections(id) ON DELETE CASCADE,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      healed_headline VARCHAR(500),
      healed_copy TEXT,
      heal_strategy TEXT,
      policy_fixes TEXT,
      confidence_pct INT DEFAULT 0,
      platform_response VARCHAR(50),
      attempted_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_heal_attempts_rejection ON heal_attempts(rejection_id, attempted_at DESC);
  `);
}

module.exports = { ensureSelfHealingSchema };
