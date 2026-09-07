'use strict';

const _db = require('../../db');

async function ensureMarketingPlanSchema() {
  if (!_db.hasDb()) return false;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketing_plans (
      id            SERIAL PRIMARY KEY,
      tenant_id     INTEGER NOT NULL UNIQUE,
      title         TEXT NOT NULL DEFAULT 'Revenue Marketing Plan',
      current_step  INTEGER NOT NULL DEFAULT 1,
      steps_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  return true;
}

module.exports = { ensureMarketingPlanSchema };
