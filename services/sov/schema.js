const _db = require('../../db');
const _tenantMig = require('../tenants/migration');

async function ensureSovSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS sov_snapshots (
      id SERIAL PRIMARY KEY,
      watchlist_id INTEGER REFERENCES crisis_watchlist(id) ON DELETE CASCADE,
      target_brand TEXT NOT NULL,
      brand TEXT NOT NULL,
      mentions INTEGER NOT NULL DEFAULT 0,
      pos_count INTEGER NOT NULL DEFAULT 0,
      neu_count INTEGER NOT NULL DEFAULT 0,
      neg_count INTEGER NOT NULL DEFAULT 0,
      taken_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_sov_target ON sov_snapshots(target_brand, taken_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sov_watch ON sov_snapshots(watchlist_id, taken_at DESC);
  `);
  await _tenantMig.addTenantIdColumn('sov_snapshots');
}

module.exports = { ensureSovSchema };
