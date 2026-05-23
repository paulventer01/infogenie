const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');

async function ensureWeeklyReportSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool();
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS weekly_report_subs (
      id SERIAL PRIMARY KEY,
      brand TEXT NOT NULL,
      email TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_sent_at TIMESTAMPTZ,
      UNIQUE (brand, email)
    );
    CREATE TABLE IF NOT EXISTS weekly_report_runs (
      id SERIAL PRIMARY KEY,
      brand TEXT NOT NULL,
      sections_count INTEGER NOT NULL DEFAULT 0,
      sent_to TEXT,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_wr_subs_brand ON weekly_report_subs(brand);
    CREATE INDEX IF NOT EXISTS idx_wr_runs_brand ON weekly_report_runs(brand, generated_at DESC);
  `);

  for (const t of ['weekly_report_subs', 'weekly_report_runs']) {
    try { await addTenantIdColumn(t); }
    catch (e) { console.error(`[weekly-report] addTenantIdColumn ${t}: ${e.message}`); }
  }

  // Tenant-scoped sub uniqueness so two tenants can each subscribe the same
  // email to the same brand label. Create new UNIQUE first; drop legacy after.
  try {
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_wr_subs_tenant_brand_email
                        ON weekly_report_subs (tenant_id, brand, email)`);
    await pool.query(`ALTER TABLE weekly_report_subs
                        DROP CONSTRAINT IF EXISTS weekly_report_subs_brand_email_key`);
  } catch (e) { console.error('[weekly-report] uniq migrate:', e.message); }
}

module.exports = { ensureWeeklyReportSchema };
