const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');

async function ensureAutopilotSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS autopilot_schedules (
      id            SERIAL PRIMARY KEY,
      tenant_id     INT NOT NULL REFERENCES tenants(id),
      name          TEXT NOT NULL,
      brand         TEXT NOT NULL,
      keyword       TEXT,
      mode          TEXT NOT NULL DEFAULT 'article',
      channels      JSONB NOT NULL DEFAULT '["blog"]'::jsonb,
      frequency     TEXT NOT NULL DEFAULT 'weekly',
      wp_site_id    INT REFERENCES wordpress_sites(id) ON DELETE SET NULL,
      auto_publish  BOOLEAN NOT NULL DEFAULT false,
      wp_status     TEXT NOT NULL DEFAULT 'draft',
      enabled       BOOLEAN NOT NULL DEFAULT true,
      last_run_at   TIMESTAMPTZ,
      next_run_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      run_count     INT NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_ap_sched_tenant ON autopilot_schedules(tenant_id, enabled, next_run_at);

    CREATE TABLE IF NOT EXISTS autopilot_logs (
      id           SERIAL PRIMARY KEY,
      schedule_id  INT REFERENCES autopilot_schedules(id) ON DELETE CASCADE,
      tenant_id    INT NOT NULL REFERENCES tenants(id),
      status       TEXT NOT NULL,
      detail       TEXT,
      wp_post_url  TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_ap_logs_sched ON autopilot_logs(schedule_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ap_logs_tenant ON autopilot_logs(tenant_id, created_at DESC);
  `);
  console.log('[autopilot] schema ready');
}

module.exports = { ensureAutopilotSchema };
