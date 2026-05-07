const _db = require('../../db');
async function ensurePricingWatchSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS pricing_watch_targets (
      id SERIAL PRIMARY KEY,
      label TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      competitor TEXT,
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS pricing_watch_snapshots (
      id SERIAL PRIMARY KEY,
      target_id INT NOT NULL REFERENCES pricing_watch_targets(id) ON DELETE CASCADE,
      product_name TEXT,
      price NUMERIC(12,2),
      currency TEXT,
      original_price NUMERIC(12,2),
      in_stock BOOLEAN,
      promo TEXT,
      raw_extract JSONB,
      taken_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_pws_target_taken ON pricing_watch_snapshots(target_id, taken_at DESC);
  `);
  console.log('[pricing-watch] schema ready');
}
module.exports = { ensurePricingWatchSchema };
