const _db = require('../../db');

async function ensureKnowledgeGraphSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketing_memory_nodes (
      id              SERIAL PRIMARY KEY,
      tenant_id       INTEGER NOT NULL,
      node_type       TEXT NOT NULL CHECK (node_type IN (
                        'campaign_result','competitor_signal','content_performance',
                        'audience_shift','lead_event','manual_observation','ai_synthesis'
                      )),
      source_ref      TEXT,
      summary         TEXT NOT NULL,
      detail_json     JSONB DEFAULT '{}',
      embedding       JSONB,
      importance_score FLOAT DEFAULT 0.5 CHECK (importance_score >= 0 AND importance_score <= 1),
      rolled_up_at    TIMESTAMPTZ,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_mmn_tenant_created
    ON marketing_memory_nodes(tenant_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_mmn_tenant_type
    ON marketing_memory_nodes(tenant_id, node_type)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_mmn_rollup
    ON marketing_memory_nodes(tenant_id, rolled_up_at)
    WHERE rolled_up_at IS NULL
  `);
}

module.exports = { ensureKnowledgeGraphSchema };
