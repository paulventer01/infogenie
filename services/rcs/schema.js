const _db = require('../../db');

async function ensureRcsSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS rcs_campaigns (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      name VARCHAR(255) NOT NULL,
      channel VARCHAR(30) NOT NULL DEFAULT 'rcs',
      message_body TEXT NOT NULL,
      rich_card TEXT,
      cta_buttons TEXT,
      media_url VARCHAR(500),
      sender_name VARCHAR(120),
      status VARCHAR(20) DEFAULT 'draft',
      recipient_count INT DEFAULT 0,
      sent_count INT DEFAULT 0,
      delivered_count INT DEFAULT 0,
      read_count INT DEFAULT 0,
      reply_count INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      sent_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_rcs_campaigns_tenant ON rcs_campaigns(tenant_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS rcs_messages (
      id SERIAL PRIMARY KEY,
      campaign_id INT REFERENCES rcs_campaigns(id) ON DELETE CASCADE,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      recipient_phone VARCHAR(30),
      recipient_name VARCHAR(255),
      status VARCHAR(20) DEFAULT 'queued',
      error_message TEXT,
      sent_at TIMESTAMPTZ,
      delivered_at TIMESTAMPTZ,
      read_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_rcs_messages_campaign ON rcs_messages(campaign_id, status);
  `);
}

module.exports = { ensureRcsSchema };
