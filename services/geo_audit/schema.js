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
  `);
}

module.exports = { ensureGeoAuditSchema };
