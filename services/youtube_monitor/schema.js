const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');

async function ensureYoutubeMonitorSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool();
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS yt_channels (
      id SERIAL PRIMARY KEY,
      brand TEXT NOT NULL,
      channel_name TEXT NOT NULL,
      channel_url TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_scanned_at TIMESTAMPTZ,
      UNIQUE (brand, channel_url)
    );
    CREATE TABLE IF NOT EXISTS yt_snapshots (
      id SERIAL PRIMARY KEY,
      channel_id INTEGER NOT NULL REFERENCES yt_channels(id) ON DELETE CASCADE,
      video_title TEXT NOT NULL,
      video_url TEXT,
      published_at TEXT,
      view_count BIGINT,
      like_count BIGINT,
      comment_count BIGINT,
      sentiment TEXT,
      summary TEXT,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_yt_snap_channel ON yt_snapshots(channel_id, captured_at DESC);
  `);

  for (const t of ['yt_channels', 'yt_snapshots']) {
    try { await addTenantIdColumn(t); }
    catch (e) { console.error(`[youtube-monitor] addTenantIdColumn ${t}: ${e.message}`); }
  }

  // (tenant_id, brand, channel_url) UNIQUE so two tenants can each track
  // the same channel under the same brand label. Create-then-drop preserves
  // dedup during rollout.
  try {
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_yt_tenant_brand_url
                        ON yt_channels (tenant_id, brand, channel_url)`);
    await pool.query(`ALTER TABLE yt_channels
                        DROP CONSTRAINT IF EXISTS yt_channels_brand_channel_url_key`);
  } catch (e) { console.error('[youtube-monitor] uniq migrate:', e.message); }
}

module.exports = { ensureYoutubeMonitorSchema };
