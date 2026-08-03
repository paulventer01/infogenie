const crypto = require('crypto');
const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');

async function ensureAffiliateSchema() {
  if (!_db.hasDb()) return false;
  const p = _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS affiliate_programs (
      id              SERIAL PRIMARY KEY,
      tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name            TEXT NOT NULL,
      commission_pct  NUMERIC(5,2) NOT NULL DEFAULT 15,
      cookie_days     INTEGER NOT NULL DEFAULT 30,
      payout_terms    TEXT,
      enabled         BOOLEAN NOT NULL DEFAULT true,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS affiliate_partners (
      id              SERIAL PRIMARY KEY,
      tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      program_id      INTEGER NOT NULL REFERENCES affiliate_programs(id) ON DELETE CASCADE,
      name            TEXT NOT NULL,
      email           TEXT,
      code            TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'active',
      clicks          INTEGER NOT NULL DEFAULT 0,
      conversions     INTEGER NOT NULL DEFAULT 0,
      earned          NUMERIC(12,2) NOT NULL DEFAULT 0,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(tenant_id, code)
    );
    CREATE TABLE IF NOT EXISTS affiliate_clicks (
      id              SERIAL PRIMARY KEY,
      tenant_id       INTEGER NOT NULL,
      partner_id      INTEGER NOT NULL REFERENCES affiliate_partners(id) ON DELETE CASCADE,
      landing_url     TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_affiliate_partners_tenant ON affiliate_partners(tenant_id);
  `);
  for (const t of ['affiliate_programs', 'affiliate_partners', 'affiliate_clicks']) {
    try { await addTenantIdColumn(t); } catch (_) { /* idempotent */ }
  }
  return true;
}

function _genAffCode() {
  return 'aff_' + crypto.randomBytes(3).toString('hex');
}

module.exports = { ensureAffiliateSchema, _genAffCode };
