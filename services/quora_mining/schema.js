const _db = require('../../db');
async function ensureQuoraMiningSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool(); if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS quora_runs (
      id SERIAL PRIMARY KEY,
      topic TEXT NOT NULL,
      total_questions INTEGER NOT NULL DEFAULT 0,
      questions JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_quora_topic ON quora_runs(topic, created_at DESC);
  `);
}
module.exports = { ensureQuoraMiningSchema };
