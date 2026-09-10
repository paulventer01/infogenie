'use strict';

const _db = require('../../db');
const { ensureAdminSchema } = require('../admin/schema');

async function ensureClientReportingSchema() {
  if (!_db.hasDb()) return;
  // Reuse the canonical client entity; its tenant/id pair anchors the profile.
  await ensureAdminSchema();
  const pool = _db.getPool();
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS clients_tenant_unique_id ON clients(tenant_id, id);
    CREATE TABLE IF NOT EXISTS client_reporting_profiles (
      tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      client_id INT NOT NULL,
      report_source TEXT NOT NULL CHECK (report_source IN ('search-intel', 'campaigns')),
      default_format TEXT NOT NULL CHECK (default_format IN ('pdf', 'pptx', 'xlsx')),
      report_title VARCHAR(160) NOT NULL CHECK (report_title = btrim(report_title) AND length(report_title) > 0),
      branding_mode TEXT NOT NULL DEFAULT 'workspace' CHECK (branding_mode IN ('workspace', 'custom')),
      branding_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
      version INT NOT NULL DEFAULT 1 CHECK (version > 0),
      updated_by_user_id INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, client_id),
      FOREIGN KEY (tenant_id, client_id) REFERENCES clients(tenant_id, id) ON DELETE CASCADE,
      CHECK (branding_mode <> 'workspace' OR branding_overrides = '{}'::jsonb),
      CHECK (jsonb_typeof(branding_overrides) = 'object'
        AND branding_overrides - ARRAY['agencyName', 'footerText', 'primaryColor', 'accentColor', 'textColor']::text[] = '{}'::jsonb),
      CHECK (NOT (branding_overrides ? 'agencyName') OR
        (jsonb_typeof(branding_overrides->'agencyName') = 'string' AND length(branding_overrides->>'agencyName') <= 80)),
      CHECK (NOT (branding_overrides ? 'footerText') OR
        (jsonb_typeof(branding_overrides->'footerText') = 'string' AND length(branding_overrides->>'footerText') <= 200)),
      CHECK (NOT (branding_overrides ? 'primaryColor') OR
        (jsonb_typeof(branding_overrides->'primaryColor') = 'string' AND
         branding_overrides->>'primaryColor' ~ '^#[0-9A-Fa-f]{6}$')),
      CHECK (NOT (branding_overrides ? 'accentColor') OR
        (jsonb_typeof(branding_overrides->'accentColor') = 'string' AND
         branding_overrides->>'accentColor' ~ '^#[0-9A-Fa-f]{6}$')),
      CHECK (NOT (branding_overrides ? 'textColor') OR
        (jsonb_typeof(branding_overrides->'textColor') = 'string' AND
         branding_overrides->>'textColor' ~ '^#[0-9A-Fa-f]{6}$'))
    );
    CREATE TABLE IF NOT EXISTS client_reporting_recipients (
      tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      client_id INT NOT NULL,
      email TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT true,
      updated_by_user_id INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, client_id),
      FOREIGN KEY (tenant_id, client_id) REFERENCES clients(tenant_id, id) ON DELETE CASCADE,
      CHECK (email = lower(btrim(email)) AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' AND length(email) <= 240)
    );
    CREATE TABLE IF NOT EXISTS client_reporting_schedules (
      tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      client_id INT NOT NULL,
      cadence TEXT NOT NULL CHECK (cadence IN ('weekly', 'monthly')),
      timezone TEXT NOT NULL CHECK (length(timezone) > 0 AND length(timezone) <= 64),
      send_time TEXT NOT NULL CHECK (send_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
      format TEXT NOT NULL CHECK (format IN ('pdf', 'pptx', 'xlsx')),
      opted_in BOOLEAN NOT NULL DEFAULT false,
      paused BOOLEAN NOT NULL DEFAULT false,
      next_due_at TIMESTAMPTZ NOT NULL,
      updated_by_user_id INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, client_id),
      FOREIGN KEY (tenant_id, client_id) REFERENCES clients(tenant_id, id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS client_reporting_schedules_due_idx
      ON client_reporting_schedules (next_due_at) WHERE opted_in = true AND paused = false;
    CREATE TABLE IF NOT EXISTS client_reporting_schedule_claims (
      tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      client_id INT NOT NULL,
      window_key TEXT NOT NULL CHECK (length(window_key) > 0 AND length(window_key) <= 32),
      claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, client_id, window_key),
      FOREIGN KEY (tenant_id, client_id) REFERENCES clients(tenant_id, id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS client_reporting_delivery_history (
      id BIGSERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      client_id INT NOT NULL,
      window_key TEXT NOT NULL CHECK (length(window_key) > 0 AND length(window_key) <= 32),
      status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
      attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      recipient_email TEXT,
      profile_version INT,
      format TEXT CHECK (format IS NULL OR format IN ('pdf', 'pptx', 'xlsx')),
      error_code TEXT CHECK (error_code IS NULL OR length(error_code) <= 64),
      FOREIGN KEY (tenant_id, client_id) REFERENCES clients(tenant_id, id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS client_reporting_delivery_history_client_idx
      ON client_reporting_delivery_history (tenant_id, client_id, attempted_at DESC);
  `);
}

// Called only after the canonical client and both source schemas are ready.
// No inferred/backfilled assignments: existing records remain unmapped.
async function ensureClientReportingMappingSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE UNIQUE INDEX IF NOT EXISTS search_intel_queries_tenant_unique_id
      ON search_intel_queries(tenant_id, id);
    CREATE UNIQUE INDEX IF NOT EXISTS ad_campaigns_tenant_unique_id
      ON ad_campaigns(tenant_id, id);
    CREATE TABLE IF NOT EXISTS client_reporting_query_mappings (
      tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      query_id INT NOT NULL,
      client_id INT NOT NULL,
      mapping_id UUID NOT NULL UNIQUE,
      created_by_user_id INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, query_id),
      FOREIGN KEY (tenant_id, client_id) REFERENCES clients(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, query_id) REFERENCES search_intel_queries(tenant_id, id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS client_reporting_query_mappings_client_idx
      ON client_reporting_query_mappings(tenant_id, client_id, query_id);
    CREATE TABLE IF NOT EXISTS client_reporting_campaign_mappings (
      tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INT NOT NULL,
      client_id INT NOT NULL,
      mapping_id UUID NOT NULL UNIQUE,
      created_by_user_id INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, campaign_id),
      FOREIGN KEY (tenant_id, client_id) REFERENCES clients(tenant_id, id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id, campaign_id) REFERENCES ad_campaigns(tenant_id, id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS client_reporting_campaign_mappings_client_idx
      ON client_reporting_campaign_mappings(tenant_id, client_id, campaign_id);
  `);
}

module.exports = { ensureClientReportingSchema, ensureClientReportingMappingSchema };
