const _db = require('../../db');

async function ensureLinkedInOutreachSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS linkedin_sequences (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      name VARCHAR(255) NOT NULL,
      objective VARCHAR(100) DEFAULT 'lead_generation',
      target_title VARCHAR(255),
      target_industry VARCHAR(255),
      connection_message TEXT,
      followup_1_message TEXT,
      followup_1_delay_days INT DEFAULT 3,
      followup_2_message TEXT,
      followup_2_delay_days INT DEFAULT 7,
      followup_3_message TEXT,
      followup_3_delay_days INT DEFAULT 14,
      daily_connection_limit INT DEFAULT 20,
      status VARCHAR(30) DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_li_sequences_tenant ON linkedin_sequences(tenant_id, status);

    CREATE TABLE IF NOT EXISTS linkedin_contacts (
      id SERIAL PRIMARY KEY,
      sequence_id INT NOT NULL REFERENCES linkedin_sequences(id) ON DELETE CASCADE,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      linkedin_url VARCHAR(500),
      first_name VARCHAR(100),
      last_name VARCHAR(100),
      title VARCHAR(255),
      company VARCHAR(255),
      industry VARCHAR(100),
      location VARCHAR(255),
      email VARCHAR(255),
      status VARCHAR(40) DEFAULT 'pending',
      connection_sent_at TIMESTAMPTZ,
      connected_at TIMESTAMPTZ,
      followup_1_sent_at TIMESTAMPTZ,
      followup_2_sent_at TIMESTAMPTZ,
      followup_3_sent_at TIMESTAMPTZ,
      replied_at TIMESTAMPTZ,
      reply_snippet TEXT,
      notes TEXT,
      added_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_li_contacts_sequence ON linkedin_contacts(sequence_id, status);
    CREATE INDEX IF NOT EXISTS idx_li_contacts_tenant ON linkedin_contacts(tenant_id, added_at DESC);
  `);
}

module.exports = { ensureLinkedInOutreachSchema };
