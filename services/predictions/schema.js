'use strict';
const _db = require('../../db');

async function ensurePredictionsSchema() {
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS prediction_runs (
      id              SERIAL PRIMARY KEY,
      tenant_id       INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      prediction_type TEXT NOT NULL CHECK (prediction_type IN ('competitor_move','campaign_outcome','churn_trajectory','revenue_scenario')),
      inputs_json     JSONB NOT NULL DEFAULT '{}',
      output_json     JSONB NOT NULL DEFAULT '{}',
      model_used      TEXT NOT NULL DEFAULT 'gpt-4o',
      expires_at      TIMESTAMPTZ NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_prediction_runs_tenant_type
      ON prediction_runs (tenant_id, prediction_type, created_at DESC)
  `);
}

module.exports = { ensurePredictionsSchema };
