const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');
async function ensureUgcDiscoverySchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS ugc_items (
      id SERIAL PRIMARY KEY,
      brand TEXT NOT NULL,
      platform TEXT NOT NULL,
      author TEXT,
      content TEXT,
      url TEXT,
      media_url TEXT,
      ugc_type TEXT DEFAULT 'post',
      sentiment TEXT DEFAULT 'neutral',
      estimated_reach INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'new',
      tags JSONB DEFAULT '[]'::jsonb,
      discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_ugc_brand ON ugc_items(brand, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ugc_status ON ugc_items(status, created_at DESC);
  `);
  try { await addTenantIdColumn('ugc_items'); } catch(e) { console.error('[ugc-discovery] migration:', e.message); }
}
module.exports = { ensureUgcDiscoverySchema };
