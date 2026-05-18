const _db = require('../../db');

async function ensureHeatmapsSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS heatmap_config (
      id              INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      clarity_project_id TEXT,
      clarity_api_token  TEXT,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`INSERT INTO heatmap_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
  console.log('[heatmaps] schema ready');
}

module.exports = { ensureHeatmapsSchema };
