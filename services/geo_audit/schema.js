const _db = require('../../db');

async function ensureGeoAuditSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool();
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS geo_audit_runs (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      score INT NOT NULL,
      grade TEXT NOT NULL,
      summary JSONB,
      checks JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_geo_audit_url ON geo_audit_runs(url, created_at DESC);

    CREATE TABLE IF NOT EXISTS geo_citation_checks (
      id         TEXT PRIMARY KEY,
      run_id     TEXT REFERENCES geo_audit_runs(id) ON DELETE CASCADE,
      tenant_id  INT,
      domain     TEXT NOT NULL,
      queries    JSONB NOT NULL DEFAULT '[]',
      results    JSONB NOT NULL DEFAULT '[]',
      citation_rate FLOAT NOT NULL DEFAULT 0,
      checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_geo_citation_run
      ON geo_citation_checks(run_id, checked_at DESC);
    CREATE INDEX IF NOT EXISTS idx_geo_citation_tenant
      ON geo_citation_checks(tenant_id, checked_at DESC);
  `);
}

module.exports = { ensureGeoAuditSchema };
