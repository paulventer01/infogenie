const _db = require('../../db');

async function ensureChangeMonitorSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS change_monitor_watches (
      id                   SERIAL PRIMARY KEY,
      tenant_id            INT NOT NULL REFERENCES tenants(id),
      url                  TEXT NOT NULL,
      label                TEXT NOT NULL DEFAULT '',
      last_snapshot        TEXT,
      last_checked         TIMESTAMPTZ,
      last_changed         TIMESTAMPTZ,
      status               TEXT NOT NULL DEFAULT 'active',
      alert_email          BOOLEAN NOT NULL DEFAULT TRUE,
      alert_slack          BOOLEAN NOT NULL DEFAULT FALSE,
      check_interval_hours INT NOT NULL DEFAULT 6,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_cmw_tenant ON change_monitor_watches(tenant_id)`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS change_monitor_diffs (
      id                SERIAL PRIMARY KEY,
      watch_id          INT NOT NULL REFERENCES change_monitor_watches(id) ON DELETE CASCADE,
      tenant_id         INT NOT NULL REFERENCES tenants(id),
      diff_summary      TEXT NOT NULL DEFAULT '',
      strategic_insight TEXT NOT NULL DEFAULT '',
      old_snapshot_len  INT,
      new_snapshot_len  INT,
      detected_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_cmd_watch ON change_monitor_diffs(watch_id)`);
  console.log('[change-monitor] schema ready');
}

module.exports = { ensureChangeMonitorSchema };
