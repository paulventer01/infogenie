const _db = require('../../db');

async function ensurePostLaunchAuditSchema() {
  if (!_db.hasDb()) return;
  const p = _db.getPool();

  await p.query(`
    CREATE TABLE IF NOT EXISTS post_launch_audits (
      id              SERIAL PRIMARY KEY,
      tenant_id       INT NOT NULL REFERENCES tenants(id),
      campaign_name   TEXT NOT NULL,
      platform        TEXT NOT NULL DEFAULT 'meta',
      campaign_id     INT,
      audit_window    TEXT NOT NULL DEFAULT '48h',
      status          TEXT NOT NULL DEFAULT 'pending',
      scheduled_for   TIMESTAMPTZ,
      completed_at    TIMESTAMPTZ,
      overall_result  TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS post_launch_checks (
      id          SERIAL PRIMARY KEY,
      audit_id    INT NOT NULL REFERENCES post_launch_audits(id) ON DELETE CASCADE,
      check_type  TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      details     JSONB,
      run_at      TIMESTAMPTZ
    );
  `);
}

module.exports = { ensurePostLaunchAuditSchema };
