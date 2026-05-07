const _db = require('../../db');
async function ensureChatbotBuilderSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool(); if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chatbot_configs (
      id SERIAL PRIMARY KEY,
      brand TEXT NOT NULL,
      greeting TEXT NOT NULL DEFAULT '',
      tone TEXT NOT NULL DEFAULT 'friendly',
      faq JSONB NOT NULL DEFAULT '[]',
      fallback TEXT NOT NULL DEFAULT '',
      lead_fields JSONB NOT NULL DEFAULT '[]',
      accent TEXT NOT NULL DEFAULT '#6366F1',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_chatbot_brand ON chatbot_configs(brand, created_at DESC);
  `);
}
module.exports = { ensureChatbotBuilderSchema };
