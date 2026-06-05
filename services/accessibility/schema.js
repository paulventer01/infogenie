const _db = require('../../db');

async function ensureAccessibilitySchema() {
  if (!_db.hasDb()) return;
  const p = _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS accessibility_runs (
      id           SERIAL PRIMARY KEY,
      tenant_id    INT NOT NULL REFERENCES tenants(id),
      url          TEXT NOT NULL,
      score        INT NOT NULL DEFAULT 0,
      issues       JSONB NOT NULL DEFAULT '[]',
      summary      TEXT,
      source       TEXT NOT NULL DEFAULT 'ai',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_accessibility_tenant ON accessibility_runs(tenant_id)`);
  console.log('[accessibility] schema ready');
}

module.exports = { ensureAccessibilitySchema };
