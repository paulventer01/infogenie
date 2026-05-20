const _db = require('../../db');

async function ensureMediaIntelSchema() {
  const pool = _db.getPool();
  if (!_db.hasDb()) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS media_intel_scans (
      id           SERIAL PRIMARY KEY,
      brand        TEXT NOT NULL,
      competitors  TEXT[],
      results      JSONB,
      summary      TEXT,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

module.exports = { ensureMediaIntelSchema };
