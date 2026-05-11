const _db = require('../../db');

async function ensureBacklinkMonitorSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool();
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS backlink_monitors (
      id BIGSERIAL PRIMARY KEY,
      domain TEXT NOT NULL UNIQUE,
      alert_email TEXT,
      alert_slack_webhook TEXT,
      frequency TEXT NOT NULL DEFAULT 'daily',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_run_at TIMESTAMPTZ,
      last_total_referring INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS backlink_snapshots (
      id BIGSERIAL PRIMARY KEY,
      monitor_id BIGINT NOT NULL REFERENCES backlink_monitors(id) ON DELETE CASCADE,
      referring_domain TEXT NOT NULL,
      rank INTEGER,
      backlinks INTEGER,
      country TEXT,
      first_seen TIMESTAMPTZ,
      snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (monitor_id, referring_domain)
    );
    CREATE TABLE IF NOT EXISTS backlink_changes (
      id BIGSERIAL PRIMARY KEY,
      monitor_id BIGINT NOT NULL REFERENCES backlink_monitors(id) ON DELETE CASCADE,
      change_type TEXT NOT NULL,
      referring_domain TEXT NOT NULL,
      rank INTEGER,
      country TEXT,
      detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      notified_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_blc_monitor ON backlink_changes(monitor_id, detected_at DESC);
    CREATE INDEX IF NOT EXISTS idx_blc_type ON backlink_changes(monitor_id, change_type);
    -- Defense-in-depth: even if a transaction is replayed, the same monitor
    -- can only record one change row per (type, referring_domain, day).
    CREATE UNIQUE INDEX IF NOT EXISTS idx_blc_dedupe
      ON backlink_changes (monitor_id, change_type, referring_domain, (date_trunc('day', detected_at)));
  `);
}

module.exports = { ensureBacklinkMonitorSchema };
