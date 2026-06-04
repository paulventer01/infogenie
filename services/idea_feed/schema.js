const _db = require('../../db');

async function ensureIdeaFeedSchema() {
  if (!_db.hasDb()) return;
  const p = _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS idea_feed_items (
      id           SERIAL PRIMARY KEY,
      tenant_id    INT NOT NULL REFERENCES tenants(id),
      angle        TEXT NOT NULL,
      headline     TEXT NOT NULL,
      copy         TEXT NOT NULL,
      channel      TEXT NOT NULL DEFAULT 'instagram',
      hashtags     JSONB NOT NULL DEFAULT '[]',
      cta          TEXT,
      visual_concept TEXT,
      status       TEXT NOT NULL DEFAULT 'pending',
      batch_date   DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_idea_feed_tenant_date ON idea_feed_items(tenant_id, batch_date)`);
  console.log('[idea-feed] schema ready');
}

module.exports = { ensureIdeaFeedSchema };
