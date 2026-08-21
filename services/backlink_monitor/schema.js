const _db = require('../../db');
const { enforceTenantIdNotNull } = require('../tenants/migration');

async function ensureBacklinkMonitorSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool();
  if (!pool) return;

  // IMMUTABLE wrapper: date_trunc('day', timestamptz) is STABLE, so a unique
  // index on that expression used to abort the whole multi-statement query and
  // roll back table creation. UTC-calendar-date is deterministic.
  await pool.query(`
    CREATE OR REPLACE FUNCTION infogenie_timestamptz_utc_date(ts timestamptz)
    RETURNS date
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
    AS $$ SELECT (ts AT TIME ZONE 'UTC')::date $$
  `);

  // Split statements so a later index failure cannot roll back table creation.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS backlink_monitors (
      id BIGSERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      domain TEXT NOT NULL,
      alert_email TEXT,
      alert_slack_webhook TEXT,
      frequency TEXT NOT NULL DEFAULT 'daily',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_run_at TIMESTAMPTZ,
      last_total_referring INTEGER NOT NULL DEFAULT 0
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS backlink_snapshots (
      id BIGSERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      monitor_id BIGINT NOT NULL REFERENCES backlink_monitors(id) ON DELETE CASCADE,
      referring_domain TEXT NOT NULL,
      rank INTEGER,
      backlinks INTEGER,
      country TEXT,
      first_seen TIMESTAMPTZ,
      snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (monitor_id, referring_domain)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS backlink_changes (
      id BIGSERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      monitor_id BIGINT NOT NULL REFERENCES backlink_monitors(id) ON DELETE CASCADE,
      change_type TEXT NOT NULL,
      referring_domain TEXT NOT NULL,
      rank INTEGER,
      country TEXT,
      detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      notified_at TIMESTAMPTZ
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_blc_monitor ON backlink_changes(monitor_id, detected_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_blc_type ON backlink_changes(monitor_id, change_type)`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_blc_dedupe
      ON backlink_changes (monitor_id, change_type, referring_domain, (infogenie_timestamptz_utc_date(detected_at)))
  `);

  // Legacy global UNIQUE(domain) blocks two tenants sharing a domain.
  await pool.query(`ALTER TABLE backlink_monitors DROP CONSTRAINT IF EXISTS backlink_monitors_domain_key`);
  await pool.query(`DROP INDEX IF EXISTS backlink_monitors_domain_key`);

  // Fail-closed closeout: never assign orphans to a default tenant.
  await enforceTenantIdNotNull('backlink_monitors', { uniqueWithExtra: ['domain'] });
  await enforceTenantIdNotNull('backlink_snapshots', {
    backfillFrom: { parentTable: 'backlink_monitors', parentIdColumn: 'id', childFkColumn: 'monitor_id' },
    indexExtra: ['monitor_id'],
  });
  await enforceTenantIdNotNull('backlink_changes', {
    backfillFrom: { parentTable: 'backlink_monitors', parentIdColumn: 'id', childFkColumn: 'monitor_id' },
    indexExtra: ['monitor_id'],
  });
}

module.exports = { ensureBacklinkMonitorSchema };
