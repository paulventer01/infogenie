const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');
async function ensureAnomalyDetectorSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS anomaly_detections (
      id SERIAL PRIMARY KEY,
      brand TEXT NOT NULL,
      anomaly_type TEXT NOT NULL DEFAULT 'mention_spike',
      severity TEXT NOT NULL DEFAULT 'low',
      spike_factor NUMERIC(6,2) DEFAULT 1,
      baseline_value NUMERIC(10,2) DEFAULT 0,
      current_value NUMERIC(10,2) DEFAULT 0,
      ai_explanation TEXT,
      recommended_action TEXT,
      affected_channels JSONB DEFAULT '[]'::jsonb,
      signals JSONB DEFAULT '[]'::jsonb,
      resolved BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_anomaly_brand ON anomaly_detections(brand, created_at DESC);
  `);
  try { await addTenantIdColumn('anomaly_detections'); } catch(e) { console.error('[anomaly-detector] migration:', e.message); }
}
module.exports = { ensureAnomalyDetectorSchema };
