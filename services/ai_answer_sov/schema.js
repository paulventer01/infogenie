const _db = require('../../db');

async function ensureAiAnswerSovSchema() {
  const p = await _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS sov_questions (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      question TEXT NOT NULL,
      topic_cluster VARCHAR(120),
      brand_domain VARCHAR(255),
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sov_questions_tenant ON sov_questions(tenant_id);
    CREATE TABLE IF NOT EXISTS sov_responses (
      id SERIAL PRIMARY KEY,
      question_id INT NOT NULL REFERENCES sov_questions(id) ON DELETE CASCADE,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      llm_provider VARCHAR(40) NOT NULL,
      answer_text TEXT,
      brand_mentioned BOOLEAN DEFAULT FALSE,
      brand_sentiment VARCHAR(20),
      competitor_citations TEXT,
      citation_rank INT,
      run_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sov_responses_question ON sov_responses(question_id, run_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sov_responses_tenant ON sov_responses(tenant_id, run_at DESC);
  `);
}

module.exports = { ensureAiAnswerSovSchema };
