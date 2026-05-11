const _db = require('../../db');
async function ensureTiktokDownloaderSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool(); if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tiktok_downloads (
      id SERIAL PRIMARY KEY,
      url TEXT NOT NULL,
      author TEXT,
      caption TEXT,
      hashtags JSONB DEFAULT '[]',
      music TEXT,
      likes BIGINT DEFAULT 0,
      views BIGINT DEFAULT 0,
      comments BIGINT DEFAULT 0,
      shares BIGINT DEFAULT 0,
      duration_sec INTEGER DEFAULT 0,
      video_url TEXT,
      cover_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_tt_dl_created ON tiktok_downloads(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tt_dl_author ON tiktok_downloads(author);
  `);
}
module.exports = { ensureTiktokDownloaderSchema };
