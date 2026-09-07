const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');

async function ensureInfluencerAnalyticsSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS influencer_campaign_signals (
      id BIGSERIAL PRIMARY KEY,
      tenant_id INT,
      competitor TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'instagram',
      influencer_handle TEXT,
      follower_count INT,
      engagement_rate NUMERIC(8,4),
      content_url TEXT,
      theme TEXT,
      estimated_cost_usd NUMERIC(12,2),
      detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      raw JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE INDEX IF NOT EXISTS idx_inf_camp_tenant ON influencer_campaign_signals(tenant_id, competitor, detected_at DESC);
  `);
  try { await addTenantIdColumn('influencer_campaign_signals'); } catch (_) {}
  console.log('[influencer-analytics] schema ready');
}
module.exports = { ensureInfluencerAnalyticsSchema };
