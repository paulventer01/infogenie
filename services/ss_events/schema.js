const _db = require('../../db');

async function ensureSsEventsSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS ss_sources (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      source_name VARCHAR(255) NOT NULL,
      source_type VARCHAR(40) NOT NULL,
      pixel_id VARCHAR(255),
      ingest_token VARCHAR(64) UNIQUE,
      description TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      event_count INT DEFAULT 0,
      last_event_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_ss_sources_tenant ON ss_sources(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_ss_sources_token ON ss_sources(ingest_token);
    CREATE TABLE IF NOT EXISTS ss_events (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      source_id INT REFERENCES ss_sources(id) ON DELETE SET NULL,
      source_name VARCHAR(255),
      event_name VARCHAR(120) NOT NULL,
      event_type VARCHAR(60),
      email_hash VARCHAR(128),
      phone_hash VARCHAR(128),
      fbclid VARCHAR(255),
      gclid VARCHAR(255),
      ttclid VARCHAR(255),
      value NUMERIC(12,2),
      currency VARCHAR(10) DEFAULT 'USD',
      properties TEXT,
      user_agent TEXT,
      ip_hash VARCHAR(128),
      received_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_ss_events_tenant ON ss_events(tenant_id, received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ss_events_type ON ss_events(tenant_id, event_name, received_at DESC);
  `);
}

module.exports = { ensureSsEventsSchema };
