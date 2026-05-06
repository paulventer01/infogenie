// Optimizer schema — Postgres tables for the autonomous campaign optimizer.
// Idempotent. Called from server boot.
const _db = require('../../db');

async function ensureOptimizerSchema() {
  if (!_db.hasDb()) return false;
  const p = _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS ad_campaigns (
      id              SERIAL PRIMARY KEY,
      platform        TEXT NOT NULL,
      platform_camp_id TEXT NOT NULL,
      name            TEXT NOT NULL,
      objective       TEXT,
      daily_budget    NUMERIC(12,2),
      currency        TEXT DEFAULT 'USD',
      status          TEXT DEFAULT 'active',
      optimizer_enabled BOOLEAN DEFAULT false,
      target_roas     NUMERIC(6,2) DEFAULT 2.00,
      min_spend_floor NUMERIC(12,2) DEFAULT 50.00,
      max_daily_budget NUMERIC(12,2) DEFAULT 500.00,
      owner_email     TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (platform, platform_camp_id)
    );

    CREATE TABLE IF NOT EXISTS ad_performance_hourly (
      id            BIGSERIAL PRIMARY KEY,
      campaign_id   INTEGER NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
      bucket_hour   TIMESTAMPTZ NOT NULL,
      spend         NUMERIC(12,2) DEFAULT 0,
      impressions   BIGINT DEFAULT 0,
      clicks        BIGINT DEFAULT 0,
      conversions   NUMERIC(12,2) DEFAULT 0,
      revenue       NUMERIC(12,2) DEFAULT 0,
      raw           JSONB,
      fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (campaign_id, bucket_hour)
    );
    CREATE INDEX IF NOT EXISTS idx_perf_camp_bucket
      ON ad_performance_hourly(campaign_id, bucket_hour DESC);

    CREATE TABLE IF NOT EXISTS optimizer_actions (
      id            BIGSERIAL PRIMARY KEY,
      campaign_id   INTEGER REFERENCES ad_campaigns(id) ON DELETE CASCADE,
      action_type   TEXT NOT NULL,
      reason        TEXT,
      before_value  JSONB,
      after_value   JSONB,
      applied       BOOLEAN DEFAULT false,
      apply_error   TEXT,
      run_id        TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_actions_camp_time
      ON optimizer_actions(campaign_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS optimizer_settings (
      key         TEXT PRIMARY KEY,
      value       JSONB NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- ── Phase 8: 72h Creative Auto-Refresh ──────────────────────────────────
    -- Tracks individual ads (under a campaign) so we can rotate creative when
    -- it goes stale. Each row is one Meta/Google/TikTok ad object.
    CREATE TABLE IF NOT EXISTS ad_creatives (
      id              SERIAL PRIMARY KEY,
      campaign_id     INTEGER NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
      platform_ad_id  TEXT NOT NULL,
      adset_id        TEXT,
      headline        TEXT,
      body            TEXT,
      image_hash      TEXT,
      image_url       TEXT,
      cta             TEXT,
      link_url        TEXT,
      status          TEXT DEFAULT 'active',
      generation      INTEGER DEFAULT 1,
      parent_ad_id    TEXT,
      first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      paused_at       TIMESTAMPTZ,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (campaign_id, platform_ad_id)
    );
    CREATE INDEX IF NOT EXISTS idx_ad_creatives_camp ON ad_creatives(campaign_id);
    -- Google Ads RSA support (multi-headline / multi-description). Meta rows
    -- leave these NULL and use the singular headline/body columns above.
    ALTER TABLE ad_creatives ADD COLUMN IF NOT EXISTS headlines    JSONB;
    ALTER TABLE ad_creatives ADD COLUMN IF NOT EXISTS descriptions JSONB;
    ALTER TABLE ad_creatives ADD COLUMN IF NOT EXISTS final_url    TEXT;

    -- Audit log of every creative-refresh decision (generated copy/image,
    -- whether it was uploaded, which old ad got paused).
    CREATE TABLE IF NOT EXISTS creative_refreshes (
      id              BIGSERIAL PRIMARY KEY,
      campaign_id     INTEGER REFERENCES ad_campaigns(id) ON DELETE CASCADE,
      old_ad_id       TEXT,
      old_headline    TEXT,
      old_body        TEXT,
      new_ad_id       TEXT,
      new_headline    TEXT,
      new_body        TEXT,
      new_image_url   TEXT,
      reason          TEXT,
      perf_snapshot   JSONB,
      applied         BOOLEAN DEFAULT false,
      apply_error     TEXT,
      run_id          TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_creative_refresh_camp_time
      ON creative_refreshes(campaign_id, created_at DESC);

    -- ── Phase 7: Multi-Armed Bandit (ad-set-level budget allocation) ───────
    -- Tracks ad sets under each campaign (one "arm" per ad set) and their
    -- rolling 7-day performance, used by the Thompson-sampling allocator.
    CREATE TABLE IF NOT EXISTS ad_sets (
      id                SERIAL PRIMARY KEY,
      campaign_id       INTEGER NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
      platform_adset_id TEXT NOT NULL,
      name              TEXT,
      daily_budget      NUMERIC(12,2),
      status            TEXT DEFAULT 'active',
      first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (campaign_id, platform_adset_id)
    );
    CREATE INDEX IF NOT EXISTS idx_ad_sets_camp ON ad_sets(campaign_id);

    CREATE TABLE IF NOT EXISTS ad_set_performance_hourly (
      id            BIGSERIAL PRIMARY KEY,
      ad_set_id     INTEGER NOT NULL REFERENCES ad_sets(id) ON DELETE CASCADE,
      bucket_hour   TIMESTAMPTZ NOT NULL,
      spend         NUMERIC(12,2) DEFAULT 0,
      impressions   BIGINT DEFAULT 0,
      clicks        BIGINT DEFAULT 0,
      conversions   NUMERIC(12,2) DEFAULT 0,
      revenue       NUMERIC(12,2) DEFAULT 0,
      raw           JSONB,
      fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (ad_set_id, bucket_hour)
    );
    CREATE INDEX IF NOT EXISTS idx_adset_perf_time
      ON ad_set_performance_hourly(ad_set_id, bucket_hour DESC);

    -- One row per (run, ad-set) bandit allocation decision.
    CREATE TABLE IF NOT EXISTS bandit_allocations (
      id              BIGSERIAL PRIMARY KEY,
      campaign_id     INTEGER REFERENCES ad_campaigns(id) ON DELETE CASCADE,
      ad_set_id       INTEGER REFERENCES ad_sets(id) ON DELETE CASCADE,
      run_id          TEXT,
      prior_alpha     NUMERIC(12,2),
      prior_beta      NUMERIC(12,2),
      sampled_score   NUMERIC(12,6),
      avg_value       NUMERIC(12,4),
      old_budget      NUMERIC(12,2),
      new_budget      NUMERIC(12,2),
      share           NUMERIC(6,4),
      applied         BOOLEAN DEFAULT false,
      apply_error     TEXT,
      reason          TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_bandit_alloc_camp_time
      ON bandit_allocations(campaign_id, created_at DESC);
  `);
  return true;
}

async function getSetting(key, fallback = null) {
  if (!_db.hasDb()) return fallback;
  const r = await _db.getPool().query('SELECT value FROM optimizer_settings WHERE key=$1', [key]);
  return r.rows.length ? r.rows[0].value : fallback;
}

async function setSetting(key, value) {
  if (!_db.hasDb()) return false;
  await _db.getPool().query(`
    INSERT INTO optimizer_settings (key, value, updated_at) VALUES ($1, $2, now())
    ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()
  `, [key, JSON.stringify(value)]);
  return true;
}

module.exports = { ensureOptimizerSchema, getSetting, setSetting };
