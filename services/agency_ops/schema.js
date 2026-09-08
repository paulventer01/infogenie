'use strict';

const _db = require('../../db');

async function ensureAgencyOpsSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agency_time_entries (
      id TEXT PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      member_id TEXT NOT NULL,
      member_role TEXT,
      client_ref TEXT NOT NULL,
      project_ref TEXT,
      work_item TEXT NOT NULL,
      work_date DATE NOT NULL,
      hours NUMERIC(8,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
      billable BOOLEAN NOT NULL DEFAULT true,
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_agency_time_entries_tenant_date
      ON agency_time_entries(tenant_id, work_date DESC);
    CREATE INDEX IF NOT EXISTS idx_agency_time_entries_tenant_client
      ON agency_time_entries(tenant_id, client_ref, work_date DESC);
    CREATE INDEX IF NOT EXISTS idx_agency_time_entries_tenant_member
      ON agency_time_entries(tenant_id, member_id, work_date DESC);
  `);

  await pool.query(`
    ALTER TABLE agency_time_entries
      ADD COLUMN IF NOT EXISTS member_role TEXT;
    UPDATE agency_time_entries e
       SET member_role = m.role
      FROM team_capacity m
     WHERE e.member_role IS NULL
       AND m.id = e.member_id
       AND m.tenant_id = e.tenant_id;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agency_rate_cards (
      id TEXT PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      member_id TEXT,
      role TEXT,
      cost_rate NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (cost_rate >= 0),
      bill_rate NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (bill_rate >= 0),
      currency VARCHAR(10) NOT NULL DEFAULT 'USD',
      effective_from DATE NOT NULL,
      effective_to DATE,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (member_id IS NOT NULL OR role IS NOT NULL),
      CHECK (effective_to IS NULL OR effective_to >= effective_from)
    );

    CREATE INDEX IF NOT EXISTS idx_agency_rate_cards_lookup
      ON agency_rate_cards(tenant_id, member_id, role, effective_from DESC);
    CREATE INDEX IF NOT EXISTS idx_agency_rate_cards_active
      ON agency_rate_cards(tenant_id, active, effective_from DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agency_scope_baselines (
      id TEXT PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      client_ref TEXT NOT NULL,
      project_ref TEXT,
      name TEXT NOT NULL,
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      contracted_hours NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (contracted_hours >= 0),
      change_budget_hours NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (change_budget_hours >= 0),
      contracted_value NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (contracted_value >= 0),
      currency VARCHAR(10) NOT NULL DEFAULT 'USD',
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (period_end >= period_start)
    );

    CREATE INDEX IF NOT EXISTS idx_agency_scope_baselines_lookup
      ON agency_scope_baselines(tenant_id, client_ref, period_start, period_end);
  `);
}

module.exports = { ensureAgencyOpsSchema };
