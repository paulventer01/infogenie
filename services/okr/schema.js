const _db = require('../../db');

async function ensureOkrSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool();
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS okr_objectives (
      id          TEXT PRIMARY KEY,
      tenant_id   INT  NOT NULL,
      title       TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      quarter     TEXT NOT NULL,
      owner_email TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'on_track'
                  CHECK (status IN ('on_track','at_risk','off_track','complete')),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_okr_obj_tenant
      ON okr_objectives(tenant_id, quarter, created_at DESC);

    CREATE TABLE IF NOT EXISTS okr_key_results (
      id            TEXT PRIMARY KEY,
      tenant_id     INT  NOT NULL,
      objective_id  TEXT NOT NULL REFERENCES okr_objectives(id) ON DELETE CASCADE,
      title         TEXT NOT NULL,
      metric_type   TEXT NOT NULL DEFAULT 'manual'
                    CHECK (metric_type IN ('manual','spend','impressions','clicks','conversions','roas','leads')),
      linked_channel TEXT NOT NULL DEFAULT '',
      target_value  NUMERIC(14,2) NOT NULL DEFAULT 0,
      current_value NUMERIC(14,2) NOT NULL DEFAULT 0,
      unit          TEXT NOT NULL DEFAULT '',
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_okr_kr_obj
      ON okr_key_results(objective_id);
    CREATE INDEX IF NOT EXISTS idx_okr_kr_tenant
      ON okr_key_results(tenant_id, created_at DESC);
  `);
}

module.exports = { ensureOkrSchema };
