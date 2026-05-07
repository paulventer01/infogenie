const _db = require('../../db');
async function ensureRedditPulseSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool(); if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reddit_pulse_runs (
      id SERIAL PRIMARY KEY,
      brand TEXT NOT NULL,
      subreddits JSONB NOT NULL DEFAULT '[]',
      keywords JSONB NOT NULL DEFAULT '[]',
      total_posts INTEGER NOT NULL DEFAULT 0,
      pos_count INTEGER NOT NULL DEFAULT 0,
      neu_count INTEGER NOT NULL DEFAULT 0,
      neg_count INTEGER NOT NULL DEFAULT 0,
      posts JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_reddit_brand ON reddit_pulse_runs(brand, created_at DESC);
  `);
}
module.exports = { ensureRedditPulseSchema };
