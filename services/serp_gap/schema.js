const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');

async function ensureSerpGapSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS serp_gap_runs (
      id BIGSERIAL PRIMARY KEY,
      tenant_id INT,
      my_domain TEXT NOT NULL,
      seed_keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
      opportunities JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  try { await addTenantIdColumn('serp_gap_runs'); } catch (_) {}
  console.log('[serp-gap] schema ready');
}
module.exports = { ensureSerpGapSchema };
