const _db = require('../../db');
async function ensureChurnScorerSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool(); if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS churn_scores (
      id SERIAL PRIMARY KEY,
      contact_email TEXT NOT NULL,
      contact_name TEXT,
      score INTEGER NOT NULL,
      risk_level TEXT NOT NULL,
      signals JSONB NOT NULL DEFAULT '[]',
      recommendation TEXT,
      input_data JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (contact_email)
    );
    CREATE INDEX IF NOT EXISTS idx_churn_score ON churn_scores(score DESC, created_at DESC);
  `);
}
module.exports = { ensureChurnScorerSchema };
