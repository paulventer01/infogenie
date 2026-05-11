// T38 — Carousel Generator
const _db = require('../../db');

async function ensureCarouselSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool();
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS carousels (
      id BIGSERIAL PRIMARY KEY,
      topic TEXT NOT NULL,
      structure TEXT NOT NULL,
      brand_voice TEXT,
      audience TEXT,
      slides JSONB NOT NULL,
      meta JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS carousels_created_idx ON carousels(created_at DESC);
  `);
}

module.exports = { ensureCarouselSchema };
