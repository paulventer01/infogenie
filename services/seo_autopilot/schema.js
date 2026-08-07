const _db = require('../../db');

async function ensureSeoAutopilotSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS seo_growth_plans (
      id              SERIAL PRIMARY KEY,
      tenant_id       INTEGER NOT NULL,
      niche           TEXT NOT NULL,
      domain          TEXT,
      brand           TEXT,
      industry        TEXT,
      tone            TEXT DEFAULT 'professional',
      competitors     JSONB DEFAULT '[]',
      keywords        JSONB DEFAULT '[]',
      calendar        JSONB DEFAULT '[]',
      destinations    JSONB DEFAULT '[]',
      autopilot       BOOLEAN DEFAULT FALSE,
      publish_status  TEXT DEFAULT 'draft',
      frequency       TEXT DEFAULT 'daily',
      next_run_at     TIMESTAMPTZ,
      last_run_at     TIMESTAMPTZ,
      meta            JSONB DEFAULT '{}',
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_seo_plans_tenant ON seo_growth_plans(tenant_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_seo_plans_due
    ON seo_growth_plans(autopilot, next_run_at)
    WHERE autopilot = TRUE
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS seo_autopilot_runs (
      id              SERIAL PRIMARY KEY,
      tenant_id       INTEGER NOT NULL,
      plan_id         INTEGER REFERENCES seo_growth_plans(id) ON DELETE CASCADE,
      status          TEXT DEFAULT 'ok',
      keyword         TEXT,
      title           TEXT,
      word_count      INTEGER,
      destinations    JSONB DEFAULT '[]',
      publish_results JSONB DEFAULT '[]',
      article_html    TEXT,
      error           TEXT,
      meta            JSONB DEFAULT '{}',
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_seo_runs_tenant ON seo_autopilot_runs(tenant_id, created_at DESC)
  `);
}

module.exports = { ensureSeoAutopilotSchema };
