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

    -- Phase 4A: mirror audience membership to a HubSpot Static List so the
    -- sales team can use the same segment inside HubSpot for follow-up, ads
    -- custom audiences, etc. list_id is stored once the list is auto-created
    -- the first time the binding is saved (or set manually if you already
    -- own a list). Joins/leaves are pushed via the v3 lists/memberships API.
    CREATE TABLE IF NOT EXISTS audience_hubspot_list_bindings (
      id            SERIAL PRIMARY KEY,
      audience_id   INTEGER NOT NULL UNIQUE REFERENCES audience_segments(id) ON DELETE CASCADE,
      list_id       TEXT,
      list_name     TEXT NOT NULL,
      enabled       BOOLEAN NOT NULL DEFAULT true,
      auto_exit     BOOLEAN NOT NULL DEFAULT true,
      last_sync_at  TIMESTAMPTZ,
      last_error    TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Phase 4B: when a contact lands in a churn-risk audience, fire a
    -- single-touch personalised win-back via the existing drip engine. The
    -- variant body/subject is stored on the binding (regeneratable via the
    -- /api/reengage/generate endpoint from the UI). Tagged with the same
    -- provenance fields as Phase 3 drip bindings so onLeave can auto-exit.
    CREATE TABLE IF NOT EXISTS audience_reengage_bindings (
      id            SERIAL PRIMARY KEY,
      audience_id   INTEGER NOT NULL UNIQUE REFERENCES audience_segments(id) ON DELETE CASCADE,
      variant       JSONB NOT NULL,   -- { subject, preheader, body, cta, angle, tone }
      brand         TEXT,
      dry_run       BOOLEAN NOT NULL DEFAULT true,
      enabled       BOOLEAN NOT NULL DEFAULT true,
      auto_exit     BOOLEAN NOT NULL DEFAULT true,
      app_origin    TEXT,
      last_triggered_at TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  return true;
}

module.exports = { ensureAudiencesSchema };
