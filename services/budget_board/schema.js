const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');
const hasDb = () => _db.hasDb();
const pool = { query: (...a) => _db.getPool().query(...a) };

async function ensureBudgetSchema() {
  if (!hasDb()) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS budgets (
      id             TEXT PRIMARY KEY,
      period_month   TEXT NOT NULL,
      target_cents   BIGINT NOT NULL DEFAULT 0,
      by_channel     JSONB NOT NULL DEFAULT '{}'::jsonb,
      project_id     TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS spend_events (
      id             BIGSERIAL PRIMARY KEY,
      channel        TEXT NOT NULL,
      amount_cents   BIGINT NOT NULL,
      occurred_at    DATE NOT NULL DEFAULT CURRENT_DATE,
      source         TEXT DEFAULT '',
      project_id     TEXT,
      notes          TEXT DEFAULT '',
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_spend_when ON spend_events(occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_spend_channel ON spend_events(channel);
  `);
  // Phase 2B — add tenant_id and rewrite the per-month uniqueness to be per-tenant.
  await addTenantIdColumn('budgets');
  await addTenantIdColumn('spend_events');
  try {
    await pool.query(`DROP INDEX IF EXISTS uniq_budget_period_proj`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_budget_tenant_period_proj
      ON budgets (tenant_id, period_month, COALESCE(project_id,''))`);
  } catch (e) { console.warn('[budgets] index rewrite skipped:', e.message); }
}
module.exports = { ensureBudgetSchema };
