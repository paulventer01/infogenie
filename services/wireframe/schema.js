const _db = require('../../db');

async function ensureWireframeSchema() {
  if (!_db.hasDb()) return;
  const p = _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS wireframe_runs (
      id           SERIAL PRIMARY KEY,
      tenant_id    INT NOT NULL REFERENCES tenants(id),
      page_type    TEXT NOT NULL DEFAULT 'landing',
      description  TEXT,
      html         TEXT NOT NULL,
      source       TEXT NOT NULL DEFAULT 'ai',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_wireframe_tenant ON wireframe_runs(tenant_id)`);
  console.log('[wireframe] schema ready');
}

module.exports = { ensureWireframeSchema };
