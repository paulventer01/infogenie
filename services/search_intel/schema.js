// Search & AI Visibility Intelligence — DDL.
// • search_intel_queries:  tracked prompts/keywords the user wants monitored
//   across multiple LLMs (e.g. "best CRM for SaaS startups").
// • search_intel_llm_runs: each daily run per provider — captures whether the
//   user's brand was mentioned, position in the answer, and the cited URLs.
// • search_intel_pulse_runs: DataForSEO keyword-idea expansions for a seed
//   term + locale (the "what is the world searching for" view).
// • search_intel_images:   OpenAI-vision logo/brand detections cached per URL.
const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');

async function ensureSearchIntelSchema() {
  if (!_db.hasDb()) return false;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS search_intel_queries (
      id          SERIAL PRIMARY KEY,
      query       TEXT NOT NULL,
      brand       TEXT NOT NULL,
      competitors TEXT[] NOT NULL DEFAULT '{}',
      locale      TEXT NOT NULL DEFAULT 'en-US',
      enabled     BOOLEAN NOT NULL DEFAULT true,
      last_run_at TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (query, brand, locale)
    );

    CREATE TABLE IF NOT EXISTS search_intel_llm_runs (
      id              SERIAL PRIMARY KEY,
      query_id        INTEGER NOT NULL REFERENCES search_intel_queries(id) ON DELETE CASCADE,
      provider        TEXT NOT NULL,
      response_text   TEXT NOT NULL,
      brand_mentioned BOOLEAN NOT NULL DEFAULT false,
      brand_position  INTEGER,
      competitor_hits JSONB NOT NULL DEFAULT '[]',
      citations       JSONB NOT NULL DEFAULT '[]',
      tokens_used     INTEGER,
      error           TEXT,
      ran_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS search_intel_llm_runs_query_idx ON search_intel_llm_runs(query_id, ran_at DESC);

    CREATE TABLE IF NOT EXISTS search_intel_pulse_runs (
      id          SERIAL PRIMARY KEY,
      seed        TEXT NOT NULL,
      locale      TEXT NOT NULL DEFAULT 'en-US',
      suggestions JSONB NOT NULL DEFAULT '[]',
      total_volume BIGINT,
      ran_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS search_intel_pulse_seed_idx ON search_intel_pulse_runs(seed, ran_at DESC);

    CREATE TABLE IF NOT EXISTS search_intel_images (
      id          SERIAL PRIMARY KEY,
      source_url  TEXT NOT NULL UNIQUE,
      brands      JSONB NOT NULL DEFAULT '[]',
      objects     JSONB NOT NULL DEFAULT '[]',
      raw         TEXT,
      ran_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // ── Phase 2 migration (inline) ───────────────────────────────────────────
  // These tables are tenant-scoped. Run the tenant_id migration inline (rather
  // than relying solely on the deferred phase2 batch) so reads/writes that use
  // tenant_id work immediately on boot, including on fresh installs. The
  // deferred batch then becomes a redundant no-op.
  //
  // search_intel_queries: its legacy global UNIQUE (query, brand, locale) is
  // replaced with a per-tenant composite so two workspaces can track the same
  // prompt independently.
  //
  // search_intel_images: its legacy global UNIQUE (source_url) is replaced with
  // a per-tenant composite so each workspace keeps its own logo/brand cache and
  // one workspace's analysis can't leak into another's.
  try {
    await pool.query(`ALTER TABLE search_intel_queries DROP CONSTRAINT IF EXISTS search_intel_queries_query_brand_locale_key`);
    await addTenantIdColumn('search_intel_queries', { uniqueWithExtra: ['query', 'brand', 'locale'] });
    await addTenantIdColumn('search_intel_llm_runs');
    await addTenantIdColumn('search_intel_pulse_runs');
    await pool.query(`ALTER TABLE search_intel_images DROP CONSTRAINT IF EXISTS search_intel_images_source_url_key`);
    await addTenantIdColumn('search_intel_images', { uniqueWithExtra: ['source_url'] });
  } catch (e) {
    console.warn('[search-intel] tenant migration warning:', e.message);
  }

  return true;
}

module.exports = { ensureSearchIntelSchema };
