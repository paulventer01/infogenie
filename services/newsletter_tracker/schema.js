const _db = require('../../db');
async function ensureNewsletterTrackerSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool(); if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS newsletter_targets (
      id SERIAL PRIMARY KEY,
      brand TEXT NOT NULL,
      newsletter_name TEXT NOT NULL,
      archive_url TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_scanned_at TIMESTAMPTZ,
      UNIQUE (brand, archive_url)
    );
    CREATE TABLE IF NOT EXISTS newsletter_issues (
      id SERIAL PRIMARY KEY,
      target_id INTEGER NOT NULL REFERENCES newsletter_targets(id) ON DELETE CASCADE,
      subject TEXT NOT NULL,
      sent_date TEXT,
      preview TEXT,
      url TEXT,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_nl_issues_target ON newsletter_issues(target_id, captured_at DESC);
  `);
}
module.exports = { ensureNewsletterTrackerSchema };
