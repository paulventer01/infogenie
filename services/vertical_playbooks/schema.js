const _db = require('../../db');

async function ensureVerticalPlaybooksSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS vertical_playbooks (
      id SERIAL PRIMARY KEY,
      vertical VARCHAR(100) NOT NULL,
      title VARCHAR(300) NOT NULL,
      description TEXT,
      content JSONB NOT NULL DEFAULT '{}',
      is_system BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
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
}

module.exports = { ensureVerticalPlaybooksSchema };
