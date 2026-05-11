const _db = require('../../db');
async function ensureSeoTasksSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool(); if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS seo_tasks (
      id SERIAL PRIMARY KEY,
      source TEXT NOT NULL DEFAULT 'seo_audit',
      source_url TEXT NOT NULL,
      check_id TEXT NOT NULL,
      label TEXT NOT NULL,
      message TEXT,
      fix TEXT,
      priority INTEGER NOT NULL DEFAULT 2,
      status TEXT NOT NULL DEFAULT 'open',
      assignee TEXT,
      due_date DATE,
      snoozed_until TIMESTAMPTZ,
      notes TEXT,
      audit_run_id INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      closed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_seo_tasks_status ON seo_tasks(status, priority, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_seo_tasks_url_check ON seo_tasks(source_url, check_id);
    -- Race-safe dedup: only ONE active task per (url, check_id) — closed/wont-fix excluded
    -- so a re-opened issue can be tracked without surfacing as a duplicate of historical work.
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_seo_tasks_active
      ON seo_tasks(source_url, check_id)
      WHERE status NOT IN ('done','wont_fix');
  `);
}
module.exports = { ensureSeoTasksSchema };
