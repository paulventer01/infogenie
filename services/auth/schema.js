// services/auth/schema.js — Platform Authentication Foundation
// Creates the tables that back per-user identity:
//   users             — one row per InfoGenie account
//   user_identities   — (user_id, provider, provider_user_id) for social login
//   email_tokens      — short-lived tokens for email verification + password reset
//   user_sessions     — express-session storage (managed by connect-pg-simple,
//                       but we create it here so it exists on boot)
const _db = require('../../db');

async function ensureAuthSchema() {
  if (!_db.hasDb()) return;
  const p = _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS users (
      id              SERIAL PRIMARY KEY,
      email           TEXT NOT NULL UNIQUE,
      password_hash   TEXT,
      name            TEXT DEFAULT '',
      is_owner        BOOLEAN NOT NULL DEFAULT FALSE,
      email_verified_at TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_login_at   TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email));

    CREATE TABLE IF NOT EXISTS user_identities (
      id                SERIAL PRIMARY KEY,
      user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider          TEXT NOT NULL,
      provider_user_id  TEXT NOT NULL,
      email             TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (provider, provider_user_id)
    );
    CREATE INDEX IF NOT EXISTS user_identities_user_idx ON user_identities (user_id);

    CREATE TABLE IF NOT EXISTS email_tokens (
      token       TEXT PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purpose     TEXT NOT NULL,
      expires_at  TIMESTAMPTZ NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      consumed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS email_tokens_user_idx ON email_tokens (user_id);

    CREATE TABLE IF NOT EXISTS user_sessions (
      sid    VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
      sess   JSON NOT NULL,
      expire TIMESTAMP(6) NOT NULL
    );
    CREATE INDEX IF NOT EXISTS user_sessions_expire_idx ON user_sessions (expire);
  `);
  console.log('[auth] schema ready (users, user_identities, email_tokens, user_sessions)');
}

module.exports = { ensureAuthSchema };
