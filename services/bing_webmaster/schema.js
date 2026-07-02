const _db = require('../../db');

async function ensureBingWebmasterSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool();
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bing_wmt_snapshots (
      id          SERIAL PRIMARY KEY,
      tenant_id   INT  NOT NULL,
      site_url    TEXT NOT NULL DEFAULT '',
      snap_type   TEXT NOT NULL,
      data        JSONB NOT NULL DEFAULT '{}',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_bwmt_tenant_type
      ON bing_wmt_snapshots(tenant_id, snap_type, created_at DESC);
  `);
}

module.exports = { ensureBingWebmasterSchema };
