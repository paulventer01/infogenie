'use strict';

const _db = require('../../db');

async function ensureDocumentRagSchema() {
  if (!_db.hasDb()) return false;
  const pool = _db.getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS rag_documents (
      id            SERIAL PRIMARY KEY,
      tenant_id     INTEGER NOT NULL,
      title         TEXT NOT NULL,
      kind          TEXT NOT NULL,
      source        TEXT NOT NULL DEFAULT 'upload',
      source_ref    TEXT,
      chars         INTEGER DEFAULT 0,
      chunk_count   INTEGER DEFAULT 0,
      status        TEXT NOT NULL DEFAULT 'indexed',
      meta_json     JSONB DEFAULT '{}'::jsonb,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_rag_docs_tenant ON rag_documents(tenant_id, created_at DESC)`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_rag_docs_source_ref ON rag_documents(tenant_id, source_ref) WHERE source_ref IS NOT NULL`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_search_index (
      id           SERIAL PRIMARY KEY,
      tenant_id    INTEGER NOT NULL,
      data_type    TEXT NOT NULL,
      content      TEXT NOT NULL,
      embedding    JSONB,
      updated_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // Extend shared vector index with provenance columns (idempotent).
  await pool.query(`ALTER TABLE platform_search_index ADD COLUMN IF NOT EXISTS source_ref TEXT`);
  await pool.query(`ALTER TABLE platform_search_index ADD COLUMN IF NOT EXISTS meta_json JSONB DEFAULT '{}'::jsonb`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_psi_source_ref ON platform_search_index(tenant_id, source_ref)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_psi_data_type ON platform_search_index(tenant_id, data_type)`);

  return true;
}

module.exports = { ensureDocumentRagSchema };
