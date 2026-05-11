const _db = require('../../db');

async function ensureUnifiedInboxSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS unified_inbox_items (
      id BIGSERIAL PRIMARY KEY,
      source TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_url TEXT,
      author TEXT,
      title TEXT,
      content TEXT,
      sentiment TEXT,
      score NUMERIC,
      status TEXT NOT NULL DEFAULT 'new',
      assignee TEXT,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      notes TEXT,
      raw JSONB,
      occurred_at TIMESTAMPTZ,
      ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      handled_at TIMESTAMPTZ
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_inbox_source ON unified_inbox_items(source, source_id);
    CREATE INDEX IF NOT EXISTS idx_inbox_status ON unified_inbox_items(status, ingested_at DESC);
    CREATE INDEX IF NOT EXISTS idx_inbox_source ON unified_inbox_items(source, ingested_at DESC);
    CREATE INDEX IF NOT EXISTS idx_inbox_sentiment ON unified_inbox_items(sentiment);
  `);
}

module.exports = { ensureUnifiedInboxSchema };
