const _db = require('../../db');

async function ensureAiTrafficSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_traffic_sites (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      domain TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS ai_traffic_hits (
      id BIGSERIAL PRIMARY KEY,
      site_id TEXT NOT NULL,
      source TEXT NOT NULL,
      referrer TEXT NOT NULL DEFAULT '',
      path TEXT NOT NULL DEFAULT '/',
      ts TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_ath_site_ts ON ai_traffic_hits(site_id, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_ath_source ON ai_traffic_hits(site_id, source, ts DESC);
  `);
}

module.exports = { ensureAiTrafficSchema };
