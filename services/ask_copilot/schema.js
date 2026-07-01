const _db = require('../../db');

async function ensureAskCopilotSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS intelligence_cards (
      id           SERIAL PRIMARY KEY,
      tenant_id    INTEGER NOT NULL,
      user_id      INTEGER,
      question     TEXT NOT NULL,
      answer_json  JSONB NOT NULL DEFAULT '{}',
      mode         TEXT NOT NULL DEFAULT 'standard',
      pinned       BOOLEAN NOT NULL DEFAULT FALSE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_intel_cards_tenant ON intelligence_cards(tenant_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_intel_cards_pinned ON intelligence_cards(tenant_id, pinned) WHERE pinned = TRUE`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ask_history (
      id           SERIAL PRIMARY KEY,
      tenant_id    INTEGER NOT NULL,
      user_id      INTEGER,
      question     TEXT NOT NULL,
      answer_json  JSONB NOT NULL DEFAULT '{}',
      mode         TEXT NOT NULL DEFAULT 'standard',
      topic        TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // migration: add topic column if it doesn't exist yet
  await pool.query(`ALTER TABLE ask_history ADD COLUMN IF NOT EXISTS topic TEXT`);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ask_history_tenant ON ask_history(tenant_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ask_history_topic ON ask_history(tenant_id, topic) WHERE topic IS NOT NULL`);
}

module.exports = { ensureAskCopilotSchema };
