const _db = require('../../db');

async function ensureSocialDraftsSchema() {
  if (!_db.hasDb()) return;
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS social_post_drafts (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL,
      profile_id VARCHAR(80) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'draft',
      text TEXT,
      media_urls JSONB NOT NULL DEFAULT '[]',
      platforms JSONB NOT NULL DEFAULT '[]',
      scheduled_for TIMESTAMPTZ,
      zernio_post_id VARCHAR(80),
      meta JSONB NOT NULL DEFAULT '{}',
      created_by VARCHAR(255),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_social_drafts_tenant_sched
      ON social_post_drafts(tenant_id, scheduled_for);
    CREATE INDEX IF NOT EXISTS idx_social_drafts_tenant_profile
      ON social_post_drafts(tenant_id, profile_id);
  `);
}

module.exports = { ensureSocialDraftsSchema };
