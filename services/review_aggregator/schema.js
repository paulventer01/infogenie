const _db = require('../../db');
async function ensureReviewAggregatorSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool(); if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS review_aggregator_runs (
      id SERIAL PRIMARY KEY,
      brand TEXT NOT NULL,
      platform TEXT NOT NULL,
      avg_rating NUMERIC(3,2),
      total_reviews INTEGER NOT NULL DEFAULT 0,
      pos_count INTEGER NOT NULL DEFAULT 0,
      neu_count INTEGER NOT NULL DEFAULT 0,
      neg_count INTEGER NOT NULL DEFAULT 0,
      reviews JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_revagg_brand ON review_aggregator_runs(brand, created_at DESC);
  `);
}
module.exports = { ensureReviewAggregatorSchema };
