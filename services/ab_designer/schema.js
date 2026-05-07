const _db = require('../../db');
async function ensureAbDesignerSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS ab_designer_runs (
      id SERIAL PRIMARY KEY,
      brand TEXT,
      element_kind TEXT NOT NULL,
      original TEXT,
      goal TEXT,
      audience TEXT,
      variants JSONB NOT NULL DEFAULT '[]'::jsonb,
      generated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_abd_created ON ab_designer_runs(created_at DESC);
  `);
  console.log('[ab-designer] schema ready');
}
module.exports = { ensureAbDesignerSchema };
