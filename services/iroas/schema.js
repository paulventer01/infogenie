const _db = require('../../db');
async function ensureIroasSchema() {
  if (!_db.hasDb()) return;
  const p = _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS iroas_tests (
      id                   SERIAL PRIMARY KEY,
      tenant_id            INT NOT NULL REFERENCES tenants(id),
      name                 TEXT NOT NULL,
      campaign_name        TEXT,
      channel              TEXT NOT NULL DEFAULT 'meta',
      holdout_pct          INT NOT NULL DEFAULT 10,
      start_date           DATE,
      end_date             DATE,
      test_reach           BIGINT NOT NULL DEFAULT 0,
      control_reach        BIGINT NOT NULL DEFAULT 0,
      test_conversions     INT NOT NULL DEFAULT 0,
      control_conversions  INT NOT NULL DEFAULT 0,
      test_spend           NUMERIC(14,2) NOT NULL DEFAULT 0,
      reported_revenue     NUMERIC(14,2) NOT NULL DEFAULT 0,
      avg_order_value      NUMERIC(10,2) NOT NULL DEFAULT 0,
      status               TEXT NOT NULL DEFAULT 'active',
      notes                TEXT,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await p.query(`CREATE TABLE IF NOT EXISTS iroas_saturation (
    id          SERIAL PRIMARY KEY,
    tenant_id   INT NOT NULL REFERENCES tenants(id),
    channel     TEXT NOT NULL,
    data_points JSONB NOT NULL DEFAULT '[]',
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_iroas_tenant ON iroas_tests(tenant_id)`);
  console.log('[iroas] schema ready');
}
module.exports = { ensureIroasSchema };
