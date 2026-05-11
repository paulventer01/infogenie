const _db = require('../../db');
async function ensureSchemaGeneratorSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool(); if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_blocks (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      fields JSONB NOT NULL DEFAULT '{}',
      jsonld TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_schema_blocks_created ON schema_blocks(created_at DESC);
  `);
}
module.exports = { ensureSchemaGeneratorSchema };
