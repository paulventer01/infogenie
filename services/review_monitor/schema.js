// services/review_monitor/schema.js — T46 Deleted Review Detection
const _db = require('../../db');

async function ensureReviewMonitorSchema() {
  if (!_db.hasDb || !_db.hasDb()) return;
  const pool = _db.getPool(); if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS review_snapshots (
      id           SERIAL PRIMARY KEY,
      tenant_id    INT NOT NULL,
      brand        TEXT NOT NULL,
      platform     TEXT NOT NULL,
      review_id    TEXT NOT NULL,
      rating       NUMERIC(3,1),
      author       TEXT,
      title        TEXT,
      body         TEXT,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at    TIMESTAMPTZ,
      deleted       BOOLEAN NOT NULL DEFAULT false,
      UNIQUE (tenant_id, brand, platform, review_id)
    );
    CREATE INDEX IF NOT EXISTS idx_rev_snap_brand   ON review_snapshots(tenant_id, brand, platform, deleted);
    CREATE INDEX IF NOT EXISTS idx_rev_snap_deleted ON review_snapshots(tenant_id, deleted_at DESC) WHERE deleted = true;
  `);
}

module.exports = { ensureReviewMonitorSchema };
