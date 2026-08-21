const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');

// Advertising workflow persistence (PR 1). Does not replace agent_orchestrator_runs
// or the suggest/resolve/apply hub. Full current_state CHECK is user-mandated —
// do not compress to draft/running.
//
// PHASE ENUM (current_phase / orchestrator_steps.phase):
//   research, creative_generation, creative_selection, campaign_construction,
//   publishing, activation, monitoring, optimization
// GATE ENUM (next_approval_gate / orchestrator_approvals.gate):
//   research_execution, creative_generation, creative_selection,
//   campaign_publishing, campaign_activation, optimization_application
// Platforms (selected_platforms / approved_platforms JSONB arrays) are stored
// as JSONB; allowed values meta|google|tiktok are validated by Backend.

const WORKFLOW_STATES_SQL = `
  'draft',
  'research_approval_required','research_approved','research_running','research_complete','research_failed',
  'generation_approval_required','generation_approved','generation_running','creative_review_required','creative_approved',
  'campaign_drafting','campaign_review_required','publishing_approval_required','publishing_approved','publishing','published_paused',
  'activation_approval_required','activation_approved','activating','active','monitoring',
  'optimization_proposed','optimization_approval_required','optimization_approved','optimization_applying','optimization_applied',
  'paused','failed','cancelled','completed'
`.trim();

const WORKFLOW_PHASES_SQL = `
  'research','creative_generation','creative_selection','campaign_construction',
  'publishing','activation','monitoring','optimization'
`.trim();

const APPROVAL_GATES_SQL = `
  'research_execution','creative_generation','creative_selection',
  'campaign_publishing','campaign_activation','optimization_application'
`.trim();

const ADVERTISING_ORCH_TABLES = [
  'orchestrator_workflows',
  'orchestrator_steps',
  'orchestrator_approvals',
  'orchestrator_audit_events',
  'orchestrator_idempotency_keys',
  'orchestrator_execution_leases',
  // PR 2 — shared credit accounting, tenant cost controls, outbox, leases
  'orchestrator_credit_accounts',
  'orchestrator_credit_ledger',
  'orchestrator_credit_reservations',
  'orchestrator_tenant_limits',
  'orchestrator_pricing_catalog',
  'orchestrator_usage_records',
  'orchestrator_ai_inflight',
  'orchestrator_ai_request_ticks',
  'orchestrator_outbox',
];

async function _ensureNamedCheck(p, table, name, checkBody) {
  await p.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${name}`);
  try {
    await p.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${checkBody})`);
  } catch (e) {
    if (!e || e.code !== '42710') throw e;
  }
}

