const _db = require('../../db');
async function ensureVocSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS voc_runs (
      id SERIAL PRIMARY KEY,
      brand TEXT NOT NULL,
      lookback_days INT NOT NULL DEFAULT 14,
      mention_count INT NOT NULL DEFAULT 0,
      themes JSONB NOT NULL DEFAULT '[]'::jsonb,
      summary TEXT,
      generated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_voc_brand_created ON voc_runs(brand, created_at DESC);
  `);
  console.log('[voc] schema ready');
}
module.exports = { ensureVocSchema };
