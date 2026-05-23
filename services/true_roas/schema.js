// T36 — True ROAS schema
// offline_conversions: revenue closed in CRM/warehouse, attributed back to a paid channel.
// true_roas_settings: 1-row JSONB blob (in kv_store) for thresholds + sync state.

const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');

async function ensureTrueRoasSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool();
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS offline_conversions (
      id BIGSERIAL PRIMARY KEY,
      source TEXT NOT NULL,
      source_deal_id TEXT,
      email TEXT,
      click_id TEXT,
      platform TEXT,
      revenue_cents BIGINT NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      lead_created_at TIMESTAMPTZ,
      closed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      raw JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (source, source_deal_id)
    );
    CREATE INDEX IF NOT EXISTS idx_oc_closed   ON offline_conversions (closed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_oc_platform ON offline_conversions (platform, closed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_oc_email    ON offline_conversions (lower(email));
  `);

  try { await addTenantIdColumn('offline_conversions'); }
  catch (e) { console.error('[true-roas] addTenantIdColumn:', e.message); }

  // The legacy UNIQUE (source, source_deal_id) would block two tenants from
  // both syncing the same HubSpot deal id. Create the tenant-scoped UNIQUE
  // FIRST so dedup never lapses during rollout, then drop the legacy one.
  try {
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_oc_tenant_source_deal
                        ON offline_conversions (tenant_id, source, source_deal_id)`);
    await pool.query(`ALTER TABLE offline_conversions
                        DROP CONSTRAINT IF EXISTS offline_conversions_source_source_deal_id_key`);
  } catch (e) { console.error('[true-roas] uniq migrate:', e.message); }
}

module.exports = { ensureTrueRoasSchema };
