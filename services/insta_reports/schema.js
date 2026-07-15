const _db = require('../../db');

async function ensureInstaReportsSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS insta_report_prospects (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      business_name VARCHAR(255) NOT NULL,
      contact_name VARCHAR(255),
      email VARCHAR(255),
      website_url VARCHAR(500),
      phone VARCHAR(40),
      industry VARCHAR(100),
      location VARCHAR(255),
      notes TEXT,
      source VARCHAR(30) DEFAULT 'manual',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_irp_tenant ON insta_report_prospects(tenant_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS insta_reports (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      prospect_id INT NOT NULL REFERENCES insta_report_prospects(id) ON DELETE CASCADE,
      sections_enabled TEXT[] DEFAULT ARRAY['seo','pagespeed','content','social','competitors','recommendations'],
      report_data JSONB DEFAULT '{}',
      status VARCHAR(20) DEFAULT 'pending',
      public_token VARCHAR(48) UNIQUE,
      viewed_at TIMESTAMPTZ,
      generated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_ir_tenant ON insta_reports(tenant_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ir_prospect ON insta_reports(prospect_id);
    CREATE INDEX IF NOT EXISTS idx_ir_token ON insta_reports(public_token);

    CREATE TABLE IF NOT EXISTS insta_report_sends (
      id SERIAL PRIMARY KEY,
      report_id INT NOT NULL REFERENCES insta_reports(id) ON DELETE CASCADE,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      recipient_email VARCHAR(255) NOT NULL,
      subject VARCHAR(500),
      sent_at TIMESTAMPTZ DEFAULT NOW(),
      opened_at TIMESTAMPTZ,
      status VARCHAR(20) DEFAULT 'sent'
    );
    CREATE INDEX IF NOT EXISTS idx_irs_report ON insta_report_sends(report_id);
  `);
}

module.exports = { ensureInstaReportsSchema };
