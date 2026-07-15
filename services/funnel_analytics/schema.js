const _db = require('../../db');

async function ensureFunnelAnalyticsSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS funnels (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      name VARCHAR(255) NOT NULL,
      description TEXT,
      status VARCHAR(20) DEFAULT 'active',
      pixel_id VARCHAR(32) UNIQUE NOT NULL DEFAULT substring(md5(random()::text || now()::text), 1, 16),
      currency VARCHAR(3) DEFAULT 'USD',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_funnels_tenant ON funnels(tenant_id, status);

    CREATE TABLE IF NOT EXISTS funnel_steps (
      id SERIAL PRIMARY KEY,
      funnel_id INT NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      name VARCHAR(255) NOT NULL,
      step_type VARCHAR(30) DEFAULT 'page',
      url_pattern VARCHAR(500),
      position INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_funnel_steps_funnel ON funnel_steps(funnel_id, position);

    CREATE TABLE IF NOT EXISTS funnel_events (
      id BIGSERIAL PRIMARY KEY,
      funnel_id INT NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
      step_id INT REFERENCES funnel_steps(id) ON DELETE SET NULL,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      session_id VARCHAR(64),
      event_type VARCHAR(20) NOT NULL,
      revenue NUMERIC(12,2) DEFAULT 0,
      currency VARCHAR(3) DEFAULT 'USD',
      utm_source VARCHAR(100),
      utm_medium VARCHAR(100),
      utm_campaign VARCHAR(100),
      utm_term VARCHAR(100),
      utm_content VARCHAR(100),
      referrer VARCHAR(500),
      ip_hash VARCHAR(64),
      user_agent TEXT,
      meta JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_funnel_events_funnel ON funnel_events(funnel_id, event_type, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_funnel_events_step ON funnel_events(step_id, event_type, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_funnel_events_session ON funnel_events(session_id, funnel_id);
  `);
}

module.exports = { ensureFunnelAnalyticsSchema };
