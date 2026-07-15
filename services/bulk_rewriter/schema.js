const _db = require('../../db');

async function ensureBulkRewriterSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS bulk_rewrite_jobs (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      name VARCHAR(255) NOT NULL DEFAULT 'Untitled Job',
      tone VARCHAR(40) DEFAULT 'professional',
      intensity VARCHAR(20) DEFAULT 'moderate',
      target_keywords TEXT,
      seo_focus BOOLEAN DEFAULT TRUE,
      status VARCHAR(20) DEFAULT 'pending',
      total_items INT DEFAULT 0,
      processed_items INT DEFAULT 0,
      failed_items INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_brw_jobs_tenant ON bulk_rewrite_jobs(tenant_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS bulk_rewrite_items (
      id SERIAL PRIMARY KEY,
      job_id INT NOT NULL REFERENCES bulk_rewrite_jobs(id) ON DELETE CASCADE,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      title VARCHAR(500),
      original_text TEXT NOT NULL,
      rewritten_text TEXT,
      word_count_orig INT DEFAULT 0,
      word_count_new INT DEFAULT 0,
      seo_score_orig INT,
      seo_score_new INT,
      changes_summary TEXT,
      status VARCHAR(20) DEFAULT 'pending',
      error_message TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_brw_items_job ON bulk_rewrite_items(job_id, status);
  `);
}

module.exports = { ensureBulkRewriterSchema };