async function _ensureNamedUnique(p, table, name, cols) {
  const r = await p.query(
    `SELECT 1 FROM pg_constraint WHERE conname = $1 AND conrelid = $2::regclass`,
    [name, `public.${table}`]
  );
  if (!r.rowCount) {
    await p.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} UNIQUE (${cols})`);
  }
}

// Serialize DDL so overlapping ensure() callers (parallel test files, boot)
// cannot race CREATE TABLE IF NOT EXISTS on the same relation types.
let _ensureMutex = Promise.resolve();

async function ensureAgentOrchestratorSchema() {
  if (!_db.hasDb()) return false;
  const queued = _ensureMutex.then(() => _runEnsureAgentOrchestratorSchema());
  _ensureMutex = queued.catch(() => {});
  return queued;
}

async function _runEnsureAgentOrchestratorSchema() {
  const pool = _db.getPool();
  const p = await pool.connect();
  try {
    await p.query('SELECT pg_advisory_lock($1)', [87231402]);
    try {
      return await _runEnsureAgentOrchestratorSchemaLocked(p);
    } finally {
      await p.query('SELECT pg_advisory_unlock($1)', [87231402]);
    }
  } finally {
    p.release();
  }
}

async function _runEnsureAgentOrchestratorSchemaLocked(p) {
  await p.query(`
    CREATE TABLE IF NOT EXISTS agent_orchestrator_runs (
      id              TEXT PRIMARY KEY,
      tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      module          TEXT NOT NULL,
      kind            TEXT NOT NULL,
      input           JSONB NOT NULL DEFAULT '{}',
      result          JSONB NOT NULL DEFAULT '{}',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_agent_orch_tenant_time
      ON agent_orchestrator_runs(tenant_id, created_at DESC);
  `);
  try { await addTenantIdColumn('agent_orchestrator_runs'); } catch (_) { /* idempotent */ }

  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_workflows (
      id                         TEXT PRIMARY KEY,
      tenant_id                  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name                       TEXT NOT NULL,
      objective                  TEXT NOT NULL DEFAULT '',
      product_or_service         TEXT NOT NULL DEFAULT '',
      offer                      TEXT NOT NULL DEFAULT '',
      landing_page_url           TEXT NOT NULL DEFAULT '',
      target_markets             JSONB NOT NULL DEFAULT '[]',
      target_audiences           JSONB NOT NULL DEFAULT '[]',
      selected_platforms         JSONB NOT NULL DEFAULT '[]',
      advertising_budget         NUMERIC(14,2) NULL,
      currency                   TEXT NOT NULL DEFAULT 'USD',
      planned_start              TIMESTAMPTZ NULL,
      planned_end                TIMESTAMPTZ NULL,
      current_state              TEXT NOT NULL DEFAULT 'draft',
      previous_state             TEXT NULL,
      current_phase              TEXT NOT NULL DEFAULT 'research',
      next_approval_gate         TEXT NULL,
      version                    INTEGER NOT NULL DEFAULT 1,
      created_by_user_id         INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      paused_at                  TIMESTAMPTZ NULL,
      paused_by_user_id          INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      pause_reason               TEXT NULL,
      cancelled_at               TIMESTAMPTZ NULL,
      cancelled_by_user_id       INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      cancel_reason              TEXT NULL,
      credit_ceiling_micros      BIGINT NOT NULL DEFAULT 0,
      block_reason               TEXT NULL,
      blocked_at                 TIMESTAMPTZ NULL,
      created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT orchestrator_workflows_current_state_check
        CHECK (current_state IN (${WORKFLOW_STATES_SQL})),
      CONSTRAINT orchestrator_workflows_current_phase_check
        CHECK (current_phase IN (${WORKFLOW_PHASES_SQL})),
      CONSTRAINT orchestrator_workflows_next_approval_gate_check
        CHECK (next_approval_gate IS NULL OR next_approval_gate IN (${APPROVAL_GATES_SQL})),
      CONSTRAINT orchestrator_workflows_credit_ceiling_micros_check
        CHECK (credit_ceiling_micros >= 0)
    );

    CREATE TABLE IF NOT EXISTS orchestrator_steps (
      id                TEXT PRIMARY KEY,
      tenant_id         INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      workflow_id       TEXT NOT NULL REFERENCES orchestrator_workflows(id) ON DELETE CASCADE,
      phase             TEXT NOT NULL,
      agent_type        TEXT NOT NULL DEFAULT '',
      state             TEXT NOT NULL DEFAULT 'pending',
      attempt_number    INTEGER NOT NULL DEFAULT 0,
      object_version    INTEGER NOT NULL DEFAULT 1,
      idempotency_key   TEXT NULL,
      input_ref         JSONB NOT NULL DEFAULT '{}',
      output_ref        JSONB NOT NULL DEFAULT '{}',
      lease_id          TEXT NULL,
      error_code        TEXT NULL,
      retry_class       TEXT NULL,
      started_at        TIMESTAMPTZ NULL,
      heartbeat_at      TIMESTAMPTZ NULL,
      completed_at      TIMESTAMPTZ NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT orchestrator_steps_phase_check
        CHECK (phase IN (${WORKFLOW_PHASES_SQL}))
    );

    CREATE TABLE IF NOT EXISTS orchestrator_approvals (
      id                           SERIAL PRIMARY KEY,
      tenant_id                    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      workflow_id                  TEXT NOT NULL REFERENCES orchestrator_workflows(id) ON DELETE CASCADE,
      gate                         TEXT NOT NULL,
      object_type                  TEXT NOT NULL DEFAULT '',
      object_id                    TEXT NOT NULL DEFAULT '',
      object_version               INTEGER NOT NULL DEFAULT 1,
      content_hash                 TEXT NOT NULL,
      approved_platforms           JSONB NOT NULL DEFAULT '[]',
      approved_advertising_budget  NUMERIC(14,2) NULL,
      approved_credit_ceiling      NUMERIC(14,2) NULL,
      approved_credit_ceiling_micros BIGINT NULL,
      actor_user_id                INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      decision                     TEXT NOT NULL,
      comment                      TEXT NULL,
      permission_snapshot          JSONB NOT NULL DEFAULT '[]',
      created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT orchestrator_approvals_gate_check
        CHECK (gate IN (${APPROVAL_GATES_SQL})),
      CONSTRAINT orchestrator_approvals_decision_check
        CHECK (decision IN ('approved','rejected')),
      CONSTRAINT orchestrator_approvals_approved_credit_ceiling_micros_check
        CHECK (approved_credit_ceiling_micros >= 0)
    );

    CREATE TABLE IF NOT EXISTS orchestrator_audit_events (
      id              SERIAL PRIMARY KEY,
      tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      workflow_id     TEXT NOT NULL REFERENCES orchestrator_workflows(id) ON DELETE CASCADE,
      event           TEXT NOT NULL,
      actor_user_id   INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      detail          JSONB NOT NULL DEFAULT '{}',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS orchestrator_idempotency_keys (
      id               SERIAL PRIMARY KEY,
      tenant_id        INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      key              TEXT NOT NULL,
      endpoint         TEXT NOT NULL DEFAULT '',
      action           TEXT NOT NULL DEFAULT '',
      request_hash     TEXT NOT NULL,
      response_status  INTEGER NOT NULL,
      response_body    JSONB NOT NULL DEFAULT '{}',
      status           TEXT NOT NULL DEFAULT 'pending',
      owner_token      TEXT NULL,
      lease_expires_at TIMESTAMPTZ NULL,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT orchestrator_idempotency_keys_tenant_unique_key UNIQUE (tenant_id, key),
      CONSTRAINT orchestrator_idempotency_keys_status_check
        CHECK (status IN ('pending','completed','expired'))
    );

    CREATE TABLE IF NOT EXISTS orchestrator_execution_leases (
      id             SERIAL PRIMARY KEY,
      tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      workflow_id    TEXT NOT NULL REFERENCES orchestrator_workflows(id) ON DELETE CASCADE,
      step_id        TEXT NULL,
      holder         TEXT NOT NULL,
      expires_at     TIMESTAMPTZ NOT NULL,
      heartbeat_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT orchestrator_execution_leases_tenant_unique_workflow_id UNIQUE (tenant_id, workflow_id)
    );
  `);

  await p.query(`ALTER TABLE orchestrator_workflows ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_workflows ADD COLUMN IF NOT EXISTS objective TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_workflows ADD COLUMN IF NOT EXISTS product_or_service TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_workflows ADD COLUMN IF NOT EXISTS offer TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_workflows ADD COLUMN IF NOT EXISTS landing_page_url TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_workflows ADD COLUMN IF NOT EXISTS target_markets JSONB NOT NULL DEFAULT '[]'`);
  await p.query(`ALTER TABLE orchestrator_workflows ADD COLUMN IF NOT EXISTS target_audiences JSONB NOT NULL DEFAULT '[]'`);
  await p.query(`ALTER TABLE orchestrator_workflows ADD COLUMN IF NOT EXISTS selected_platforms JSONB NOT NULL DEFAULT '[]'`);
  await p.query(`ALTER TABLE orchestrator_workflows ADD COLUMN IF NOT EXISTS advertising_budget NUMERIC(14,2) NULL`);
  await p.query(`ALTER TABLE orchestrator_workflows ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD'`);
  await p.query(`ALTER TABLE orchestrator_workflows ADD COLUMN IF NOT EXISTS planned_start TIMESTAMPTZ NULL`);
  await p.query(`ALTER TABLE orchestrator_workflows ADD COLUMN IF NOT EXISTS planned_end TIMESTAMPTZ NULL`);
  await p.query(`ALTER TABLE orchestrator_workflows ADD COLUMN IF NOT EXISTS current_state TEXT NOT NULL DEFAULT 'draft'`);
  await p.query(`ALTER TABLE orchestrator_workflows ADD COLUMN IF NOT EXISTS previous_state TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_workflows ADD COLUMN IF NOT EXISTS current_phase TEXT NOT NULL DEFAULT 'research'`);
  await p.query(`ALTER TABLE orchestrator_workflows ADD COLUMN IF NOT EXISTS next_approval_gate TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_workflows ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1`);
  await p.query(`ALTER TABLE orchestrator_workflows ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL`);
  await p.query(`ALTER TABLE orchestrator_workflows ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ NULL`);
  await p.query(`ALTER TABLE orchestrator_workflows ADD COLUMN IF NOT EXISTS paused_by_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL`);
  await p.query(`ALTER TABLE orchestrator_workflows ADD COLUMN IF NOT EXISTS pause_reason TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_workflows ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ NULL`);
  await p.query(`ALTER TABLE orchestrator_workflows ADD COLUMN IF NOT EXISTS cancelled_by_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL`);
  await p.query(`ALTER TABLE orchestrator_workflows ADD COLUMN IF NOT EXISTS cancel_reason TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_workflows ADD COLUMN IF NOT EXISTS credit_ceiling_micros BIGINT NOT NULL DEFAULT 0`);
  await p.query(`ALTER TABLE orchestrator_workflows ADD COLUMN IF NOT EXISTS block_reason TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_workflows ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ NULL`);
  await p.query(`ALTER TABLE orchestrator_workflows ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`);
  await p.query(`ALTER TABLE orchestrator_workflows ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`);

  await p.query(`ALTER TABLE orchestrator_steps ADD COLUMN IF NOT EXISTS workflow_id TEXT`);
  await p.query(`ALTER TABLE orchestrator_steps ADD COLUMN IF NOT EXISTS phase TEXT NOT NULL DEFAULT 'research'`);
  await p.query(`ALTER TABLE orchestrator_steps ADD COLUMN IF NOT EXISTS agent_type TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_steps ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'pending'`);
  await p.query(`ALTER TABLE orchestrator_steps ADD COLUMN IF NOT EXISTS attempt_number INTEGER NOT NULL DEFAULT 0`);
  await p.query(`ALTER TABLE orchestrator_steps ADD COLUMN IF NOT EXISTS object_version INTEGER NOT NULL DEFAULT 1`);
  await p.query(`ALTER TABLE orchestrator_steps ADD COLUMN IF NOT EXISTS idempotency_key TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_steps ADD COLUMN IF NOT EXISTS input_ref JSONB NOT NULL DEFAULT '{}'`);
  await p.query(`ALTER TABLE orchestrator_steps ADD COLUMN IF NOT EXISTS output_ref JSONB NOT NULL DEFAULT '{}'`);
  await p.query(`ALTER TABLE orchestrator_steps ADD COLUMN IF NOT EXISTS lease_id TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_steps ADD COLUMN IF NOT EXISTS error_code TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_steps ADD COLUMN IF NOT EXISTS retry_class TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_steps ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NULL`);
  await p.query(`ALTER TABLE orchestrator_steps ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ NULL`);
  await p.query(`ALTER TABLE orchestrator_steps ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ NULL`);
  await p.query(`ALTER TABLE orchestrator_steps ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`);

  await p.query(`ALTER TABLE orchestrator_approvals ADD COLUMN IF NOT EXISTS workflow_id TEXT`);
  await p.query(`ALTER TABLE orchestrator_approvals ADD COLUMN IF NOT EXISTS gate TEXT NOT NULL DEFAULT 'research_execution'`);
  await p.query(`ALTER TABLE orchestrator_approvals ADD COLUMN IF NOT EXISTS object_type TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_approvals ADD COLUMN IF NOT EXISTS object_id TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_approvals ADD COLUMN IF NOT EXISTS object_version INTEGER NOT NULL DEFAULT 1`);
  await p.query(`ALTER TABLE orchestrator_approvals ADD COLUMN IF NOT EXISTS content_hash TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_approvals ADD COLUMN IF NOT EXISTS approved_platforms JSONB NOT NULL DEFAULT '[]'`);
  await p.query(`ALTER TABLE orchestrator_approvals ADD COLUMN IF NOT EXISTS approved_advertising_budget NUMERIC(14,2) NULL`);
  await p.query(`ALTER TABLE orchestrator_approvals ADD COLUMN IF NOT EXISTS approved_credit_ceiling NUMERIC(14,2) NULL`);
  await p.query(`ALTER TABLE orchestrator_approvals ADD COLUMN IF NOT EXISTS approved_credit_ceiling_micros BIGINT NULL`);
  await p.query(`ALTER TABLE orchestrator_approvals ADD COLUMN IF NOT EXISTS actor_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL`);
  await p.query(`ALTER TABLE orchestrator_approvals ADD COLUMN IF NOT EXISTS decision TEXT NOT NULL DEFAULT 'approved'`);
  await p.query(`ALTER TABLE orchestrator_approvals ADD COLUMN IF NOT EXISTS comment TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_approvals ADD COLUMN IF NOT EXISTS permission_snapshot JSONB NOT NULL DEFAULT '[]'`);
  await p.query(`ALTER TABLE orchestrator_approvals ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`);

  await p.query(`ALTER TABLE orchestrator_audit_events ADD COLUMN IF NOT EXISTS workflow_id TEXT`);
  await p.query(`ALTER TABLE orchestrator_audit_events ADD COLUMN IF NOT EXISTS event TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_audit_events ADD COLUMN IF NOT EXISTS actor_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL`);
  await p.query(`ALTER TABLE orchestrator_audit_events ADD COLUMN IF NOT EXISTS detail JSONB NOT NULL DEFAULT '{}'`);
  await p.query(`ALTER TABLE orchestrator_audit_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`);

  await p.query(`ALTER TABLE orchestrator_idempotency_keys ADD COLUMN IF NOT EXISTS key TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_idempotency_keys ADD COLUMN IF NOT EXISTS endpoint TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_idempotency_keys ADD COLUMN IF NOT EXISTS action TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_idempotency_keys ADD COLUMN IF NOT EXISTS request_hash TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_idempotency_keys ADD COLUMN IF NOT EXISTS response_status INTEGER NOT NULL DEFAULT 0`);
  await p.query(`ALTER TABLE orchestrator_idempotency_keys ADD COLUMN IF NOT EXISTS response_body JSONB NOT NULL DEFAULT '{}'`);
  await p.query(`ALTER TABLE orchestrator_idempotency_keys ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'`);
  await p.query(`ALTER TABLE orchestrator_idempotency_keys ADD COLUMN IF NOT EXISTS owner_token TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_idempotency_keys ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ NULL`);
  await p.query(`ALTER TABLE orchestrator_idempotency_keys ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`);
  await p.query(`ALTER TABLE orchestrator_idempotency_keys ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`);

  await p.query(`ALTER TABLE orchestrator_execution_leases ADD COLUMN IF NOT EXISTS workflow_id TEXT`);
  await p.query(`ALTER TABLE orchestrator_execution_leases ADD COLUMN IF NOT EXISTS step_id TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_execution_leases ADD COLUMN IF NOT EXISTS holder TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_execution_leases ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT now()`);
  await p.query(`ALTER TABLE orchestrator_execution_leases ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now()`);
  await p.query(`ALTER TABLE orchestrator_execution_leases ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`);

  await _ensureNamedCheck(p, 'orchestrator_workflows', 'orchestrator_workflows_current_state_check',
    `current_state IN (${WORKFLOW_STATES_SQL})`);
  await _ensureNamedCheck(p, 'orchestrator_workflows', 'orchestrator_workflows_current_phase_check',
    `current_phase IN (${WORKFLOW_PHASES_SQL})`);
  await _ensureNamedCheck(p, 'orchestrator_workflows', 'orchestrator_workflows_next_approval_gate_check',
    `next_approval_gate IS NULL OR next_approval_gate IN (${APPROVAL_GATES_SQL})`);
  await _ensureNamedCheck(p, 'orchestrator_steps', 'orchestrator_steps_phase_check',
    `phase IN (${WORKFLOW_PHASES_SQL})`);
  await _ensureNamedCheck(p, 'orchestrator_approvals', 'orchestrator_approvals_gate_check',
    `gate IN (${APPROVAL_GATES_SQL})`);
  await _ensureNamedCheck(p, 'orchestrator_approvals', 'orchestrator_approvals_decision_check',
    `decision IN ('approved','rejected')`);
  await _ensureNamedCheck(p, 'orchestrator_workflows', 'orchestrator_workflows_credit_ceiling_micros_check',
    `credit_ceiling_micros >= 0`);
  await _ensureNamedCheck(p, 'orchestrator_approvals', 'orchestrator_approvals_approved_credit_ceiling_micros_check',
    `approved_credit_ceiling_micros >= 0`);
  await _ensureNamedCheck(p, 'orchestrator_idempotency_keys', 'orchestrator_idempotency_keys_status_check',
    `status IN ('pending','completed','expired')`);

  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_orchestrator_workflows_tenant_created
      ON orchestrator_workflows (tenant_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_orchestrator_workflows_tenant_state
      ON orchestrator_workflows (tenant_id, current_state);
    CREATE INDEX IF NOT EXISTS idx_orchestrator_steps_tenant_workflow
      ON orchestrator_steps (tenant_id, workflow_id);
    CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_steps_tenant_unique_idempotency_key
      ON orchestrator_steps (tenant_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_orchestrator_approvals_tenant_workflow_gate
      ON orchestrator_approvals (tenant_id, workflow_id, gate);
    CREATE INDEX IF NOT EXISTS idx_orchestrator_audit_events_tenant_workflow_created
      ON orchestrator_audit_events (tenant_id, workflow_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_orchestrator_idempotency_keys_tenant_created
      ON orchestrator_idempotency_keys (tenant_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_orchestrator_idempotency_keys_tenant_status_lease
      ON orchestrator_idempotency_keys (tenant_id, status, lease_expires_at);
  `);

  await _ensureNamedUnique(p, 'orchestrator_idempotency_keys',
    'orchestrator_idempotency_keys_tenant_unique_key', 'tenant_id, key');
  await _ensureNamedUnique(p, 'orchestrator_execution_leases',
    'orchestrator_execution_leases_tenant_unique_workflow_id', 'tenant_id, workflow_id');

  // UPDATE is always rejected. Direct DELETE is rejected while the parent
  // orchestrator_workflows row still exists. FK ON DELETE CASCADE (workflow
  // teardown and tenant teardown) runs after the parent row is gone, so the
  // EXISTS check returns false and the child delete is allowed. Verified on
  // Postgres 16: parent-EXISTS is sufficient; pg_trigger_depth() not required.
  await p.query(`
    CREATE OR REPLACE FUNCTION orchestrator_approvals_immutable()
    RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'orchestrator_approvals_immutable';
      END IF;
      IF EXISTS (
        SELECT 1 FROM orchestrator_workflows w
         WHERE w.id = OLD.workflow_id AND w.tenant_id = OLD.tenant_id
      ) THEN
        RAISE EXCEPTION 'orchestrator_approvals_immutable';
      END IF;
      RETURN OLD;
    END;
    $fn$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION orchestrator_audit_events_immutable()
    RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'orchestrator_audit_events_immutable';
      END IF;
      IF EXISTS (
        SELECT 1 FROM orchestrator_workflows w
         WHERE w.id = OLD.workflow_id AND w.tenant_id = OLD.tenant_id
      ) THEN
        RAISE EXCEPTION 'orchestrator_audit_events_immutable';
      END IF;
      RETURN OLD;
    END;
    $fn$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS orchestrator_approvals_immutable ON orchestrator_approvals;
    CREATE TRIGGER orchestrator_approvals_immutable
      BEFORE UPDATE OR DELETE ON orchestrator_approvals
      FOR EACH ROW
      EXECUTE FUNCTION orchestrator_approvals_immutable();

    DROP TRIGGER IF EXISTS orchestrator_audit_events_immutable ON orchestrator_audit_events;
    CREATE TRIGGER orchestrator_audit_events_immutable
      BEFORE UPDATE OR DELETE ON orchestrator_audit_events
      FOR EACH ROW
      EXECUTE FUNCTION orchestrator_audit_events_immutable();
  `);

  // Existing idempotency rows: pending when response_status=0, completed otherwise.
  await p.query(`
    UPDATE orchestrator_idempotency_keys
       SET status = 'completed'
     WHERE response_status <> 0
       AND status = 'pending'
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_credit_accounts (
      tenant_id         INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
      currency          TEXT NOT NULL DEFAULT 'USD',
      available_micros  BIGINT NOT NULL DEFAULT 0,
      reserved_micros   BIGINT NOT NULL DEFAULT 0,
      consumed_micros   BIGINT NOT NULL DEFAULT 0,
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT orchestrator_credit_accounts_available_micros_check
        CHECK (available_micros >= 0),
      CONSTRAINT orchestrator_credit_accounts_reserved_micros_check
        CHECK (reserved_micros >= 0),
      CONSTRAINT orchestrator_credit_accounts_consumed_micros_check
        CHECK (consumed_micros >= 0)
    );

    CREATE TABLE IF NOT EXISTS orchestrator_credit_ledger (
      id                BIGSERIAL PRIMARY KEY,
      tenant_id         INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      entry_type        TEXT NOT NULL,
      amount_micros     BIGINT NOT NULL,
      reservation_id    TEXT NULL,
      workflow_id       TEXT NULL,
      step_id           TEXT NULL,
      provider          TEXT NULL,
      operation         TEXT NULL,
      model_or_service  TEXT NULL,
      actor_user_id     INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      idempotency_key   TEXT NULL,
      reason_code       TEXT NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT orchestrator_credit_ledger_entry_type_check
        CHECK (entry_type IN ('grant','reservation','commit','release','refund','adjustment')),
      CONSTRAINT orchestrator_credit_ledger_amount_micros_check
        CHECK (amount_micros > 0)
    );

    CREATE TABLE IF NOT EXISTS orchestrator_credit_reservations (
      id                    TEXT PRIMARY KEY,
      tenant_id             INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      workflow_id           TEXT NULL,
      step_id               TEXT NULL,
      amount_micros         BIGINT NOT NULL,
      committed_micros      BIGINT NOT NULL DEFAULT 0,
      status                TEXT NOT NULL,
      estimated_cost_micros BIGINT NOT NULL,
      actual_cost_micros    BIGINT NULL,
      cost_status           TEXT NOT NULL DEFAULT 'estimated',
      provider              TEXT NOT NULL DEFAULT '',
      operation             TEXT NOT NULL DEFAULT '',
      model_or_service      TEXT NOT NULL DEFAULT '',
      pricing_version       INTEGER NULL,
      idempotency_key       TEXT NOT NULL,
      actor_user_id         INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at            TIMESTAMPTZ NULL,
      CONSTRAINT orchestrator_credit_reservations_amount_micros_check
        CHECK (amount_micros > 0),
      CONSTRAINT orchestrator_credit_reservations_committed_micros_check
        CHECK (committed_micros >= 0),
      CONSTRAINT orchestrator_credit_reservations_status_check
        CHECK (status IN ('reserved','committed','released','expired')),
      CONSTRAINT orchestrator_credit_reservations_estimated_cost_micros_check
        CHECK (estimated_cost_micros >= 0),
      CONSTRAINT orchestrator_credit_reservations_actual_cost_micros_check
        CHECK (actual_cost_micros >= 0),
      CONSTRAINT orchestrator_credit_reservations_cost_status_check
        CHECK (cost_status IN ('estimated','final')),
      CONSTRAINT orchestrator_credit_reservations_committed_lte_amount_check
        CHECK (committed_micros <= amount_micros),
      CONSTRAINT orchestrator_credit_reservations_tenant_unique_idempotency_key
        UNIQUE (tenant_id, idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS orchestrator_tenant_limits (
      tenant_id                 INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
      credit_ceiling_micros     BIGINT NOT NULL DEFAULT 0,
      requests_per_minute       INTEGER NOT NULL DEFAULT 0,
      max_concurrent_ai         INTEGER NOT NULL DEFAULT 0,
      daily_ai_cost_micros      BIGINT NOT NULL DEFAULT 0,
      monthly_ai_cost_micros    BIGINT NOT NULL DEFAULT 0,
      per_workflow_cost_micros  BIGINT NOT NULL DEFAULT 0,
      provider_limits           JSONB NOT NULL DEFAULT '{}',
      updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by_user_id        INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT orchestrator_tenant_limits_credit_ceiling_micros_check
        CHECK (credit_ceiling_micros >= 0),
      CONSTRAINT orchestrator_tenant_limits_requests_per_minute_check
        CHECK (requests_per_minute >= 0),
      CONSTRAINT orchestrator_tenant_limits_max_concurrent_ai_check
        CHECK (max_concurrent_ai >= 0),
      CONSTRAINT orchestrator_tenant_limits_daily_ai_cost_micros_check
        CHECK (daily_ai_cost_micros >= 0),
      CONSTRAINT orchestrator_tenant_limits_monthly_ai_cost_micros_check
        CHECK (monthly_ai_cost_micros >= 0),
      CONSTRAINT orchestrator_tenant_limits_per_workflow_cost_micros_check
        CHECK (per_workflow_cost_micros >= 0)
    );

    CREATE TABLE IF NOT EXISTS orchestrator_pricing_catalog (
      id                            BIGSERIAL PRIMARY KEY,
      tenant_id                     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      provider                      TEXT NOT NULL,
      model_or_service              TEXT NOT NULL,
      unit_type                     TEXT NOT NULL,
      input_price_micros_per_million  BIGINT NOT NULL DEFAULT 0,
      output_price_micros_per_million BIGINT NOT NULL DEFAULT 0,
      currency                      TEXT NOT NULL DEFAULT 'USD',
      effective_from                TIMESTAMPTZ NOT NULL DEFAULT now(),
      pricing_version               INTEGER NOT NULL,
      created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT orchestrator_pricing_catalog_unit_type_check
        CHECK (unit_type IN ('token_input','token_output','request','image','second')),
      CONSTRAINT orchestrator_pricing_catalog_input_price_check
        CHECK (input_price_micros_per_million >= 0),
      CONSTRAINT orchestrator_pricing_catalog_output_price_check
        CHECK (output_price_micros_per_million >= 0),
      CONSTRAINT orchestrator_pricing_catalog_pricing_version_check
        CHECK (pricing_version >= 1),
      CONSTRAINT orchestrator_pricing_catalog_tenant_unique_price
        UNIQUE (tenant_id, provider, model_or_service, unit_type, pricing_version)
    );

    CREATE TABLE IF NOT EXISTS orchestrator_usage_records (
      id                     BIGSERIAL PRIMARY KEY,
      tenant_id              INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      reservation_id         TEXT NULL,
      workflow_id            TEXT NULL,
      step_id                TEXT NULL,
      provider               TEXT NOT NULL DEFAULT '',
      model_or_service       TEXT NOT NULL DEFAULT '',
      unit_type              TEXT NOT NULL DEFAULT 'request',
      input_units            BIGINT NOT NULL DEFAULT 0,
      output_units           BIGINT NOT NULL DEFAULT 0,
      estimated_cost_micros  BIGINT NOT NULL DEFAULT 0,
      actual_cost_micros     BIGINT NULL,
      cost_status            TEXT NOT NULL,
      pricing_version        INTEGER NULL,
      usage_source           TEXT NOT NULL DEFAULT 'estimated',
      created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT orchestrator_usage_records_input_units_check
        CHECK (input_units >= 0),
      CONSTRAINT orchestrator_usage_records_output_units_check
        CHECK (output_units >= 0),
      CONSTRAINT orchestrator_usage_records_estimated_cost_micros_check
        CHECK (estimated_cost_micros >= 0),
      CONSTRAINT orchestrator_usage_records_actual_cost_micros_check
        CHECK (actual_cost_micros >= 0),
      CONSTRAINT orchestrator_usage_records_cost_status_check
        CHECK (cost_status IN ('estimated','final')),
      CONSTRAINT orchestrator_usage_records_usage_source_check
        CHECK (usage_source IN ('provider','estimated','manual'))
    );

    CREATE TABLE IF NOT EXISTS orchestrator_ai_inflight (
      id                TEXT PRIMARY KEY,
      tenant_id         INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      workflow_id       TEXT NULL,
      provider          TEXT NOT NULL DEFAULT '',
      model_or_service  TEXT NOT NULL DEFAULT '',
      started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      lease_expires_at  TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orchestrator_ai_request_ticks (
      id                BIGSERIAL PRIMARY KEY,
      tenant_id         INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      provider          TEXT NOT NULL DEFAULT '',
      model_or_service  TEXT NOT NULL DEFAULT '',
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS orchestrator_outbox (
      id                TEXT NOT NULL,
      tenant_id         INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      workflow_id       TEXT NULL,
      destination       TEXT NOT NULL,
      operation         TEXT NOT NULL,
      payload           JSONB NOT NULL DEFAULT '{}',
      credential_ref    TEXT NULL,
      state             TEXT NOT NULL DEFAULT 'pending',
      attempt_count     INTEGER NOT NULL DEFAULT 0,
      max_attempts      INTEGER NOT NULL DEFAULT 8,
      next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_error_code   TEXT NULL,
      claimed_by        TEXT NULL,
      claimed_until     TIMESTAMPTZ NULL,
      idempotency_key   TEXT NOT NULL,
      completed_at      TIMESTAMPTZ NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, id),
      CONSTRAINT orchestrator_outbox_destination_check
        CHECK (destination IN ('meta','google','tiktok','internal')),
      CONSTRAINT orchestrator_outbox_state_check
        CHECK (state IN ('pending','claimed','processing','completed','failed','dead_letter')),
      CONSTRAINT orchestrator_outbox_attempt_count_check
        CHECK (attempt_count >= 0),
      CONSTRAINT orchestrator_outbox_max_attempts_check
        CHECK (max_attempts >= 1),
      CONSTRAINT orchestrator_outbox_tenant_unique_dest_op_idemp
        UNIQUE (tenant_id, destination, operation, idempotency_key)
    );
  `);

  await p.query(`ALTER TABLE orchestrator_credit_accounts ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD'`);
  await p.query(`ALTER TABLE orchestrator_credit_accounts ADD COLUMN IF NOT EXISTS available_micros BIGINT NOT NULL DEFAULT 0`);
  await p.query(`ALTER TABLE orchestrator_credit_accounts ADD COLUMN IF NOT EXISTS reserved_micros BIGINT NOT NULL DEFAULT 0`);
  await p.query(`ALTER TABLE orchestrator_credit_accounts ADD COLUMN IF NOT EXISTS consumed_micros BIGINT NOT NULL DEFAULT 0`);
  await p.query(`ALTER TABLE orchestrator_credit_accounts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`);

  await p.query(`ALTER TABLE orchestrator_credit_ledger ADD COLUMN IF NOT EXISTS entry_type TEXT NOT NULL DEFAULT 'grant'`);
  await p.query(`ALTER TABLE orchestrator_credit_ledger ADD COLUMN IF NOT EXISTS amount_micros BIGINT NOT NULL DEFAULT 1`);
  await p.query(`ALTER TABLE orchestrator_credit_ledger ADD COLUMN IF NOT EXISTS reservation_id TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_credit_ledger ADD COLUMN IF NOT EXISTS workflow_id TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_credit_ledger ADD COLUMN IF NOT EXISTS step_id TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_credit_ledger ADD COLUMN IF NOT EXISTS provider TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_credit_ledger ADD COLUMN IF NOT EXISTS operation TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_credit_ledger ADD COLUMN IF NOT EXISTS model_or_service TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_credit_ledger ADD COLUMN IF NOT EXISTS actor_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL`);
  await p.query(`ALTER TABLE orchestrator_credit_ledger ADD COLUMN IF NOT EXISTS idempotency_key TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_credit_ledger ADD COLUMN IF NOT EXISTS reason_code TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_credit_ledger ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`);

  await p.query(`ALTER TABLE orchestrator_credit_reservations ADD COLUMN IF NOT EXISTS workflow_id TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_credit_reservations ADD COLUMN IF NOT EXISTS step_id TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_credit_reservations ADD COLUMN IF NOT EXISTS amount_micros BIGINT NOT NULL DEFAULT 1`);
  await p.query(`ALTER TABLE orchestrator_credit_reservations ADD COLUMN IF NOT EXISTS committed_micros BIGINT NOT NULL DEFAULT 0`);
  await p.query(`ALTER TABLE orchestrator_credit_reservations ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'reserved'`);
  await p.query(`ALTER TABLE orchestrator_credit_reservations ADD COLUMN IF NOT EXISTS estimated_cost_micros BIGINT NOT NULL DEFAULT 0`);
  await p.query(`ALTER TABLE orchestrator_credit_reservations ADD COLUMN IF NOT EXISTS actual_cost_micros BIGINT NULL`);
  await p.query(`ALTER TABLE orchestrator_credit_reservations ADD COLUMN IF NOT EXISTS cost_status TEXT NOT NULL DEFAULT 'estimated'`);
  await p.query(`ALTER TABLE orchestrator_credit_reservations ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_credit_reservations ADD COLUMN IF NOT EXISTS operation TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_credit_reservations ADD COLUMN IF NOT EXISTS model_or_service TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_credit_reservations ADD COLUMN IF NOT EXISTS pricing_version INTEGER NULL`);
  await p.query(`ALTER TABLE orchestrator_credit_reservations ADD COLUMN IF NOT EXISTS idempotency_key TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_credit_reservations ADD COLUMN IF NOT EXISTS actor_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL`);
  await p.query(`ALTER TABLE orchestrator_credit_reservations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`);
  await p.query(`ALTER TABLE orchestrator_credit_reservations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`);
  await p.query(`ALTER TABLE orchestrator_credit_reservations ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NULL`);

  await p.query(`ALTER TABLE orchestrator_tenant_limits ADD COLUMN IF NOT EXISTS credit_ceiling_micros BIGINT NOT NULL DEFAULT 0`);
  await p.query(`ALTER TABLE orchestrator_tenant_limits ADD COLUMN IF NOT EXISTS requests_per_minute INTEGER NOT NULL DEFAULT 0`);
  await p.query(`ALTER TABLE orchestrator_tenant_limits ADD COLUMN IF NOT EXISTS max_concurrent_ai INTEGER NOT NULL DEFAULT 0`);
  await p.query(`ALTER TABLE orchestrator_tenant_limits ADD COLUMN IF NOT EXISTS daily_ai_cost_micros BIGINT NOT NULL DEFAULT 0`);
  await p.query(`ALTER TABLE orchestrator_tenant_limits ADD COLUMN IF NOT EXISTS monthly_ai_cost_micros BIGINT NOT NULL DEFAULT 0`);
  await p.query(`ALTER TABLE orchestrator_tenant_limits ADD COLUMN IF NOT EXISTS per_workflow_cost_micros BIGINT NOT NULL DEFAULT 0`);
  await p.query(`ALTER TABLE orchestrator_tenant_limits ADD COLUMN IF NOT EXISTS provider_limits JSONB NOT NULL DEFAULT '{}'`);
  await p.query(`ALTER TABLE orchestrator_tenant_limits ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`);
  await p.query(`ALTER TABLE orchestrator_tenant_limits ADD COLUMN IF NOT EXISTS updated_by_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL`);

  await p.query(`ALTER TABLE orchestrator_pricing_catalog ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_pricing_catalog ADD COLUMN IF NOT EXISTS model_or_service TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_pricing_catalog ADD COLUMN IF NOT EXISTS unit_type TEXT NOT NULL DEFAULT 'request'`);
  await p.query(`ALTER TABLE orchestrator_pricing_catalog ADD COLUMN IF NOT EXISTS input_price_micros_per_million BIGINT NOT NULL DEFAULT 0`);
  await p.query(`ALTER TABLE orchestrator_pricing_catalog ADD COLUMN IF NOT EXISTS output_price_micros_per_million BIGINT NOT NULL DEFAULT 0`);
  await p.query(`ALTER TABLE orchestrator_pricing_catalog ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD'`);
  await p.query(`ALTER TABLE orchestrator_pricing_catalog ADD COLUMN IF NOT EXISTS effective_from TIMESTAMPTZ NOT NULL DEFAULT now()`);
  await p.query(`ALTER TABLE orchestrator_pricing_catalog ADD COLUMN IF NOT EXISTS pricing_version INTEGER NOT NULL DEFAULT 1`);
  await p.query(`ALTER TABLE orchestrator_pricing_catalog ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`);

  await p.query(`ALTER TABLE orchestrator_usage_records ADD COLUMN IF NOT EXISTS reservation_id TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_usage_records ADD COLUMN IF NOT EXISTS workflow_id TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_usage_records ADD COLUMN IF NOT EXISTS step_id TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_usage_records ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_usage_records ADD COLUMN IF NOT EXISTS model_or_service TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_usage_records ADD COLUMN IF NOT EXISTS unit_type TEXT NOT NULL DEFAULT 'request'`);
  await p.query(`ALTER TABLE orchestrator_usage_records ADD COLUMN IF NOT EXISTS input_units BIGINT NOT NULL DEFAULT 0`);
  await p.query(`ALTER TABLE orchestrator_usage_records ADD COLUMN IF NOT EXISTS output_units BIGINT NOT NULL DEFAULT 0`);
  await p.query(`ALTER TABLE orchestrator_usage_records ADD COLUMN IF NOT EXISTS estimated_cost_micros BIGINT NOT NULL DEFAULT 0`);
  await p.query(`ALTER TABLE orchestrator_usage_records ADD COLUMN IF NOT EXISTS actual_cost_micros BIGINT NULL`);
  await p.query(`ALTER TABLE orchestrator_usage_records ADD COLUMN IF NOT EXISTS cost_status TEXT NOT NULL DEFAULT 'estimated'`);
  await p.query(`ALTER TABLE orchestrator_usage_records ADD COLUMN IF NOT EXISTS pricing_version INTEGER NULL`);
  await p.query(`ALTER TABLE orchestrator_usage_records ADD COLUMN IF NOT EXISTS usage_source TEXT NOT NULL DEFAULT 'estimated'`);
  await p.query(`ALTER TABLE orchestrator_usage_records ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`);

  await p.query(`ALTER TABLE orchestrator_ai_inflight ADD COLUMN IF NOT EXISTS workflow_id TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_ai_inflight ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_ai_inflight ADD COLUMN IF NOT EXISTS model_or_service TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_ai_inflight ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NOT NULL DEFAULT now()`);
  await p.query(`ALTER TABLE orchestrator_ai_inflight ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ NOT NULL DEFAULT now()`);

  await p.query(`ALTER TABLE orchestrator_ai_request_ticks ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_ai_request_ticks ADD COLUMN IF NOT EXISTS model_or_service TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_ai_request_ticks ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`);

  await p.query(`ALTER TABLE orchestrator_outbox ADD COLUMN IF NOT EXISTS workflow_id TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_outbox ADD COLUMN IF NOT EXISTS destination TEXT NOT NULL DEFAULT 'internal'`);
  await p.query(`ALTER TABLE orchestrator_outbox ADD COLUMN IF NOT EXISTS operation TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_outbox ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'`);
  await p.query(`ALTER TABLE orchestrator_outbox ADD COLUMN IF NOT EXISTS credential_ref TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_outbox ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'pending'`);
  await p.query(`ALTER TABLE orchestrator_outbox ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0`);
  await p.query(`ALTER TABLE orchestrator_outbox ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 8`);
  await p.query(`ALTER TABLE orchestrator_outbox ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now()`);
  await p.query(`ALTER TABLE orchestrator_outbox ADD COLUMN IF NOT EXISTS last_error_code TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_outbox ADD COLUMN IF NOT EXISTS claimed_by TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_outbox ADD COLUMN IF NOT EXISTS claimed_until TIMESTAMPTZ NULL`);
  await p.query(`ALTER TABLE orchestrator_outbox ADD COLUMN IF NOT EXISTS idempotency_key TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_outbox ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ NULL`);
  await p.query(`ALTER TABLE orchestrator_outbox ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`);
  await p.query(`ALTER TABLE orchestrator_outbox ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`);

  await _ensureNamedCheck(p, 'orchestrator_credit_accounts', 'orchestrator_credit_accounts_available_micros_check',
    `available_micros >= 0`);
  await _ensureNamedCheck(p, 'orchestrator_credit_accounts', 'orchestrator_credit_accounts_reserved_micros_check',
    `reserved_micros >= 0`);
  await _ensureNamedCheck(p, 'orchestrator_credit_accounts', 'orchestrator_credit_accounts_consumed_micros_check',
    `consumed_micros >= 0`);
  await _ensureNamedCheck(p, 'orchestrator_credit_ledger', 'orchestrator_credit_ledger_entry_type_check',
    `entry_type IN ('grant','reservation','commit','release','refund','adjustment')`);
  await _ensureNamedCheck(p, 'orchestrator_credit_ledger', 'orchestrator_credit_ledger_amount_micros_check',
    `amount_micros > 0`);
  await _ensureNamedCheck(p, 'orchestrator_credit_reservations', 'orchestrator_credit_reservations_amount_micros_check',
    `amount_micros > 0`);
  await _ensureNamedCheck(p, 'orchestrator_credit_reservations', 'orchestrator_credit_reservations_committed_micros_check',
    `committed_micros >= 0`);
  await _ensureNamedCheck(p, 'orchestrator_credit_reservations', 'orchestrator_credit_reservations_status_check',
    `status IN ('reserved','committed','released','expired')`);
  await _ensureNamedCheck(p, 'orchestrator_credit_reservations', 'orchestrator_credit_reservations_estimated_cost_micros_check',
    `estimated_cost_micros >= 0`);
  await _ensureNamedCheck(p, 'orchestrator_credit_reservations', 'orchestrator_credit_reservations_actual_cost_micros_check',
    `actual_cost_micros >= 0`);
  await _ensureNamedCheck(p, 'orchestrator_credit_reservations', 'orchestrator_credit_reservations_cost_status_check',
    `cost_status IN ('estimated','final')`);
  await _ensureNamedCheck(p, 'orchestrator_credit_reservations', 'orchestrator_credit_reservations_committed_lte_amount_check',
    `committed_micros <= amount_micros`);
  await _ensureNamedCheck(p, 'orchestrator_tenant_limits', 'orchestrator_tenant_limits_credit_ceiling_micros_check',
    `credit_ceiling_micros >= 0`);
  await _ensureNamedCheck(p, 'orchestrator_tenant_limits', 'orchestrator_tenant_limits_requests_per_minute_check',
    `requests_per_minute >= 0`);
  await _ensureNamedCheck(p, 'orchestrator_tenant_limits', 'orchestrator_tenant_limits_max_concurrent_ai_check',
    `max_concurrent_ai >= 0`);
  await _ensureNamedCheck(p, 'orchestrator_tenant_limits', 'orchestrator_tenant_limits_daily_ai_cost_micros_check',
    `daily_ai_cost_micros >= 0`);
  await _ensureNamedCheck(p, 'orchestrator_tenant_limits', 'orchestrator_tenant_limits_monthly_ai_cost_micros_check',
    `monthly_ai_cost_micros >= 0`);
  await _ensureNamedCheck(p, 'orchestrator_tenant_limits', 'orchestrator_tenant_limits_per_workflow_cost_micros_check',
    `per_workflow_cost_micros >= 0`);
  await _ensureNamedCheck(p, 'orchestrator_pricing_catalog', 'orchestrator_pricing_catalog_unit_type_check',
    `unit_type IN ('token_input','token_output','request','image','second')`);
  await _ensureNamedCheck(p, 'orchestrator_pricing_catalog', 'orchestrator_pricing_catalog_input_price_check',
    `input_price_micros_per_million >= 0`);
  await _ensureNamedCheck(p, 'orchestrator_pricing_catalog', 'orchestrator_pricing_catalog_output_price_check',
    `output_price_micros_per_million >= 0`);
  await _ensureNamedCheck(p, 'orchestrator_pricing_catalog', 'orchestrator_pricing_catalog_pricing_version_check',
    `pricing_version >= 1`);
  await _ensureNamedCheck(p, 'orchestrator_usage_records', 'orchestrator_usage_records_input_units_check',
    `input_units >= 0`);
  await _ensureNamedCheck(p, 'orchestrator_usage_records', 'orchestrator_usage_records_output_units_check',
    `output_units >= 0`);
  await _ensureNamedCheck(p, 'orchestrator_usage_records', 'orchestrator_usage_records_estimated_cost_micros_check',
    `estimated_cost_micros >= 0`);
  await _ensureNamedCheck(p, 'orchestrator_usage_records', 'orchestrator_usage_records_actual_cost_micros_check',
    `actual_cost_micros >= 0`);
  await _ensureNamedCheck(p, 'orchestrator_usage_records', 'orchestrator_usage_records_cost_status_check',
    `cost_status IN ('estimated','final')`);
  await _ensureNamedCheck(p, 'orchestrator_usage_records', 'orchestrator_usage_records_usage_source_check',
    `usage_source IN ('provider','estimated','manual')`);
  await _ensureNamedCheck(p, 'orchestrator_outbox', 'orchestrator_outbox_destination_check',
    `destination IN ('meta','google','tiktok','internal')`);
  await _ensureNamedCheck(p, 'orchestrator_outbox', 'orchestrator_outbox_state_check',
    `state IN ('pending','claimed','processing','completed','failed','dead_letter')`);
  await _ensureNamedCheck(p, 'orchestrator_outbox', 'orchestrator_outbox_attempt_count_check',
    `attempt_count >= 0`);
  await _ensureNamedCheck(p, 'orchestrator_outbox', 'orchestrator_outbox_max_attempts_check',
    `max_attempts >= 1`);

  await _ensureNamedUnique(p, 'orchestrator_credit_reservations',
    'orchestrator_credit_reservations_tenant_unique_idempotency_key', 'tenant_id, idempotency_key');
  await _ensureNamedUnique(p, 'orchestrator_pricing_catalog',
    'orchestrator_pricing_catalog_tenant_unique_price',
    'tenant_id, provider, model_or_service, unit_type, pricing_version');
  await _ensureNamedUnique(p, 'orchestrator_outbox',
    'orchestrator_outbox_tenant_unique_dest_op_idemp',
    'tenant_id, destination, operation, idempotency_key');

  await p.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_credit_ledger_tenant_unique_idempotency_key
      ON orchestrator_credit_ledger (tenant_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_orchestrator_credit_ledger_tenant_created
      ON orchestrator_credit_ledger (tenant_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_orchestrator_credit_ledger_tenant_workflow
      ON orchestrator_credit_ledger (tenant_id, workflow_id);
    CREATE INDEX IF NOT EXISTS idx_orchestrator_credit_ledger_tenant_reservation
      ON orchestrator_credit_ledger (tenant_id, reservation_id);

    CREATE INDEX IF NOT EXISTS idx_orchestrator_credit_reservations_tenant_workflow
      ON orchestrator_credit_reservations (tenant_id, workflow_id);
    CREATE INDEX IF NOT EXISTS idx_orchestrator_credit_reservations_tenant_status
      ON orchestrator_credit_reservations (tenant_id, status);

    CREATE INDEX IF NOT EXISTS idx_orchestrator_pricing_catalog_tenant_provider_model_from
      ON orchestrator_pricing_catalog (tenant_id, provider, model_or_service, effective_from DESC);

    CREATE INDEX IF NOT EXISTS idx_orchestrator_usage_records_tenant_created
      ON orchestrator_usage_records (tenant_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_orchestrator_usage_records_tenant_workflow
      ON orchestrator_usage_records (tenant_id, workflow_id);
    CREATE INDEX IF NOT EXISTS idx_orchestrator_usage_records_tenant_reservation
      ON orchestrator_usage_records (tenant_id, reservation_id);

    CREATE INDEX IF NOT EXISTS idx_orchestrator_ai_inflight_tenant_lease
      ON orchestrator_ai_inflight (tenant_id, lease_expires_at);

    CREATE INDEX IF NOT EXISTS idx_orchestrator_ai_request_ticks_tenant_created
      ON orchestrator_ai_request_ticks (tenant_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_orchestrator_outbox_tenant_state_next
      ON orchestrator_outbox (tenant_id, state, next_attempt_at);
    CREATE INDEX IF NOT EXISTS idx_orchestrator_outbox_tenant_workflow
      ON orchestrator_outbox (tenant_id, workflow_id);
  `);

  // UPDATE always rejected. Direct DELETE rejected while the tenant row still
  // exists so tenant ON DELETE CASCADE can remove history after the parent is
  // gone. Same parent-EXISTS pattern as orchestrator_audit_events_immutable.
  await p.query(`
    CREATE OR REPLACE FUNCTION orchestrator_credit_ledger_immutable()
    RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'orchestrator_credit_ledger_immutable';
      END IF;
      IF EXISTS (
        SELECT 1 FROM tenants t
         WHERE t.id = OLD.tenant_id
      ) THEN
        RAISE EXCEPTION 'orchestrator_credit_ledger_immutable';
      END IF;
      RETURN OLD;
    END;
    $fn$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION orchestrator_usage_records_immutable()
    RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'orchestrator_usage_records_immutable';
      END IF;
      IF EXISTS (
        SELECT 1 FROM tenants t
         WHERE t.id = OLD.tenant_id
      ) THEN
        RAISE EXCEPTION 'orchestrator_usage_records_immutable';
      END IF;
      RETURN OLD;
    END;
    $fn$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS orchestrator_credit_ledger_immutable ON orchestrator_credit_ledger;
    CREATE TRIGGER orchestrator_credit_ledger_immutable
      BEFORE UPDATE OR DELETE ON orchestrator_credit_ledger
      FOR EACH ROW
      EXECUTE FUNCTION orchestrator_credit_ledger_immutable();

    DROP TRIGGER IF EXISTS orchestrator_usage_records_immutable ON orchestrator_usage_records;
    CREATE TRIGGER orchestrator_usage_records_immutable
      BEFORE UPDATE OR DELETE ON orchestrator_usage_records
      FOR EACH ROW
      EXECUTE FUNCTION orchestrator_usage_records_immutable();
  `);

  for (const t of ADVERTISING_ORCH_TABLES) {
    try { await addTenantIdColumn(t); } catch (_) { /* idempotent */ }
  }
  return true;
}

module.exports = { ensureAgentOrchestratorSchema };
