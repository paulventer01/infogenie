const _db = require('../../db');

async function ensureStrategicIntelligenceSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS business_context_facts (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      category VARCHAR(60) NOT NULL,
      title VARCHAR(255) NOT NULL,
      fact TEXT NOT NULL,
      why_it_matters TEXT,
      source VARCHAR(40) DEFAULT 'manual',
      importance NUMERIC(4,3) DEFAULT 0.7,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_bcf_tenant ON business_context_facts(tenant_id, category);

    CREATE TABLE IF NOT EXISTS strategic_decisions (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      decided_at TIMESTAMPTZ DEFAULT NOW(),
      title VARCHAR(255) NOT NULL,
      decision TEXT NOT NULL,
      hypothesis TEXT,
      expected_impact TEXT,
      metrics_watched TEXT[],
      review_at DATE,
      outcome_status VARCHAR(40) DEFAULT 'pending',
      outcome_summary TEXT,
      outcome_measured_at TIMESTAMPTZ,
      lesson TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sd_tenant_review ON strategic_decisions(tenant_id, review_at);

    CREATE TABLE IF NOT EXISTS scenario_runs (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      question TEXT NOT NULL,
      assumptions JSONB DEFAULT '{}',
      decomposition JSONB DEFAULT '[]',
      scenarios JSONB DEFAULT '[]',
      recommendation TEXT,
      why_best TEXT,
      risks JSONB DEFAULT '[]',
      opportunities JSONB DEFAULT '[]',
      model_used VARCHAR(80),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS root_cause_runs (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      problem TEXT NOT NULL,
      tree JSONB DEFAULT '[]',
      primary_cause TEXT,
      contributing_causes JSONB DEFAULT '[]',
      evidence JSONB DEFAULT '[]',
      fix_sequence JSONB DEFAULT '[]',
      why_best TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS writeback_jobs (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      system_key VARCHAR(60) NOT NULL,
      action_key VARCHAR(80) NOT NULL,
      payload JSONB DEFAULT '{}',
      status VARCHAR(40) DEFAULT 'queued',
      result_json JSONB DEFAULT '{}',
      error TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_wbj_tenant ON writeback_jobs(tenant_id, created_at DESC);
  `);

  // Expand marketing memory node types for institutional memory (best-effort)
  try {
    await pool.query(`ALTER TABLE marketing_memory_nodes DROP CONSTRAINT IF EXISTS marketing_memory_nodes_node_type_check`);
    await pool.query(`
      ALTER TABLE marketing_memory_nodes ADD CONSTRAINT marketing_memory_nodes_node_type_check
      CHECK (node_type IN (
        'campaign_result','competitor_signal','content_performance',
        'audience_shift','lead_event','manual_observation','ai_synthesis',
        'business_fact','strategic_decision','outcome_review','benchmark_insight'
      ))
    `);
  } catch (e) {
    console.warn('[strategic] memory node_type expand:', e.message);
  }
}

module.exports = { ensureStrategicIntelligenceSchema };
