// Dynamic Audiences (Segments) — Postgres schema.
// Drip-style real-time, rule-based audience membership.
// Idempotent — called from server boot.
const _db = require('../../db');

async function ensureAudiencesSchema() {
  if (!_db.hasDb()) return false;
  const p = _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS audience_segments (
      id            SERIAL PRIMARY KEY,
      name          TEXT NOT NULL,
      description   TEXT,
      rules         JSONB NOT NULL DEFAULT '{"match":"all","conditions":[]}'::jsonb,
      owner_email   TEXT,
      enabled       BOOLEAN NOT NULL DEFAULT true,
      member_count  INTEGER NOT NULL DEFAULT 0,
      last_evaluated_at TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS audience_segment_members (
      id           BIGSERIAL PRIMARY KEY,
      segment_id   INTEGER NOT NULL REFERENCES audience_segments(id) ON DELETE CASCADE,
      contact_id   TEXT NOT NULL,
      contact_email TEXT,
      joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      left_at      TIMESTAMPTZ,
      UNIQUE (segment_id, contact_id)
    );
    CREATE INDEX IF NOT EXISTS idx_aud_members_segment_active
      ON audience_segment_members(segment_id) WHERE left_at IS NULL;

    CREATE TABLE IF NOT EXISTS audience_evaluation_log (
      id           BIGSERIAL PRIMARY KEY,
      segment_id   INTEGER REFERENCES audience_segments(id) ON DELETE CASCADE,
      ran_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      contacts_scanned INTEGER DEFAULT 0,
      members_added INTEGER DEFAULT 0,
      members_removed INTEGER DEFAULT 0,
      duration_ms  INTEGER,
      source       TEXT,
      error        TEXT
    );

    -- Phase 3: bind a saved audience to a Drip campaign sequence. When a
    -- contact JOINS the segment they are auto-enrolled; when they LEAVE the
    -- segment, any active enrollment that originated from this binding is
    -- auto-marked unsubscribed so contacts auto-flow in/out of the funnel.
    CREATE TABLE IF NOT EXISTS audience_drip_bindings (
      id           SERIAL PRIMARY KEY,
      audience_id  INTEGER NOT NULL UNIQUE REFERENCES audience_segments(id) ON DELETE CASCADE,
      sequence     JSONB NOT NULL,
      brand        TEXT,
      dry_run      BOOLEAN NOT NULL DEFAULT true,
      enabled      BOOLEAN NOT NULL DEFAULT true,
      app_origin   TEXT,
      auto_exit    BOOLEAN NOT NULL DEFAULT true,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  return true;
}

module.exports = { ensureAudiencesSchema };
