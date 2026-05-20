const _db = require('../../db');

async function ensureLinkedinAdsSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS linkedin_ad_searches (
      id          BIGSERIAL PRIMARY KEY,
      company     TEXT NOT NULL,
      result      JSONB NOT NULL DEFAULT '{}',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_lads_company ON linkedin_ad_searches(company, created_at DESC);
  `);
}

module.exports = { ensureLinkedinAdsSchema };
