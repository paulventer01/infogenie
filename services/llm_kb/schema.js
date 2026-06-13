const _db = require('../../db');

async function ensureLlmKbSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS llm_kb_entries (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      entry_type VARCHAR(40) NOT NULL,
      title VARCHAR(500) NOT NULL,
      content TEXT NOT NULL,
      schema_json TEXT,
      target_llms TEXT DEFAULT 'openai,anthropic,perplexity',
      seo_keywords TEXT,
      brand_domain VARCHAR(255),
      llm_optimized BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_llm_kb_tenant ON llm_kb_entries(tenant_id, entry_type);
    CREATE TABLE IF NOT EXISTS llm_kb_submissions (
      id SERIAL PRIMARY KEY,
      entry_id INT NOT NULL REFERENCES llm_kb_entries(id) ON DELETE CASCADE,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      target_platform VARCHAR(80),
      submission_method VARCHAR(80),
      notes TEXT,
      status VARCHAR(30) DEFAULT 'pending',
      submitted_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_llm_kb_submissions_entry ON llm_kb_submissions(entry_id, submitted_at DESC);
  `);
}

module.exports = { ensureLlmKbSchema };
