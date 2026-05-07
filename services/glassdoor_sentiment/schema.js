const _db = require('../../db');
async function ensureGlassdoorSentimentSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool(); if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS glassdoor_runs (
      id SERIAL PRIMARY KEY,
      company TEXT NOT NULL,
      overall_rating NUMERIC(3,2),
      ceo_approval NUMERIC(5,2),
      recommend_pct NUMERIC(5,2),
      total_reviews INTEGER,
      reviews JSONB NOT NULL DEFAULT '[]',
      top_complaints JSONB NOT NULL DEFAULT '[]',
      top_praises JSONB NOT NULL DEFAULT '[]',
      culture_signals JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_glassdoor_co ON glassdoor_runs(company, created_at DESC);
  `);
}
module.exports = { ensureGlassdoorSentimentSchema };
