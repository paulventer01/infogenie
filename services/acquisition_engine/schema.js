const _db = require('../../db');

async function ensureAcquisitionEngineSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS acquisition_campaigns (
      id            SERIAL PRIMARY KEY,
      tenant_id     INT NOT NULL REFERENCES tenants(id),
      name          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'draft',
      config        JSONB NOT NULL DEFAULT '{}',
      stats         JSONB NOT NULL DEFAULT '{}',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS acquisition_campaigns_tenant_idx ON acquisition_campaigns(tenant_id);

    CREATE TABLE IF NOT EXISTS acquisition_prospects (
      id              SERIAL PRIMARY KEY,
      tenant_id       INT NOT NULL REFERENCES tenants(id),
      campaign_id     INT REFERENCES acquisition_campaigns(id) ON DELETE CASCADE,
      name            TEXT,
      company         TEXT,
      email           TEXT,
      role            TEXT,
      score           INT DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'found',
      email_sent_at   TIMESTAMPTZ,
      reply_received  BOOLEAN DEFAULT FALSE,
      meeting_booked  BOOLEAN DEFAULT FALSE,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS acquisition_prospects_campaign_idx ON acquisition_prospects(campaign_id);
    CREATE INDEX IF NOT EXISTS acquisition_prospects_tenant_idx ON acquisition_prospects(tenant_id);
  `);
}

module.exports = { ensureAcquisitionEngineSchema };
