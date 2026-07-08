const _db = require('../../db');

async function ensureReviewReplySchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool(); if (!pool) return;
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS review_reply_drafts (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      platform TEXT,
      reviewer_name TEXT,
      rating INT,
      review_text TEXT,
      ai_draft_reply TEXT,
      status TEXT DEFAULT 'pending',
      source_review_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_rev_reply_tenant ON review_reply_drafts(tenant_id, status);

    CREATE TABLE IF NOT EXISTS review_request_rules (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      channel TEXT NOT NULL,
      delay_hours INT DEFAULT 24,
      message_template TEXT,
      target_platform_url TEXT,
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_rev_req_rules_tenant ON review_request_rules(tenant_id, active);

    CREATE TABLE IF NOT EXISTS review_request_log (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      rule_id INT REFERENCES review_request_rules(id),
      contact_email TEXT,
      contact_phone TEXT,
      sent_at TIMESTAMPTZ DEFAULT NOW(),
      status TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_rev_req_log_tenant ON review_request_log(tenant_id, rule_id);
  `);
}

module.exports = { ensureReviewReplySchema };
