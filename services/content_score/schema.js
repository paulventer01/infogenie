const _db = require('../../db');

async function ensureContentScoreSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS content_score_runs (
      id BIGSERIAL PRIMARY KEY,
      url TEXT NOT NULL,
      keyword TEXT NOT NULL DEFAULT '',
      score INTEGER NOT NULL DEFAULT 0,
      breakdown JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_cs_url ON content_score_runs(url, created_at DESC);
  `);
}

module.exports = { ensureContentScoreSchema };
