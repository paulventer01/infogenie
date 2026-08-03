const crypto = require('crypto');
const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');

async function ensureReferralSchema() {
  if (!_db.hasDb()) return false;
  const p = _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS referral_programs (
      id              SERIAL PRIMARY KEY,
      tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name            TEXT NOT NULL,
      reward_type     TEXT NOT NULL DEFAULT 'percent',
      reward_value    NUMERIC(10,2) NOT NULL DEFAULT 10,
      referrer_reward NUMERIC(10,2),
      currency        TEXT NOT NULL DEFAULT 'USD',
      enabled         BOOLEAN NOT NULL DEFAULT true,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS referral_links (
      id              SERIAL PRIMARY KEY,
      tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      program_id      INTEGER NOT NULL REFERENCES referral_programs(id) ON DELETE CASCADE,
      code            TEXT NOT NULL,
      referrer_email  TEXT,
      referrer_name   TEXT,
      clicks          INTEGER NOT NULL DEFAULT 0,
      conversions     INTEGER NOT NULL DEFAULT 0,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(tenant_id, code)
    );
    CREATE TABLE IF NOT EXISTS referral_conversions (
      id              SERIAL PRIMARY KEY,
      tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      link_id         INTEGER NOT NULL REFERENCES referral_links(id) ON DELETE CASCADE,
      referee_email   TEXT,
      amount          NUMERIC(12,2),
      status          TEXT NOT NULL DEFAULT 'pending',
      meta            JSONB,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_referral_links_tenant ON referral_links(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_referral_conv_tenant ON referral_conversions(tenant_id, created_at DESC);
  `);
  for (const t of ['referral_programs', 'referral_links', 'referral_conversions']) {
    try { await addTenantIdColumn(t); } catch (_) { /* idempotent */ }
  }
  return true;
}

function _genCode() {
  return crypto.randomBytes(4).toString('hex');
}

module.exports = { ensureReferralSchema, _genCode };
