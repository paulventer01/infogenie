const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');
async function ensurePodcastMonitorSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS podcast_monitor_runs (
      id SERIAL PRIMARY KEY,
      brand TEXT NOT NULL,
      lookback_days INT NOT NULL DEFAULT 30,
      episodes JSONB NOT NULL DEFAULT '[]'::jsonb,
      source TEXT,
      ran_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_pmr_brand_ran ON podcast_monitor_runs(brand, ran_at DESC);
  `);
  try { await addTenantIdColumn('podcast_monitor_runs'); }
  catch (e) { console.error('[podcast-monitor] addTenantIdColumn:', e.message); }
  console.log('[podcast-monitor] schema ready');
}
module.exports = { ensurePodcastMonitorSchema };
