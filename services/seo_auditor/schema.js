const _db = require('../../db');
async function ensureSeoAuditorSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool(); if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS seo_audit_runs (
      id SERIAL PRIMARY KEY,
      url TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      grade TEXT NOT NULL DEFAULT 'F',
      checks JSONB NOT NULL DEFAULT '[]',
      summary JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_seo_audit_url ON seo_audit_runs(url, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_seo_audit_created ON seo_audit_runs(created_at DESC);
  `);
}
module.exports = { ensureSeoAuditorSchema };
