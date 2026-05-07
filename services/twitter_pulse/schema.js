const _db = require('../../db');
async function ensureTwitterPulseSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool(); if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS twitter_pulse_runs (
      id SERIAL PRIMARY KEY,
      brand TEXT NOT NULL,
      keywords JSONB NOT NULL DEFAULT '[]',
      total_tweets INTEGER NOT NULL DEFAULT 0,
      pos_count INTEGER NOT NULL DEFAULT 0,
      neu_count INTEGER NOT NULL DEFAULT 0,
      neg_count INTEGER NOT NULL DEFAULT 0,
      tweets JSONB NOT NULL DEFAULT '[]',
      viral_thread_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_twpulse_brand ON twitter_pulse_runs(brand, created_at DESC);
  `);
}
module.exports = { ensureTwitterPulseSchema };
