const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');

async function ensureLlmGapSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS llm_gap_runs (
      id BIGSERIAL PRIMARY KEY,
      tenant_id INT,
      brand TEXT NOT NULL,
      prompts JSONB NOT NULL DEFAULT '[]'::jsonb,
      gaps JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  try { await addTenantIdColumn('llm_gap_runs'); } catch (_) {}
  console.log('[llm-gap] schema ready');
}
module.exports = { ensureLlmGapSchema };
