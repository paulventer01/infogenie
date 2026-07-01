const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');
async function ensurePresenceScoreSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS presence_scores (
      id SERIAL PRIMARY KEY,
      brand TEXT NOT NULL,
      overall_score INTEGER NOT NULL DEFAULT 0,
      search_presence INTEGER DEFAULT 0,
      social_presence INTEGER DEFAULT 0,
      news_presence INTEGER DEFAULT 0,
      community_presence INTEGER DEFAULT 0,
      influencer_presence INTEGER DEFAULT 0,
      vs_competitors JSONB DEFAULT '[]'::jsonb,
      insights JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_presence_brand ON presence_scores(brand, created_at DESC);
  `);
  try { await addTenantIdColumn('presence_scores'); } catch(e) { console.error('[presence-score] migration:', e.message); }
}
module.exports = { ensurePresenceScoreSchema };
