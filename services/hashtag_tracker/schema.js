const _db = require('../../db');
const { enforceTenantIdNotNull } = require('../tenants/migration');
async function ensureHashtagTrackerSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS hashtag_watches (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      hashtag TEXT NOT NULL,
      platforms JSONB NOT NULL DEFAULT '["twitter","instagram","tiktok"]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS hashtag_scans (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      watch_id INTEGER NOT NULL REFERENCES hashtag_watches(id) ON DELETE CASCADE,
      hashtag TEXT NOT NULL,
      total_posts INTEGER NOT NULL DEFAULT 0,
      estimated_reach INTEGER NOT NULL DEFAULT 0,
      sentiment_pos INTEGER NOT NULL DEFAULT 0,
      sentiment_neu INTEGER NOT NULL DEFAULT 0,
      sentiment_neg INTEGER NOT NULL DEFAULT 0,
      top_posts JSONB NOT NULL DEFAULT '[]'::jsonb,
      top_influencers JSONB NOT NULL DEFAULT '[]'::jsonb,
      velocity TEXT DEFAULT 'stable',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_ht_watch ON hashtag_scans(watch_id, created_at DESC);
  `);
  try { await enforceTenantIdNotNull('hashtag_watches'); } catch(e) { console.error('[hashtag-tracker] watches fail-closed:', e.message); }
  try {
    await enforceTenantIdNotNull('hashtag_scans', {
      backfillFrom: { parentTable: 'hashtag_watches', parentIdColumn: 'id', childFkColumn: 'watch_id' },
      indexExtra: ['watch_id'],
    });
  } catch(e) { console.error('[hashtag-tracker] scans fail-closed:', e.message); }
}
module.exports = { ensureHashtagTrackerSchema };
