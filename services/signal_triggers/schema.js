const _db = require('../../db');
const hasDb = () => _db.hasDb();
const pool = { query: (...a) => _db.getPool().query(...a) };

async function ensureSignalTriggersSchema() {
  if (!hasDb()) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS signal_triggers (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      signal_type  TEXT NOT NULL,
      condition    JSONB NOT NULL DEFAULT '{}'::jsonb,
      journey_id   TEXT,
      enabled      BOOLEAN NOT NULL DEFAULT true,
      last_fired_at TIMESTAMPTZ,
      fire_count   INT NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS signal_events (
      id          BIGSERIAL PRIMARY KEY,
      signal_type TEXT NOT NULL,
      payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_signal_events_type_time ON signal_events(signal_type, created_at DESC);
  `);
}

module.exports = { ensureSignalTriggersSchema };
