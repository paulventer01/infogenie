const _db = require('../../db');

async function ensureWeeklyReportSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool();
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS weekly_report_subs (
      id SERIAL PRIMARY KEY,
      brand TEXT NOT NULL,
      email TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_sent_at TIMESTAMPTZ,
      UNIQUE (brand, email)
    );
    CREATE TABLE IF NOT EXISTS weekly_report_runs (
      id SERIAL PRIMARY KEY,
      brand TEXT NOT NULL,
      sections_count INTEGER NOT NULL DEFAULT 0,
      sent_to TEXT,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_wr_subs_brand ON weekly_report_subs(brand);
    CREATE INDEX IF NOT EXISTS idx_wr_runs_brand ON weekly_report_runs(brand, generated_at DESC);
  `);
}

module.exports = { ensureWeeklyReportSchema };
