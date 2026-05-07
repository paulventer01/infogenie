const _db = require('../../db');
async function ensureSerpTrackerSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS serp_tracker_keywords (
      id SERIAL PRIMARY KEY,
      keyword TEXT NOT NULL,
      target_domain TEXT NOT NULL,
      country TEXT NOT NULL DEFAULT 'us',
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(keyword, target_domain, country)
    );
    CREATE TABLE IF NOT EXISTS serp_tracker_runs (
      id SERIAL PRIMARY KEY,
      keyword_id INT REFERENCES serp_tracker_keywords(id) ON DELETE CASCADE,
      target_position INT,
      target_url TEXT,
      total_results TEXT,
      results JSONB NOT NULL DEFAULT '[]'::jsonb,
      ran_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_serp_runs_keyword_at ON serp_tracker_runs(keyword_id, ran_at DESC);
  `);
  console.log('[serp-tracker] schema ready');
}
module.exports = { ensureSerpTrackerSchema };
