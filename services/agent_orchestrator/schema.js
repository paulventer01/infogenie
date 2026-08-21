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
  // PR 3A — research runs, public competitor identity, append-only evidence, asset metadata
  'orchestrator_research_runs',
  'orchestrator_research_competitors',
  'orchestrator_research_evidence',
  'orchestrator_research_evidence_assets',
  'orchestrator_research_quota',
  'orchestrator_research_legacy_holds',
  'orchestrator_research_cleanup_ops',
];

const RESEARCH_RETENTION_EXPIRY_SQL =
  `retention_class = 'legal_hold' OR (expires_at IS NOT NULL AND expires_at > created_at)`;

// Redefine in one transaction. A bare DROP followed by a separate ADD leaves
// the table with no CHECK between the two autocommit statements, and leaves it
// permanently unconstrained when the ADD fails validation.
//
// `{ notValid: true }` still DROP+ADDs atomically, but ADD … CHECK (…) NOT VALID
// so legacy rows cannot fail boot. NOT VALID still enforces NEW inserts/updates.
// After commit, a violator scan of ZERO rows VALIDATE CONSTRAINTs (fail-closed
// if VALIDATE throws). Other CHECKs keep the validating ADD.
async function _ensureNamedCheck(p, table, name, checkBody, opts = {}) {
  const notValid = !!(opts && opts.notValid);
  await p.query('BEGIN');
  try {
    await p.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${name}`);
    const suffix = notValid ? ' NOT VALID' : '';
    await p.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${checkBody})${suffix}`);
    await p.query('COMMIT');
  } catch (e) {
    try { await p.query('ROLLBACK'); } catch (_) { /* already aborted */ }
    if (!e || e.code !== '42710') throw e;
    return;
  }
  if (!notValid) return;
  const violators = await p.query(`SELECT 1 FROM ${table} WHERE NOT (${checkBody}) LIMIT 1`);
  if (violators.rowCount === 0) {
    await p.query(`ALTER TABLE ${table} VALIDATE CONSTRAINT ${name}`);
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

function _fkColList(cols) {
  return String(cols || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(',');
}

async function _ensureNamedFk(p, table, name, cols, refTable, refCols, fkSuffix) {
  const wanted = _fkColList(cols);
  const r = await p.query(
    `SELECT string_agg(att.attname, ',' ORDER BY k.n) AS cols
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
       JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, n) ON true
       JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = k.attnum
      WHERE nsp.nspname = 'public'
        AND rel.relname = $1
        AND con.conname = $2
        AND con.contype = 'f'
      GROUP BY con.oid`,
    [table, name]
  );
  const existing = r.rowCount ? _fkColList(r.rows[0].cols) : null;
  if (existing === wanted) return;
  // Same reason as _ensureNamedCheck: swap the column list atomically so a
  // failed ADD cannot leave the table with no foreign key at all.
  await p.query('BEGIN');
  try {
    if (existing) {
      await p.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${name}`);
    }
    await p.query(
      `ALTER TABLE ${table} ADD CONSTRAINT ${name} FOREIGN KEY (${cols}) REFERENCES ${refTable} (${refCols}) ${fkSuffix}`
    );
    await p.query('COMMIT');
  } catch (e) {
    try { await p.query('ROLLBACK'); } catch (_) { /* already aborted */ }
    throw e;
  }
}

// One table's functions+triggers per transaction. DROP+CREATE stay atomic so
// boot never commits a window with no trigger (same fail-open class as
// _ensureNamedCheck). Runs DDL and evidence DDL must not share a transaction:
// node-pg would otherwise hold AccessExclusiveLock on both tables at once and
// deadlock (40P01) with the retention sweeper, which holds evidence row locks
// until COMMIT then needs AccessShareLock on runs from the DELETE trigger.
async function _installInTransaction(p, sql) {
  await p.query('BEGIN');
  try {
    await p.query(sql);
    await p.query('COMMIT');
  } catch (e) {
    try { await p.query('ROLLBACK'); } catch (_) { /* already aborted */ }
    throw e;
  }
}

async function _columnExists(p, table, column) {
  const r = await p.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 AND column_name=$2 LIMIT 1`,
    [table, column]
  );
  return r.rowCount > 0;
}

// Deduplication fingerprint, not authenticity/provenance proof. Idempotent
// rename from the original evidence_hash column; drop stale CHECKs/indexes.
async function _ensureContentFingerprintColumn(p) {
  const hasHash = await _columnExists(p, 'orchestrator_research_evidence', 'evidence_hash');
  const hasFp = await _columnExists(p, 'orchestrator_research_evidence', 'content_fingerprint');
  if (hasHash && !hasFp) {
    await p.query(`ALTER TABLE orchestrator_research_evidence DROP CONSTRAINT IF EXISTS orchestrator_research_evidence_evidence_hash_check`);
    await p.query(`ALTER TABLE orchestrator_research_evidence RENAME COLUMN evidence_hash TO content_fingerprint`);
  }
  await p.query(`ALTER TABLE orchestrator_research_evidence ADD COLUMN IF NOT EXISTS content_fingerprint TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000'`);
  // Keep the DEFAULT only for ADD COLUMN so a populated table can gain a
  // NOT NULL fingerprint. Drop it immediately so a later INSERT that omits
  // the column fails closed instead of writing a silent all-zero fingerprint.
  await p.query(`ALTER TABLE orchestrator_research_evidence ALTER COLUMN content_fingerprint DROP DEFAULT`);
  await p.query(`ALTER TABLE orchestrator_research_evidence DROP CONSTRAINT IF EXISTS orchestrator_research_evidence_evidence_hash_check`);
  await p.query(`DROP INDEX IF EXISTS idx_orchestrator_research_evidence_tenant_hash`);
  const stale = await p.query(
    `SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'orchestrator_research_evidence'
        AND indexdef ILIKE '%evidence_hash%'`
  );
  for (const row of stale.rows) {
    if (/^[a-z0-9_]+$/.test(row.indexname)) {
      await p.query(`DROP INDEX IF EXISTS ${row.indexname}`);
    }
  }
}

function _preflightFailed() {
  const err = new Error('orchestrator_schema_preflight_failed');
  err.code = 'orchestrator_schema_preflight_failed';
  return err;
}

// SELECT-only privilege probes. Must run before any CREATE/ALTER/UPDATE/DELETE
// in the locked ensure path. Never SET replica-role GUCs.
async function _preflightAgentOrchestratorSchema(p) {
  const flags = (await p.query(`
    SELECT has_database_privilege(current_user, current_database(), 'CONNECT') AS can_connect,
           has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create,
           has_schema_privilege(current_user, 'public', 'USAGE') AS schema_usage
  `)).rows[0];
  if (!flags.can_connect || !flags.schema_create || !flags.schema_usage) {
    throw _preflightFailed();
  }

  const tables = (await p.query(`
    SELECT c.relname AS table_name,
           has_table_privilege(current_user, c.oid, 'INSERT') AS can_insert,
           has_table_privilege(current_user, c.oid, 'UPDATE') AS can_update,
           has_table_privilege(current_user, c.oid, 'DELETE') AS can_delete,
           has_table_privilege(current_user, c.oid, 'REFERENCES') AS can_references,
           has_table_privilege(current_user, c.oid, 'TRIGGER') AS can_trigger
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relname LIKE 'orchestrator_%'
     ORDER BY 1
  `)).rows;

  for (const row of tables) {
    if (!row.can_insert || !row.can_update || !row.can_delete || !row.can_references || !row.can_trigger) {
      throw _preflightFailed();
    }
  }
}

async function _identifyLegacyResearchCleanup(p) {
  const evidence = await p.query(`
    INSERT INTO orchestrator_research_legacy_holds (tenant_id, target_kind, target_id, reason)
    SELECT e.tenant_id, 'evidence', e.id,
           CASE
             WHEN e.retention_class = 'short'
                  AND e.created_at + interval '7 days' <= now() THEN 'legacy_short_due'
             WHEN e.expires_at IS NULL THEN 'missing_expiry'
             ELSE 'invalid_expiry'
           END
      FROM orchestrator_research_evidence e
     WHERE (
             e.retention_class = 'short'
             AND e.created_at + interval '7 days' <= now()
           )
        OR (
             e.retention_class IN ('standard', 'short')
             AND (e.expires_at IS NULL OR e.expires_at <= e.created_at)
           )
    ON CONFLICT (tenant_id, target_kind, target_id) DO NOTHING
  `);
  const assets = await p.query(`
    INSERT INTO orchestrator_research_legacy_holds (tenant_id, target_kind, target_id, reason)
    SELECT a.tenant_id, 'asset', a.id,
           CASE
             WHEN a.retention_class = 'short'
                  AND a.created_at + interval '7 days' <= now() THEN 'legacy_short_due'
             WHEN a.expires_at IS NULL THEN 'missing_expiry'
             ELSE 'invalid_expiry'
           END
      FROM orchestrator_research_evidence_assets a
     WHERE (
             a.retention_class = 'short'
             AND a.created_at + interval '7 days' <= now()
           )
        OR (
             a.retention_class IN ('standard', 'short')
             AND (a.expires_at IS NULL OR a.expires_at <= a.created_at)
           )
    ON CONFLICT (tenant_id, target_kind, target_id) DO NOTHING
  `);
  return {
    evidence: evidence.rowCount || 0,
    assets: assets.rowCount || 0,
  };
}

async function identifyLegacyResearchCleanup(client) {
  if (!_db.hasDb()) return { evidence: 0, assets: 0 };
  const p = client || _db.getPool();
  return _identifyLegacyResearchCleanup(p);
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
  let failed = null;
  try {
    await p.query('SELECT pg_advisory_lock($1)', [87231402]);
    try {
      return await _runEnsureAgentOrchestratorSchemaLocked(p);
    } finally {
      await p.query('SELECT pg_advisory_unlock($1)', [87231402]);
    }
  } catch (err) {
    failed = err;
    throw err;
  } finally {
    // A failed ensure can leave this client inside an aborted transaction.
    // Destroy it instead of handing a tainted client back to the pool.
    p.release(failed || undefined);
  }
}

async function _runEnsureAgentOrchestratorSchemaLocked(p) {
  await _preflightAgentOrchestratorSchema(p);
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
      max_research_evidence_records INTEGER NOT NULL DEFAULT 0,
      max_research_evidence_payload_bytes BIGINT NOT NULL DEFAULT 0,
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
        CHECK (per_workflow_cost_micros >= 0),
      CONSTRAINT orchestrator_tenant_limits_max_research_evidence_records_check
        CHECK (max_research_evidence_records >= 0),
      CONSTRAINT orchestrator_tenant_limits_max_research_evidence_payload_bytes_check
        CHECK (max_research_evidence_payload_bytes >= 0)
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
  await p.query(`ALTER TABLE orchestrator_tenant_limits ADD COLUMN IF NOT EXISTS max_research_evidence_records INTEGER NOT NULL DEFAULT 0`);
  await p.query(`ALTER TABLE orchestrator_tenant_limits ADD COLUMN IF NOT EXISTS max_research_evidence_payload_bytes BIGINT NOT NULL DEFAULT 0`);

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
  await _ensureNamedCheck(p, 'orchestrator_tenant_limits', 'orchestrator_tenant_limits_max_research_evidence_records_check',
    `max_research_evidence_records >= 0`);
  await _ensureNamedCheck(p, 'orchestrator_tenant_limits', 'orchestrator_tenant_limits_max_research_evidence_payload_bytes_check',
    `max_research_evidence_payload_bytes >= 0`);
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

  // Additive parent uniques so PR3A composite FKs can reference (tenant_id, id)
  // without replacing existing PKs. Safe on existing rows: workflow id is already
  // globally unique; approval id is SERIAL.
  await _ensureNamedUnique(p, 'orchestrator_workflows',
    'orchestrator_workflows_tenant_unique_id', 'tenant_id, id');
  await _ensureNamedUnique(p, 'orchestrator_approvals',
    'orchestrator_approvals_tenant_unique_id', 'tenant_id, id');

  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_research_runs (
      id                         TEXT NOT NULL,
      tenant_id                  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      workflow_id                TEXT NOT NULL,
      approval_id                INTEGER NOT NULL,
      approval_object_version    INTEGER NOT NULL,
      contract_version           TEXT NOT NULL DEFAULT 'v1',
      requested_platforms        TEXT[] NOT NULL,
      research_brief             TEXT NOT NULL DEFAULT '',
      search_parameters          JSONB NOT NULL DEFAULT '{}',
      state                      TEXT NOT NULL DEFAULT 'pending',
      idempotency_key            TEXT NOT NULL,
      continuation_state         JSONB NOT NULL DEFAULT '{}',
      failure_class              TEXT NULL,
      error_code                 TEXT NULL,
      error_message              TEXT NULL,
      created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
      started_at                 TIMESTAMPTZ NULL,
      completed_at               TIMESTAMPTZ NULL,
      failed_at                  TIMESTAMPTZ NULL,
      PRIMARY KEY (tenant_id, id),
      CONSTRAINT orchestrator_research_runs_tenant_unique_idempotency_key
        UNIQUE (tenant_id, idempotency_key),
      CONSTRAINT orchestrator_research_runs_tenant_workflow_fkey
        FOREIGN KEY (tenant_id, workflow_id)
        REFERENCES orchestrator_workflows (tenant_id, id) ON DELETE CASCADE,
      CONSTRAINT orchestrator_research_runs_tenant_approval_fkey
        FOREIGN KEY (tenant_id, approval_id)
        REFERENCES orchestrator_approvals (tenant_id, id)
        ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
      CONSTRAINT orchestrator_research_runs_contract_version_check
        CHECK (contract_version IN ('v1')),
      CONSTRAINT orchestrator_research_runs_state_check
        CHECK (state IN ('pending','running','completed','failed','cancelled')),
      CONSTRAINT orchestrator_research_runs_failure_class_check
        CHECK (failure_class IS NULL OR failure_class IN (
          'rate_limit','auth_failure','transient','invalid_response','policy_rejection','terminal'
        )),
      CONSTRAINT orchestrator_research_runs_requested_platforms_check
        CHECK (
          cardinality(requested_platforms) >= 1
          AND cardinality(requested_platforms) <= 3
          AND requested_platforms <@ ARRAY['meta','google','tiktok']::text[]
        ),
      CONSTRAINT orchestrator_research_runs_research_brief_check
        CHECK (char_length(research_brief) <= 4000),
      CONSTRAINT orchestrator_research_runs_search_parameters_check
        CHECK (octet_length(search_parameters::text) <= 8192),
      CONSTRAINT orchestrator_research_runs_search_parameters_type_check
        CHECK (jsonb_typeof(search_parameters) = 'object'),
      CONSTRAINT orchestrator_research_runs_continuation_state_check
        CHECK (octet_length(continuation_state::text) <= 4096),
      CONSTRAINT orchestrator_research_runs_continuation_state_type_check
        CHECK (jsonb_typeof(continuation_state) = 'object'),
      CONSTRAINT orchestrator_research_runs_error_code_check
        CHECK (char_length(error_code) <= 128),
      CONSTRAINT orchestrator_research_runs_error_message_check
        CHECK (char_length(error_message) <= 512),
      CONSTRAINT orchestrator_research_runs_idempotency_key_check
        CHECK (char_length(idempotency_key) BETWEEN 1 AND 256),
      CONSTRAINT orchestrator_research_runs_id_check
        CHECK (char_length(id) BETWEEN 1 AND 128)
    );

    CREATE TABLE IF NOT EXISTS orchestrator_research_competitors (
      id                      TEXT NOT NULL,
      tenant_id               INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      research_run_id         TEXT NOT NULL,
      platform                TEXT NOT NULL,
      provider_advertiser_id  TEXT NOT NULL,
      normalized_name         TEXT NOT NULL,
      canonical_url           TEXT NULL,
      country                 TEXT NULL,
      market                  TEXT NULL,
      discovery_source        TEXT NOT NULL,
      captured_at             TIMESTAMPTZ NOT NULL,
      dedup_key               TEXT NOT NULL,
      contract_version        TEXT NOT NULL DEFAULT 'v1',
      created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, id),
      CONSTRAINT orchestrator_research_competitors_tenant_unique_dedup
        UNIQUE (tenant_id, research_run_id, platform, dedup_key),
      CONSTRAINT orchestrator_research_competitors_tenant_unique_ext
        UNIQUE (tenant_id, research_run_id, platform, provider_advertiser_id),
      CONSTRAINT orchestrator_research_competitors_tenant_unique_run_id
        UNIQUE (tenant_id, research_run_id, id),
      CONSTRAINT orchestrator_research_competitors_tenant_run_fkey
        FOREIGN KEY (tenant_id, research_run_id)
        REFERENCES orchestrator_research_runs (tenant_id, id) ON DELETE CASCADE,
      CONSTRAINT orchestrator_research_competitors_platform_check
        CHECK (platform IN ('meta','google','tiktok')),
      CONSTRAINT orchestrator_research_competitors_contract_version_check
        CHECK (contract_version IN ('v1')),
      CONSTRAINT orchestrator_research_competitors_discovery_source_check
        CHECK (discovery_source IN (
          'ad_library','ads_transparency_center','keyword_planner','public_profile','connector'
        )),
      CONSTRAINT orchestrator_research_competitors_provider_advertiser_id_check
        CHECK (char_length(provider_advertiser_id) BETWEEN 1 AND 256),
      CONSTRAINT orchestrator_research_competitors_normalized_name_check
        CHECK (char_length(normalized_name) BETWEEN 1 AND 256),
      CONSTRAINT orchestrator_research_competitors_canonical_url_check
        CHECK (canonical_url IS NULL OR char_length(canonical_url) <= 2048),
      CONSTRAINT orchestrator_research_competitors_country_check
        CHECK (country IS NULL OR char_length(country) <= 8),
      CONSTRAINT orchestrator_research_competitors_market_check
        CHECK (market IS NULL OR char_length(market) <= 64),
      CONSTRAINT orchestrator_research_competitors_dedup_key_check
        CHECK (char_length(dedup_key) BETWEEN 1 AND 128),
      CONSTRAINT orchestrator_research_competitors_id_check
        CHECK (char_length(id) BETWEEN 1 AND 128)
    );

    CREATE TABLE IF NOT EXISTS orchestrator_research_evidence (
      id                    TEXT NOT NULL,
      tenant_id             INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      research_run_id       TEXT NOT NULL,
      competitor_id         TEXT NOT NULL,
      platform              TEXT NOT NULL,
      source_type           TEXT NOT NULL,
      provider_external_id  TEXT NULL,
      canonical_source_url  TEXT NULL,
      advertiser_name       TEXT NOT NULL DEFAULT '',
      creative_format       TEXT NULL,
      headline              TEXT NOT NULL DEFAULT '',
      body_text             TEXT NOT NULL DEFAULT '',
      excerpt               TEXT NOT NULL DEFAULT '',
      provider_started_on   DATE NULL,
      provider_ended_on     DATE NULL,
      captured_at           TIMESTAMPTZ NOT NULL,
      market                TEXT NULL,
      language              TEXT NULL,
      placement             TEXT NULL,
      provider_metrics      JSONB NOT NULL DEFAULT '{}',
      metrics_kind          TEXT NOT NULL DEFAULT 'provider_reported',
      provenance_method     TEXT NOT NULL,
      connector_id          TEXT NOT NULL,
      connector_version     TEXT NOT NULL,
      contract_version      TEXT NOT NULL DEFAULT 'v1',
      content_fingerprint   TEXT NOT NULL,
      dedup_key             TEXT NOT NULL,
      expires_at            TIMESTAMPTZ NULL,
      retention_class       TEXT NOT NULL DEFAULT 'standard',
      supersedes_id         TEXT NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, id),
      CONSTRAINT orchestrator_research_evidence_tenant_unique_dedup
        UNIQUE (tenant_id, research_run_id, dedup_key),
      CONSTRAINT orchestrator_research_evidence_tenant_run_fkey
        FOREIGN KEY (tenant_id, research_run_id)
        REFERENCES orchestrator_research_runs (tenant_id, id) ON DELETE CASCADE,
      CONSTRAINT orchestrator_research_evidence_tenant_competitor_fkey
        FOREIGN KEY (tenant_id, research_run_id, competitor_id)
        REFERENCES orchestrator_research_competitors (tenant_id, research_run_id, id) ON DELETE CASCADE,
      CONSTRAINT orchestrator_research_evidence_platform_check
        CHECK (platform IN ('meta','google','tiktok')),
      CONSTRAINT orchestrator_research_evidence_source_type_check
        CHECK (source_type IN (
          'ad_creative','ad_copy','landing_page','auction_insight','search_term',
          'public_page','public_video','labelled_metric'
        )),
      CONSTRAINT orchestrator_research_evidence_creative_format_check
        CHECK (creative_format IS NULL OR creative_format IN (
          'image','video','carousel','text','html','unknown'
        )),
      CONSTRAINT orchestrator_research_evidence_metrics_kind_check
        CHECK (metrics_kind IN ('provider_reported','estimated')),
      CONSTRAINT orchestrator_research_evidence_provenance_method_check
        CHECK (provenance_method IN (
          'ad_library','ads_transparency_center','keyword_planner','public_scrape','connector'
        )),
      CONSTRAINT orchestrator_research_evidence_connector_id_check
        CHECK (connector_id IN ('meta_research','google_research','tiktok_research')),
      CONSTRAINT orchestrator_research_evidence_contract_version_check
        CHECK (contract_version IN ('v1')),
      CONSTRAINT orchestrator_research_evidence_retention_class_check
        CHECK (retention_class IN ('standard','short','legal_hold')),
      CONSTRAINT orchestrator_research_evidence_retention_expiry_check
        CHECK (retention_class = 'legal_hold' OR (expires_at IS NOT NULL AND expires_at > created_at)),
      CONSTRAINT orchestrator_research_evidence_headline_check
        CHECK (char_length(headline) <= 500),
      CONSTRAINT orchestrator_research_evidence_body_text_check
        CHECK (char_length(body_text) <= 4000),
      CONSTRAINT orchestrator_research_evidence_excerpt_check
        CHECK (char_length(excerpt) <= 2000),
      CONSTRAINT orchestrator_research_evidence_advertiser_name_check
        CHECK (char_length(advertiser_name) <= 256),
      CONSTRAINT orchestrator_research_evidence_provider_external_id_check
        CHECK (provider_external_id IS NULL OR char_length(provider_external_id) BETWEEN 1 AND 256),
      CONSTRAINT orchestrator_research_evidence_canonical_source_url_check
        CHECK (canonical_source_url IS NULL OR char_length(canonical_source_url) <= 2048),
      CONSTRAINT orchestrator_research_evidence_market_check
        CHECK (market IS NULL OR char_length(market) <= 64),
      CONSTRAINT orchestrator_research_evidence_language_check
        CHECK (language IS NULL OR char_length(language) <= 16),
      CONSTRAINT orchestrator_research_evidence_placement_check
        CHECK (placement IS NULL OR char_length(placement) <= 64),
      CONSTRAINT orchestrator_research_evidence_connector_version_check
        CHECK (char_length(connector_version) BETWEEN 1 AND 64),
      CONSTRAINT orchestrator_research_evidence_content_fingerprint_check
        CHECK (char_length(content_fingerprint) = 64 AND content_fingerprint ~ '^[0-9a-f]{64}$'),
      CONSTRAINT orchestrator_research_evidence_dedup_key_check
        CHECK (char_length(dedup_key) BETWEEN 1 AND 128),
      CONSTRAINT orchestrator_research_evidence_provider_metrics_len_check
        CHECK (octet_length(provider_metrics::text) <= 8192),
      CONSTRAINT orchestrator_research_evidence_provider_metrics_type_check
        CHECK (jsonb_typeof(provider_metrics) = 'object'),
      CONSTRAINT orchestrator_research_evidence_supersedes_id_check
        CHECK (supersedes_id IS NULL OR char_length(supersedes_id) BETWEEN 1 AND 128),
      CONSTRAINT orchestrator_research_evidence_id_check
        CHECK (char_length(id) BETWEEN 1 AND 128)
    );

    CREATE TABLE IF NOT EXISTS orchestrator_research_evidence_assets (
      id                TEXT NOT NULL,
      tenant_id         INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      evidence_id       TEXT NOT NULL,
      media_type        TEXT NOT NULL,
      storage_ref       TEXT NOT NULL,
      checksum_sha256   TEXT NOT NULL,
      width_px          INTEGER NULL,
      height_px         INTEGER NULL,
      duration_ms       INTEGER NULL,
      captured_at       TIMESTAMPTZ NOT NULL,
      expires_at        TIMESTAMPTZ NULL,
      retention_class   TEXT NOT NULL DEFAULT 'standard',
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, id),
      CONSTRAINT orchestrator_research_evidence_assets_tenant_unique_ref
        UNIQUE (tenant_id, evidence_id, storage_ref),
      CONSTRAINT orchestrator_research_evidence_assets_tenant_evidence_fkey
        FOREIGN KEY (tenant_id, evidence_id)
        REFERENCES orchestrator_research_evidence (tenant_id, id) ON DELETE CASCADE,
      CONSTRAINT orchestrator_research_evidence_assets_media_type_check
        CHECK (media_type IN ('image','video','html','other')),
      CONSTRAINT orchestrator_research_evidence_assets_retention_class_check
        CHECK (retention_class IN ('standard','short','legal_hold')),
      CONSTRAINT orchestrator_research_evidence_assets_retention_expiry_check
        CHECK (retention_class = 'legal_hold' OR (expires_at IS NOT NULL AND expires_at > created_at)),
      CONSTRAINT orchestrator_research_evidence_assets_storage_ref_check
        CHECK (char_length(storage_ref) BETWEEN 1 AND 1024),
      CONSTRAINT orchestrator_research_evidence_assets_checksum_sha256_check
        CHECK (char_length(checksum_sha256) = 64 AND checksum_sha256 ~ '^[0-9a-f]{64}$'),
      CONSTRAINT orchestrator_research_evidence_assets_width_px_check
        CHECK (width_px IS NULL OR width_px >= 0),
      CONSTRAINT orchestrator_research_evidence_assets_height_px_check
        CHECK (height_px IS NULL OR height_px >= 0),
      CONSTRAINT orchestrator_research_evidence_assets_duration_ms_check
        CHECK (duration_ms IS NULL OR duration_ms >= 0),
      CONSTRAINT orchestrator_research_evidence_assets_id_check
        CHECK (char_length(id) BETWEEN 1 AND 128)
    );

    CREATE TABLE IF NOT EXISTS orchestrator_research_quota (
      tenant_id       INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
      evidence_count  INTEGER NOT NULL DEFAULT 0,
      payload_bytes   BIGINT NOT NULL DEFAULT 0,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT orchestrator_research_quota_evidence_count_check
        CHECK (evidence_count >= 0),
      CONSTRAINT orchestrator_research_quota_payload_bytes_check
        CHECK (payload_bytes >= 0)
    );

    CREATE TABLE IF NOT EXISTS orchestrator_research_legacy_holds (
      tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      target_kind    TEXT NOT NULL,
      target_id      TEXT NOT NULL,
      reason         TEXT NOT NULL,
      identified_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, target_kind, target_id),
      CONSTRAINT orchestrator_research_legacy_holds_target_kind_check
        CHECK (target_kind IN ('evidence','asset')),
      CONSTRAINT orchestrator_research_legacy_holds_reason_check
        CHECK (reason IN ('legacy_short_due','missing_expiry','invalid_expiry')),
      CONSTRAINT orchestrator_research_legacy_holds_target_id_check
        CHECK (char_length(target_id) BETWEEN 1 AND 128)
    );

    CREATE TABLE IF NOT EXISTS orchestrator_research_cleanup_ops (
      id                      TEXT NOT NULL,
      tenant_id               INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      idempotency_key         TEXT NOT NULL,
      state                   TEXT NOT NULL,
      dry_run_evidence_count  INTEGER NOT NULL DEFAULT 0,
      dry_run_assets_count    INTEGER NOT NULL DEFAULT 0,
      purged_evidence_count   INTEGER NOT NULL DEFAULT 0,
      purged_assets_count     INTEGER NOT NULL DEFAULT 0,
      actor_user_id           INTEGER NULL,
      approved_at             TIMESTAMPTZ NULL,
      confirmation_sha256     TEXT NULL,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, id),
      CONSTRAINT orchestrator_research_cleanup_ops_tenant_unique_idempotency_key
        UNIQUE (tenant_id, idempotency_key),
      CONSTRAINT orchestrator_research_cleanup_ops_state_check
        CHECK (state IN ('previewed','approved','running','completed','failed')),
      CONSTRAINT orchestrator_research_cleanup_ops_id_check
        CHECK (char_length(id) BETWEEN 1 AND 128),
      CONSTRAINT orchestrator_research_cleanup_ops_idempotency_key_check
        CHECK (char_length(idempotency_key) BETWEEN 1 AND 256),
      CONSTRAINT orchestrator_research_cleanup_ops_dry_run_evidence_count_check
        CHECK (dry_run_evidence_count >= 0),
      CONSTRAINT orchestrator_research_cleanup_ops_dry_run_assets_count_check
        CHECK (dry_run_assets_count >= 0),
      CONSTRAINT orchestrator_research_cleanup_ops_purged_evidence_count_check
        CHECK (purged_evidence_count >= 0),
      CONSTRAINT orchestrator_research_cleanup_ops_purged_assets_count_check
        CHECK (purged_assets_count >= 0),
      CONSTRAINT orchestrator_research_cleanup_ops_confirmation_sha256_check
        CHECK (
          confirmation_sha256 IS NULL
          OR (char_length(confirmation_sha256) = 64 AND confirmation_sha256 ~ '^[0-9a-f]{64}$')
        )
    );
  `);

  await p.query(`ALTER TABLE orchestrator_research_runs ADD COLUMN IF NOT EXISTS workflow_id TEXT`);
  await p.query(`ALTER TABLE orchestrator_research_runs ADD COLUMN IF NOT EXISTS approval_id INTEGER`);
  await p.query(`ALTER TABLE orchestrator_research_runs ADD COLUMN IF NOT EXISTS approval_object_version INTEGER NOT NULL DEFAULT 1`);
  await p.query(`ALTER TABLE orchestrator_research_runs ADD COLUMN IF NOT EXISTS contract_version TEXT NOT NULL DEFAULT 'v1'`);
  await p.query(`ALTER TABLE orchestrator_research_runs ADD COLUMN IF NOT EXISTS requested_platforms TEXT[] NOT NULL DEFAULT ARRAY['meta']::text[]`);
  await p.query(`ALTER TABLE orchestrator_research_runs ADD COLUMN IF NOT EXISTS research_brief TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_research_runs ADD COLUMN IF NOT EXISTS search_parameters JSONB NOT NULL DEFAULT '{}'`);
  await p.query(`ALTER TABLE orchestrator_research_runs ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'pending'`);
  await p.query(`ALTER TABLE orchestrator_research_runs ADD COLUMN IF NOT EXISTS idempotency_key TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_research_runs ADD COLUMN IF NOT EXISTS continuation_state JSONB NOT NULL DEFAULT '{}'`);
  await p.query(`ALTER TABLE orchestrator_research_runs ADD COLUMN IF NOT EXISTS failure_class TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_research_runs ADD COLUMN IF NOT EXISTS error_code TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_research_runs ADD COLUMN IF NOT EXISTS error_message TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_research_runs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`);
  await p.query(`ALTER TABLE orchestrator_research_runs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NULL`);
  await p.query(`ALTER TABLE orchestrator_research_runs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ NULL`);
  await p.query(`ALTER TABLE orchestrator_research_runs ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ NULL`);

  await p.query(`ALTER TABLE orchestrator_research_competitors ADD COLUMN IF NOT EXISTS research_run_id TEXT`);
  await p.query(`ALTER TABLE orchestrator_research_competitors ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'meta'`);
  await p.query(`ALTER TABLE orchestrator_research_competitors ADD COLUMN IF NOT EXISTS provider_advertiser_id TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_research_competitors ADD COLUMN IF NOT EXISTS normalized_name TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_research_competitors ADD COLUMN IF NOT EXISTS canonical_url TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_research_competitors ADD COLUMN IF NOT EXISTS country TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_research_competitors ADD COLUMN IF NOT EXISTS market TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_research_competitors ADD COLUMN IF NOT EXISTS discovery_source TEXT NOT NULL DEFAULT 'ad_library'`);
  await p.query(`ALTER TABLE orchestrator_research_competitors ADD COLUMN IF NOT EXISTS captured_at TIMESTAMPTZ NOT NULL DEFAULT now()`);
  await p.query(`ALTER TABLE orchestrator_research_competitors ADD COLUMN IF NOT EXISTS dedup_key TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_research_competitors ADD COLUMN IF NOT EXISTS contract_version TEXT NOT NULL DEFAULT 'v1'`);
  await p.query(`ALTER TABLE orchestrator_research_competitors ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`);

  await p.query(`ALTER TABLE orchestrator_research_evidence ADD COLUMN IF NOT EXISTS research_run_id TEXT`);
  await p.query(`ALTER TABLE orchestrator_research_evidence ADD COLUMN IF NOT EXISTS competitor_id TEXT`);
  await p.query(`ALTER TABLE orchestrator_research_evidence ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'meta'`);
  await p.query(`ALTER TABLE orchestrator_research_evidence ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'ad_creative'`);
  await p.query(`ALTER TABLE orchestrator_research_evidence ADD COLUMN IF NOT EXISTS provider_external_id TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_research_evidence ADD COLUMN IF NOT EXISTS canonical_source_url TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_research_evidence ADD COLUMN IF NOT EXISTS advertiser_name TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_research_evidence ADD COLUMN IF NOT EXISTS creative_format TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_research_evidence ADD COLUMN IF NOT EXISTS headline TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_research_evidence ADD COLUMN IF NOT EXISTS body_text TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_research_evidence ADD COLUMN IF NOT EXISTS excerpt TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_research_evidence ADD COLUMN IF NOT EXISTS provider_started_on DATE NULL`);
  await p.query(`ALTER TABLE orchestrator_research_evidence ADD COLUMN IF NOT EXISTS provider_ended_on DATE NULL`);
  await p.query(`ALTER TABLE orchestrator_research_evidence ADD COLUMN IF NOT EXISTS captured_at TIMESTAMPTZ NOT NULL DEFAULT now()`);
  await p.query(`ALTER TABLE orchestrator_research_evidence ADD COLUMN IF NOT EXISTS market TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_research_evidence ADD COLUMN IF NOT EXISTS language TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_research_evidence ADD COLUMN IF NOT EXISTS placement TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_research_evidence ADD COLUMN IF NOT EXISTS provider_metrics JSONB NOT NULL DEFAULT '{}'`);
  await p.query(`ALTER TABLE orchestrator_research_evidence ADD COLUMN IF NOT EXISTS metrics_kind TEXT NOT NULL DEFAULT 'provider_reported'`);
  await p.query(`ALTER TABLE orchestrator_research_evidence ADD COLUMN IF NOT EXISTS provenance_method TEXT NOT NULL DEFAULT 'ad_library'`);
  await p.query(`ALTER TABLE orchestrator_research_evidence ADD COLUMN IF NOT EXISTS connector_id TEXT NOT NULL DEFAULT 'meta_research'`);
  await p.query(`ALTER TABLE orchestrator_research_evidence ADD COLUMN IF NOT EXISTS connector_version TEXT NOT NULL DEFAULT 'v1'`);
  await p.query(`ALTER TABLE orchestrator_research_evidence ADD COLUMN IF NOT EXISTS contract_version TEXT NOT NULL DEFAULT 'v1'`);
  await _ensureContentFingerprintColumn(p);
  await p.query(`ALTER TABLE orchestrator_research_evidence ADD COLUMN IF NOT EXISTS dedup_key TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_research_evidence ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NULL`);
  await p.query(`ALTER TABLE orchestrator_research_evidence ADD COLUMN IF NOT EXISTS retention_class TEXT NOT NULL DEFAULT 'standard'`);
  await p.query(`ALTER TABLE orchestrator_research_evidence ADD COLUMN IF NOT EXISTS supersedes_id TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_research_evidence ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`);

  await p.query(`ALTER TABLE orchestrator_research_evidence_assets ADD COLUMN IF NOT EXISTS evidence_id TEXT`);
  await p.query(`ALTER TABLE orchestrator_research_evidence_assets ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'other'`);
  await p.query(`ALTER TABLE orchestrator_research_evidence_assets ADD COLUMN IF NOT EXISTS storage_ref TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_research_evidence_assets ADD COLUMN IF NOT EXISTS checksum_sha256 TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000'`);
  await p.query(`ALTER TABLE orchestrator_research_evidence_assets ADD COLUMN IF NOT EXISTS width_px INTEGER NULL`);
  await p.query(`ALTER TABLE orchestrator_research_evidence_assets ADD COLUMN IF NOT EXISTS height_px INTEGER NULL`);
  await p.query(`ALTER TABLE orchestrator_research_evidence_assets ADD COLUMN IF NOT EXISTS duration_ms INTEGER NULL`);
  await p.query(`ALTER TABLE orchestrator_research_evidence_assets ADD COLUMN IF NOT EXISTS captured_at TIMESTAMPTZ NOT NULL DEFAULT now()`);
  await p.query(`ALTER TABLE orchestrator_research_evidence_assets ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NULL`);
  await p.query(`ALTER TABLE orchestrator_research_evidence_assets ADD COLUMN IF NOT EXISTS retention_class TEXT NOT NULL DEFAULT 'standard'`);
  await p.query(`ALTER TABLE orchestrator_research_evidence_assets ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`);

  await p.query(`ALTER TABLE orchestrator_research_quota ADD COLUMN IF NOT EXISTS evidence_count INTEGER NOT NULL DEFAULT 0`);
  await p.query(`ALTER TABLE orchestrator_research_quota ADD COLUMN IF NOT EXISTS payload_bytes BIGINT NOT NULL DEFAULT 0`);
  await p.query(`ALTER TABLE orchestrator_research_quota ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`);

  await p.query(`ALTER TABLE orchestrator_research_legacy_holds ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL DEFAULT 'missing_expiry'`);
  await p.query(`ALTER TABLE orchestrator_research_legacy_holds ADD COLUMN IF NOT EXISTS identified_at TIMESTAMPTZ NOT NULL DEFAULT now()`);

  await p.query(`ALTER TABLE orchestrator_research_cleanup_ops ADD COLUMN IF NOT EXISTS idempotency_key TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_research_cleanup_ops ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'previewed'`);
  await p.query(`ALTER TABLE orchestrator_research_cleanup_ops ADD COLUMN IF NOT EXISTS dry_run_evidence_count INTEGER NOT NULL DEFAULT 0`);
  await p.query(`ALTER TABLE orchestrator_research_cleanup_ops ADD COLUMN IF NOT EXISTS dry_run_assets_count INTEGER NOT NULL DEFAULT 0`);
  await p.query(`ALTER TABLE orchestrator_research_cleanup_ops ADD COLUMN IF NOT EXISTS purged_evidence_count INTEGER NOT NULL DEFAULT 0`);
  await p.query(`ALTER TABLE orchestrator_research_cleanup_ops ADD COLUMN IF NOT EXISTS purged_assets_count INTEGER NOT NULL DEFAULT 0`);
  await p.query(`ALTER TABLE orchestrator_research_cleanup_ops ADD COLUMN IF NOT EXISTS actor_user_id INTEGER NULL`);
  await p.query(`ALTER TABLE orchestrator_research_cleanup_ops ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ NULL`);
  await p.query(`ALTER TABLE orchestrator_research_cleanup_ops ADD COLUMN IF NOT EXISTS confirmation_sha256 TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_research_cleanup_ops ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`);
  await p.query(`ALTER TABLE orchestrator_research_cleanup_ops ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`);

  const usersPresent = await p.query(`
    SELECT 1 FROM information_schema.tables
     WHERE table_schema='public' AND table_name='users' LIMIT 1
  `);
  if (usersPresent.rowCount) {
    await _ensureNamedFk(p, 'orchestrator_research_cleanup_ops',
      'orchestrator_research_cleanup_ops_actor_user_fkey',
      'actor_user_id', 'users', 'id',
      'ON DELETE SET NULL');
  }

  await _identifyLegacyResearchCleanup(p);

  await _ensureNamedCheck(p, 'orchestrator_research_runs', 'orchestrator_research_runs_contract_version_check',
    `contract_version IN ('v1')`);
  await _ensureNamedCheck(p, 'orchestrator_research_runs', 'orchestrator_research_runs_state_check',
    `state IN ('pending','running','completed','failed','cancelled')`);
  await _ensureNamedCheck(p, 'orchestrator_research_runs', 'orchestrator_research_runs_failure_class_check',
    `failure_class IS NULL OR failure_class IN ('rate_limit','auth_failure','transient','invalid_response','policy_rejection','terminal')`);
  await _ensureNamedCheck(p, 'orchestrator_research_runs', 'orchestrator_research_runs_requested_platforms_check',
    `cardinality(requested_platforms) >= 1 AND cardinality(requested_platforms) <= 3 AND requested_platforms <@ ARRAY['meta','google','tiktok']::text[]`);
  await _ensureNamedCheck(p, 'orchestrator_research_runs', 'orchestrator_research_runs_research_brief_check',
    `char_length(research_brief) <= 4000`);
  await _ensureNamedCheck(p, 'orchestrator_research_runs', 'orchestrator_research_runs_search_parameters_check',
    `octet_length(search_parameters::text) <= 8192`);
  await _ensureNamedCheck(p, 'orchestrator_research_runs', 'orchestrator_research_runs_search_parameters_type_check',
    `jsonb_typeof(search_parameters) = 'object'`, { notValid: true });
  await _ensureNamedCheck(p, 'orchestrator_research_runs', 'orchestrator_research_runs_continuation_state_check',
    `octet_length(continuation_state::text) <= 4096`);
  await _ensureNamedCheck(p, 'orchestrator_research_runs', 'orchestrator_research_runs_continuation_state_type_check',
    `jsonb_typeof(continuation_state) = 'object'`, { notValid: true });
  await _ensureNamedCheck(p, 'orchestrator_research_runs', 'orchestrator_research_runs_error_code_check',
    `char_length(error_code) <= 128`);
  await _ensureNamedCheck(p, 'orchestrator_research_runs', 'orchestrator_research_runs_error_message_check',
    `char_length(error_message) <= 512`);
  await _ensureNamedCheck(p, 'orchestrator_research_runs', 'orchestrator_research_runs_idempotency_key_check',
    `char_length(idempotency_key) BETWEEN 1 AND 256`);
  await _ensureNamedCheck(p, 'orchestrator_research_runs', 'orchestrator_research_runs_id_check',
    `char_length(id) BETWEEN 1 AND 128`);

  await _ensureNamedCheck(p, 'orchestrator_research_competitors', 'orchestrator_research_competitors_platform_check',
    `platform IN ('meta','google','tiktok')`);
  await _ensureNamedCheck(p, 'orchestrator_research_competitors', 'orchestrator_research_competitors_contract_version_check',
    `contract_version IN ('v1')`);
  await _ensureNamedCheck(p, 'orchestrator_research_competitors', 'orchestrator_research_competitors_discovery_source_check',
    `discovery_source IN ('ad_library','ads_transparency_center','keyword_planner','public_profile','connector')`);
  await _ensureNamedCheck(p, 'orchestrator_research_competitors', 'orchestrator_research_competitors_provider_advertiser_id_check',
    `char_length(provider_advertiser_id) BETWEEN 1 AND 256`);
  await _ensureNamedCheck(p, 'orchestrator_research_competitors', 'orchestrator_research_competitors_normalized_name_check',
    `char_length(normalized_name) BETWEEN 1 AND 256`);
  await _ensureNamedCheck(p, 'orchestrator_research_competitors', 'orchestrator_research_competitors_canonical_url_check',
    `canonical_url IS NULL OR char_length(canonical_url) <= 2048`);
  await _ensureNamedCheck(p, 'orchestrator_research_competitors', 'orchestrator_research_competitors_country_check',
    `country IS NULL OR char_length(country) <= 8`);
  await _ensureNamedCheck(p, 'orchestrator_research_competitors', 'orchestrator_research_competitors_market_check',
    `market IS NULL OR char_length(market) <= 64`);
  await _ensureNamedCheck(p, 'orchestrator_research_competitors', 'orchestrator_research_competitors_dedup_key_check',
    `char_length(dedup_key) BETWEEN 1 AND 128`);
  await _ensureNamedCheck(p, 'orchestrator_research_competitors', 'orchestrator_research_competitors_id_check',
    `char_length(id) BETWEEN 1 AND 128`);

  await _ensureNamedCheck(p, 'orchestrator_research_evidence', 'orchestrator_research_evidence_platform_check',
    `platform IN ('meta','google','tiktok')`);
  await _ensureNamedCheck(p, 'orchestrator_research_evidence', 'orchestrator_research_evidence_source_type_check',
    `source_type IN ('ad_creative','ad_copy','landing_page','auction_insight','search_term','public_page','public_video','labelled_metric')`);
  await _ensureNamedCheck(p, 'orchestrator_research_evidence', 'orchestrator_research_evidence_creative_format_check',
    `creative_format IS NULL OR creative_format IN ('image','video','carousel','text','html','unknown')`);
  await _ensureNamedCheck(p, 'orchestrator_research_evidence', 'orchestrator_research_evidence_metrics_kind_check',
    `metrics_kind IN ('provider_reported','estimated')`);
  await _ensureNamedCheck(p, 'orchestrator_research_evidence', 'orchestrator_research_evidence_provenance_method_check',
    `provenance_method IN ('ad_library','ads_transparency_center','keyword_planner','public_scrape','connector')`);
  await _ensureNamedCheck(p, 'orchestrator_research_evidence', 'orchestrator_research_evidence_connector_id_check',
    `connector_id IN ('meta_research','google_research','tiktok_research')`);
  await _ensureNamedCheck(p, 'orchestrator_research_evidence', 'orchestrator_research_evidence_contract_version_check',
    `contract_version IN ('v1')`);
  await _ensureNamedCheck(p, 'orchestrator_research_evidence', 'orchestrator_research_evidence_retention_class_check',
    `retention_class IN ('standard','short','legal_hold')`);
  await _ensureNamedCheck(p, 'orchestrator_research_evidence', 'orchestrator_research_evidence_retention_expiry_check',
    RESEARCH_RETENTION_EXPIRY_SQL, { notValid: true });
  await _ensureNamedCheck(p, 'orchestrator_research_evidence', 'orchestrator_research_evidence_headline_check',
    `char_length(headline) <= 500`);
  await _ensureNamedCheck(p, 'orchestrator_research_evidence', 'orchestrator_research_evidence_body_text_check',
    `char_length(body_text) <= 4000`);
  await _ensureNamedCheck(p, 'orchestrator_research_evidence', 'orchestrator_research_evidence_excerpt_check',
    `char_length(excerpt) <= 2000`);
  await _ensureNamedCheck(p, 'orchestrator_research_evidence', 'orchestrator_research_evidence_advertiser_name_check',
    `char_length(advertiser_name) <= 256`);
  await _ensureNamedCheck(p, 'orchestrator_research_evidence', 'orchestrator_research_evidence_provider_external_id_check',
    `provider_external_id IS NULL OR char_length(provider_external_id) BETWEEN 1 AND 256`);
  await _ensureNamedCheck(p, 'orchestrator_research_evidence', 'orchestrator_research_evidence_canonical_source_url_check',
    `canonical_source_url IS NULL OR char_length(canonical_source_url) <= 2048`);
  await _ensureNamedCheck(p, 'orchestrator_research_evidence', 'orchestrator_research_evidence_market_check',
    `market IS NULL OR char_length(market) <= 64`);
  await _ensureNamedCheck(p, 'orchestrator_research_evidence', 'orchestrator_research_evidence_language_check',
    `language IS NULL OR char_length(language) <= 16`);
  await _ensureNamedCheck(p, 'orchestrator_research_evidence', 'orchestrator_research_evidence_placement_check',
    `placement IS NULL OR char_length(placement) <= 64`);
  await _ensureNamedCheck(p, 'orchestrator_research_evidence', 'orchestrator_research_evidence_connector_version_check',
    `char_length(connector_version) BETWEEN 1 AND 64`);
  await _ensureNamedCheck(p, 'orchestrator_research_evidence', 'orchestrator_research_evidence_content_fingerprint_check',
    `char_length(content_fingerprint) = 64 AND content_fingerprint ~ '^[0-9a-f]{64}$'`);
  await _ensureNamedCheck(p, 'orchestrator_research_evidence', 'orchestrator_research_evidence_dedup_key_check',
    `char_length(dedup_key) BETWEEN 1 AND 128`);
  await _ensureNamedCheck(p, 'orchestrator_research_evidence', 'orchestrator_research_evidence_provider_metrics_len_check',
    `octet_length(provider_metrics::text) <= 8192`);
  await _ensureNamedCheck(p, 'orchestrator_research_evidence', 'orchestrator_research_evidence_provider_metrics_type_check',
    `jsonb_typeof(provider_metrics) = 'object'`);
  await _ensureNamedCheck(p, 'orchestrator_research_evidence', 'orchestrator_research_evidence_supersedes_id_check',
    `supersedes_id IS NULL OR char_length(supersedes_id) BETWEEN 1 AND 128`);
  await _ensureNamedCheck(p, 'orchestrator_research_evidence', 'orchestrator_research_evidence_id_check',
    `char_length(id) BETWEEN 1 AND 128`);

  await _ensureNamedCheck(p, 'orchestrator_research_evidence_assets', 'orchestrator_research_evidence_assets_media_type_check',
    `media_type IN ('image','video','html','other')`);
  await _ensureNamedCheck(p, 'orchestrator_research_evidence_assets', 'orchestrator_research_evidence_assets_retention_class_check',
    `retention_class IN ('standard','short','legal_hold')`);
  await _ensureNamedCheck(p, 'orchestrator_research_evidence_assets', 'orchestrator_research_evidence_assets_retention_expiry_check',
    RESEARCH_RETENTION_EXPIRY_SQL, { notValid: true });
  await _ensureNamedCheck(p, 'orchestrator_research_evidence_assets', 'orchestrator_research_evidence_assets_storage_ref_check',
    `char_length(storage_ref) BETWEEN 1 AND 1024`);
  await _ensureNamedCheck(p, 'orchestrator_research_evidence_assets', 'orchestrator_research_evidence_assets_checksum_sha256_check',
    `char_length(checksum_sha256) = 64 AND checksum_sha256 ~ '^[0-9a-f]{64}$'`);
  await _ensureNamedCheck(p, 'orchestrator_research_evidence_assets', 'orchestrator_research_evidence_assets_width_px_check',
    `width_px IS NULL OR width_px >= 0`);
  await _ensureNamedCheck(p, 'orchestrator_research_evidence_assets', 'orchestrator_research_evidence_assets_height_px_check',
    `height_px IS NULL OR height_px >= 0`);
  await _ensureNamedCheck(p, 'orchestrator_research_evidence_assets', 'orchestrator_research_evidence_assets_duration_ms_check',
    `duration_ms IS NULL OR duration_ms >= 0`);
  await _ensureNamedCheck(p, 'orchestrator_research_evidence_assets', 'orchestrator_research_evidence_assets_id_check',
    `char_length(id) BETWEEN 1 AND 128`);

  await _ensureNamedCheck(p, 'orchestrator_research_quota', 'orchestrator_research_quota_evidence_count_check',
    `evidence_count >= 0`);
  await _ensureNamedCheck(p, 'orchestrator_research_quota', 'orchestrator_research_quota_payload_bytes_check',
    `payload_bytes >= 0`);

  await _ensureNamedCheck(p, 'orchestrator_research_legacy_holds', 'orchestrator_research_legacy_holds_target_kind_check',
    `target_kind IN ('evidence','asset')`);
  await _ensureNamedCheck(p, 'orchestrator_research_legacy_holds', 'orchestrator_research_legacy_holds_reason_check',
    `reason IN ('legacy_short_due','missing_expiry','invalid_expiry')`);
  await _ensureNamedCheck(p, 'orchestrator_research_legacy_holds', 'orchestrator_research_legacy_holds_target_id_check',
    `char_length(target_id) BETWEEN 1 AND 128`);

  await _ensureNamedCheck(p, 'orchestrator_research_cleanup_ops', 'orchestrator_research_cleanup_ops_state_check',
    `state IN ('previewed','approved','running','completed','failed')`);
  await _ensureNamedCheck(p, 'orchestrator_research_cleanup_ops', 'orchestrator_research_cleanup_ops_id_check',
    `char_length(id) BETWEEN 1 AND 128`);
  await _ensureNamedCheck(p, 'orchestrator_research_cleanup_ops', 'orchestrator_research_cleanup_ops_idempotency_key_check',
    `char_length(idempotency_key) BETWEEN 1 AND 256`);
  await _ensureNamedCheck(p, 'orchestrator_research_cleanup_ops', 'orchestrator_research_cleanup_ops_dry_run_evidence_count_check',
    `dry_run_evidence_count >= 0`);
  await _ensureNamedCheck(p, 'orchestrator_research_cleanup_ops', 'orchestrator_research_cleanup_ops_dry_run_assets_count_check',
    `dry_run_assets_count >= 0`);
  await _ensureNamedCheck(p, 'orchestrator_research_cleanup_ops', 'orchestrator_research_cleanup_ops_purged_evidence_count_check',
    `purged_evidence_count >= 0`);
  await _ensureNamedCheck(p, 'orchestrator_research_cleanup_ops', 'orchestrator_research_cleanup_ops_purged_assets_count_check',
    `purged_assets_count >= 0`);
  await _ensureNamedCheck(p, 'orchestrator_research_cleanup_ops', 'orchestrator_research_cleanup_ops_confirmation_sha256_check',
    `confirmation_sha256 IS NULL OR (char_length(confirmation_sha256) = 64 AND confirmation_sha256 ~ '^[0-9a-f]{64}$')`);

  await _ensureNamedUnique(p, 'orchestrator_research_runs',
    'orchestrator_research_runs_tenant_unique_idempotency_key', 'tenant_id, idempotency_key');
  await _ensureNamedUnique(p, 'orchestrator_research_competitors',
    'orchestrator_research_competitors_tenant_unique_dedup',
    'tenant_id, research_run_id, platform, dedup_key');
  await _ensureNamedUnique(p, 'orchestrator_research_competitors',
    'orchestrator_research_competitors_tenant_unique_ext',
    'tenant_id, research_run_id, platform, provider_advertiser_id');
  await _ensureNamedUnique(p, 'orchestrator_research_competitors',
    'orchestrator_research_competitors_tenant_unique_run_id',
    'tenant_id, research_run_id, id');
  await _ensureNamedUnique(p, 'orchestrator_research_evidence',
    'orchestrator_research_evidence_tenant_unique_dedup',
    'tenant_id, research_run_id, dedup_key');
  await _ensureNamedUnique(p, 'orchestrator_research_evidence_assets',
    'orchestrator_research_evidence_assets_tenant_unique_ref',
    'tenant_id, evidence_id, storage_ref');
  await _ensureNamedUnique(p, 'orchestrator_research_cleanup_ops',
    'orchestrator_research_cleanup_ops_tenant_unique_idempotency_key',
    'tenant_id, idempotency_key');

  await _ensureNamedFk(p, 'orchestrator_research_runs',
    'orchestrator_research_runs_tenant_workflow_fkey',
    'tenant_id, workflow_id', 'orchestrator_workflows', 'tenant_id, id',
    'ON DELETE CASCADE');
  // NO ACTION (not CASCADE): an approval row must not wipe research runs.
  // DEFERRABLE so tenant/workflow teardown can delete approvals and runs in
  // one statement without depending on CASCADE child order.
  await _ensureNamedFk(p, 'orchestrator_research_runs',
    'orchestrator_research_runs_tenant_approval_fkey',
    'tenant_id, approval_id', 'orchestrator_approvals', 'tenant_id, id',
    'ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED');
  await _ensureNamedFk(p, 'orchestrator_research_competitors',
    'orchestrator_research_competitors_tenant_run_fkey',
    'tenant_id, research_run_id', 'orchestrator_research_runs', 'tenant_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_research_evidence',
    'orchestrator_research_evidence_tenant_run_fkey',
    'tenant_id, research_run_id', 'orchestrator_research_runs', 'tenant_id, id',
    'ON DELETE CASCADE');
  // Existing DBs may still have the 2-column (tenant_id, competitor_id) FK under
  // this name, which allows same-tenant evidence to cite another run's competitor.
  // _ensureNamedFk DROP+ADDs only when the local column list differs; a matching
  // 3-col FK is a no-op so repeated ensure() does not take ACCESS EXCLUSIVE.
  await _ensureNamedFk(p, 'orchestrator_research_evidence',
    'orchestrator_research_evidence_tenant_competitor_fkey',
    'tenant_id, research_run_id, competitor_id',
    'orchestrator_research_competitors', 'tenant_id, research_run_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_research_evidence_assets',
    'orchestrator_research_evidence_assets_tenant_evidence_fkey',
    'tenant_id, evidence_id', 'orchestrator_research_evidence', 'tenant_id, id',
    'ON DELETE CASCADE');

  await p.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_research_runs_tenant_unique_live_wf
      ON orchestrator_research_runs (tenant_id, workflow_id, contract_version)
      WHERE state IN ('pending','running');

    CREATE INDEX IF NOT EXISTS idx_orchestrator_research_runs_tenant_wf_created
      ON orchestrator_research_runs (tenant_id, workflow_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_orchestrator_research_runs_tenant_state
      ON orchestrator_research_runs (tenant_id, state);
    CREATE INDEX IF NOT EXISTS idx_orchestrator_research_runs_tenant_created
      ON orchestrator_research_runs (tenant_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_orchestrator_research_competitors_tenant_run
      ON orchestrator_research_competitors (tenant_id, research_run_id);
    CREATE INDEX IF NOT EXISTS idx_orchestrator_research_competitors_tenant_platform
      ON orchestrator_research_competitors (tenant_id, platform);
    CREATE INDEX IF NOT EXISTS idx_orchestrator_research_competitors_tenant_provider
      ON orchestrator_research_competitors (tenant_id, provider_advertiser_id);
    CREATE INDEX IF NOT EXISTS idx_orchestrator_research_competitors_tenant_captured
      ON orchestrator_research_competitors (tenant_id, captured_at DESC);

    CREATE INDEX IF NOT EXISTS idx_orchestrator_research_evidence_tenant_run
      ON orchestrator_research_evidence (tenant_id, research_run_id);
    CREATE INDEX IF NOT EXISTS idx_orchestrator_research_evidence_tenant_platform
      ON orchestrator_research_evidence (tenant_id, platform);
    CREATE INDEX IF NOT EXISTS idx_orchestrator_research_evidence_tenant_captured
      ON orchestrator_research_evidence (tenant_id, captured_at DESC);
    CREATE INDEX IF NOT EXISTS idx_orchestrator_research_evidence_tenant_ext
      ON orchestrator_research_evidence (tenant_id, provider_external_id);
    CREATE INDEX IF NOT EXISTS idx_orchestrator_research_evidence_tenant_fingerprint
      ON orchestrator_research_evidence (tenant_id, content_fingerprint);
    CREATE INDEX IF NOT EXISTS idx_orchestrator_research_evidence_tenant_competitor
      ON orchestrator_research_evidence (tenant_id, competitor_id);
    CREATE INDEX IF NOT EXISTS idx_orchestrator_research_evidence_tenant_expires
      ON orchestrator_research_evidence (tenant_id, expires_at, id)
      WHERE retention_class <> 'legal_hold' AND expires_at IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_orchestrator_research_evidence_assets_tenant_ev
      ON orchestrator_research_evidence_assets (tenant_id, evidence_id);
    CREATE INDEX IF NOT EXISTS idx_orchestrator_research_evidence_assets_tenant_captured
      ON orchestrator_research_evidence_assets (tenant_id, captured_at DESC);
    CREATE INDEX IF NOT EXISTS idx_orchestrator_research_evidence_assets_tenant_expires
      ON orchestrator_research_evidence_assets (tenant_id, expires_at, id)
      WHERE retention_class <> 'legal_hold' AND expires_at IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_orchestrator_research_legacy_holds_tenant_kind
      ON orchestrator_research_legacy_holds (tenant_id, target_kind, reason);

    CREATE INDEX IF NOT EXISTS idx_orchestrator_research_cleanup_ops_tenant_state
      ON orchestrator_research_cleanup_ops (tenant_id, state, created_at DESC);
  `);

  // Per-table transactions: never hold AccessExclusiveLock on
  // orchestrator_research_runs and orchestrator_research_evidence together.
  await _installInTransaction(p, `
    CREATE OR REPLACE FUNCTION orchestrator_research_runs_approval_bind()
    RETURNS trigger AS $fn$
    DECLARE
      appr RECORD;
      approved_list TEXT[];
    BEGIN
      SELECT a.tenant_id, a.workflow_id, a.gate, a.decision, a.object_version, a.approved_platforms
        INTO appr
        FROM orchestrator_approvals a
       WHERE a.id = NEW.approval_id
         AND a.tenant_id = NEW.tenant_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'orchestrator_research_runs_approval_required';
      END IF;

      IF appr.workflow_id IS DISTINCT FROM NEW.workflow_id
         OR appr.gate IS DISTINCT FROM 'research_execution'
         OR appr.decision IS DISTINCT FROM 'approved'
         OR appr.object_version IS DISTINCT FROM NEW.approval_object_version
      THEN
        RAISE EXCEPTION 'orchestrator_research_runs_approval_required';
      END IF;

      IF jsonb_typeof(appr.approved_platforms) IS DISTINCT FROM 'array'
         OR jsonb_array_length(appr.approved_platforms) < 1
      THEN
        RAISE EXCEPTION 'orchestrator_research_runs_approval_required';
      END IF;

      SELECT ARRAY(SELECT jsonb_array_elements_text(appr.approved_platforms))
        INTO approved_list;

      IF approved_list IS NULL
         OR cardinality(approved_list) < 1
         OR NOT (NEW.requested_platforms <@ approved_list)
      THEN
        RAISE EXCEPTION 'orchestrator_research_runs_approval_required';
      END IF;

      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION orchestrator_research_runs_identity_immutable()
    RETURNS trigger AS $fn$
    BEGIN
      IF NEW.id IS DISTINCT FROM OLD.id
         OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
         OR NEW.workflow_id IS DISTINCT FROM OLD.workflow_id
         OR NEW.approval_id IS DISTINCT FROM OLD.approval_id
         OR NEW.approval_object_version IS DISTINCT FROM OLD.approval_object_version
         OR NEW.contract_version IS DISTINCT FROM OLD.contract_version
         OR NEW.requested_platforms IS DISTINCT FROM OLD.requested_platforms
         OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
         OR NEW.research_brief IS DISTINCT FROM OLD.research_brief
         OR NEW.search_parameters IS DISTINCT FROM OLD.search_parameters
         OR NEW.created_at IS DISTINCT FROM OLD.created_at
      THEN
        RAISE EXCEPTION 'orchestrator_research_runs_identity_immutable';
      END IF;
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS orchestrator_research_runs_approval_bind ON orchestrator_research_runs;
    CREATE TRIGGER orchestrator_research_runs_approval_bind
      BEFORE INSERT OR UPDATE ON orchestrator_research_runs
      FOR EACH ROW
      EXECUTE FUNCTION orchestrator_research_runs_approval_bind();

    DROP TRIGGER IF EXISTS orchestrator_research_runs_identity_immutable ON orchestrator_research_runs;
    CREATE TRIGGER orchestrator_research_runs_identity_immutable
      BEFORE UPDATE ON orchestrator_research_runs
      FOR EACH ROW
      EXECUTE FUNCTION orchestrator_research_runs_identity_immutable();
  `);

  await _installInTransaction(p, `
    CREATE OR REPLACE FUNCTION orchestrator_research_competitors_immutable()
    RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'orchestrator_research_competitors_immutable';
      END IF;
      IF EXISTS (
        SELECT 1 FROM orchestrator_research_runs r
         WHERE r.id = OLD.research_run_id AND r.tenant_id = OLD.tenant_id
      ) THEN
        RAISE EXCEPTION 'orchestrator_research_competitors_immutable';
      END IF;
      RETURN OLD;
    END;
    $fn$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS orchestrator_research_competitors_immutable ON orchestrator_research_competitors;
    CREATE TRIGGER orchestrator_research_competitors_immutable
      BEFORE UPDATE OR DELETE ON orchestrator_research_competitors
      FOR EACH ROW
      EXECUTE FUNCTION orchestrator_research_competitors_immutable();
  `);

  await _installInTransaction(p, `
    CREATE OR REPLACE FUNCTION orchestrator_research_evidence_payload_bytes(e orchestrator_research_evidence)
    RETURNS BIGINT
    LANGUAGE sql
    IMMUTABLE
    AS $fn$
      SELECT octet_length(coalesce(e.headline, ''))
           + octet_length(coalesce(e.body_text, ''))
           + octet_length(coalesce(e.excerpt, ''))
           + octet_length(coalesce(e.advertiser_name, ''))
           + octet_length(coalesce(e.provider_metrics::text, '{}'));
    $fn$;

    CREATE OR REPLACE FUNCTION orchestrator_research_evidence_immutable()
    RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'orchestrator_research_evidence_immutable';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM orchestrator_research_runs r
         WHERE r.id = OLD.research_run_id AND r.tenant_id = OLD.tenant_id
      ) THEN
        RETURN OLD;
      END IF;
      IF OLD.retention_class IS DISTINCT FROM 'legal_hold'
         AND OLD.expires_at IS NOT NULL
         AND OLD.expires_at <= now() THEN
        RETURN OLD;
      END IF;
      IF current_setting('infogenie.research_cleanup', true) = 'on'
         AND EXISTS (
           SELECT 1 FROM orchestrator_research_legacy_holds h
            WHERE h.tenant_id = OLD.tenant_id
              AND h.target_kind = 'evidence'
              AND h.target_id = OLD.id
         ) THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'orchestrator_research_evidence_immutable';
    END;
    $fn$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION orchestrator_research_evidence_supersedes_bind()
    RETURNS trigger AS $fn$
    BEGIN
      IF NEW.supersedes_id IS NOT NULL THEN
        IF NOT EXISTS (
          SELECT 1 FROM orchestrator_research_evidence e
           WHERE e.tenant_id = NEW.tenant_id
             AND e.id = NEW.supersedes_id
             AND e.research_run_id = NEW.research_run_id
        ) THEN
          RAISE EXCEPTION 'orchestrator_research_evidence_supersedes_missing';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION orchestrator_research_evidence_quota_insert()
    RETURNS trigger AS $fn$
    DECLARE
      row_bytes BIGINT;
      q_count INTEGER;
      q_bytes BIGINT;
      max_records INTEGER;
      max_bytes BIGINT;
    BEGIN
      INSERT INTO orchestrator_research_quota (tenant_id)
      VALUES (NEW.tenant_id)
      ON CONFLICT (tenant_id) DO NOTHING;

      PERFORM 1
        FROM orchestrator_research_quota
       WHERE tenant_id = NEW.tenant_id
       FOR UPDATE;

      SELECT COUNT(*)::int,
             COALESCE(SUM(orchestrator_research_evidence_payload_bytes(e)), 0)
        INTO q_count, q_bytes
        FROM orchestrator_research_evidence e
       WHERE e.tenant_id = NEW.tenant_id;

      SELECT max_research_evidence_records, max_research_evidence_payload_bytes
        INTO max_records, max_bytes
        FROM orchestrator_tenant_limits
       WHERE tenant_id = NEW.tenant_id;

      IF NOT FOUND THEN
        max_records := 0;
        max_bytes := 0;
      END IF;

      max_records := COALESCE(max_records, 0);
      max_bytes := COALESCE(max_bytes, 0);
      q_count := COALESCE(q_count, 0);
      q_bytes := COALESCE(q_bytes, 0);
      row_bytes := orchestrator_research_evidence_payload_bytes(NEW);

      IF max_records <= 0
         OR max_bytes <= 0
         OR (q_count + 1) > max_records
         OR (q_bytes + row_bytes) > max_bytes THEN
        RAISE EXCEPTION 'orchestrator_research_evidence_limit_exceeded';
      END IF;

      UPDATE orchestrator_research_quota
         SET evidence_count = q_count + 1,
             payload_bytes = q_bytes + row_bytes,
             updated_at = now()
       WHERE tenant_id = NEW.tenant_id;

      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION orchestrator_research_evidence_quota_delete()
    RETURNS trigger AS $fn$
    DECLARE
      q_count INTEGER;
      q_bytes BIGINT;
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM tenants t WHERE t.id = OLD.tenant_id
      ) THEN
        RETURN OLD;
      END IF;

      BEGIN
        INSERT INTO orchestrator_research_quota (tenant_id)
        VALUES (OLD.tenant_id)
        ON CONFLICT (tenant_id) DO NOTHING;
      EXCEPTION
        WHEN foreign_key_violation THEN
          RETURN OLD;
      END;

      PERFORM 1
        FROM orchestrator_research_quota
       WHERE tenant_id = OLD.tenant_id
       FOR UPDATE;

      SELECT COUNT(*)::int,
             COALESCE(SUM(orchestrator_research_evidence_payload_bytes(e)), 0)
        INTO q_count, q_bytes
        FROM orchestrator_research_evidence e
       WHERE e.tenant_id = OLD.tenant_id;

      UPDATE orchestrator_research_quota
         SET evidence_count = COALESCE(q_count, 0),
             payload_bytes = COALESCE(q_bytes, 0),
             updated_at = now()
       WHERE tenant_id = OLD.tenant_id;

      RETURN OLD;
    END;
    $fn$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS orchestrator_research_evidence_immutable ON orchestrator_research_evidence;
    CREATE TRIGGER orchestrator_research_evidence_immutable
      BEFORE UPDATE OR DELETE ON orchestrator_research_evidence
      FOR EACH ROW
      EXECUTE FUNCTION orchestrator_research_evidence_immutable();

    DROP TRIGGER IF EXISTS orchestrator_research_evidence_supersedes_bind ON orchestrator_research_evidence;
    CREATE TRIGGER orchestrator_research_evidence_supersedes_bind
      BEFORE INSERT ON orchestrator_research_evidence
      FOR EACH ROW
      EXECUTE FUNCTION orchestrator_research_evidence_supersedes_bind();

    DROP TRIGGER IF EXISTS orchestrator_research_evidence_quota_insert ON orchestrator_research_evidence;
    CREATE TRIGGER orchestrator_research_evidence_quota_insert
      BEFORE INSERT ON orchestrator_research_evidence
      FOR EACH ROW
      EXECUTE FUNCTION orchestrator_research_evidence_quota_insert();

    DROP TRIGGER IF EXISTS orchestrator_research_evidence_quota_delete ON orchestrator_research_evidence;
    CREATE TRIGGER orchestrator_research_evidence_quota_delete
      AFTER DELETE ON orchestrator_research_evidence
      FOR EACH ROW
      EXECUTE FUNCTION orchestrator_research_evidence_quota_delete();
  `);

  await _installInTransaction(p, `
    CREATE OR REPLACE FUNCTION orchestrator_research_evidence_assets_immutable()
    RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'orchestrator_research_evidence_assets_immutable';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM orchestrator_research_evidence e
         WHERE e.id = OLD.evidence_id AND e.tenant_id = OLD.tenant_id
      ) THEN
        RETURN OLD;
      END IF;
      IF OLD.retention_class IS DISTINCT FROM 'legal_hold'
         AND OLD.expires_at IS NOT NULL
         AND OLD.expires_at <= now() THEN
        RETURN OLD;
      END IF;
      IF current_setting('infogenie.research_cleanup', true) = 'on'
         AND EXISTS (
           SELECT 1 FROM orchestrator_research_legacy_holds h
            WHERE h.tenant_id = OLD.tenant_id
              AND h.target_kind = 'asset'
              AND h.target_id = OLD.id
         ) THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'orchestrator_research_evidence_assets_immutable';
    END;
    $fn$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS orchestrator_research_evidence_assets_immutable ON orchestrator_research_evidence_assets;
    CREATE TRIGGER orchestrator_research_evidence_assets_immutable
      BEFORE UPDATE OR DELETE ON orchestrator_research_evidence_assets
      FOR EACH ROW
      EXECUTE FUNCTION orchestrator_research_evidence_assets_immutable();
  `);

  for (const t of ADVERTISING_ORCH_TABLES) {
    try { await addTenantIdColumn(t); } catch (_) { /* idempotent */ }
  }
  return true;
}

module.exports = { ensureAgentOrchestratorSchema, identifyLegacyResearchCleanup };
