const _db = require('../../db');
const hasDb = () => _db.hasDb();
const pool = { query: (...a) => _db.getPool().query(...a) };

async function ensureProjectsSchema() {
  if (!hasDb()) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketing_projects (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      goal          TEXT NOT NULL DEFAULT '',
      monthly_budget INT NOT NULL DEFAULT 0,
      channels      JSONB NOT NULL DEFAULT '[]'::jsonb,
      owner_email   TEXT,
      status        TEXT NOT NULL DEFAULT 'active',
      brand_color   TEXT DEFAULT '#0066FF',
      start_date    DATE,
      end_date      DATE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}
module.exports = { ensureProjectsSchema };
