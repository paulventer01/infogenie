const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');

async function ensureUnifiedInboxSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS unified_inbox_items (
      id BIGSERIAL PRIMARY KEY,
      source TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_url TEXT,
      author TEXT,
      title TEXT,
      content TEXT,
      sentiment TEXT,
      score NUMERIC,
      status TEXT NOT NULL DEFAULT 'new',
      assignee TEXT,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      notes TEXT,
      raw JSONB,
      occurred_at TIMESTAMPTZ,
      ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      handled_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_inbox_status ON unified_inbox_items(status, ingested_at DESC);
    CREATE INDEX IF NOT EXISTS idx_inbox_source ON unified_inbox_items(source, ingested_at DESC);
    CREATE INDEX IF NOT EXISTS idx_inbox_sentiment ON unified_inbox_items(sentiment);
  `);

  // Multi-tenancy (Phase 2B). Two changes needed:
  //   1. add tenant_id column (idempotent via shared helper)
  //   2. replace the old UNIQUE(source, source_id) with a tenant-scoped one
  //      so two tenants can each ingest the same upstream item without
  //      colliding on the dedup index.
  try { await addTenantIdColumn('unified_inbox_items'); }
  catch (e) { console.error('[unified-inbox] addTenantIdColumn:', e.message); }

  try {
    // Create the new tenant-scoped unique index FIRST so the dedup contract
    // never has a gap. Only drop the old single-column index after the new
    // one is in place. Both ops are idempotent so reboot-replay is safe.
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_inbox_tenant_source ON unified_inbox_items(tenant_id, source, source_id)`);
    await pool.query(`DROP INDEX IF EXISTS uniq_inbox_source`);
  } catch (e) { console.error('[unified-inbox] uniq index migrate:', e.message); }
}

module.exports = { ensureUnifiedInboxSchema };
