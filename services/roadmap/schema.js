// T37 — Get-Started Roadmap progress tracker
const _db = require('../../db');

async function ensureRoadmapSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool();
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS roadmap_progress (
      task_id TEXT PRIMARY KEY,
      completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      notes TEXT
    );
  `);
}

module.exports = { ensureRoadmapSchema };
