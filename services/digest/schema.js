const _db = require('../../db');

async function ensureSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS digest_runs (
      id SERIAL PRIMARY KEY,
      brand TEXT NOT NULL,
      headline TEXT NOT NULL,
      summary_md TEXT NOT NULL,
      sections JSONB NOT NULL DEFAULT '[]'::jsonb,
      stats JSONB NOT NULL DEFAULT '{}'::jsonb,
      generated_by TEXT NOT NULL DEFAULT 'template',
      delivered_to JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_digest_runs_brand_created ON digest_runs(brand, created_at DESC);
  `);
  console.log('[digest] schema ready');
}

module.exports = { ensureDigestSchema: ensureSchema };
