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
  `);
}

module.exports = { ensureClientReportingSchema };
