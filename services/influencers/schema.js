const _db = require('../../db');

async function ensureInfluencerSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS influencers (
      id SERIAL PRIMARY KEY,
      handle TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'instagram',
      name TEXT,
      bio TEXT,
      niche TEXT,
      country TEXT,
      followers INTEGER DEFAULT 0,
      engagement_rate NUMERIC(6,3) DEFAULT 0,
      contact_email TEXT,
      contact_phone TEXT,
      profile_url TEXT,
      status TEXT NOT NULL DEFAULT 'prospect',
      tags JSONB NOT NULL DEFAULT '[]',
      owner TEXT,
      deal_value NUMERIC(12,2) DEFAULT 0,
      last_contacted_at TIMESTAMPTZ,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (platform, handle)
    );
    CREATE INDEX IF NOT EXISTS idx_influencers_status ON influencers(status);
    CREATE INDEX IF NOT EXISTS idx_influencers_platform ON influencers(platform);
    CREATE INDEX IF NOT EXISTS idx_influencers_followers ON influencers(followers);

    CREATE TABLE IF NOT EXISTS influencer_outreach (
      id SERIAL PRIMARY KEY,
      influencer_id INTEGER NOT NULL REFERENCES influencers(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      subject TEXT,
      body TEXT,
      direction TEXT NOT NULL DEFAULT 'outbound',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_outreach_inf ON influencer_outreach(influencer_id, created_at DESC);
  `);

  // T45 — Influencer Fake-Detection & Deep Vetting: add vet columns
  await pool.query(`ALTER TABLE influencers ADD COLUMN IF NOT EXISTS vet_score   INT`);
  await pool.query(`ALTER TABLE influencers ADD COLUMN IF NOT EXISTS vet_risk    TEXT`);
  await pool.query(`ALTER TABLE influencers ADD COLUMN IF NOT EXISTS vet_flags   JSONB`);
  await pool.query(`ALTER TABLE influencers ADD COLUMN IF NOT EXISTS vetted_at   TIMESTAMPTZ`);
}

module.exports = { ensureInfluencerSchema };
