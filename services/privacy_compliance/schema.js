const _db = require('../../db');

async function ensurePrivacyComplianceSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS privacy_checks (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      check_type VARCHAR(60) NOT NULL,
      jurisdiction TEXT,
      input_count INT DEFAULT 0,
      flagged_count INT DEFAULT 0,
      cleaned_count INT DEFAULT 0,
      risk_level VARCHAR(20),
      summary TEXT,
      issues TEXT,
      recommendations TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_privacy_checks_tenant ON privacy_checks(tenant_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS consent_records (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      email VARCHAR(320),
      phone_hash VARCHAR(128),
      channels_consented TEXT,
      jurisdiction VARCHAR(40),
      consent_source VARCHAR(80),
      consent_date TIMESTAMPTZ,
      expiry_date TIMESTAMPTZ,
      is_withdrawn BOOLEAN DEFAULT FALSE,
      withdrawn_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_consent_records_tenant ON consent_records(tenant_id, email);
  `);
}

module.exports = { ensurePrivacyComplianceSchema };
