const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');

async function ensureAiProvidersSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_providers (
      id           SERIAL PRIMARY KEY,
      name         TEXT NOT NULL,
      base_url     TEXT NOT NULL,
      api_key      TEXT NOT NULL,
      model        TEXT NOT NULL,
      category     TEXT NOT NULL CHECK (category IN ('writing','analysis','vision','audio')),
      is_default   BOOLEAN NOT NULL DEFAULT FALSE,
      enabled      BOOLEAN NOT NULL DEFAULT TRUE,
      notes        TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ai_providers_cat_idx ON ai_providers(category, is_default DESC, enabled DESC);
  `);
  try { await addTenantIdColumn('ai_providers'); }
  catch (e) { console.error('[ai-providers] addTenantIdColumn:', e.message); }
  console.log('[ai-providers] schema ready');
}

module.exports = { ensureAiProvidersSchema };
