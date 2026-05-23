const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');
async function ensureColdEmailSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS cold_email_runs (
      id SERIAL PRIMARY KEY,
      sender_brand TEXT,
      sender_name TEXT,
      sender_offer TEXT,
      target_company TEXT,
      target_role TEXT,
      target_pain TEXT,
      tone TEXT,
      sequence_steps INT,
      emails JSONB NOT NULL DEFAULT '[]'::jsonb,
      generated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_cold_email_created ON cold_email_runs(created_at DESC);
  `);
  try { await addTenantIdColumn('cold_email_runs'); }
  catch (e) { console.error('[cold-email] addTenantIdColumn:', e.message); }
  console.log('[cold-email] schema ready');
}
module.exports = { ensureColdEmailSchema };
