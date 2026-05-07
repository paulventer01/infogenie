const _db = require('../../db');
async function ensureLeadFinderSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS lead_finder_runs (
      id SERIAL PRIMARY KEY,
      query_filters JSONB NOT NULL DEFAULT '{}'::jsonb,
      result_count INT NOT NULL DEFAULT 0,
      leads JSONB NOT NULL DEFAULT '[]'::jsonb,
      source TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_lead_finder_created ON lead_finder_runs(created_at DESC);
  `);
  console.log('[lead-finder] schema ready');
}
module.exports = { ensureLeadFinderSchema };
