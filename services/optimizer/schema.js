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
