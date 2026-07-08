const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');

async function ensureCampaignComposerSchema() {
  if (!_db.hasDb()) return false;
  const p = _db.getPool();

  await p.query(`
    CREATE TABLE IF NOT EXISTS campaign_composer_drafts (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      prompt TEXT NOT NULL,
      draft JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'draft',
      segment_id INT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_campaign_composer_drafts_tenant ON campaign_composer_drafts(tenant_id);
  `);

  return true;
}

module.exports = { ensureCampaignComposerSchema };
