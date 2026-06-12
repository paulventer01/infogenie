const _db = require('../../db');

async function ensureInvestorModeSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS investor_reports (
      id            SERIAL PRIMARY KEY,
      tenant_id     INT NOT NULL REFERENCES tenants(id),
      report_type   TEXT NOT NULL DEFAULT 'monthly',
      content       JSONB NOT NULL DEFAULT '{}',
      portal_token  TEXT UNIQUE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS investor_reports_tenant_idx ON investor_reports(tenant_id);
    CREATE INDEX IF NOT EXISTS investor_reports_token_idx ON investor_reports(portal_token);
  `);
}

module.exports = { ensureInvestorModeSchema };
