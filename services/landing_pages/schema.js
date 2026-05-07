const _db = require('../../db');
async function ensureLandingPagesSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS landing_pages (
      id SERIAL PRIMARY KEY,
      brand TEXT,
      title TEXT NOT NULL,
      goal TEXT,
      audience TEXT,
      brief TEXT,
      content JSONB NOT NULL DEFAULT '{}'::jsonb,
      html TEXT NOT NULL,
      generated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_lp_created ON landing_pages(created_at DESC);
  `);
  console.log('[landing-pages] schema ready');
}
module.exports = { ensureLandingPagesSchema };
