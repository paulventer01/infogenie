const _db = require('../../db');

async function ensureBulkReportingSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool();
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bulk_audit_runs (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'Bulk audit',
      status TEXT NOT NULL DEFAULT 'running',
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      total INTEGER NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS bulk_audit_items (
      id BIGSERIAL PRIMARY KEY,
      run_id BIGINT NOT NULL REFERENCES bulk_audit_runs(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      score INTEGER,
      grade TEXT,
      passed INTEGER,
      warned INTEGER,
      failed INTEGER,
      error TEXT,
      report_json JSONB,
      processed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_bulk_items_run ON bulk_audit_items(run_id, status);
  `);
}

module.exports = { ensureBulkReportingSchema };
