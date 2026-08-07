const _db = require('../../db');

async function ensureAiTracesSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_call_traces (
      id                SERIAL PRIMARY KEY,
      tenant_id         INTEGER,
      surface           TEXT,
      category          TEXT,
      provider          TEXT,
      model             TEXT,
      cascade_tier      TEXT,
      escalated_from    TEXT,
      context_pack_id   TEXT,
      latency_ms        INTEGER,
      prompt_tokens     INTEGER,
      completion_tokens INTEGER,
      status            TEXT DEFAULT 'ok',
      error             TEXT,
      meta              JSONB DEFAULT '{}',
      created_at        TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_traces_tenant_created
    ON ai_call_traces(tenant_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_traces_surface
    ON ai_call_traces(tenant_id, surface, created_at DESC)
  `);
}

module.exports = { ensureAiTracesSchema };
