// services/jobs/schema.js — Postgres job queue + DLQ tables.
'use strict';

const _db = require('../../db');
const { ensureJobQueueEmptyPayloadCheck } = require('../tenants/preflight');

async function ensureJobsSchema() {
  if (!_db.hasDb()) return;
  const p = _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS job_queue (
      -- GLOBAL by design: platform worker queue. Workers claim globally.
      -- Enqueue sites write process-level jobs (empty payload {}). Not tenant
      -- business data — do not add tenant_id.
      -- Platform jobs only; tenant-specific work must not be stored here.
      -- CHECK job_queue_global_empty_payload enforces payload = '{}'::jsonb.
      id            BIGSERIAL PRIMARY KEY,
      name          TEXT NOT NULL,
      payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
      status        TEXT NOT NULL DEFAULT 'pending',
      attempts      INT  NOT NULL DEFAULT 0,
      max_attempts  INT  NOT NULL DEFAULT 3,
      run_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      locked_at     TIMESTAMPTZ,
      locked_by     TEXT,
      last_error    TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at  TIMESTAMPTZ,
      CONSTRAINT job_queue_global_empty_payload CHECK (payload = '{}'::jsonb)
    )
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_job_queue_claim
    ON job_queue (status, run_at) WHERE status IN ('pending','failed')`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_job_queue_name_status
    ON job_queue (name, status)`);

  // Existing installs: ADD CONSTRAINT only when every row already has {}.
  // Violators are left in place (not stripped, not deleted); preflight reports them.
  await ensureJobQueueEmptyPayloadCheck();

  await p.query(`
    CREATE TABLE IF NOT EXISTS job_schedules (
      -- GLOBAL by design: platform cron registry. PK on name.
      -- registerSchedule is process-level, not workspace data.
      -- No payload column — nothing to CHECK. Stays global without tenant_id.
      name              TEXT PRIMARY KEY,
      interval_ms       BIGINT NOT NULL,
      enabled           BOOLEAN NOT NULL DEFAULT true,
      last_enqueued_at  TIMESTAMPTZ,
      last_success_at   TIMESTAMPTZ,
      last_error        TEXT,
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

module.exports = { ensureJobsSchema };
