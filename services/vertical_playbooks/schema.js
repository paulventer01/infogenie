const _db = require('../../db');
const { ensureVerticalPlaybooksXorCheck } = require('../tenants/preflight');

async function ensureVerticalPlaybooksSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS vertical_playbooks (
      id SERIAL PRIMARY KEY,
      -- MIXED (roles pattern): is_system=TRUE catalog rows keep tenant_id IS NULL
      -- (shared library). Custom is_system=FALSE rows are tenant-owned and must
      -- stamp tenant_id. Do not backfill system rows onto an arbitrary tenant.
      -- CHECK vertical_playbooks_system_xor_tenant: catalog xor custom.
      tenant_id INT REFERENCES tenants(id) ON DELETE CASCADE,
      vertical VARCHAR(100) NOT NULL,
      title VARCHAR(300) NOT NULL,
      description TEXT,
      content JSONB NOT NULL DEFAULT '{}',
      is_system BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT vertical_playbooks_system_xor_tenant CHECK (
        (is_system IS TRUE AND tenant_id IS NULL)
        OR (is_system IS FALSE AND tenant_id IS NOT NULL)
      )
    );
    CREATE TABLE IF NOT EXISTS active_playbooks (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      playbook_id INT NOT NULL REFERENCES vertical_playbooks(id),
      progress JSONB DEFAULT '{}',
      activated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, playbook_id)
    );
  `);

  await p.query(`
    ALTER TABLE vertical_playbooks
      ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id) ON DELETE CASCADE
  `);

  await p.query(`
    CREATE INDEX IF NOT EXISTS vertical_playbooks_tenant_idx
      ON vertical_playbooks (tenant_id)
  `);

  // Partial unique indexes — same shape as roles:
  //   system catalog: unique by vertical where tenant_id IS NULL
  //   custom: unique by (tenant_id, title) where tenant_id IS NOT NULL
  await p.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS vertical_playbooks_system_vertical_idx
      ON vertical_playbooks (vertical) WHERE tenant_id IS NULL
  `);
  await p.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS vertical_playbooks_tenant_title_idx
      ON vertical_playbooks (tenant_id, title) WHERE tenant_id IS NOT NULL
  `);

  // Existing installs: ADD CONSTRAINT only when every row already satisfies
  // the xor. Violators are left in place (not auto-assigned); preflight reports them.
  await ensureVerticalPlaybooksXorCheck();
}

module.exports = { ensureVerticalPlaybooksSchema };
