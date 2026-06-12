const _db = require('../../db');

async function ensureResilientTrackerSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS resilient_trackers (
      id                   SERIAL PRIMARY KEY,
      tenant_id            INT NOT NULL REFERENCES tenants(id),
      url                  TEXT NOT NULL,
      label                TEXT NOT NULL DEFAULT '',
      data_points          JSONB NOT NULL DEFAULT '[]',
      last_data            JSONB NOT NULL DEFAULT '{}',
      last_method          TEXT,
      last_checked         TIMESTAMPTZ,
      consecutive_failures INT NOT NULL DEFAULT 0,
      status               TEXT NOT NULL DEFAULT 'active',
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_rt_tenant ON resilient_trackers(tenant_id)`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS resilient_tracker_snapshots (
      id         SERIAL PRIMARY KEY,
      tracker_id INT NOT NULL REFERENCES resilient_trackers(id) ON DELETE CASCADE,
      tenant_id  INT NOT NULL REFERENCES tenants(id),
      data       JSONB NOT NULL DEFAULT '{}',
      method     TEXT,
      success    BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_rts_tracker ON resilient_tracker_snapshots(tracker_id)`);
  console.log('[resilient-tracker] schema ready');
}

module.exports = { ensureResilientTrackerSchema };
