// Optimizer schema — Postgres tables for the autonomous campaign optimizer.
// Idempotent. Called from server boot.
const _db = require('../../db');
const { addTenantIdColumn, markTenantIdNotNull } = require('../tenants/migration');

// Tables that get a per-tenant `tenant_id` column. ad_campaigns also gets its
// legacy UNIQUE(platform, platform_camp_id) rewritten as a per-tenant unique
// so two tenants can independently mirror the same platform campaign id.
const _TENANT_TABLES = [
  'ad_campaigns', 'ad_performance_hourly', 'optimizer_actions',
  'ad_creatives', 'creative_refreshes', 'ad_sets',
  'ad_set_performance_hourly', 'bandit_allocations',
  'optimizer_dayparting', 'creative_fatigue_forecasts',
];
const _INDEX_EXTRAS = {
  ad_performance_hourly:     ['bucket_hour'],
  ad_set_performance_hourly: ['bucket_hour'],
};

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
      key         TEXT NOT NULL,
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

    -- ── T34: Day-part / hour-of-day budget shifting ────────────────────────
    -- One row per campaign per analysis run. hours_json is an array of 24
    -- {hour, spend, conv, revenue, cpa, roas, score} entries; best/worst hour
    -- arrays cite the top-N performing hour buckets. recommendation is the
    -- plain-English summary the UI surfaces.
    CREATE TABLE IF NOT EXISTS optimizer_dayparting (
      id            BIGSERIAL PRIMARY KEY,
      campaign_id   INTEGER NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
      window_days   INTEGER DEFAULT 14,
      total_spend   NUMERIC(12,2) DEFAULT 0,
      total_conv    NUMERIC(12,2) DEFAULT 0,
      hours_json    JSONB,
      best_hours    JSONB,
      worst_hours   JSONB,
      recommendation TEXT,
      run_id        TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_dayparting_camp_time
      ON optimizer_dayparting(campaign_id, created_at DESC);

    -- ── T34: Predictive creative fatigue ───────────────────────────────────
    -- For each ad creative, runs a linear regression on daily CTR over the
    -- learning window. If the slope is negative AND the projected CTR will
    -- drop below the floor within days_until_floor days, the creative is
    -- flagged predicted_fatigue=true so the optimizer can refresh it BEFORE
    -- performance actually craters.
    CREATE TABLE IF NOT EXISTS creative_fatigue_forecasts (
      id                 BIGSERIAL PRIMARY KEY,
      campaign_id        INTEGER REFERENCES ad_campaigns(id) ON DELETE CASCADE,
      creative_id        INTEGER REFERENCES ad_creatives(id) ON DELETE CASCADE,
      platform_ad_id     TEXT,
      window_days        INTEGER DEFAULT 14,
      samples            INTEGER DEFAULT 0,
      current_ctr        NUMERIC(8,5),
      slope_per_day      NUMERIC(10,7),
      projected_ctr_3d   NUMERIC(8,5),
      days_until_floor   NUMERIC(6,2),
      ctr_floor          NUMERIC(8,5),
      predicted_fatigue  BOOLEAN DEFAULT false,
      reason             TEXT,
      run_id             TEXT,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_fatigue_camp_time
      ON creative_fatigue_forecasts(campaign_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_fatigue_creative_time
      ON creative_fatigue_forecasts(creative_id, created_at DESC);
  `);

  // ── Phase 2B (multi-tenant): add tenant_id to every optimizer data table.
  // Idempotent — safe on every boot. The deferred phase2_migrate batch also
  // covers these as a fallback, but doing it inline here keeps the optimizer
  // self-contained and ensures the column exists before any route or cron
  // tries to read/write it.
  for (const t of _TENANT_TABLES) {
    try { await addTenantIdColumn(t, { indexExtra: _INDEX_EXTRAS[t] }); }
    catch (e) { console.error(`[optimizer/schema] tenant_id on ${t}: ${e.message}`); }
  }
  // Rewrite legacy UNIQUE(platform, platform_camp_id) so the same platform
  // campaign id can exist in multiple tenants (different mirrors).
  try {
    await p.query(`ALTER TABLE ad_campaigns DROP CONSTRAINT IF EXISTS ad_campaigns_platform_platform_camp_id_key`);
    await addTenantIdColumn('ad_campaigns', { uniqueWithExtra: ['platform','platform_camp_id'] });
  } catch (e) { console.error('[optimizer/schema] ad_campaigns unique rewrite:', e.message); }

  // Rewrite legacy PRIMARY KEY(key) so the same setting name can be stored
  // independently per tenant — otherwise one workspace's INSERT ... ON CONFLICT
  // silently overwrites another's. Becomes UNIQUE (tenant_id, key).
  try {
    await p.query(`ALTER TABLE optimizer_settings DROP CONSTRAINT IF EXISTS optimizer_settings_pkey`);
    await addTenantIdColumn('optimizer_settings', { uniqueWithExtra: ['key'] });
    // addTenantIdColumn backfills NULL rows to the default tenant; flip the
    // column NOT NULL so enforcement-on can't leave a tenant-less setting that
    // would be invisible to every workspace's scoped reads.
    await markTenantIdNotNull('optimizer_settings');
  } catch (e) { console.error('[optimizer/schema] optimizer_settings unique rewrite:', e.message); }

  return true;
}

async function getSetting(tenantId, key, fallback = null) {
  if (!_db.hasDb()) return fallback;
  if (tenantId == null) return fallback;
  const r = await _db.getPool().query(
    'SELECT value FROM optimizer_settings WHERE tenant_id=$1 AND key=$2', [tenantId, key]);
  return r.rows.length ? r.rows[0].value : fallback;
}

async function setSetting(tenantId, key, value) {
  if (!_db.hasDb()) return false;
  if (tenantId == null) return false;
  await _db.getPool().query(`
    INSERT INTO optimizer_settings (tenant_id, key, value, updated_at) VALUES ($1, $2, $3, now())
    ON CONFLICT (tenant_id, key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()
  `, [tenantId, key, JSON.stringify(value)]);
  return true;
}

// Per-run helper for crons that iterate many campaigns across tenants. Caches
// each (tenant_id, key) lookup (the in-flight promise) so the same tenant's
// setting isn't re-queried once per campaign. Build a fresh one per run.
function makeSettingsCache() {
  const cache = new Map();
  return (tenantId, key, fallback = null) => {
    const ck = tenantId + '\u0000' + key;
    if (cache.has(ck)) return cache.get(ck);
    const pr = getSetting(tenantId, key, fallback);
    cache.set(ck, pr);
    return pr;
  };
}

module.exports = { ensureOptimizerSchema, getSetting, setSetting, makeSettingsCache };
