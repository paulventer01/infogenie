const _db = require('../../db');

async function ensureEmailDesignerSchema() {
  if (!_db.hasDb()) return;
  const p = _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS email_templates (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      name VARCHAR(255) NOT NULL,
      description TEXT,
      subject VARCHAR(500),
      blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
      global_styles JSONB NOT NULL DEFAULT '{}'::jsonb,
      rendered_html TEXT,
      spam_score NUMERIC(4,1),
      status VARCHAR(20) DEFAULT 'draft',
      tags VARCHAR(500),
      version INT DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_email_templates_tenant ON email_templates(tenant_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS email_template_versions (
      id BIGSERIAL PRIMARY KEY,
      template_id INT NOT NULL REFERENCES email_templates(id) ON DELETE CASCADE,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      version INT NOT NULL,
      blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
      global_styles JSONB NOT NULL DEFAULT '{}'::jsonb,
      rendered_html TEXT,
      saved_by VARCHAR(320),
      note TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_email_template_versions_tmpl ON email_template_versions(template_id, version DESC);
  `);
}

module.exports = { ensureEmailDesignerSchema };
