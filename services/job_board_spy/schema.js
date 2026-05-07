const _db = require('../../db');
async function ensureJobBoardSpySchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool(); if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS job_board_runs (
      id SERIAL PRIMARY KEY,
      company TEXT NOT NULL,
      total_jobs INTEGER NOT NULL DEFAULT 0,
      by_dept JSONB NOT NULL DEFAULT '{}',
      jobs JSONB NOT NULL DEFAULT '[]',
      strategic_signals JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_jobspy_co ON job_board_runs(company, created_at DESC);
  `);
}
module.exports = { ensureJobBoardSpySchema };
