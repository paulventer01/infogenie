const { getDb } = require('../../db');

async function ensureRealtimeNewsSchema() {
  const db = getDb();
  if (!db) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS rtn_saved_articles (
      id          SERIAL PRIMARY KEY,
      tenant_id   INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      article_url TEXT NOT NULL,
      title       TEXT NOT NULL,
      snippet     TEXT,
      source_name TEXT,
      published_at TIMESTAMPTZ,
      search_query TEXT,
      topic       TEXT,
      sentiment   TEXT DEFAULT 'neutral',
      saved_at    TIMESTAMPTZ DEFAULT NOW(),
      notes       TEXT
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_rtn_saved_tenant
      ON rtn_saved_articles(tenant_id, saved_at DESC)
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS rtn_search_history (
      id          SERIAL PRIMARY KEY,
      tenant_id   INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      query       TEXT NOT NULL,
      result_count INT DEFAULT 0,
      searched_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_rtn_history_tenant
      ON rtn_search_history(tenant_id, searched_at DESC)
  `);
}

module.exports = { ensureRealtimeNewsSchema };
