const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');

async function ensureEmailRepliesSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_replies (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER,
      from_email TEXT NOT NULL,
      to_email TEXT,
      subject TEXT,
      body_text TEXT,
      body_html TEXT,
      message_id TEXT,
      in_reply_to TEXT,
      provider TEXT DEFAULT 'resend',
      provider_email_id TEXT,
      matched_provider_id TEXT,
      matched_channel TEXT,
      drip_enrollment_id TEXT,
      broadcast_recipient_id INTEGER,
      raw JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_email_replies_tenant_created
      ON email_replies(tenant_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_email_replies_provider_id
      ON email_replies(provider, provider_email_id)
      WHERE provider_email_id IS NOT NULL;
  `);
  try { await addTenantIdColumn('email_replies'); }
  catch (e) { console.error('[email-replies] addTenantIdColumn:', e.message); }
  console.log('[email-replies] schema ready');
}

module.exports = { ensureEmailRepliesSchema };
