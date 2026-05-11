const _db = require('../../db');

async function ensureSeoCrawlerSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool();
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS seo_crawl_runs (
      id TEXT PRIMARY KEY,
      root_url TEXT NOT NULL,
      max_pages INT NOT NULL DEFAULT 25,
      page_count INT NOT NULL DEFAULT 0,
      avg_score NUMERIC,
      site_grade TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      error TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS seo_crawl_pages (
      id BIGSERIAL PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES seo_crawl_runs(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      score INT,
      grade TEXT,
      summary JSONB,
      checks JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_seo_crawl_pages_run ON seo_crawl_pages(run_id, score);
  `);
}

module.exports = { ensureSeoCrawlerSchema };
