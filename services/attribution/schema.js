const _db = require('../../db');

async function ensureAttributionSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS attribution_touchpoints (
      id           BIGSERIAL PRIMARY KEY,
      tenant_id    INT NOT NULL REFERENCES tenants(id),
      run_id       BIGINT NOT NULL,
      channel      TEXT NOT NULL,
      spend        NUMERIC(12,2) NOT NULL DEFAULT 0,
      impressions  BIGINT NOT NULL DEFAULT 0,
      clicks       BIGINT NOT NULL DEFAULT 0,
      leads        BIGINT NOT NULL DEFAULT 0,
      customers    BIGINT NOT NULL DEFAULT 0,
      revenue      NUMERIC(12,2) NOT NULL DEFAULT 0,
      position     INT NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_attr_tp_run ON attribution_touchpoints(run_id, position);
    CREATE INDEX IF NOT EXISTS idx_attr_tp_tenant ON attribution_touchpoints(tenant_id, run_id);

    CREATE TABLE IF NOT EXISTS attribution_runs (
      id             BIGSERIAL PRIMARY KEY,
      tenant_id      INT NOT NULL REFERENCES tenants(id),
      name           TEXT NOT NULL DEFAULT '',
      date_range     TEXT NOT NULL DEFAULT '',
      total_spend    NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_revenue  NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_leads    BIGINT NOT NULL DEFAULT 0,
      total_customers BIGINT NOT NULL DEFAULT 0,
      models         JSONB NOT NULL DEFAULT '{}',
      insights       JSONB NOT NULL DEFAULT '[]',
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_attr_runs_tenant ON attribution_runs(tenant_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS attribution_revenue_events (
      id           BIGSERIAL PRIMARY KEY,
      tenant_id    INT,
      email        TEXT,
      amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
      channel      TEXT NOT NULL DEFAULT 'email',
      campaign     TEXT,
      source       TEXT,
      utm_source   TEXT,
      utm_medium   TEXT,
      utm_campaign TEXT,
      meta         JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_attr_rev_tenant ON attribution_revenue_events(tenant_id, created_at DESC);
  `);
}

module.exports = { ensureAttributionSchema };
