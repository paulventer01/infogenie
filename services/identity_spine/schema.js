const _db = require('../../db');

async function ensureIdentitySpineSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS identity_profiles (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      email VARCHAR(320),
      name VARCHAR(255),
      phone VARCHAR(50),
      company VARCHAR(255),
      source_channels TEXT,
      lifecycle_stage VARCHAR(40) DEFAULT 'unknown',
      ltv_score NUMERIC(10,2) DEFAULT 0,
      propensity_score NUMERIC(5,2) DEFAULT 0,
      next_best_action TEXT,
      tags TEXT,
      last_seen_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_identity_profiles_tenant ON identity_profiles(tenant_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS identity_events (
      id SERIAL PRIMARY KEY,
      profile_id INT REFERENCES identity_profiles(id) ON DELETE CASCADE,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      event_type VARCHAR(80),
      channel VARCHAR(60),
      properties TEXT,
      occurred_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_identity_events_profile ON identity_events(profile_id, occurred_at DESC);
  `);
}

module.exports = { ensureIdentitySpineSchema };
