const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');

async function ensureBattleCardsSchema() {
  if (!_db.hasDb()) return;
  const p = _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS battle_cards (
      id SERIAL PRIMARY KEY,
      competitor TEXT NOT NULL,
      domain TEXT,
      brand TEXT,
      summary TEXT,
      positioning TEXT,
      strengths JSONB NOT NULL DEFAULT '[]',
      weaknesses JSONB NOT NULL DEFAULT '[]',
      recent_moves JSONB NOT NULL DEFAULT '[]',
      counter_plays JSONB NOT NULL DEFAULT '[]',
      sov_snippet TEXT,
      generated_by TEXT NOT NULL DEFAULT 'template',
      generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (competitor, brand)
    );
    CREATE INDEX IF NOT EXISTS idx_bc_brand ON battle_cards(brand);
  `);
  // Phase 2B — inline tenant_id migration. Also rewrite the UNIQUE constraint
  // from (competitor, brand) to (tenant_id, competitor, brand) so two tenants
  // can both generate a card for "Acme" without colliding.
  await addTenantIdColumn('battle_cards');
  try {
    await p.query(`ALTER TABLE battle_cards DROP CONSTRAINT IF EXISTS battle_cards_competitor_brand_key`);
  } catch (_) { /* legacy name may differ — best-effort */ }
  await addTenantIdColumn('battle_cards', { uniqueWithExtra: ['competitor', 'brand'] });
}

module.exports = { ensureBattleCardsSchema };
