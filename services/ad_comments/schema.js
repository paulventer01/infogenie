const _db = require('../../db');

async function ensureAdCommentsSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool();
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ad_comment_alerts (
      id          TEXT PRIMARY KEY,
      tenant_id   INT  NOT NULL,
      platform    TEXT NOT NULL DEFAULT 'meta',
      ad_id       TEXT NOT NULL,
      ad_name     TEXT NOT NULL DEFAULT '',
      post_id     TEXT NOT NULL DEFAULT '',
      comment_id  TEXT NOT NULL,
      comment_text TEXT NOT NULL,
      author      TEXT NOT NULL DEFAULT '',
      sentiment   TEXT NOT NULL DEFAULT 'neutral'
                  CHECK (sentiment IN ('positive','neutral','negative')),
      actioned    BOOLEAN NOT NULL DEFAULT FALSE,
      actioned_at TIMESTAMPTZ,
      actioned_note TEXT NOT NULL DEFAULT '',
      detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(tenant_id, platform, comment_id)
    );
    CREATE INDEX IF NOT EXISTS idx_adcomm_tenant_det
      ON ad_comment_alerts(tenant_id, detected_at DESC);
    CREATE INDEX IF NOT EXISTS idx_adcomm_neg
      ON ad_comment_alerts(tenant_id, sentiment, actioned);
  `);
}

module.exports = { ensureAdCommentsSchema };
