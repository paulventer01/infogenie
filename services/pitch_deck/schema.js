const _db = require('../../db');

async function ensurePitchDeckSchema() {
  if (!_db.hasDb()) return;
  const p = _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS pitch_decks (
      id           SERIAL PRIMARY KEY,
      tenant_id    INT NOT NULL REFERENCES tenants(id),
      deck_title   TEXT NOT NULL,
      goal         TEXT NOT NULL DEFAULT 'investor',
      brand        TEXT,
      product      TEXT,
      audience     TEXT,
      slide_count  INT NOT NULL DEFAULT 12,
      slides       JSONB NOT NULL DEFAULT '[]',
      source       TEXT NOT NULL DEFAULT 'openai',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_pitch_decks_tenant ON pitch_decks(tenant_id)`);
  console.log('[pitch-deck] schema ready');
}

module.exports = { ensurePitchDeckSchema };
