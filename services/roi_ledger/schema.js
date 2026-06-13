const _db = require('../../db');

async function ensureRoiLedgerSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS roi_actions (
      id              SERIAL PRIMARY KEY,
      tenant_id       INT NOT NULL REFERENCES tenants(id),
      action_type     TEXT NOT NULL,
      module          TEXT NOT NULL,
      title           TEXT NOT NULL,
      description     TEXT,
      estimated_value NUMERIC(12,2) NOT NULL DEFAULT 0,
      actual_value    NUMERIC(12,2),
      currency        TEXT NOT NULL DEFAULT 'USD',
      status          TEXT NOT NULL DEFAULT 'completed',
      metadata        JSONB NOT NULL DEFAULT '{}',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at     TIMESTAMPTZ
    )
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS roi_actions_tenant_created ON roi_actions(tenant_id, created_at DESC)`);
  await p.query(`CREATE INDEX IF NOT EXISTS roi_actions_module ON roi_actions(tenant_id, module)`);
}

module.exports = { ensureRoiLedgerSchema };
