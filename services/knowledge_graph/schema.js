const _db = require('../../db');

let _vectorReady = null; // null unknown, true/false cached

async function ensureKnowledgeGraphSchema() {
  if (!_db.hasDb()) return { vector: false };
  const pool = _db.getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketing_memory_nodes (
      id              SERIAL PRIMARY KEY,
      tenant_id       INTEGER NOT NULL,
      node_type       TEXT NOT NULL CHECK (node_type IN (
                        'campaign_result','competitor_signal','content_performance',
                        'audience_shift','lead_event','manual_observation','ai_synthesis',
                        'business_fact','strategic_decision','outcome_review','benchmark_insight'
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

  // Optional pgvector — fail-open to JSONB + in-app cosine when extension unavailable
  let vector = false;
  try {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    await pool.query(`
      ALTER TABLE marketing_memory_nodes
        ADD COLUMN IF NOT EXISTS embedding_vec vector(1536)
    `);
    // IVFFlat needs data; use HNSW when available, else skip index until rows exist
    try {
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_mmn_embedding_vec_hnsw
        ON marketing_memory_nodes
        USING hnsw (embedding_vec vector_cosine_ops)
      `);
    } catch (_) {
      // Older pgvector without HNSW — leave unindexed; sequential vector scan still beats JS over 200
    }
    vector = true;
  } catch (e) {
    console.warn('[knowledge-graph] pgvector unavailable — using JSONB cosine fallback:', e.message);
    vector = false;
  }
  _vectorReady = vector;
  return { vector };
}

async function isVectorReady() {
  if (_vectorReady != null) return _vectorReady;
  if (!_db.hasDb()) {
    _vectorReady = false;
    return false;
  }
  try {
    const pool = _db.getPool();
    const r = await pool.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name='marketing_memory_nodes' AND column_name='embedding_vec'
      LIMIT 1
    `);
    _vectorReady = r.rows.length > 0;
  } catch {
    _vectorReady = false;
  }
  return _vectorReady;
}

function _resetVectorCache() {
  _vectorReady = null;
}

module.exports = { ensureKnowledgeGraphSchema, isVectorReady, _resetVectorCache };
