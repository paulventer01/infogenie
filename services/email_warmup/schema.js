const _db = require('../../db');

async function ensureEmailWarmupSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS email_warmup_accounts (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      email VARCHAR(255) NOT NULL,
      display_name VARCHAR(255),
      provider VARCHAR(40) DEFAULT 'smtp',
      smtp_host VARCHAR(255),
      smtp_port INT DEFAULT 587,
      smtp_user VARCHAR(255),
      smtp_pass_enc TEXT,
      status VARCHAR(30) DEFAULT 'active',
      current_day INT DEFAULT 0,
      target_days INT DEFAULT 42,
      start_volume INT DEFAULT 3,
      max_volume INT DEFAULT 200,
      current_daily_volume INT DEFAULT 3,
      warmup_start TIMESTAMPTZ DEFAULT NOW(),
      last_sent_at TIMESTAMPTZ,
      reputation_score INT DEFAULT 100,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_ewu_accounts_tenant ON email_warmup_accounts(tenant_id, status);

    CREATE TABLE IF NOT EXISTS email_warmup_log (
      id SERIAL PRIMARY KEY,
      account_id INT NOT NULL REFERENCES email_warmup_accounts(id) ON DELETE CASCADE,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      day_number INT NOT NULL,
      planned_volume INT DEFAULT 0,
      sent_volume INT DEFAULT 0,
      delivered_count INT DEFAULT 0,
      bounced_count INT DEFAULT 0,
      spam_count INT DEFAULT 0,
      open_rate NUMERIC(5,2) DEFAULT 0,
      reputation_score INT DEFAULT 100,
      blacklist_hits TEXT[],
      logged_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_ewu_log_account ON email_warmup_log(account_id, day_number DESC);

    CREATE TABLE IF NOT EXISTS email_warmup_blacklist_checks (
      id SERIAL PRIMARY KEY,
      account_id INT NOT NULL REFERENCES email_warmup_accounts(id) ON DELETE CASCADE,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      checked_at TIMESTAMPTZ DEFAULT NOW(),
      lists_checked INT DEFAULT 0,
      lists_hit INT DEFAULT 0,
      hit_details JSONB DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_ewu_bl_account ON email_warmup_blacklist_checks(account_id, checked_at DESC);
  `);
}

module.exports = { ensureEmailWarmupSchema };
