// Lead Intelligence schema — unified inbound leads, review queue, search terms, transparency.
const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');

async function ensureLeadIntelligenceSchema() {
  if (!_db.hasDb()) return false;
  const p = _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS lead_intel_leads (
      id              BIGSERIAL PRIMARY KEY,
      tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      channel         TEXT NOT NULL,
      source_ref      TEXT,
      contact_name    TEXT,
      contact_email   TEXT,
      contact_phone   TEXT,
      message         TEXT,
      page_url        TEXT,
      platform        TEXT,
      utm_source      TEXT,
      utm_medium      TEXT,
      utm_campaign    TEXT,
      utm_term        TEXT,
      utm_content     TEXT,
      gclid           TEXT,
      fbclid          TEXT,
      campaign_id     INTEGER,
      score           INTEGER,
      tier            TEXT,
      classification  TEXT,
      reasoning       TEXT,
      signals         JSONB,
      suggested_actions JSONB,
      classifier_model TEXT,
      classified_at   TIMESTAMPTZ,
      review_status   TEXT DEFAULT 'pending',
      raw_payload     JSONB,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_lead_intel_leads_tenant_time
      ON lead_intel_leads(tenant_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_lead_intel_leads_tenant_tier
      ON lead_intel_leads(tenant_id, tier, created_at DESC);

    CREATE TABLE IF NOT EXISTS lead_intel_review_queue (
      id              BIGSERIAL PRIMARY KEY,
      tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      item_type       TEXT NOT NULL,
      item_id         BIGINT,
      title           TEXT NOT NULL,
      summary         TEXT,
      priority        TEXT DEFAULT 'normal',
      status          TEXT DEFAULT 'open',
      assignee        TEXT,
      resolution      TEXT,
      meta            JSONB,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolved_at     TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_lead_intel_review_open
      ON lead_intel_review_queue(tenant_id, status, created_at DESC);

    CREATE TABLE IF NOT EXISTS lead_intel_search_terms (
      id              BIGSERIAL PRIMARY KEY,
      tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      platform        TEXT DEFAULT 'google',
      campaign_name   TEXT,
      search_term     TEXT NOT NULL,
      match_type      TEXT,
      impressions     BIGINT DEFAULT 0,
      clicks          BIGINT DEFAULT 0,
      cost            NUMERIC(12,2) DEFAULT 0,
      conversions     NUMERIC(12,2) DEFAULT 0,
      window_days     INTEGER DEFAULT 30,
      synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, platform, search_term, campaign_name, window_days)
    );
    CREATE INDEX IF NOT EXISTS idx_lead_intel_search_cost
      ON lead_intel_search_terms(tenant_id, cost DESC);

    CREATE TABLE IF NOT EXISTS lead_intel_negative_suggestions (
      id              BIGSERIAL PRIMARY KEY,
      tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      platform        TEXT DEFAULT 'google',
      keyword         TEXT NOT NULL,
      reason          TEXT,
      estimated_waste NUMERIC(12,2),
      status          TEXT DEFAULT 'suggested',
      source_term_id  BIGINT REFERENCES lead_intel_search_terms(id) ON DELETE SET NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, platform, keyword)
    );
    CREATE INDEX IF NOT EXISTS idx_lead_intel_neg_status
      ON lead_intel_negative_suggestions(tenant_id, status);
  `);

  for (const t of ['lead_intel_leads', 'lead_intel_review_queue', 'lead_intel_search_terms', 'lead_intel_negative_suggestions']) {
    try { await addTenantIdColumn(t); } catch (e) { console.error(`[lead-intel/schema] tenant_id on ${t}:`, e.message); }
  }
  return true;
}

module.exports = { ensureLeadIntelligenceSchema };
