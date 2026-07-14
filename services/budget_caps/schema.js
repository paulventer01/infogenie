const _db = require('../../db');

async function ensureBudgetCapsSchema() {
  if (!_db.hasDb()) return;
  const p = _db.getPool();

  await p.query(`
    CREATE TABLE IF NOT EXISTS platform_budget_caps (
      id                  SERIAL PRIMARY KEY,
      tenant_id           INT NOT NULL REFERENCES tenants(id),
      platform            TEXT NOT NULL,
      daily_cap           NUMERIC(12,2),
      lifetime_cap        NUMERIC(12,2),
      alert_threshold_pct INT NOT NULL DEFAULT 80,
      paused_at_limit     BOOLEAN NOT NULL DEFAULT false,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(tenant_id, platform)
    );
  `);

  await p.query(`
    ALTER TABLE ad_campaigns
      ADD COLUMN IF NOT EXISTS lifetime_budget NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS total_spend     NUMERIC(12,2) NOT NULL DEFAULT 0;
  `).catch(() => {});
}

module.exports = { ensureBudgetCapsSchema };
