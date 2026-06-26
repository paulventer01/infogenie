const _db = require('../../db');

async function ensureSurveysSchema() {
  if (!_db.hasDb()) return;
  const p = _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS surveys (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      title VARCHAR(255) NOT NULL,
      description TEXT,
      status VARCHAR(20) DEFAULT 'draft',
      embed_key VARCHAR(80) UNIQUE,
      questions JSONB NOT NULL DEFAULT '[]'::jsonb,
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      response_count INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_surveys_tenant ON surveys(tenant_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS survey_responses (
      id BIGSERIAL PRIMARY KEY,
      survey_id INT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      respondent_email VARCHAR(320),
      respondent_meta JSONB DEFAULT '{}'::jsonb,
      answers JSONB NOT NULL DEFAULT '{}'::jsonb,
      submitted_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_survey_responses_survey ON survey_responses(survey_id, submitted_at DESC);

    CREATE TABLE IF NOT EXISTS survey_analyses (
      id SERIAL PRIMARY KEY,
      survey_id INT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      total_responses INT DEFAULT 0,
      themes JSONB DEFAULT '[]'::jsonb,
      sentiment_summary TEXT,
      top_issues JSONB DEFAULT '[]'::jsonb,
      recommendations JSONB DEFAULT '[]'::jsonb,
      ai_narrative TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_survey_analyses_survey ON survey_analyses(survey_id, created_at DESC);
  `);
}

module.exports = { ensureSurveysSchema };
