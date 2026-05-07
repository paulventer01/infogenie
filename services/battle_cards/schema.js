const _db = require('../../db');

async function ensureBattleCardsSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
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
}

module.exports = { ensureBattleCardsSchema };
