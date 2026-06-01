const _db = require('../../db');

async function ensureYtCommentMinerSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS yt_comment_runs (
      id                  SERIAL PRIMARY KEY,
      tenant_id           INT NOT NULL REFERENCES tenants(id),
      channel_id          INT,
      channel_name        TEXT,
      video_url           TEXT,
      questions           JSONB NOT NULL DEFAULT '[]',
      themes              JSONB NOT NULL DEFAULT '[]',
      content_ideas       JSONB NOT NULL DEFAULT '[]',
      sentiment_breakdown JSONB NOT NULL DEFAULT '{}',
      comment_count       INT  NOT NULL DEFAULT 0,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS yt_comment_runs_tenant_created
      ON yt_comment_runs(tenant_id, created_at DESC)
  `);
}

module.exports = { ensureYtCommentMinerSchema };
