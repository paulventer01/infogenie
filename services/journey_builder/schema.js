const _db = require('../../db');
const hasDb = () => _db.hasDb();
const pool = { query: (...a) => _db.getPool().query(...a) };

async function ensureJourneySchema() {
  if (!hasDb()) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS journeys (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      description   TEXT DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'draft',
      trigger_type  TEXT NOT NULL DEFAULT 'manual',
      trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
      nodes         JSONB NOT NULL DEFAULT '[]'::jsonb,
      edges         JSONB NOT NULL DEFAULT '[]'::jsonb,
      stats         JSONB NOT NULL DEFAULT '{"started":0,"completed":0,"failed":0}'::jsonb,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS journey_runs (
      id            BIGSERIAL PRIMARY KEY,
      journey_id    TEXT NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
      contact_email TEXT,
      contact_phone TEXT,
      contact_meta  JSONB NOT NULL DEFAULT '{}'::jsonb,
      current_node  TEXT,
      status        TEXT NOT NULL DEFAULT 'running',
      log           JSONB NOT NULL DEFAULT '[]'::jsonb,
      started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      next_run_at   TIMESTAMPTZ,
      completed_at  TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_journey_runs_journey ON journey_runs(journey_id);
    CREATE INDEX IF NOT EXISTS idx_journey_runs_pending ON journey_runs(status, next_run_at) WHERE status='running';
  `);
}

module.exports = { ensureJourneySchema };
