const _db = require('../../db');

async function ensureDataProvenanceSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS insight_provenance (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      insight_key VARCHAR(200) NOT NULL,
      insight_label VARCHAR(300),
      source_type VARCHAR(50) NOT NULL,
      source_name VARCHAR(200),
      source_url TEXT,
      is_ai_estimated BOOLEAN NOT NULL DEFAULT FALSE,
      ai_model VARCHAR(100),
      freshness_hours INT,
      fetched_at TIMESTAMPTZ DEFAULT NOW(),
      data_snapshot JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS insight_provenance_tenant_key ON insight_provenance(tenant_id, insight_key);
  `);
}

module.exports = { ensureDataProvenanceSchema };
