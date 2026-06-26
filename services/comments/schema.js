// Schema for F13 — Team Collaboration asset comments
const _db = require('../../db');

async function ensureCommentsSchema() {
  if (!_db.hasDb()) return;
  const p = _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS asset_comments (
      id          SERIAL PRIMARY KEY,
      tenant_id   INT NOT NULL REFERENCES tenants(id),
      asset_type  TEXT NOT NULL,          -- 'journey'|'campaign'|'experiment'|'landing-page'|'drip'|'audience' etc.
      asset_id    TEXT NOT NULL,          -- string so any ID format works
      user_id     INT REFERENCES users(id) ON DELETE SET NULL,
      parent_id   INT REFERENCES asset_comments(id) ON DELETE CASCADE,
      body        TEXT NOT NULL,
      reactions   JSONB DEFAULT '{}',     -- { "👍": 3, "🎉": 1 }
      edited_at   TIMESTAMPTZ,
      resolved_at TIMESTAMPTZ,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS asset_comments_lookup
      ON asset_comments(tenant_id, asset_type, asset_id)
      WHERE resolved_at IS NULL;
  `);
}

module.exports = { ensureCommentsSchema };
