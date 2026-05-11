const _db = require('../../db');
async function ensureVoiceoverSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool(); if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS voiceover_runs (
      id SERIAL PRIMARY KEY,
      label TEXT,
      voice TEXT NOT NULL,
      model TEXT NOT NULL,
      char_count INTEGER NOT NULL DEFAULT 0,
      mp3_url TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_voiceover_created ON voiceover_runs(created_at DESC);
  `);
}
module.exports = { ensureVoiceoverSchema };
