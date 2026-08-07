'use strict';

const _db = require('../../db');

async function ensureCapacitySchema() {
  if (!_db.hasDb()) return;
  const p = _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS team_capacity (
      id TEXT PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      member_name TEXT NOT NULL,
      role TEXT DEFAULT 'marketer',
      weekly_hours NUMERIC(6,2) NOT NULL DEFAULT 40,
      allocated_hours NUMERIC(6,2) NOT NULL DEFAULT 0,
      skills JSONB DEFAULT '[]',
      notes TEXT DEFAULT '',
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_team_capacity_tenant ON team_capacity(tenant_id, active);
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS capacity_assignments (
      id TEXT PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      member_id TEXT NOT NULL REFERENCES team_capacity(id) ON DELETE CASCADE,
      work_item TEXT NOT NULL,
      source TEXT DEFAULT 'manual',
      source_ref TEXT,
      hours NUMERIC(6,2) NOT NULL DEFAULT 0,
      due_date DATE,
      status TEXT DEFAULT 'open',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_capacity_assign_tenant ON capacity_assignments(tenant_id, status);
  `);
}

module.exports = { ensureCapacitySchema };
