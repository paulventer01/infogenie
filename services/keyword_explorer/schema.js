const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');
async function ensureKeywordExplorerSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS keyword_explorer_runs (
      id SERIAL PRIMARY KEY,
      seed TEXT NOT NULL,
      country TEXT NOT NULL DEFAULT 'us',
      seed_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
      ideas JSONB NOT NULL DEFAULT '[]'::jsonb,
      ran_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_kw_explorer_at ON keyword_explorer_runs(ran_at DESC);
  `);
  try { await addTenantIdColumn('keyword_explorer_runs'); }
  catch (e) { console.error('[keyword-explorer] addTenantIdColumn:', e.message); }
  console.log('[keyword-explorer] schema ready');
}
module.exports = { ensureKeywordExplorerSchema };
