const _db = require('../../db');

async function ensureCrmSyncSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_sync_logs (
      id              BIGSERIAL PRIMARY KEY,
      provider        TEXT NOT NULL,
      operation       TEXT NOT NULL DEFAULT 'push',
      contacts_total  INTEGER NOT NULL DEFAULT 0,
      contacts_ok     INTEGER NOT NULL DEFAULT 0,
      contacts_failed INTEGER NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','partial','failed')),
      error           TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_crm_provider ON crm_sync_logs(provider, created_at DESC);
  `);
}

module.exports = { ensureCrmSyncSchema };
