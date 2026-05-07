const _db = require('../../db');

async function ensureCrisisRadarSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crisis_watchlist (
      id SERIAL PRIMARY KEY,
      brand TEXT NOT NULL,
      competitors JSONB NOT NULL DEFAULT '[]',
      country TEXT NOT NULL DEFAULT 'US',
      enabled BOOLEAN NOT NULL DEFAULT true,
      spike_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.8,
      neg_pct_threshold NUMERIC(4,2) NOT NULL DEFAULT 0.35,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (brand, country)
    );
    CREATE TABLE IF NOT EXISTS crisis_snapshots (
      id SERIAL PRIMARY KEY,
      watchlist_id INTEGER NOT NULL REFERENCES crisis_watchlist(id) ON DELETE CASCADE,
      brand TEXT NOT NULL,
      total_mentions INTEGER NOT NULL DEFAULT 0,
      pos_count INTEGER NOT NULL DEFAULT 0,
      neu_count INTEGER NOT NULL DEFAULT 0,
      neg_count INTEGER NOT NULL DEFAULT 0,
      neg_pct NUMERIC(5,3) NOT NULL DEFAULT 0,
      top_sources JSONB NOT NULL DEFAULT '[]',
      taken_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_snap_watch ON crisis_snapshots(watchlist_id, taken_at DESC);
    CREATE TABLE IF NOT EXISTS crisis_incidents (
      id SERIAL PRIMARY KEY,
      watchlist_id INTEGER NOT NULL REFERENCES crisis_watchlist(id) ON DELETE CASCADE,
      brand TEXT NOT NULL,
      kind TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'med',
      headline TEXT NOT NULL,
      detail TEXT,
      metric_value NUMERIC,
      baseline NUMERIC,
      sample_mentions JSONB NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      acknowledged_at TIMESTAMPTZ,
      resolved_at TIMESTAMPTZ,
      slack_sent BOOLEAN NOT NULL DEFAULT false
    );
    CREATE INDEX IF NOT EXISTS idx_inc_status ON crisis_incidents(status, created_at DESC);
  `);
}

module.exports = { ensureCrisisRadarSchema };
