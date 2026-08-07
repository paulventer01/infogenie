const _db = require('../../db');

async function ensureAiFeedbackSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_output_feedback (
      id            SERIAL PRIMARY KEY,
      tenant_id     INTEGER NOT NULL,
      user_email    TEXT,
      surface       TEXT,
      call_trace_id INTEGER,
      rating        SMALLINT NOT NULL CHECK (rating IN (-1, 0, 1)),
      comment       TEXT,
      output_hash   TEXT,
      meta          JSONB DEFAULT '{}',
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_feedback_tenant_created
    ON ai_output_feedback(tenant_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_feedback_surface
    ON ai_output_feedback(tenant_id, surface, rating)
  `);
}

module.exports = { ensureAiFeedbackSchema };
