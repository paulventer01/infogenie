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
];

async function _ensureNamedCheck(p, table, name, checkBody) {
  await p.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${name}`);
  await p.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${checkBody})`);
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

async function ensureAgentOrchestratorSchema() {
  if (!_db.hasDb()) return false;
  const p = _db.getPool();
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
      created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT orchestrator_workflows_current_state_check
        CHECK (current_state IN (${WORKFLOW_STATES_SQL})),
      CONSTRAINT orchestrator_workflows_current_phase_check
        CHECK (current_phase IN (${WORKFLOW_PHASES_SQL})),
      CONSTRAINT orchestrator_workflows_next_approval_gate_check
        CHECK (next_approval_gate IS NULL OR next_approval_gate IN (${APPROVAL_GATES_SQL}))
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
      actor_user_id                INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      decision                     TEXT NOT NULL,
      comment                      TEXT NULL,
      permission_snapshot          JSONB NOT NULL DEFAULT '[]',
      created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT orchestrator_approvals_gate_check
        CHECK (gate IN (${APPROVAL_GATES_SQL})),
      CONSTRAINT orchestrator_approvals_decision_check
        CHECK (decision IN ('approved','rejected'))
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
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT orchestrator_idempotency_keys_tenant_unique_key UNIQUE (tenant_id, key)
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
  await p.query(`ALTER TABLE orchestrator_idempotency_keys ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`);

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

  for (const t of ADVERTISING_ORCH_TABLES) {
    try { await addTenantIdColumn(t); } catch (_) { /* idempotent */ }
  }
  return true;
}

module.exports = { ensureAgentOrchestratorSchema };
