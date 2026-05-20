const _db = require('../../db');

async function ensureEmailBroadcastSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_broadcasts (
      id          BIGSERIAL PRIMARY KEY,
      name        TEXT NOT NULL DEFAULT '',
      subject     TEXT NOT NULL DEFAULT '',
      from_name   TEXT NOT NULL DEFAULT 'InfoGenie',
      from_email  TEXT NOT NULL DEFAULT '',
      body_html   TEXT NOT NULL DEFAULT '',
      body_text   TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sending','sent','paused')),
      recipient_count   INTEGER NOT NULL DEFAULT 0,
      sent_count        INTEGER NOT NULL DEFAULT 0,
      open_count        INTEGER NOT NULL DEFAULT 0,
      click_count       INTEGER NOT NULL DEFAULT 0,
      bounce_count      INTEGER NOT NULL DEFAULT 0,
      complaint_count   INTEGER NOT NULL DEFAULT 0,
      unsubscribe_count INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      sent_at     TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS email_broadcast_recipients (
      id               BIGSERIAL PRIMARY KEY,
      broadcast_id     BIGINT NOT NULL REFERENCES email_broadcasts(id) ON DELETE CASCADE,
      email            TEXT NOT NULL,
      name             TEXT NOT NULL DEFAULT '',
      status           TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','opened','clicked','bounced','complained','unsubscribed')),
      resend_message_id TEXT,
      sent_at          TIMESTAMPTZ,
      opened_at        TIMESTAMPTZ,
      clicked_at       TIMESTAMPTZ,
      bounced_at       TIMESTAMPTZ,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(broadcast_id, email)
    );
    CREATE INDEX IF NOT EXISTS idx_ebr_broadcast ON email_broadcast_recipients(broadcast_id, status);
    CREATE INDEX IF NOT EXISTS idx_ebr_msgid ON email_broadcast_recipients(resend_message_id) WHERE resend_message_id IS NOT NULL;
  `);
}

module.exports = { ensureEmailBroadcastSchema };
