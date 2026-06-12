const _db = require('../../db');

async function ensureBizScannerSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS biz_scan_runs (
      id            SERIAL PRIMARY KEY,
      tenant_id     INT NOT NULL REFERENCES tenants(id),
      industry      TEXT NOT NULL,
      region        TEXT NOT NULL,
      scan_type     TEXT NOT NULL DEFAULT 'all',
      results       JSONB NOT NULL DEFAULT '[]',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS biz_scan_runs_tenant_idx ON biz_scan_runs(tenant_id);
  `);
}

module.exports = { ensureBizScannerSchema };
