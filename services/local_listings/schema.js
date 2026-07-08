const _db = require('../../db');

async function ensureLocalListingsSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS business_listing_profile (
      tenant_id INT PRIMARY KEY REFERENCES tenants(id),
      business_name TEXT NOT NULL,
      address TEXT NOT NULL,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      zip TEXT NOT NULL,
      phone TEXT,
      website TEXT,
      hours JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS listing_sync_status (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      platform TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unknown',
      detected_data JSONB,
      discrepancies JSONB,
      last_checked TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, platform)
    );
  `);
}

module.exports = { ensureLocalListingsSchema };
