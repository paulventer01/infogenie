const _db = require('../../db');
const { addTenantIdColumn, enforceTenantIdNotNull } = require('../tenants/migration');

async function ensureGeoAuditSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool();
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS geo_audit_runs (
      id TEXT PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      score INT NOT NULL,
      grade TEXT NOT NULL,
      summary JSONB,
      checks JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_geo_audit_url ON geo_audit_runs(url, created_at DESC);

    CREATE TABLE IF NOT EXISTS geo_citation_checks (
      id         TEXT PRIMARY KEY,
      run_id     TEXT REFERENCES geo_audit_runs(id) ON DELETE CASCADE,
      tenant_id  INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      domain     TEXT NOT NULL,
      queries    JSONB NOT NULL DEFAULT '[]',
      results    JSONB NOT NULL DEFAULT '[]',
      citation_rate FLOAT NOT NULL DEFAULT 0,
      checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_geo_citation_run
      ON geo_citation_checks(run_id, checked_at DESC);
    CREATE INDEX IF NOT EXISTS idx_geo_citation_tenant
      ON geo_citation_checks(tenant_id, checked_at DESC);
  `);

  // Parent is a PLAIN_TABLES historical table — addTenantIdColumn (default
  // backfill) matches phase2. Child closeout is fail-closed from the parent.
  try { await addTenantIdColumn('geo_audit_runs', { notNull: true }); }
  catch (e) { console.error('[geo-audit] runs tenant_id:', e.message); }
  try {
    await enforceTenantIdNotNull('geo_citation_checks', {
      backfillFrom: { parentTable: 'geo_audit_runs', parentIdColumn: 'id', childFkColumn: 'run_id' },
      indexExtra: ['run_id'],
    });
  } catch (e) { console.error('[geo-audit] citations fail-closed:', e.message); }
}

module.exports = { ensureGeoAuditSchema };
