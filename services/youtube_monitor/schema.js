const _db = require('../../db');

async function ensureYoutubeMonitorSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool();
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS yt_channels (
      id SERIAL PRIMARY KEY,
      brand TEXT NOT NULL,
      channel_name TEXT NOT NULL,
      channel_url TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_scanned_at TIMESTAMPTZ,
      UNIQUE (brand, channel_url)
    );
    CREATE TABLE IF NOT EXISTS yt_snapshots (
      id SERIAL PRIMARY KEY,
      channel_id INTEGER NOT NULL REFERENCES yt_channels(id) ON DELETE CASCADE,
      video_title TEXT NOT NULL,
      video_url TEXT,
      published_at TEXT,
      view_count BIGINT,
      like_count BIGINT,
      comment_count BIGINT,
      sentiment TEXT,
      summary TEXT,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_yt_snap_channel ON yt_snapshots(channel_id, captured_at DESC);
  `);
}

module.exports = { ensureYoutubeMonitorSchema };
