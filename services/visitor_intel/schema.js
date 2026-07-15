const _db = require('../../db');

async function ensureVisitorIntelSchema() {
  if (!_db.hasDb()) return;
  const p = _db.getPool();

  await p.query(`
    CREATE TABLE IF NOT EXISTS visitor_tracking_tokens (
      id         SERIAL PRIMARY KEY,
      tenant_id  INT NOT NULL UNIQUE REFERENCES tenants(id),
      token      UUID NOT NULL DEFAULT gen_random_uuid(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS visitor_sessions (
      id                  SERIAL PRIMARY KEY,
      tenant_id           INT NOT NULL REFERENCES tenants(id),
      session_key         VARCHAR(128) NOT NULL,
      ip                  VARCHAR(45),
      isp_name            VARCHAR(255),
      company_name        VARCHAR(255),
      company_domain      VARCHAR(255),
      company_industry    VARCHAR(255),
      company_size        VARCHAR(100),
      company_country     VARCHAR(100),
      company_linkedin    VARCHAR(500),
      company_logo        VARCHAR(500),
      company_description TEXT,
      is_company          BOOLEAN NOT NULL DEFAULT FALSE,
      pages               JSONB NOT NULL DEFAULT '[]',
      visit_count         INT NOT NULL DEFAULT 1,
      intent_score        INT NOT NULL DEFAULT 0,
      first_seen          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      enriched            BOOLEAN NOT NULL DEFAULT FALSE,
      UNIQUE(tenant_id, session_key)
    );
    CREATE INDEX IF NOT EXISTS idx_vsessions_tenant_last   ON visitor_sessions(tenant_id, last_seen DESC);
    CREATE INDEX IF NOT EXISTS idx_vsessions_tenant_score  ON visitor_sessions(tenant_id, intent_score DESC);
    CREATE INDEX IF NOT EXISTS idx_vsessions_company       ON visitor_sessions(tenant_id, company_domain);
  `);
}

module.exports = { ensureVisitorIntelSchema };
