const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');
async function ensureContentCalendarSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS content_calendar_runs (
      id SERIAL PRIMARY KEY,
      brand TEXT NOT NULL,
      goal TEXT,
      channels JSONB NOT NULL DEFAULT '[]'::jsonb,
      days INT NOT NULL DEFAULT 7,
      posts JSONB NOT NULL DEFAULT '[]'::jsonb,
      generated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_cc_brand_created ON content_calendar_runs(brand, created_at DESC);
  `);
  await addTenantIdColumn('content_calendar_runs');
  console.log('[content-calendar] schema ready');
}
module.exports = { ensureContentCalendarSchema };
