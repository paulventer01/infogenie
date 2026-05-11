const _db = require('../../db');

async function ensureSocialTagsSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool();
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS social_tags_runs (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      score INT NOT NULL,
      grade TEXT NOT NULL,
      summary JSONB,
      checks JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_social_tags_url ON social_tags_runs(url, created_at DESC);
  `);
}

module.exports = { ensureSocialTagsSchema };
