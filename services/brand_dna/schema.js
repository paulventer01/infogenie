const _db = require('../../db');

async function ensureBrandDnaSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS brand_dna_assets (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      asset_type VARCHAR(60) NOT NULL,
      title VARCHAR(255) NOT NULL,
      content TEXT NOT NULL,
      channel VARCHAR(60),
      performance_metric VARCHAR(120),
      performance_value NUMERIC(10,2),
      tags TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_brand_dna_assets_tenant ON brand_dna_assets(tenant_id, asset_type);
    CREATE TABLE IF NOT EXISTS brand_dna_profiles (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id) UNIQUE,
      brand_voice TEXT,
      tone_descriptors TEXT,
      banned_phrases TEXT,
      writing_style TEXT,
      sentence_length VARCHAR(30),
      example_headlines TEXT,
      example_hooks TEXT,
      example_ctas TEXT,
      colour_of_language TEXT,
      asset_count INT DEFAULT 0,
      generated_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_brand_dna_profiles_tenant ON brand_dna_profiles(tenant_id);
  `);
}

module.exports = { ensureBrandDnaSchema };
