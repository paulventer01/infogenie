const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');

async function ensureDailyTrendsSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_traffic_snapshots (
      id BIGSERIAL PRIMARY KEY,
      tenant_id INT,
      domain TEXT NOT NULL,
      snapshot_date DATE NOT NULL,
      visits NUMERIC(14,2) NOT NULL DEFAULT 0,
      search NUMERIC(14,2) NOT NULL DEFAULT 0,
      social NUMERIC(14,2) NOT NULL DEFAULT 0,
      direct NUMERIC(14,2) NOT NULL DEFAULT 0,
      referral NUMERIC(14,2) NOT NULL DEFAULT 0,
      email NUMERIC(14,2) NOT NULL DEFAULT 0,
      paid NUMERIC(14,2) NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'estimate',
      raw JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(tenant_id, domain, snapshot_date)
    );
    CREATE INDEX IF NOT EXISTS idx_daily_traffic_domain_date
      ON daily_traffic_snapshots(tenant_id, domain, snapshot_date DESC);
  `);
  try { await addTenantIdColumn('daily_traffic_snapshots'); } catch (_) {}
  console.log('[daily-trends] schema ready');
}

module.exports = { ensureDailyTrendsSchema };
