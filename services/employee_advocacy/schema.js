const _db = require('../../db');

async function ensureAdvocacySchema() {
  const pool = _db.getPool();
  if (!_db.hasDb()) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS advocacy_posts (
      id          SERIAL PRIMARY KEY,
      title       TEXT NOT NULL,
      body        TEXT NOT NULL,
      platforms   TEXT[] DEFAULT ARRAY['linkedin','twitter','facebook'],
      tags        TEXT[] DEFAULT '{}',
      cta_url     TEXT,
      status      TEXT NOT NULL DEFAULT 'active',
      created_by  INTEGER,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS advocacy_share_keys (
      id          SERIAL PRIMARY KEY,
      share_key   TEXT UNIQUE NOT NULL,
      label       TEXT,
      active      BOOLEAN DEFAULT TRUE,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS advocacy_shares (
      id          SERIAL PRIMARY KEY,
      share_key   TEXT NOT NULL,
      platform    TEXT,
      post_id     INTEGER,
      shared_at   TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

module.exports = { ensureAdvocacySchema };
