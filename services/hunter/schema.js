const _db = require('../../db');

async function ensureHunterSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hunter_searches (
      id          BIGSERIAL PRIMARY KEY,
      type        TEXT NOT NULL DEFAULT 'domain' CHECK (type IN ('domain','finder','verifier')),
      query       TEXT NOT NULL,
      result      JSONB NOT NULL DEFAULT '{}',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hunter_query ON hunter_searches(query, created_at DESC);
  `);
}

module.exports = { ensureHunterSchema };
