// Search & AI Visibility Intelligence — DDL.
// • search_intel_queries:  tracked prompts/keywords the user wants monitored
//   across multiple LLMs (e.g. "best CRM for SaaS startups").
// • search_intel_llm_runs: each daily run per provider — captures whether the
//   user's brand was mentioned, position in the answer, and the cited URLs.
// • search_intel_pulse_runs: DataForSEO keyword-idea expansions for a seed
//   term + locale (the "what is the world searching for" view).
// • search_intel_images:   OpenAI-vision logo/brand detections cached per URL.
const _db = require('../../db');

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
  return true;
}

module.exports = { ensureSearchIntelSchema };
