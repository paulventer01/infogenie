const _db = require('../../db');

async function ensureBizScannerSchema() {
  if (!_db.hasDb()) return;
  const p = _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS biz_scanner_runs (
      id          SERIAL PRIMARY KEY,
      tenant_id   INT NOT NULL REFERENCES tenants(id),
      industry    TEXT NOT NULL DEFAULT '',
      region      TEXT NOT NULL DEFAULT '',
      scan_type   TEXT NOT NULL DEFAULT 'all',
      budget_range TEXT NOT NULL DEFAULT '',
      results     JSONB NOT NULL DEFAULT '{}',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS biz_scanner_runs_tenant_idx ON biz_scanner_runs(tenant_id);
  `);
}

module.exports = { ensureBizScannerSchema };
