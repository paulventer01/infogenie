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
// research_plan (orchestrator_workflows): PR3C canonical research plan (search
// params, platforms, ceilings, connector/contract versions). Empty {} means no plan yet.

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
  'orchestrator_research_cleanup_targets',
  // PR 4A — versioned evidence-backed angles, hooks, claims, creative briefs
  'orchestrator_creative_artifacts',
  'orchestrator_creative_citations',
  'orchestrator_creative_audit',
  // PR 4B — immutable proposal-generation bundles (no finished creative)
  'orchestrator_proposal_generations',
  // PR 5A — static-image generation jobs + asset metadata (no bytes/prompts)
  'orchestrator_static_image_jobs',
  'orchestrator_static_image_assets',
  // PR 5B — video-generation jobs + output metadata (no bytes/prompts/live provider)
  'orchestrator_video_generation_jobs',
  'orchestrator_video_generation_outputs',
  // PR 6A — campaign draft contracts + human publishing-approval snapshots
  // (no live publish/activate/pause). Audit uses orchestrator_audit_events;
  // do not add a fifth table.
  'orchestrator_campaign_drafts',
  'orchestrator_campaign_draft_revisions',
  'orchestrator_campaign_draft_creatives',
  'orchestrator_campaign_publish_approvals',
  // PR 6B — guarded internal publishing request bound to an approved snapshot.
  // Does not publish, activate, pause, or store provider/campaign side effects.
  'orchestrator_campaign_publish_requests',
  'orchestrator_campaign_delivery_intents',
  'orchestrator_campaign_delivery_attempts',
  // PR 6E — tenant-scoped append-only/consume-once sandbox outcome rows for
  // the fake delivery worker (no HTTP, no vault, no provider IDs).
  'orchestrator_campaign_delivery_sandbox_outcomes',
  // PR 6F-0 — tenant-owned Meta credential-reference metadata + provider
  // challenge/confirmation (no object ledger, no secrets, no provider IDs).
  'orchestrator_tenant_meta_credential_refs',
  'orchestrator_campaign_provider_challenges',
  'orchestrator_campaign_provider_confirmations',
  // PR 6F-1 — bounded Meta paused-draft execution ledger + append-only provider
  // object rows (no secrets, no activation, no retry worker).
  'orchestrator_campaign_provider_draft_executions',
  'orchestrator_campaign_provider_objects',
  // PR 6F-1R — append-only provider-object outcome events (no mutable compensation).
  'orchestrator_campaign_provider_object_events',
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

// Catalog comparison for _ensureNamedFk. ON DELETE omitted → NO ACTION ('a').
// DEFERRABLE is compared so a CASCADE FK is swapped to NO ACTION DEFERRABLE
// without rewriting matching FKs on every boot.
function _fkActionSpec(suffix) {
  const s = String(suffix || '').replace(/\s+/g, ' ').trim().toUpperCase();
  let deltype = 'a';
  if (/\bON DELETE CASCADE\b/.test(s)) deltype = 'c';
  else if (/\bON DELETE SET NULL\b/.test(s)) deltype = 'n';
  else if (/\bON DELETE SET DEFAULT\b/.test(s)) deltype = 'd';
  else if (/\bON DELETE RESTRICT\b/.test(s)) deltype = 'r';
  const notDeferrable = /\bNOT DEFERRABLE\b/.test(s);
  const deferrable = !notDeferrable && /\bDEFERRABLE\b/.test(s);
  const deferred = deferrable && /\bINITIALLY DEFERRED\b/.test(s);
  return { deltype, deferrable, deferred };
}

async function _ensureNamedFk(p, table, name, cols, refTable, refCols, fkSuffix) {
  const wanted = _fkColList(cols);
  const wantedAction = _fkActionSpec(fkSuffix);
  const r = await p.query(
    `SELECT string_agg(att.attname, ',' ORDER BY k.n) AS cols,
            con.confdeltype AS deltype,
            con.condeferrable AS deferrable,
            con.condeferred AS deferred
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
       JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, n) ON true
       JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = k.attnum
      WHERE nsp.nspname = 'public'
        AND rel.relname = $1
        AND con.conname = $2
        AND con.contype = 'f'
      GROUP BY con.oid, con.confdeltype, con.condeferrable, con.condeferred`,
    [table, name]
  );
  const existing = r.rowCount ? _fkColList(r.rows[0].cols) : null;
  const existingAction = r.rowCount
    ? {
      deltype: r.rows[0].deltype,
      deferrable: !!r.rows[0].deferrable,
      deferred: !!r.rows[0].deferred,
    }
    : null;
  if (
    existing === wanted
    && existingAction
    && existingAction.deltype === wantedAction.deltype
    && existingAction.deferrable === wantedAction.deferrable
    && existingAction.deferred === wantedAction.deferred
  ) return;
  // Same reason as _ensureNamedCheck: swap the column list / ON DELETE action
  // atomically so a failed ADD cannot leave the table with no foreign key at all.
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

// Catalog lookup only — no BEGIN/COMMIT. Used inside an already-open
// transaction so a failed ADD cannot commit earlier DDL.
async function _constraintExistsOn(p, table, name) {
  const r = await p.query(
    `SELECT 1 FROM pg_constraint WHERE conname = $1 AND conrelid = $2::regclass`,
    [name, `public.${table}`]
  );
  return r.rowCount > 0;
}

async function _addCheckIfAbsent(p, table, name, checkBody, opts = {}) {
  if (await _constraintExistsOn(p, table, name)) return;
  const suffix = opts && opts.notValid ? ' NOT VALID' : '';
  await p.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${checkBody})${suffix}`);
}

async function _addUniqueIfAbsent(p, table, name, cols) {
  if (await _constraintExistsOn(p, table, name)) return;
  await p.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} UNIQUE (${cols})`);
}

async function _addFkIfAbsent(p, table, name, cols, refTable, refCols, fkSuffix) {
  if (await _constraintExistsOn(p, table, name)) return;
  await p.query(
    `ALTER TABLE ${table} ADD CONSTRAINT ${name} FOREIGN KEY (${cols}) REFERENCES ${refTable} (${refCols}) ${fkSuffix}`
  );
}

// PR 6F-1R — upgrade an existing PR6F-1 ledger (or no-op a fresh 1R CREATE)
// in ONE transaction on the ensure client. Advisory lock is already held by
// `_runEnsureAgentOrchestratorSchema`. Other sessions keep seeing the old
// immutability triggers until COMMIT (PostgreSQL transactional DDL). A throw
// (including unbound-execution fail-closed) ROLLBACKs dropped triggers and
// nullable lineage columns so boot/settlement cannot observe a partial schema.
// Do not call `_ensureNamedCheck` / `_ensureNamedFk` / `_ensureNamedUnique` /
// `_installInTransaction` here — those helpers COMMIT.
async function _upgradePr6f1rProviderLineage(p) {
  await p.query('BEGIN');
  try {
    await p.query(`DROP TRIGGER IF EXISTS orchestrator_cpdex_guard ON orchestrator_campaign_provider_draft_executions`);
    await p.query(`DROP TRIGGER IF EXISTS orchestrator_cpo_guard ON orchestrator_campaign_provider_objects`);

    await p.query(`
      ALTER TABLE orchestrator_campaign_provider_draft_executions
        ADD COLUMN IF NOT EXISTS credential_ref_version INTEGER,
        ADD COLUMN IF NOT EXISTS account_fingerprint TEXT
    `);
    await p.query(`
      ALTER TABLE orchestrator_campaign_provider_objects
        ADD COLUMN IF NOT EXISTS publishing_request_id TEXT,
        ADD COLUMN IF NOT EXISTS intent_id TEXT,
        ADD COLUMN IF NOT EXISTS snapshot_hash TEXT,
        ADD COLUMN IF NOT EXISTS account_fingerprint TEXT,
        ADD COLUMN IF NOT EXISTS provider_object_id_digest TEXT,
        ADD COLUMN IF NOT EXISTS display_ref TEXT,
        ADD COLUMN IF NOT EXISTS parent_campaign_digest TEXT,
        ADD COLUMN IF NOT EXISTS parent_adset_digest TEXT,
        ADD COLUMN IF NOT EXISTS parent_creative_digest TEXT
    `);

    await p.query(`
      UPDATE orchestrator_campaign_provider_draft_executions e
         SET credential_ref_version = r.version,
             account_fingerprint = r.account_fingerprint
        FROM orchestrator_tenant_meta_credential_refs r
       WHERE e.tenant_id = r.tenant_id
         AND e.credential_ref_id = r.id
         AND (e.credential_ref_version IS NULL OR e.account_fingerprint IS NULL)
    `);
    const unboundExec = await p.query(`
      SELECT 1 FROM orchestrator_campaign_provider_draft_executions
       WHERE account_fingerprint IS NULL OR credential_ref_version IS NULL LIMIT 1
    `);
    if (unboundExec.rowCount) {
      const err = new Error('pr6f1r_lineage_backfill_unbound_execution');
      err.code = 'pr6f1r_lineage_backfill_unbound_execution';
      throw err;
    }

    await p.query(`
      UPDATE orchestrator_campaign_provider_objects o
         SET publishing_request_id = e.publishing_request_id,
             intent_id = e.intent_id,
             snapshot_hash = e.snapshot_hash,
             account_fingerprint = e.account_fingerprint,
             provider_object_id_digest = encode(sha256(convert_to(o.provider_object_id, 'UTF8')), 'hex'),
             display_ref = substr(encode(sha256(convert_to(o.provider_object_id, 'UTF8')), 'hex'), 1, 12)
        FROM orchestrator_campaign_provider_draft_executions e
       WHERE o.tenant_id = e.tenant_id
         AND o.execution_id = e.id
         AND o.provider_object_id_digest IS NULL
    `);
    await p.query(`
      UPDATE orchestrator_campaign_provider_objects o
         SET parent_campaign_digest = c.provider_object_id_digest
        FROM orchestrator_campaign_provider_objects c
       WHERE o.tenant_id = c.tenant_id
         AND o.execution_id = c.execution_id
         AND c.object_kind = 'campaign'
         AND o.object_kind IN ('adset','creative','ad')
         AND o.parent_campaign_digest IS NULL
    `);
    await p.query(`
      UPDATE orchestrator_campaign_provider_objects o
         SET parent_adset_digest = a.provider_object_id_digest
        FROM orchestrator_campaign_provider_objects a
       WHERE o.tenant_id = a.tenant_id
         AND o.execution_id = a.execution_id
         AND a.object_kind = 'adset'
         AND o.object_kind = 'ad'
         AND o.parent_adset_digest IS NULL
    `);
    await p.query(`
      UPDATE orchestrator_campaign_provider_objects o
         SET parent_creative_digest = cr.provider_object_id_digest
        FROM orchestrator_campaign_provider_objects cr
       WHERE o.tenant_id = cr.tenant_id
         AND o.execution_id = cr.execution_id
         AND cr.object_kind = 'creative'
         AND o.object_kind = 'ad'
         AND o.parent_creative_digest IS NULL
    `);

    await p.query(`
      ALTER TABLE orchestrator_campaign_provider_draft_executions
        ALTER COLUMN credential_ref_version SET NOT NULL,
        ALTER COLUMN account_fingerprint SET NOT NULL
    `);
    await p.query(`
      ALTER TABLE orchestrator_campaign_provider_objects
        ALTER COLUMN publishing_request_id SET NOT NULL,
        ALTER COLUMN intent_id SET NOT NULL,
        ALTER COLUMN snapshot_hash SET NOT NULL,
        ALTER COLUMN account_fingerprint SET NOT NULL,
        ALTER COLUMN provider_object_id_digest SET NOT NULL,
        ALTER COLUMN display_ref SET NOT NULL
    `);

    await _addCheckIfAbsent(p, 'orchestrator_campaign_provider_draft_executions',
      'orchestrator_cpdex_complete_cardinality_check',
      `status <> 'complete'
       OR (outcome = 'complete' AND objects_created = 4 AND objects_compensated = 0)`,
      { notValid: true });
    await _addCheckIfAbsent(p, 'orchestrator_campaign_provider_draft_executions',
      'orchestrator_cpdex_cred_ver_check', `credential_ref_version >= 1`, { notValid: true });
    await _addCheckIfAbsent(p, 'orchestrator_campaign_provider_draft_executions',
      'orchestrator_cpdex_account_fp_check',
      `char_length(account_fingerprint)=64 AND account_fingerprint ~ '^[0-9a-f]{64}$'`,
      { notValid: true });
    await _addUniqueIfAbsent(p, 'orchestrator_campaign_provider_draft_executions',
      'orchestrator_cpdex_tenant_unique_id_fp', 'tenant_id, id, account_fingerprint');
    await _addUniqueIfAbsent(p, 'orchestrator_campaign_provider_draft_executions',
      'orchestrator_cpdex_tenant_unique_id_snap', 'tenant_id, id, snapshot_hash');
    await _addUniqueIfAbsent(p, 'orchestrator_campaign_provider_draft_executions',
      'orchestrator_cpdex_tenant_unique_id_pubreq', 'tenant_id, id, publishing_request_id');
    await _addUniqueIfAbsent(p, 'orchestrator_campaign_provider_draft_executions',
      'orchestrator_cpdex_tenant_unique_id_intent', 'tenant_id, id, intent_id');

    await _addUniqueIfAbsent(p, 'orchestrator_campaign_provider_objects',
      'orchestrator_cpo_tenant_execution_kind', 'tenant_id, execution_id, object_kind');
    await _addUniqueIfAbsent(p, 'orchestrator_campaign_provider_objects',
      'orchestrator_cpo_tenant_execution_digest', 'tenant_id, execution_id, provider_object_id_digest');
    await _addUniqueIfAbsent(p, 'orchestrator_campaign_provider_objects',
      'orchestrator_cpo_tenant_account_digest', 'tenant_id, account_fingerprint, provider_object_id_digest');
    await _addCheckIfAbsent(p, 'orchestrator_campaign_provider_objects',
      'orchestrator_cpo_digest_check',
      `char_length(provider_object_id_digest)=64
       AND provider_object_id_digest ~ '^[0-9a-f]{64}$'
       AND char_length(display_ref)=12
       AND display_ref = substr(provider_object_id_digest, 1, 12)`,
      { notValid: true });
    await _addCheckIfAbsent(p, 'orchestrator_campaign_provider_objects',
      'orchestrator_cpo_account_fp_check',
      `char_length(account_fingerprint)=64 AND account_fingerprint ~ '^[0-9a-f]{64}$'`,
      { notValid: true });
    await _addCheckIfAbsent(p, 'orchestrator_campaign_provider_objects',
      'orchestrator_cpo_snapshot_hash_check',
      `char_length(snapshot_hash)=64 AND snapshot_hash ~ '^[0-9a-f]{64}$'`,
      { notValid: true });
    await _addCheckIfAbsent(p, 'orchestrator_campaign_provider_objects',
      'orchestrator_cpo_parent_lineage_check',
      `(object_kind = 'campaign'
         AND parent_campaign_digest IS NULL
         AND parent_adset_digest IS NULL
         AND parent_creative_digest IS NULL)
       OR (object_kind = 'adset'
         AND parent_campaign_digest IS NOT NULL
         AND parent_adset_digest IS NULL
         AND parent_creative_digest IS NULL
         AND char_length(parent_campaign_digest)=64
         AND parent_campaign_digest ~ '^[0-9a-f]{64}$')
       OR (object_kind = 'creative'
         AND parent_campaign_digest IS NOT NULL
         AND parent_adset_digest IS NULL
         AND parent_creative_digest IS NULL
         AND char_length(parent_campaign_digest)=64
         AND parent_campaign_digest ~ '^[0-9a-f]{64}$')
       OR (object_kind = 'ad'
         AND parent_campaign_digest IS NOT NULL
         AND parent_adset_digest IS NOT NULL
         AND parent_creative_digest IS NOT NULL
         AND char_length(parent_campaign_digest)=64
         AND char_length(parent_adset_digest)=64
         AND char_length(parent_creative_digest)=64
         AND parent_campaign_digest ~ '^[0-9a-f]{64}$'
         AND parent_adset_digest ~ '^[0-9a-f]{64}$'
         AND parent_creative_digest ~ '^[0-9a-f]{64}$')`,
      { notValid: true });
    await _addFkIfAbsent(p, 'orchestrator_campaign_provider_objects',
      'orchestrator_cpo_tenant_pub_req_fkey',
      'tenant_id, publishing_request_id', 'orchestrator_campaign_publish_requests',
      'tenant_id, id', 'ON DELETE CASCADE');
    await _addFkIfAbsent(p, 'orchestrator_campaign_provider_objects',
      'orchestrator_cpo_tenant_intent_fkey',
      'tenant_id, intent_id', 'orchestrator_campaign_delivery_intents',
      'tenant_id, id', 'ON DELETE CASCADE');
    await _addFkIfAbsent(p, 'orchestrator_campaign_provider_objects',
      'orchestrator_cpo_tenant_exec_fp_fkey',
      'tenant_id, execution_id, account_fingerprint',
      'orchestrator_campaign_provider_draft_executions',
      'tenant_id, id, account_fingerprint', 'ON DELETE CASCADE');
    await _addFkIfAbsent(p, 'orchestrator_campaign_provider_objects',
      'orchestrator_cpo_tenant_exec_snap_fkey',
      'tenant_id, execution_id, snapshot_hash',
      'orchestrator_campaign_provider_draft_executions',
      'tenant_id, id, snapshot_hash', 'ON DELETE CASCADE');
    await _addFkIfAbsent(p, 'orchestrator_campaign_provider_objects',
      'orchestrator_cpo_tenant_exec_pubreq_fkey',
      'tenant_id, execution_id, publishing_request_id',
      'orchestrator_campaign_provider_draft_executions',
      'tenant_id, id, publishing_request_id', 'ON DELETE CASCADE');
    await _addFkIfAbsent(p, 'orchestrator_campaign_provider_objects',
      'orchestrator_cpo_tenant_exec_intent_fkey',
      'tenant_id, execution_id, intent_id',
      'orchestrator_campaign_provider_draft_executions',
      'tenant_id, id, intent_id', 'ON DELETE CASCADE');

    await p.query(`
      CREATE TABLE IF NOT EXISTS orchestrator_campaign_provider_object_events (
        id TEXT NOT NULL,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        object_id TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        event_kind TEXT NOT NULL,
        sequence_number INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, id),
        CONSTRAINT orchestrator_cpoe_tenant_object_kind
          UNIQUE (tenant_id, object_id, event_kind),
        CONSTRAINT orchestrator_cpoe_kind_check CHECK (
          event_kind IN ('created','compensated')
        ),
        CONSTRAINT orchestrator_cpoe_seq_check CHECK (
          sequence_number >= 1 AND sequence_number <= 2
        ),
        CONSTRAINT orchestrator_cpoe_len_check CHECK (
          char_length(id) BETWEEN 1 AND 128
          AND char_length(object_id) BETWEEN 1 AND 128
          AND char_length(execution_id) BETWEEN 1 AND 128
        )
      )
    `);
    await _addFkIfAbsent(p, 'orchestrator_campaign_provider_object_events',
      'orchestrator_cpoe_tenant_object_fkey',
      'tenant_id, object_id', 'orchestrator_campaign_provider_objects',
      'tenant_id, id', 'ON DELETE CASCADE');
    await _addFkIfAbsent(p, 'orchestrator_campaign_provider_object_events',
      'orchestrator_cpoe_tenant_execution_fkey',
      'tenant_id, execution_id', 'orchestrator_campaign_provider_draft_executions',
      'tenant_id, id', 'ON DELETE CASCADE');
    await p.query(`
      INSERT INTO orchestrator_campaign_provider_object_events
        (id, tenant_id, object_id, execution_id, event_kind, sequence_number, created_at)
      SELECT 'cpoe_created_' || o.id, o.tenant_id, o.id, o.execution_id, 'created', 1, o.created_at
        FROM orchestrator_campaign_provider_objects o
       WHERE NOT EXISTS (
         SELECT 1 FROM orchestrator_campaign_provider_object_events e
          WHERE e.tenant_id = o.tenant_id AND e.object_id = o.id AND e.event_kind = 'created'
       )
    `);
    await p.query(`
      INSERT INTO orchestrator_campaign_provider_object_events
        (id, tenant_id, object_id, execution_id, event_kind, sequence_number, created_at)
      SELECT 'cpoe_comp_' || o.id, o.tenant_id, o.id, o.execution_id, 'compensated', 2,
             COALESCE(o.compensated_at, o.created_at)
        FROM orchestrator_campaign_provider_objects o
       WHERE o.compensated = TRUE
         AND NOT EXISTS (
           SELECT 1 FROM orchestrator_campaign_provider_object_events e
            WHERE e.tenant_id = o.tenant_id AND e.object_id = o.id AND e.event_kind = 'compensated'
         )
    `);

    await p.query(`
      CREATE OR REPLACE FUNCTION orchestrator_cpdex_guard()
      RETURNS trigger AS $fn$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          IF NEW.status IS DISTINCT FROM 'started'
             OR NEW.settled_at IS NOT NULL
             OR NEW.outcome IS NOT NULL
             OR NEW.error_code IS NOT NULL THEN
            RAISE EXCEPTION 'orchestrator_cpdex_immutable';
          END IF;
          RETURN NEW;
        END IF;
        IF TG_OP = 'UPDATE' THEN
          IF OLD.status IS DISTINCT FROM 'started'
             OR NEW.status IS NOT DISTINCT FROM 'started'
             OR NEW.id IS DISTINCT FROM OLD.id
             OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
             OR NEW.confirmation_id IS DISTINCT FROM OLD.confirmation_id
             OR NEW.challenge_id IS DISTINCT FROM OLD.challenge_id
             OR NEW.draft_id IS DISTINCT FROM OLD.draft_id
             OR NEW.revision IS DISTINCT FROM OLD.revision
             OR NEW.publish_approval_id IS DISTINCT FROM OLD.publish_approval_id
             OR NEW.workflow_approval_id IS DISTINCT FROM OLD.workflow_approval_id
             OR NEW.publishing_request_id IS DISTINCT FROM OLD.publishing_request_id
             OR NEW.intent_id IS DISTINCT FROM OLD.intent_id
             OR NEW.outbox_id IS DISTINCT FROM OLD.outbox_id
             OR NEW.attempt_id IS DISTINCT FROM OLD.attempt_id
             OR NEW.credential_ref_id IS DISTINCT FROM OLD.credential_ref_id
             OR NEW.credential_ref_version IS DISTINCT FROM OLD.credential_ref_version
             OR NEW.account_fingerprint IS DISTINCT FROM OLD.account_fingerprint
             OR NEW.generation IS DISTINCT FROM OLD.generation
             OR NEW.contract_hash IS DISTINCT FROM OLD.contract_hash
             OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash
             OR NEW.intent_hash IS DISTINCT FROM OLD.intent_hash
             OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
             OR NEW.claim_token_hash IS DISTINCT FROM OLD.claim_token_hash
             OR NEW.contract_version IS DISTINCT FROM OLD.contract_version
             OR NEW.operation IS DISTINCT FROM OLD.operation
             OR NEW.platform IS DISTINCT FROM OLD.platform
             OR NEW.connector IS DISTINCT FROM OLD.connector
             OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
             OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
             OR NEW.started_at IS DISTINCT FROM OLD.started_at
             OR NEW.simulated IS DISTINCT FROM FALSE
             OR NEW.published IS DISTINCT FROM FALSE
          THEN
            RAISE EXCEPTION 'orchestrator_cpdex_immutable';
          END IF;
          IF NEW.status = 'complete' THEN
            IF NEW.objects_created IS DISTINCT FROM 4 OR NEW.objects_compensated IS DISTINCT FROM 0 THEN
              RAISE EXCEPTION 'orchestrator_cpdex_cardinality';
            END IF;
            IF NOT EXISTS (
              SELECT 1
                FROM orchestrator_campaign_provider_objects camp
                JOIN orchestrator_campaign_provider_objects aset
                  ON aset.tenant_id = camp.tenant_id
                 AND aset.execution_id = camp.execution_id
                 AND aset.object_kind = 'adset'
                 AND aset.parent_campaign_digest = camp.provider_object_id_digest
                JOIN orchestrator_campaign_provider_objects cr
                  ON cr.tenant_id = camp.tenant_id
                 AND cr.execution_id = camp.execution_id
                 AND cr.object_kind = 'creative'
                 AND cr.parent_campaign_digest = camp.provider_object_id_digest
                JOIN orchestrator_campaign_provider_objects ad
                  ON ad.tenant_id = camp.tenant_id
                 AND ad.execution_id = camp.execution_id
                 AND ad.object_kind = 'ad'
                 AND ad.parent_campaign_digest = camp.provider_object_id_digest
                 AND ad.parent_adset_digest = aset.provider_object_id_digest
                 AND ad.parent_creative_digest = cr.provider_object_id_digest
               WHERE camp.tenant_id = NEW.tenant_id
                 AND camp.execution_id = NEW.id
                 AND camp.object_kind = 'campaign'
                 AND camp.account_fingerprint = NEW.account_fingerprint
                 AND aset.account_fingerprint = NEW.account_fingerprint
                 AND cr.account_fingerprint = NEW.account_fingerprint
                 AND ad.account_fingerprint = NEW.account_fingerprint
            ) THEN
              RAISE EXCEPTION 'orchestrator_cpdex_cardinality';
            END IF;
            IF (
              SELECT COUNT(*) FROM orchestrator_campaign_provider_objects o
               WHERE o.tenant_id = NEW.tenant_id AND o.execution_id = NEW.id
            ) <> 4 THEN
              RAISE EXCEPTION 'orchestrator_cpdex_cardinality';
            END IF;
          END IF;
          RETURN NEW;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = OLD.tenant_id) THEN
          RETURN OLD;
        END IF;
        RAISE EXCEPTION 'orchestrator_cpdex_immutable';
      END;
      $fn$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS orchestrator_cpdex_guard ON orchestrator_campaign_provider_draft_executions;
      CREATE TRIGGER orchestrator_cpdex_guard
        BEFORE INSERT OR UPDATE OR DELETE ON orchestrator_campaign_provider_draft_executions
        FOR EACH ROW
        EXECUTE FUNCTION orchestrator_cpdex_guard();

      CREATE OR REPLACE FUNCTION orchestrator_cpo_guard()
      RETURNS trigger AS $fn$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          IF NEW.compensated IS DISTINCT FROM FALSE OR NEW.compensated_at IS NOT NULL THEN
            RAISE EXCEPTION 'orchestrator_cpo_immutable';
          END IF;
          RETURN NEW;
        END IF;
        IF TG_OP = 'UPDATE' THEN
          RAISE EXCEPTION 'orchestrator_cpo_immutable';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = OLD.tenant_id) THEN
          RETURN OLD;
        END IF;
        RAISE EXCEPTION 'orchestrator_cpo_immutable';
      END;
      $fn$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS orchestrator_cpo_guard ON orchestrator_campaign_provider_objects;
      CREATE TRIGGER orchestrator_cpo_guard
        BEFORE INSERT OR UPDATE OR DELETE ON orchestrator_campaign_provider_objects
        FOR EACH ROW
        EXECUTE FUNCTION orchestrator_cpo_guard();

      CREATE OR REPLACE FUNCTION orchestrator_cpo_after_insert()
      RETURNS trigger AS $fn$
      BEGIN
        INSERT INTO orchestrator_campaign_provider_object_events
          (id, tenant_id, object_id, execution_id, event_kind, sequence_number)
        VALUES (
          'cpoe_created_' || NEW.id,
          NEW.tenant_id, NEW.id, NEW.execution_id, 'created', 1
        );
        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS orchestrator_cpo_after_insert ON orchestrator_campaign_provider_objects;
      CREATE TRIGGER orchestrator_cpo_after_insert
        AFTER INSERT ON orchestrator_campaign_provider_objects
        FOR EACH ROW
        EXECUTE FUNCTION orchestrator_cpo_after_insert();

      CREATE OR REPLACE FUNCTION orchestrator_cpoe_guard()
      RETURNS trigger AS $fn$
      BEGIN
        IF TG_OP = 'UPDATE' THEN
          RAISE EXCEPTION 'orchestrator_cpoe_immutable';
        END IF;
        IF TG_OP = 'DELETE' THEN
          IF NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = OLD.tenant_id) THEN
            RETURN OLD;
          END IF;
          RAISE EXCEPTION 'orchestrator_cpoe_immutable';
        END IF;
        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS orchestrator_cpoe_guard ON orchestrator_campaign_provider_object_events;
      CREATE TRIGGER orchestrator_cpoe_guard
        BEFORE UPDATE OR DELETE ON orchestrator_campaign_provider_object_events
        FOR EACH ROW
        EXECUTE FUNCTION orchestrator_cpoe_guard();
    `);
    await p.query('COMMIT');
  } catch (e) {
    try { await p.query('ROLLBACK'); } catch (_) { /* already aborted */ }
    throw e;
  }
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

async function _legacyShortDueSnapshotOpen(p) {
  const row = (await p.query(`
    SELECT NOT EXISTS (
             SELECT 1 FROM orchestrator_research_legacy_holds
              WHERE reason = 'legacy_short_due'
              LIMIT 1
           )
       AND NOT EXISTS (
             SELECT 1 FROM orchestrator_research_legacy_short_due_snapshot
              LIMIT 1
           ) AS open
  `)).rows[0];
  return !!row.open;
}

async function _closeLegacyShortDueSnapshot(p) {
  await p.query(`
    INSERT INTO orchestrator_research_legacy_short_due_snapshot (id) VALUES (1)
    ON CONFLICT (id) DO NOTHING
  `);
}

async function _identifyLegacyResearchCleanup(p) {
  const shortDueOpen = await _legacyShortDueSnapshotOpen(p);
  const evidence = await p.query(`
    INSERT INTO orchestrator_research_legacy_holds (tenant_id, target_kind, target_id, reason)
    SELECT s.tenant_id, s.target_kind, s.target_id, s.reason
      FROM (
        SELECT e.tenant_id,
               'evidence'::text AS target_kind,
               e.id AS target_id,
               'missing_expiry'::text AS reason
          FROM orchestrator_research_evidence e
         WHERE e.retention_class IN ('standard', 'short')
           AND e.expires_at IS NULL
        UNION ALL
        SELECT e.tenant_id, 'evidence', e.id, 'invalid_expiry'
          FROM orchestrator_research_evidence e
         WHERE e.retention_class IN ('standard', 'short')
           AND e.expires_at IS NOT NULL
           AND e.expires_at <= e.created_at
        UNION ALL
        SELECT e.tenant_id, 'evidence', e.id, 'legacy_short_due'
          FROM orchestrator_research_evidence e
         WHERE $1::boolean
           AND e.retention_class = 'short'
           AND e.expires_at IS NOT NULL
           AND e.expires_at > e.created_at
           AND e.expires_at <= now()
      ) s
    ON CONFLICT (tenant_id, target_kind, target_id) DO NOTHING
  `, [shortDueOpen]);
  const assets = await p.query(`
    INSERT INTO orchestrator_research_legacy_holds (tenant_id, target_kind, target_id, reason)
    SELECT s.tenant_id, s.target_kind, s.target_id, s.reason
      FROM (
        SELECT a.tenant_id,
               'asset'::text AS target_kind,
               a.id AS target_id,
               'missing_expiry'::text AS reason
          FROM orchestrator_research_evidence_assets a
         WHERE a.retention_class IN ('standard', 'short')
           AND a.expires_at IS NULL
        UNION ALL
        SELECT a.tenant_id, 'asset', a.id, 'invalid_expiry'
          FROM orchestrator_research_evidence_assets a
         WHERE a.retention_class IN ('standard', 'short')
           AND a.expires_at IS NOT NULL
           AND a.expires_at <= a.created_at
        UNION ALL
        SELECT a.tenant_id, 'asset', a.id, 'legacy_short_due'
          FROM orchestrator_research_evidence_assets a
         WHERE $1::boolean
           AND a.retention_class = 'short'
           AND a.expires_at IS NOT NULL
           AND a.expires_at > a.created_at
           AND a.expires_at <= now()
      ) s
    ON CONFLICT (tenant_id, target_kind, target_id) DO NOTHING
  `, [shortDueOpen]);
  await _closeLegacyShortDueSnapshot(p);
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
const SCHEMA_INIT_TIMEOUT_MS = 30000;
const SCHEMA_TRY_LOCK_SLEEP_MS = 50;
let _ensureMutex = Promise.resolve();

function _schemaInitTimeoutError() {
  const err = new Error('agent_orchestrator_schema_init_timeout');
  err.code = 'agent_orchestrator_schema_init_timeout';
  return err;
}

function _sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Bounded try-lock. Session-level 87231402 is ensure-only — do not share
// it with the sweeper. lock_timeout does not bound pg_advisory_lock, so
// callers must use this loop (or fail closed) instead of a blocking wait.
async function _tryAdvisoryLockUntil(p, key, deadlineMs) {
  for (;;) {
    const r = await p.query('SELECT pg_try_advisory_lock($1) AS locked', [key]);
    if (r.rows[0] && r.rows[0].locked) return true;
    const remaining = deadlineMs - Date.now();
    if (remaining <= 0) throw _schemaInitTimeoutError();
    await _sleepMs(Math.min(SCHEMA_TRY_LOCK_SLEEP_MS, remaining));
  }
}

async function ensureAgentOrchestratorSchema() {
  if (!_db.hasDb()) return false;
  const queuedAt = Date.now();
  let started = false;
  let cancelled = false;

  const queued = _ensureMutex.then(() => {
    // Timed-out waiters must not start DDL when the previous ensure finishes.
    if (cancelled || Date.now() - queuedAt >= SCHEMA_INIT_TIMEOUT_MS) {
      throw _schemaInitTimeoutError();
    }
    started = true;
    return _runEnsureAgentOrchestratorSchema();
  });
  _ensureMutex = queued.catch(() => {});

  const remaining = SCHEMA_INIT_TIMEOUT_MS - (Date.now() - queuedAt);
  if (remaining <= 0) {
    cancelled = true;
    throw _schemaInitTimeoutError();
  }

  let timer = null;
  const timedOut = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (!started) {
        cancelled = true;
        reject(_schemaInitTimeoutError());
      }
    }, remaining);
  });

  try {
    return await Promise.race([queued, timedOut]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function _runEnsureAgentOrchestratorSchema() {
  const pool = _db.getPool();
  const p = await pool.connect();
  const deadlineMs = Date.now() + SCHEMA_INIT_TIMEOUT_MS;
  let failed = null;
  try {
    // Fail closed (55P03) instead of waiting forever on a blocked ALTER.
    // Must run after connect and before advisory lock / DDL. Do not share
    // this advisory lock with the sweeper — that deadlocks a held-row locker.
    await p.query("SET lock_timeout = '30s'");
    await _tryAdvisoryLockUntil(p, 87231402, deadlineMs);
    try {
      return await _runEnsureAgentOrchestratorSchemaLocked(p);
    } finally {
      await p.query('SELECT pg_advisory_unlock($1)', [87231402]);
    }
  } catch (err) {
    failed = err;
    throw err;
  } finally {
    try {
      await p.query('SET lock_timeout TO DEFAULT');
    } catch (resetErr) {
      failed = failed || resetErr;
    }
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
  await p.query(`ALTER TABLE orchestrator_workflows ADD COLUMN IF NOT EXISTS research_plan JSONB NOT NULL DEFAULT '{}'`);

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
        REFERENCES orchestrator_research_evidence (tenant_id, id)
        ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
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

    -- Cluster-wide one-shot latch: first identify() snapshots already-expired
    -- short leftovers, then this row exists even if that SELECT matched nothing.
    -- Later boots must not hold naturally expired new short rows.
    CREATE TABLE IF NOT EXISTS orchestrator_research_legacy_short_due_snapshot (
      id        SMALLINT PRIMARY KEY DEFAULT 1,
      taken_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT orchestrator_research_legacy_short_due_snapshot_singleton
        CHECK (id = 1)
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
      snapshot_sha256         TEXT NULL,
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
        ),
      CONSTRAINT orchestrator_research_cleanup_ops_snapshot_sha256_check
        CHECK (
          snapshot_sha256 IS NULL
          OR (char_length(snapshot_sha256) = 64 AND snapshot_sha256 ~ '^[0-9a-f]{64}$')
        )
    );

    CREATE TABLE IF NOT EXISTS orchestrator_research_cleanup_targets (
      tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      op_id        TEXT NOT NULL,
      target_kind  TEXT NOT NULL,
      target_id    TEXT NOT NULL,
      PRIMARY KEY (tenant_id, op_id, target_kind, target_id),
      CONSTRAINT orchestrator_research_cleanup_targets_op_fkey
        FOREIGN KEY (tenant_id, op_id)
        REFERENCES orchestrator_research_cleanup_ops (tenant_id, id)
        ON DELETE CASCADE,
      CONSTRAINT orchestrator_research_cleanup_targets_target_kind_check
        CHECK (target_kind IN ('evidence','asset')),
      CONSTRAINT orchestrator_research_cleanup_targets_op_id_check
        CHECK (char_length(op_id) BETWEEN 1 AND 128),
      CONSTRAINT orchestrator_research_cleanup_targets_target_id_check
        CHECK (char_length(target_id) BETWEEN 1 AND 128)
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

  await p.query(`ALTER TABLE orchestrator_research_legacy_short_due_snapshot ADD COLUMN IF NOT EXISTS taken_at TIMESTAMPTZ NOT NULL DEFAULT now()`);

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
  await p.query(`ALTER TABLE orchestrator_research_cleanup_ops ADD COLUMN IF NOT EXISTS snapshot_sha256 TEXT NULL`);
  await p.query(`ALTER TABLE orchestrator_research_cleanup_ops ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`);
  await p.query(`ALTER TABLE orchestrator_research_cleanup_ops ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`);

  await p.query(`ALTER TABLE orchestrator_research_cleanup_targets ADD COLUMN IF NOT EXISTS op_id TEXT NOT NULL DEFAULT ''`);
  await p.query(`ALTER TABLE orchestrator_research_cleanup_targets ADD COLUMN IF NOT EXISTS target_kind TEXT NOT NULL DEFAULT 'evidence'`);
  await p.query(`ALTER TABLE orchestrator_research_cleanup_targets ADD COLUMN IF NOT EXISTS target_id TEXT NOT NULL DEFAULT ''`);

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
  await _ensureNamedCheck(p, 'orchestrator_research_cleanup_ops', 'orchestrator_research_cleanup_ops_snapshot_sha256_check',
    `snapshot_sha256 IS NULL OR (char_length(snapshot_sha256) = 64 AND snapshot_sha256 ~ '^[0-9a-f]{64}$')`);

  await _ensureNamedCheck(p, 'orchestrator_research_cleanup_targets', 'orchestrator_research_cleanup_targets_target_kind_check',
    `target_kind IN ('evidence','asset')`);
  await _ensureNamedCheck(p, 'orchestrator_research_cleanup_targets', 'orchestrator_research_cleanup_targets_op_id_check',
    `char_length(op_id) BETWEEN 1 AND 128`);
  await _ensureNamedCheck(p, 'orchestrator_research_cleanup_targets', 'orchestrator_research_cleanup_targets_target_id_check',
    `char_length(target_id) BETWEEN 1 AND 128`);

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
  // _ensureNamedFk DROP+ADDs only when the local column list or ON DELETE action
  // differs; a matching FK is a no-op so repeated ensure() does not take
  // ACCESS EXCLUSIVE.
  await _ensureNamedFk(p, 'orchestrator_research_evidence',
    'orchestrator_research_evidence_tenant_competitor_fkey',
    'tenant_id, research_run_id, competitor_id',
    'orchestrator_research_competitors', 'tenant_id, research_run_id, id',
    'ON DELETE CASCADE');
  // NO ACTION (not CASCADE): deleting parent evidence must not wipe child
  // assets (legal_hold / future-expiry). DEFERRABLE matches the approval FK
  // so tenant teardown can delete both tables in one statement.
  await _ensureNamedFk(p, 'orchestrator_research_evidence_assets',
    'orchestrator_research_evidence_assets_tenant_evidence_fkey',
    'tenant_id, evidence_id', 'orchestrator_research_evidence', 'tenant_id, id',
    'ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED');
  await _ensureNamedFk(p, 'orchestrator_research_cleanup_targets',
    'orchestrator_research_cleanup_targets_op_fkey',
    'tenant_id, op_id', 'orchestrator_research_cleanup_ops', 'tenant_id, id',
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

    CREATE INDEX IF NOT EXISTS idx_orchestrator_research_cleanup_targets_tenant_op
      ON orchestrator_research_cleanup_targets (tenant_id, op_id);
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
    DECLARE
      allowed boolean := false;
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'orchestrator_research_evidence_immutable';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM tenants t WHERE t.id = OLD.tenant_id
      ) THEN
        RETURN OLD;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM orchestrator_research_runs r
         WHERE r.id = OLD.research_run_id AND r.tenant_id = OLD.tenant_id
      ) THEN
        allowed := true;
      ELSIF OLD.retention_class IS DISTINCT FROM 'legal_hold'
         AND OLD.expires_at IS NOT NULL
         AND OLD.expires_at <= now() THEN
        allowed := true;
      ELSIF EXISTS (
        SELECT 1
          FROM orchestrator_research_cleanup_ops o
          JOIN orchestrator_research_cleanup_targets t
            ON t.tenant_id = o.tenant_id AND t.op_id = o.id
         WHERE o.tenant_id = OLD.tenant_id
           AND o.state IN ('approved', 'running')
           AND t.target_kind = 'evidence'
           AND t.target_id = OLD.id
      ) THEN
        allowed := true;
      END IF;
      IF allowed THEN
        IF EXISTS (
          SELECT 1 FROM orchestrator_research_evidence_assets a
           WHERE a.tenant_id = OLD.tenant_id AND a.evidence_id = OLD.id
        ) THEN
          RAISE EXCEPTION 'orchestrator_research_evidence_has_assets';
        END IF;
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
        SELECT 1 FROM tenants t WHERE t.id = OLD.tenant_id
      ) THEN
        RETURN OLD;
      END IF;
      IF OLD.retention_class IS DISTINCT FROM 'legal_hold'
         AND OLD.expires_at IS NOT NULL
         AND OLD.expires_at <= now() THEN
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

  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_creative_artifacts (
      id                         TEXT NOT NULL,
      tenant_id                  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      artifact_id                TEXT NOT NULL,
      kind                       TEXT NOT NULL,
      workflow_id                TEXT NOT NULL,
      research_run_id            TEXT NOT NULL,
      version                    INTEGER NOT NULL,
      supersedes_id              TEXT NULL,
      status                     TEXT NOT NULL DEFAULT 'draft',
      contract_version           TEXT NOT NULL DEFAULT 'v1',
      content_hash               TEXT NOT NULL,
      evidence_hash              TEXT NOT NULL,
      approval_id                INTEGER NULL,
      approval_object_version    INTEGER NULL,
      payload                    JSONB NOT NULL,
      created_by                 INTEGER NULL,
      approved_by                INTEGER NULL,
      created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
      approved_at                TIMESTAMPTZ NULL,
      PRIMARY KEY (tenant_id, id),
      CONSTRAINT orchestrator_creative_artifacts_tenant_unique_version
        UNIQUE (tenant_id, artifact_id, version),
      CONSTRAINT orchestrator_creative_artifacts_kind_check
        CHECK (kind IN ('angle','hook','message','claim','creative_concept','creative_brief')),
      CONSTRAINT orchestrator_creative_artifacts_status_check
        CHECK (status IN ('draft','approved','invalidated','superseded')),
      CONSTRAINT orchestrator_creative_artifacts_contract_version_check
        CHECK (contract_version IN ('v1')),
      CONSTRAINT orchestrator_creative_artifacts_version_check
        CHECK (version >= 1),
      CONSTRAINT orchestrator_creative_artifacts_id_check
        CHECK (char_length(id) BETWEEN 1 AND 128),
      CONSTRAINT orchestrator_creative_artifacts_artifact_id_check
        CHECK (char_length(artifact_id) BETWEEN 1 AND 128),
      CONSTRAINT orchestrator_creative_artifacts_content_hash_check
        CHECK (char_length(content_hash) = 64 AND content_hash ~ '^[0-9a-f]{64}$'),
      CONSTRAINT orchestrator_creative_artifacts_evidence_hash_check
        CHECK (char_length(evidence_hash) = 64 AND evidence_hash ~ '^[0-9a-f]{64}$'),
      CONSTRAINT orchestrator_creative_artifacts_payload_type_check
        CHECK (jsonb_typeof(payload) = 'object'),
      CONSTRAINT orchestrator_creative_artifacts_payload_len_check
        CHECK (octet_length(payload::text) <= 32768)
    );

    CREATE TABLE IF NOT EXISTS orchestrator_creative_citations (
      id                     TEXT NOT NULL,
      tenant_id              INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      artifact_row_id        TEXT NOT NULL,
      evidence_id            TEXT NOT NULL,
      research_run_id        TEXT NOT NULL,
      workflow_id            TEXT NOT NULL,
      source_url             TEXT NULL,
      platform_source_id     TEXT NULL,
      evidence_fingerprint   TEXT NOT NULL,
      evidence_hash          TEXT NOT NULL,
      honesty_class          TEXT NOT NULL,
      source_label           TEXT NOT NULL,
      captured_at            TIMESTAMPTZ NOT NULL,
      expires_at             TIMESTAMPTZ NULL,
      contract_version       TEXT NOT NULL DEFAULT 'v1',
      created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, id),
      CONSTRAINT orchestrator_creative_citations_tenant_unique_evidence
        UNIQUE (tenant_id, artifact_row_id, evidence_id),
      CONSTRAINT orchestrator_creative_citations_honesty_class_check
        CHECK (honesty_class IN (
          'fixture','simulated','demo','synthetic','test','mock',
          'sample','placeholder','template','live','provider'
        )),
      CONSTRAINT orchestrator_creative_citations_source_label_check
        CHECK (source_label IN (
          'fixture','simulated','demo','synthetic','test','mock',
          'sample','placeholder','template','live','provider'
        )),
      CONSTRAINT orchestrator_creative_citations_live_honesty_check
        CHECK (NOT (
          honesty_class IN ('fixture','simulated','demo','synthetic','test','mock','sample','placeholder','template')
          AND source_label IN ('live','provider')
        )),
      CONSTRAINT orchestrator_creative_citations_contract_version_check
        CHECK (contract_version IN ('v1')),
      CONSTRAINT orchestrator_creative_citations_id_check
        CHECK (char_length(id) BETWEEN 1 AND 128),
      CONSTRAINT orchestrator_creative_citations_evidence_id_check
        CHECK (char_length(evidence_id) BETWEEN 1 AND 128),
      CONSTRAINT orchestrator_creative_citations_fingerprint_check
        CHECK (char_length(evidence_fingerprint) = 64 AND evidence_fingerprint ~ '^[0-9a-f]{64}$'),
      CONSTRAINT orchestrator_creative_citations_evidence_hash_check
        CHECK (char_length(evidence_hash) = 64 AND evidence_hash ~ '^[0-9a-f]{64}$'),
      CONSTRAINT orchestrator_creative_citations_source_url_check
        CHECK (source_url IS NULL OR char_length(source_url) <= 2048),
      CONSTRAINT orchestrator_creative_citations_platform_source_id_check
        CHECK (platform_source_id IS NULL OR char_length(platform_source_id) BETWEEN 1 AND 256),
      CONSTRAINT orchestrator_creative_citations_source_present_check
        CHECK (source_url IS NOT NULL OR platform_source_id IS NOT NULL)
    );

    CREATE TABLE IF NOT EXISTS orchestrator_creative_audit (
      id               SERIAL,
      tenant_id        INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      artifact_id      TEXT NOT NULL,
      artifact_row_id  TEXT NOT NULL,
      workflow_id      TEXT NOT NULL,
      event            TEXT NOT NULL,
      actor_user_id    INTEGER NULL,
      content_hash     TEXT NOT NULL,
      evidence_hash    TEXT NOT NULL,
      detail           JSONB NOT NULL DEFAULT '{}',
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, id),
      CONSTRAINT orchestrator_creative_audit_event_check
        CHECK (event IN ('created','revised','approved','invalidated','superseded','approval_rejected')),
      CONSTRAINT orchestrator_creative_audit_content_hash_check
        CHECK (char_length(content_hash) = 64 AND content_hash ~ '^[0-9a-f]{64}$'),
      CONSTRAINT orchestrator_creative_audit_evidence_hash_check
        CHECK (char_length(evidence_hash) = 64 AND evidence_hash ~ '^[0-9a-f]{64}$'),
      CONSTRAINT orchestrator_creative_audit_detail_type_check
        CHECK (jsonb_typeof(detail) = 'object'),
      CONSTRAINT orchestrator_creative_audit_detail_len_check
        CHECK (octet_length(detail::text) <= 2048)
    );
  `);

  await _ensureNamedUnique(p, 'orchestrator_creative_artifacts',
    'orchestrator_creative_artifacts_tenant_unique_version', 'tenant_id, artifact_id, version');
  await _ensureNamedFk(p, 'orchestrator_creative_artifacts',
    'orchestrator_creative_artifacts_tenant_workflow_fkey',
    'tenant_id, workflow_id', 'orchestrator_workflows', 'tenant_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_creative_artifacts',
    'orchestrator_creative_artifacts_tenant_run_fkey',
    'tenant_id, research_run_id', 'orchestrator_research_runs', 'tenant_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_creative_artifacts',
    'orchestrator_creative_artifacts_tenant_approval_fkey',
    'tenant_id, approval_id', 'orchestrator_approvals', 'tenant_id, id',
    'ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED');
  await _ensureNamedFk(p, 'orchestrator_creative_citations',
    'orchestrator_creative_citations_tenant_artifact_fkey',
    'tenant_id, artifact_row_id', 'orchestrator_creative_artifacts', 'tenant_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_creative_audit',
    'orchestrator_creative_audit_tenant_artifact_fkey',
    'tenant_id, artifact_row_id', 'orchestrator_creative_artifacts', 'tenant_id, id',
    'ON DELETE CASCADE');

  await p.query(`CREATE INDEX IF NOT EXISTS idx_orchestrator_creative_artifacts_tenant_workflow
    ON orchestrator_creative_artifacts (tenant_id, workflow_id)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_orchestrator_creative_citations_tenant_evidence
    ON orchestrator_creative_citations (tenant_id, evidence_id)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_orchestrator_creative_audit_tenant_artifact
    ON orchestrator_creative_audit (tenant_id, artifact_id)`);

  await _installInTransaction(p, `
    CREATE OR REPLACE FUNCTION orchestrator_creative_artifacts_immutable()
    RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        IF NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = OLD.tenant_id) THEN
          RETURN OLD;
        END IF;
        RAISE EXCEPTION 'orchestrator_creative_artifacts_immutable';
      END IF;
      IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
         OR OLD.id IS DISTINCT FROM NEW.id
         OR OLD.artifact_id IS DISTINCT FROM NEW.artifact_id
         OR OLD.kind IS DISTINCT FROM NEW.kind
         OR OLD.workflow_id IS DISTINCT FROM NEW.workflow_id
         OR OLD.research_run_id IS DISTINCT FROM NEW.research_run_id
         OR OLD.version IS DISTINCT FROM NEW.version
         OR OLD.contract_version IS DISTINCT FROM NEW.contract_version
         OR OLD.content_hash IS DISTINCT FROM NEW.content_hash
         OR OLD.evidence_hash IS DISTINCT FROM NEW.evidence_hash
         OR OLD.payload IS DISTINCT FROM NEW.payload
         OR OLD.created_by IS DISTINCT FROM NEW.created_by THEN
        RAISE EXCEPTION 'orchestrator_creative_artifacts_immutable';
      END IF;
      IF OLD.status IN ('superseded', 'invalidated') THEN
        RAISE EXCEPTION 'orchestrator_creative_artifacts_immutable';
      END IF;
      IF OLD.status = 'approved' AND NEW.status NOT IN ('superseded', 'invalidated') THEN
        RAISE EXCEPTION 'orchestrator_creative_artifacts_immutable';
      END IF;
      IF OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'approved', 'superseded', 'invalidated') THEN
        RAISE EXCEPTION 'orchestrator_creative_artifacts_immutable';
      END IF;
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION orchestrator_creative_artifacts_approval_bind()
    RETURNS trigger AS $fn$
    DECLARE
      appr RECORD;
    BEGIN
      IF NEW.status IS DISTINCT FROM 'approved' THEN
        RETURN NEW;
      END IF;
      IF NEW.approval_id IS NULL THEN
        RAISE EXCEPTION 'orchestrator_creative_artifacts_approval_required';
      END IF;
      SELECT a.tenant_id, a.workflow_id, a.gate, a.decision, a.object_type,
             a.object_id, a.object_version, a.content_hash
        INTO appr
        FROM orchestrator_approvals a
       WHERE a.tenant_id = NEW.tenant_id AND a.id = NEW.approval_id;
      IF appr.tenant_id IS NULL
         OR appr.workflow_id IS DISTINCT FROM NEW.workflow_id
         OR appr.gate IS DISTINCT FROM 'creative_generation'
         OR appr.decision IS DISTINCT FROM 'approved'
         OR appr.object_type IS DISTINCT FROM 'creative_artifact'
         OR appr.object_id IS DISTINCT FROM NEW.artifact_id
         OR appr.object_version IS DISTINCT FROM NEW.version
         OR appr.content_hash IS NULL
         OR char_length(appr.content_hash) <> 64 THEN
        RAISE EXCEPTION 'orchestrator_creative_artifacts_approval_required';
      END IF;
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION orchestrator_creative_citations_immutable()
    RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'orchestrator_creative_citations_immutable';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = OLD.tenant_id) THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'orchestrator_creative_citations_immutable';
    END;
    $fn$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION orchestrator_creative_audit_immutable()
    RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'orchestrator_creative_audit_immutable';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = OLD.tenant_id) THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'orchestrator_creative_audit_immutable';
    END;
    $fn$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS orchestrator_creative_artifacts_immutable ON orchestrator_creative_artifacts;
    CREATE TRIGGER orchestrator_creative_artifacts_immutable
      BEFORE UPDATE OR DELETE ON orchestrator_creative_artifacts
      FOR EACH ROW
      EXECUTE FUNCTION orchestrator_creative_artifacts_immutable();

    DROP TRIGGER IF EXISTS orchestrator_creative_artifacts_approval_bind ON orchestrator_creative_artifacts;
    CREATE TRIGGER orchestrator_creative_artifacts_approval_bind
      BEFORE INSERT OR UPDATE ON orchestrator_creative_artifacts
      FOR EACH ROW
      EXECUTE FUNCTION orchestrator_creative_artifacts_approval_bind();

    DROP TRIGGER IF EXISTS orchestrator_creative_citations_immutable ON orchestrator_creative_citations;
    CREATE TRIGGER orchestrator_creative_citations_immutable
      BEFORE UPDATE OR DELETE ON orchestrator_creative_citations
      FOR EACH ROW
      EXECUTE FUNCTION orchestrator_creative_citations_immutable();

    DROP TRIGGER IF EXISTS orchestrator_creative_audit_immutable ON orchestrator_creative_audit;
    CREATE TRIGGER orchestrator_creative_audit_immutable
      BEFORE UPDATE OR DELETE ON orchestrator_creative_audit
      FOR EACH ROW
      EXECUTE FUNCTION orchestrator_creative_audit_immutable();
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_proposal_generations (
      id                                TEXT NOT NULL,
      tenant_id                         INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      workflow_id                       TEXT NOT NULL,
      research_run_id                   TEXT NOT NULL,
      version                           INTEGER NOT NULL DEFAULT 1,
      status                            TEXT NOT NULL DEFAULT 'pending',
      contract_version                  TEXT NOT NULL DEFAULT 'v1',
      prompt_template_version           TEXT NOT NULL,
      provider                          TEXT NOT NULL,
      model                             TEXT NOT NULL,
      evidence_snapshot_hash            TEXT NOT NULL,
      research_approval_id              INTEGER NOT NULL,
      research_approval_hash            TEXT NOT NULL,
      research_approval_object_version  INTEGER NOT NULL,
      content_hash                      TEXT NOT NULL,
      idempotency_key                   TEXT NOT NULL,
      reservation_id                    TEXT NULL,
      artifact_ids                      JSONB NOT NULL DEFAULT '[]',
      error_code                        TEXT NULL,
      created_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),
      generated_at                      TIMESTAMPTZ NULL,
      PRIMARY KEY (tenant_id, id),
      CONSTRAINT orchestrator_proposal_generations_tenant_unique_idemp UNIQUE (tenant_id, idempotency_key),
      CONSTRAINT orchestrator_proposal_generations_status_check CHECK (status IN ('pending','running','pending_review','failed','cancelled')),
      CONSTRAINT orchestrator_proposal_generations_contract_version_check CHECK (contract_version IN ('v1')),
      CONSTRAINT orchestrator_proposal_generations_version_check CHECK (version >= 1),
      CONSTRAINT orchestrator_proposal_generations_id_check CHECK (char_length(id) BETWEEN 1 AND 128),
      CONSTRAINT orchestrator_proposal_generations_prompt_check CHECK (char_length(prompt_template_version) BETWEEN 1 AND 32),
      CONSTRAINT orchestrator_proposal_generations_provider_check CHECK (char_length(provider) BETWEEN 1 AND 64),
      CONSTRAINT orchestrator_proposal_generations_model_check CHECK (char_length(model) BETWEEN 1 AND 128),
      CONSTRAINT orchestrator_proposal_generations_evidence_hash_check CHECK (char_length(evidence_snapshot_hash) = 64 AND evidence_snapshot_hash ~ '^[0-9a-f]{64}$'),
      CONSTRAINT orchestrator_proposal_generations_approval_hash_check CHECK (char_length(research_approval_hash) = 64 AND research_approval_hash ~ '^[0-9a-f]{64}$'),
      CONSTRAINT orchestrator_proposal_generations_content_hash_check CHECK (char_length(content_hash) = 64 AND content_hash ~ '^[0-9a-f]{64}$'),
      CONSTRAINT orchestrator_proposal_generations_idemp_check CHECK (char_length(idempotency_key) BETWEEN 1 AND 256),
      CONSTRAINT orchestrator_proposal_generations_artifacts_type_check CHECK (jsonb_typeof(artifact_ids) = 'array'),
      CONSTRAINT orchestrator_proposal_generations_artifacts_len_check CHECK (octet_length(artifact_ids::text) <= 4096)
    );
  `);

  await _ensureNamedUnique(p, 'orchestrator_proposal_generations',
    'orchestrator_proposal_generations_tenant_unique_idemp', 'tenant_id, idempotency_key');
  await _ensureNamedFk(p, 'orchestrator_proposal_generations',
    'orchestrator_proposal_generations_tenant_workflow_fkey',
    'tenant_id, workflow_id', 'orchestrator_workflows', 'tenant_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_proposal_generations',
    'orchestrator_proposal_generations_tenant_run_fkey',
    'tenant_id, research_run_id', 'orchestrator_research_runs', 'tenant_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_proposal_generations',
    'orchestrator_proposal_generations_tenant_approval_fkey',
    'tenant_id, research_approval_id', 'orchestrator_approvals', 'tenant_id, id',
    'ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED');

  await p.query(`CREATE INDEX IF NOT EXISTS idx_orchestrator_proposal_generations_tenant_workflow
    ON orchestrator_proposal_generations (tenant_id, workflow_id)`);
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_proposal_generations_active_version
    ON orchestrator_proposal_generations (tenant_id, workflow_id, research_run_id, version)
    WHERE status IN ('pending', 'running', 'pending_review')`);

  await _installInTransaction(p, `
    CREATE OR REPLACE FUNCTION orchestrator_proposal_generations_immutable()
    RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        IF NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = OLD.tenant_id) THEN
          RETURN OLD;
        END IF;
        RAISE EXCEPTION 'orchestrator_proposal_generations_immutable';
      END IF;
      IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR OLD.id IS DISTINCT FROM NEW.id
         OR OLD.workflow_id IS DISTINCT FROM NEW.workflow_id OR OLD.research_run_id IS DISTINCT FROM NEW.research_run_id
         OR OLD.version IS DISTINCT FROM NEW.version OR OLD.contract_version IS DISTINCT FROM NEW.contract_version
         OR OLD.prompt_template_version IS DISTINCT FROM NEW.prompt_template_version
         OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
         OR OLD.research_approval_id IS DISTINCT FROM NEW.research_approval_id
         OR OLD.research_approval_hash IS DISTINCT FROM NEW.research_approval_hash
         OR OLD.research_approval_object_version IS DISTINCT FROM NEW.research_approval_object_version
         OR OLD.evidence_snapshot_hash IS DISTINCT FROM NEW.evidence_snapshot_hash THEN
        RAISE EXCEPTION 'orchestrator_proposal_generations_immutable';
      END IF;
      IF OLD.status IN ('pending_review') THEN
        RAISE EXCEPTION 'orchestrator_proposal_generations_immutable';
      END IF;
      IF OLD.status IN ('failed', 'cancelled')
         AND (NEW.status IS DISTINCT FROM OLD.status
              OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
              OR NEW.artifact_ids IS DISTINCT FROM OLD.artifact_ids) THEN
        RAISE EXCEPTION 'orchestrator_proposal_generations_immutable';
      END IF;
      IF OLD.status = 'pending' AND NEW.status NOT IN ('pending', 'running', 'failed', 'cancelled') THEN
        RAISE EXCEPTION 'orchestrator_proposal_generations_immutable';
      END IF;
      IF OLD.status = 'running' AND NEW.status NOT IN ('running', 'pending_review', 'failed', 'cancelled') THEN
        RAISE EXCEPTION 'orchestrator_proposal_generations_immutable';
      END IF;
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS orchestrator_proposal_generations_immutable ON orchestrator_proposal_generations;
    CREATE TRIGGER orchestrator_proposal_generations_immutable
      BEFORE UPDATE OR DELETE ON orchestrator_proposal_generations
      FOR EACH ROW
      EXECUTE FUNCTION orchestrator_proposal_generations_immutable();
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_static_image_jobs (
      id TEXT NOT NULL, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      workflow_id TEXT NOT NULL, proposal_id TEXT NOT NULL, proposal_version INTEGER NOT NULL,
      proposal_content_hash TEXT NOT NULL, approval_id INTEGER NOT NULL, approval_hash TEXT NOT NULL,
      generation_request_hash TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
      model_version TEXT NOT NULL DEFAULT 'v1', idempotency_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued', state_version INTEGER NOT NULL DEFAULT 1,
      attempt_count INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
      reservation_id TEXT NULL, estimated_cost_micros BIGINT NOT NULL, reserved_cost_micros BIGINT NOT NULL,
      actual_cost_micros BIGINT NULL, credential_ref TEXT NULL, outbox_id TEXT NULL, asset_id TEXT NULL,
      error_code TEXT NULL, honesty_class TEXT NOT NULL, lease_holder TEXT NULL,
      lease_expires_at TIMESTAMPTZ NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), started_at TIMESTAMPTZ NULL, completed_at TIMESTAMPTZ NULL,
      PRIMARY KEY (tenant_id, id),
      CONSTRAINT orchestrator_static_image_jobs_tenant_unique_idemp UNIQUE (tenant_id, idempotency_key),
      CONSTRAINT orchestrator_static_image_jobs_status_check
        CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
      CONSTRAINT orchestrator_static_image_jobs_len_check CHECK (
        char_length(id) BETWEEN 1 AND 128 AND char_length(provider) BETWEEN 1 AND 64
        AND char_length(model) BETWEEN 1 AND 128 AND char_length(model_version) BETWEEN 1 AND 64
        AND char_length(idempotency_key) BETWEEN 1 AND 256),
      CONSTRAINT orchestrator_static_image_jobs_nums_check CHECK (
        proposal_version >= 1 AND state_version >= 1 AND attempt_count >= 0
        AND max_attempts BETWEEN 1 AND 8 AND estimated_cost_micros >= 0 AND reserved_cost_micros >= 0
        AND (actual_cost_micros IS NULL OR actual_cost_micros >= 0)),
      CONSTRAINT orchestrator_static_image_jobs_hex_check CHECK (
        char_length(proposal_content_hash)=64 AND proposal_content_hash ~ '^[0-9a-f]{64}$'
        AND char_length(approval_hash)=64 AND approval_hash ~ '^[0-9a-f]{64}$'
        AND char_length(generation_request_hash)=64 AND generation_request_hash ~ '^[0-9a-f]{64}$'),
      CONSTRAINT orchestrator_static_image_jobs_credential_ref_check
        CHECK (credential_ref IS NULL OR credential_ref ~ '^[A-Za-z0-9_:-]{1,128}$'),
      CONSTRAINT orchestrator_static_image_jobs_error_code_check
        CHECK (error_code IS NULL OR error_code ~ '^[a-z0-9_]{1,40}$'),
      CONSTRAINT orchestrator_static_image_jobs_honesty_class_check
        CHECK (honesty_class IN ('fixture','synthetic','demo','test','mock','live','provider'))
    );
  `);

  await p.query(`ALTER TABLE orchestrator_static_image_jobs
    ADD COLUMN IF NOT EXISTS reservation_id TEXT NULL,
    ADD COLUMN IF NOT EXISTS actual_cost_micros BIGINT NULL,
    ADD COLUMN IF NOT EXISTS credential_ref TEXT NULL,
    ADD COLUMN IF NOT EXISTS outbox_id TEXT NULL,
    ADD COLUMN IF NOT EXISTS asset_id TEXT NULL,
    ADD COLUMN IF NOT EXISTS error_code TEXT NULL,
    ADD COLUMN IF NOT EXISTS lease_holder TEXT NULL,
    ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ NULL`);

  await _ensureNamedUnique(p, 'orchestrator_static_image_jobs',
    'orchestrator_static_image_jobs_tenant_unique_idemp', 'tenant_id, idempotency_key');
  await _ensureNamedFk(p, 'orchestrator_static_image_jobs',
    'orchestrator_static_image_jobs_tenant_workflow_fkey',
    'tenant_id, workflow_id', 'orchestrator_workflows', 'tenant_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_static_image_jobs',
    'orchestrator_static_image_jobs_tenant_proposal_fkey',
    'tenant_id, proposal_id', 'orchestrator_proposal_generations', 'tenant_id, id',
    'ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED');
  await _ensureNamedFk(p, 'orchestrator_static_image_jobs',
    'orchestrator_static_image_jobs_tenant_approval_fkey',
    'tenant_id, approval_id', 'orchestrator_approvals', 'tenant_id, id',
    'ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED');

  await p.query(`CREATE INDEX IF NOT EXISTS idx_orchestrator_static_image_jobs_tenant_workflow
    ON orchestrator_static_image_jobs (tenant_id, workflow_id)`);
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_static_image_jobs_active_request
    ON orchestrator_static_image_jobs (tenant_id, proposal_id, generation_request_hash)
    WHERE status IN ('queued', 'running')`);

  await _installInTransaction(p, `
    CREATE OR REPLACE FUNCTION orchestrator_static_image_jobs_immutable()
    RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        IF NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = OLD.tenant_id) THEN
          RETURN OLD;
        END IF;
        RAISE EXCEPTION 'orchestrator_static_image_jobs_immutable';
      END IF;
      IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR OLD.id IS DISTINCT FROM NEW.id
         OR OLD.workflow_id IS DISTINCT FROM NEW.workflow_id OR OLD.proposal_id IS DISTINCT FROM NEW.proposal_id
         OR OLD.proposal_version IS DISTINCT FROM NEW.proposal_version
         OR OLD.proposal_content_hash IS DISTINCT FROM NEW.proposal_content_hash
         OR OLD.approval_id IS DISTINCT FROM NEW.approval_id OR OLD.approval_hash IS DISTINCT FROM NEW.approval_hash
         OR OLD.generation_request_hash IS DISTINCT FROM NEW.generation_request_hash
         OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
         OR OLD.estimated_cost_micros IS DISTINCT FROM NEW.estimated_cost_micros THEN
        RAISE EXCEPTION 'orchestrator_static_image_jobs_immutable';
      END IF;
      IF OLD.status IN ('succeeded', 'failed', 'cancelled') THEN
        RAISE EXCEPTION 'orchestrator_static_image_jobs_immutable';
      END IF;
      IF OLD.status = 'queued' AND NEW.status NOT IN ('queued', 'running', 'failed', 'cancelled') THEN
        RAISE EXCEPTION 'orchestrator_static_image_jobs_immutable';
      END IF;
      IF OLD.status = 'running' AND NEW.status NOT IN ('running', 'succeeded', 'failed', 'cancelled') THEN
        RAISE EXCEPTION 'orchestrator_static_image_jobs_immutable';
      END IF;
      IF (NEW.error_code IS DISTINCT FROM OLD.error_code OR NEW.completed_at IS DISTINCT FROM OLD.completed_at)
         AND NOT (OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('failed','cancelled','succeeded')) THEN
        RAISE EXCEPTION 'orchestrator_static_image_jobs_immutable';
      END IF;
      IF (NEW.asset_id IS DISTINCT FROM OLD.asset_id OR NEW.actual_cost_micros IS DISTINCT FROM OLD.actual_cost_micros)
         AND NOT (OLD.status = 'running' AND NEW.status = 'succeeded') THEN
        RAISE EXCEPTION 'orchestrator_static_image_jobs_immutable';
      END IF;
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS orchestrator_static_image_jobs_immutable ON orchestrator_static_image_jobs;
    CREATE TRIGGER orchestrator_static_image_jobs_immutable
      BEFORE UPDATE OR DELETE ON orchestrator_static_image_jobs
      FOR EACH ROW
      EXECUTE FUNCTION orchestrator_static_image_jobs_immutable();
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_static_image_assets (
      id TEXT NOT NULL, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      workflow_id TEXT NOT NULL, job_id TEXT NOT NULL, proposal_id TEXT NOT NULL,
      proposal_version INTEGER NOT NULL, proposal_content_hash TEXT NOT NULL, approval_hash TEXT NOT NULL,
      provider TEXT NOT NULL, model TEXT NOT NULL, model_version TEXT NOT NULL, request_hash TEXT NOT NULL,
      mime_type TEXT NOT NULL, width_px INTEGER NOT NULL, height_px INTEGER NOT NULL, byte_size INTEGER NOT NULL,
      asset_hash TEXT NOT NULL, storage_ref TEXT NOT NULL, moderation_status TEXT NOT NULL,
      moderation_source TEXT NOT NULL, honesty_class TEXT NOT NULL, provenance TEXT NOT NULL,
      usable BOOLEAN NOT NULL DEFAULT false, generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, id),
      CONSTRAINT orchestrator_static_image_assets_tenant_unique_job UNIQUE (tenant_id, job_id),
      CONSTRAINT orchestrator_static_image_assets_len_check CHECK (
        char_length(id) BETWEEN 1 AND 128 AND char_length(provider) BETWEEN 1 AND 64
        AND char_length(model) BETWEEN 1 AND 128 AND char_length(model_version) BETWEEN 1 AND 64
        AND proposal_version >= 1 AND width_px BETWEEN 1 AND 8192 AND height_px BETWEEN 1 AND 8192
        AND byte_size BETWEEN 1 AND 10485760),
      CONSTRAINT orchestrator_static_image_assets_hex_check CHECK (
        char_length(proposal_content_hash)=64 AND proposal_content_hash ~ '^[0-9a-f]{64}$'
        AND char_length(approval_hash)=64 AND approval_hash ~ '^[0-9a-f]{64}$'
        AND char_length(request_hash)=64 AND request_hash ~ '^[0-9a-f]{64}$'
        AND char_length(asset_hash)=64 AND asset_hash ~ '^[0-9a-f]{64}$'),
      CONSTRAINT orchestrator_static_image_assets_mime_type_check
        CHECK (mime_type IN ('image/png','image/jpeg','image/webp')),
      CONSTRAINT orchestrator_static_image_assets_storage_ref_check
        CHECK (char_length(storage_ref) BETWEEN 1 AND 1024 AND storage_ref !~* '^data:'),
      CONSTRAINT orchestrator_static_image_assets_moderation_status_check
        CHECK (moderation_status IN ('passed','failed')),
      CONSTRAINT orchestrator_static_image_assets_moderation_source_check
        CHECK (moderation_source IN ('fixture','synthetic','provider','internal')),
      CONSTRAINT orchestrator_static_image_assets_honesty_class_check
        CHECK (honesty_class IN ('fixture','synthetic','demo','test','mock','live','provider')),
      CONSTRAINT orchestrator_static_image_assets_provenance_check CHECK (provenance IN ('fixture','live')),
      CONSTRAINT orchestrator_static_image_assets_usable_check
        CHECK (usable = false OR moderation_status = 'passed'),
      CONSTRAINT orchestrator_static_image_assets_honesty_provenance_check CHECK (
        (provenance = 'fixture' AND honesty_class IN ('fixture','synthetic','demo','test','mock'))
        OR (provenance = 'live' AND honesty_class IN ('live','provider')))
    );
  `);

  await p.query(`ALTER TABLE orchestrator_static_image_assets
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS storage_ref TEXT,
    ADD COLUMN IF NOT EXISTS asset_hash TEXT,
    ADD COLUMN IF NOT EXISTS request_hash TEXT`);

  await _ensureNamedUnique(p, 'orchestrator_static_image_assets',
    'orchestrator_static_image_assets_tenant_unique_job', 'tenant_id, job_id');
  await _ensureNamedFk(p, 'orchestrator_static_image_assets',
    'orchestrator_static_image_assets_tenant_job_fkey',
    'tenant_id, job_id', 'orchestrator_static_image_jobs', 'tenant_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_static_image_assets',
    'orchestrator_static_image_assets_tenant_workflow_fkey',
    'tenant_id, workflow_id', 'orchestrator_workflows', 'tenant_id, id',
    'ON DELETE CASCADE');

  await p.query(`CREATE INDEX IF NOT EXISTS idx_orchestrator_static_image_assets_tenant_workflow
    ON orchestrator_static_image_assets (tenant_id, workflow_id)`);

  await _installInTransaction(p, `
    CREATE OR REPLACE FUNCTION orchestrator_static_image_assets_immutable()
    RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'orchestrator_static_image_assets_immutable';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = OLD.tenant_id) THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'orchestrator_static_image_assets_immutable';
    END;
    $fn$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS orchestrator_static_image_assets_immutable ON orchestrator_static_image_assets;
    CREATE TRIGGER orchestrator_static_image_assets_immutable
      BEFORE UPDATE OR DELETE ON orchestrator_static_image_assets
      FOR EACH ROW
      EXECUTE FUNCTION orchestrator_static_image_assets_immutable();
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_video_generation_jobs (
      id TEXT NOT NULL, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      workflow_id TEXT NOT NULL, proposal_id TEXT NOT NULL, proposal_version INTEGER NOT NULL,
      proposal_content_hash TEXT NOT NULL, approval_id INTEGER NOT NULL, approval_hash TEXT NOT NULL,
      contract_hash TEXT NOT NULL, contract_json JSONB NOT NULL, generation_request_hash TEXT NOT NULL,
      provider TEXT NOT NULL, model TEXT NOT NULL, model_version TEXT NOT NULL DEFAULT 'v1',
      idempotency_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
      state_version INTEGER NOT NULL DEFAULT 1, attempt_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3, reservation_id TEXT NULL,
      estimated_cost_micros BIGINT NOT NULL, reserved_cost_micros BIGINT NOT NULL,
      actual_cost_micros BIGINT NULL, credential_ref TEXT NULL, output_id TEXT NULL,
      error_code TEXT NULL, honesty_class TEXT NOT NULL, lease_holder TEXT NULL,
      lease_expires_at TIMESTAMPTZ NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), started_at TIMESTAMPTZ NULL,
      completed_at TIMESTAMPTZ NULL, PRIMARY KEY (tenant_id, id),
      CONSTRAINT orchestrator_video_generation_jobs_tenant_unique_idemp UNIQUE (tenant_id, idempotency_key),
      CONSTRAINT orchestrator_video_generation_jobs_status_check CHECK (status IN (
        'queued','reserved','running','succeeded','failed','cancelled','retryable','permanently_failed')),
      CONSTRAINT orchestrator_video_generation_jobs_len_check CHECK (
        char_length(id) BETWEEN 1 AND 128 AND char_length(provider) BETWEEN 1 AND 64
        AND char_length(model) BETWEEN 1 AND 128 AND char_length(model_version) BETWEEN 1 AND 64
        AND char_length(idempotency_key) BETWEEN 1 AND 256),
      CONSTRAINT orchestrator_video_generation_jobs_nums_check CHECK (
        proposal_version >= 1 AND state_version >= 1 AND attempt_count >= 0
        AND max_attempts BETWEEN 1 AND 8 AND estimated_cost_micros >= 0 AND reserved_cost_micros >= 0
        AND (actual_cost_micros IS NULL OR actual_cost_micros >= 0)),
      CONSTRAINT orchestrator_video_generation_jobs_hex_check CHECK (
        char_length(proposal_content_hash)=64 AND proposal_content_hash ~ '^[0-9a-f]{64}$'
        AND char_length(approval_hash)=64 AND approval_hash ~ '^[0-9a-f]{64}$'
        AND char_length(contract_hash)=64 AND contract_hash ~ '^[0-9a-f]{64}$'
        AND char_length(generation_request_hash)=64 AND generation_request_hash ~ '^[0-9a-f]{64}$'),
      CONSTRAINT orchestrator_video_generation_jobs_credential_ref_check CHECK (credential_ref IS NULL),
      CONSTRAINT orchestrator_video_generation_jobs_error_code_check
        CHECK (error_code IS NULL OR error_code ~ '^[a-z0-9_]{1,40}$'),
      CONSTRAINT orchestrator_video_generation_jobs_honesty_class_check
        CHECK (honesty_class IN ('fixture','synthetic','demo','test','mock')),
      CONSTRAINT orchestrator_video_generation_jobs_contract_json_check CHECK (
        jsonb_typeof(contract_json)='object' AND octet_length(contract_json::text) BETWEEN 2 AND 16384),
      CONSTRAINT orchestrator_video_generation_jobs_provider_check
        CHECK (provider IN ('placeholder') AND model IN ('stub-chargeable'))
    );
  `);

  await p.query(`ALTER TABLE orchestrator_video_generation_jobs
    ADD COLUMN IF NOT EXISTS reservation_id TEXT NULL,
    ADD COLUMN IF NOT EXISTS actual_cost_micros BIGINT NULL,
    ADD COLUMN IF NOT EXISTS credential_ref TEXT NULL,
    ADD COLUMN IF NOT EXISTS output_id TEXT NULL,
    ADD COLUMN IF NOT EXISTS error_code TEXT NULL,
    ADD COLUMN IF NOT EXISTS lease_holder TEXT NULL,
    ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS contract_hash TEXT,
    ADD COLUMN IF NOT EXISTS contract_json JSONB,
    ADD COLUMN IF NOT EXISTS generation_request_hash TEXT`);

  await _ensureNamedUnique(p, 'orchestrator_video_generation_jobs',
    'orchestrator_video_generation_jobs_tenant_unique_idemp', 'tenant_id, idempotency_key');
  await _ensureNamedFk(p, 'orchestrator_video_generation_jobs',
    'orchestrator_video_generation_jobs_tenant_workflow_fkey',
    'tenant_id, workflow_id', 'orchestrator_workflows', 'tenant_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_video_generation_jobs',
    'orchestrator_video_generation_jobs_tenant_proposal_fkey',
    'tenant_id, proposal_id', 'orchestrator_proposal_generations', 'tenant_id, id',
    'ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED');
  await _ensureNamedFk(p, 'orchestrator_video_generation_jobs',
    'orchestrator_video_generation_jobs_tenant_approval_fkey',
    'tenant_id, approval_id', 'orchestrator_approvals', 'tenant_id, id',
    'ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED');

  await p.query(`CREATE INDEX IF NOT EXISTS idx_orchestrator_video_generation_jobs_tenant_workflow
    ON orchestrator_video_generation_jobs (tenant_id, workflow_id)`);
  await p.query(`DROP INDEX IF EXISTS orchestrator_video_generation_jobs_active_request`);
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_video_generation_jobs_active_request
    ON orchestrator_video_generation_jobs (tenant_id, proposal_id, generation_request_hash)
    WHERE status IN ('queued','reserved','running','retryable','succeeded')`);

  await _installInTransaction(p, `
    CREATE OR REPLACE FUNCTION orchestrator_video_generation_jobs_immutable()
    RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        IF NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = OLD.tenant_id) THEN
          RETURN OLD;
        END IF;
        RAISE EXCEPTION 'orchestrator_video_generation_jobs_immutable';
      END IF;
      IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR OLD.id IS DISTINCT FROM NEW.id
         OR OLD.workflow_id IS DISTINCT FROM NEW.workflow_id OR OLD.proposal_id IS DISTINCT FROM NEW.proposal_id
         OR OLD.proposal_version IS DISTINCT FROM NEW.proposal_version
         OR OLD.proposal_content_hash IS DISTINCT FROM NEW.proposal_content_hash
         OR OLD.approval_id IS DISTINCT FROM NEW.approval_id OR OLD.approval_hash IS DISTINCT FROM NEW.approval_hash
         OR OLD.contract_hash IS DISTINCT FROM NEW.contract_hash
         OR OLD.generation_request_hash IS DISTINCT FROM NEW.generation_request_hash
         OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
         OR OLD.estimated_cost_micros IS DISTINCT FROM NEW.estimated_cost_micros
         OR OLD.provider IS DISTINCT FROM NEW.provider OR OLD.model IS DISTINCT FROM NEW.model
         OR OLD.model_version IS DISTINCT FROM NEW.model_version THEN
        RAISE EXCEPTION 'orchestrator_video_generation_jobs_immutable';
      END IF;
      IF OLD.status IN ('succeeded','failed','cancelled','permanently_failed') THEN
        RAISE EXCEPTION 'orchestrator_video_generation_jobs_immutable';
      END IF;
      IF OLD.status = 'queued' AND NEW.status NOT IN ('queued','reserved','cancelled','permanently_failed','failed') THEN
        RAISE EXCEPTION 'orchestrator_video_generation_jobs_immutable';
      END IF;
      IF OLD.status = 'reserved' AND NEW.status NOT IN ('reserved','running','cancelled','retryable','permanently_failed','failed') THEN
        RAISE EXCEPTION 'orchestrator_video_generation_jobs_immutable';
      END IF;
      IF OLD.status = 'running' AND NEW.status NOT IN ('running','succeeded','retryable','cancelled','permanently_failed','failed') THEN
        RAISE EXCEPTION 'orchestrator_video_generation_jobs_immutable';
      END IF;
      IF OLD.status = 'retryable' AND NEW.status NOT IN ('retryable','running','cancelled','permanently_failed','failed') THEN
        RAISE EXCEPTION 'orchestrator_video_generation_jobs_immutable';
      END IF;
      IF (NEW.error_code IS DISTINCT FROM OLD.error_code OR NEW.completed_at IS DISTINCT FROM OLD.completed_at)
         AND NOT (OLD.status IS DISTINCT FROM NEW.status
                  AND NEW.status IN ('failed','cancelled','permanently_failed','succeeded')) THEN
        RAISE EXCEPTION 'orchestrator_video_generation_jobs_immutable';
      END IF;
      IF (NEW.output_id IS DISTINCT FROM OLD.output_id OR NEW.actual_cost_micros IS DISTINCT FROM OLD.actual_cost_micros)
         AND NOT (OLD.status = 'running' AND NEW.status = 'succeeded') THEN
        RAISE EXCEPTION 'orchestrator_video_generation_jobs_immutable';
      END IF;
      IF OLD.reservation_id IS NOT NULL AND NEW.reservation_id IS DISTINCT FROM OLD.reservation_id THEN
        RAISE EXCEPTION 'orchestrator_video_generation_jobs_immutable';
      END IF;
      IF OLD.reservation_id IS NULL AND NEW.reservation_id IS NOT NULL
         AND NOT (OLD.status = 'queued' AND NEW.status = 'reserved') THEN
        RAISE EXCEPTION 'orchestrator_video_generation_jobs_immutable';
      END IF;
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS orchestrator_video_generation_jobs_immutable ON orchestrator_video_generation_jobs;
    CREATE TRIGGER orchestrator_video_generation_jobs_immutable
      BEFORE UPDATE OR DELETE ON orchestrator_video_generation_jobs
      FOR EACH ROW
      EXECUTE FUNCTION orchestrator_video_generation_jobs_immutable();
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_video_generation_outputs (
      id TEXT NOT NULL, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      workflow_id TEXT NOT NULL, job_id TEXT NOT NULL, proposal_id TEXT NOT NULL,
      proposal_version INTEGER NOT NULL, proposal_content_hash TEXT NOT NULL, approval_hash TEXT NOT NULL,
      contract_hash TEXT NOT NULL, request_hash TEXT NOT NULL, mime_type TEXT NOT NULL,
      width_px INTEGER NOT NULL, height_px INTEGER NOT NULL, duration_ms INTEGER NOT NULL,
      fps INTEGER NOT NULL, storage_ref TEXT NOT NULL, honesty_class TEXT NOT NULL,
      provenance TEXT NOT NULL, moderation_status TEXT NOT NULL, moderation_source TEXT NOT NULL,
      usable BOOLEAN NOT NULL DEFAULT false, generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, id),
      CONSTRAINT orchestrator_video_generation_outputs_tenant_unique_job UNIQUE (tenant_id, job_id),
      CONSTRAINT orchestrator_video_generation_outputs_len_check CHECK (
        char_length(id) BETWEEN 1 AND 128 AND proposal_version >= 1
        AND width_px BETWEEN 1 AND 7680 AND height_px BETWEEN 1 AND 7680
        AND duration_ms BETWEEN 1 AND 120000 AND fps BETWEEN 1 AND 60),
      CONSTRAINT orchestrator_video_generation_outputs_hex_check CHECK (
        char_length(proposal_content_hash)=64 AND proposal_content_hash ~ '^[0-9a-f]{64}$'
        AND char_length(approval_hash)=64 AND approval_hash ~ '^[0-9a-f]{64}$'
        AND char_length(contract_hash)=64 AND contract_hash ~ '^[0-9a-f]{64}$'
        AND char_length(request_hash)=64 AND request_hash ~ '^[0-9a-f]{64}$'),
      CONSTRAINT orchestrator_video_generation_outputs_mime_type_check
        CHECK (mime_type IN ('video/mp4','video/webm')),
      CONSTRAINT orchestrator_video_generation_outputs_storage_ref_check CHECK (
        char_length(storage_ref) BETWEEN 1 AND 1024
        AND storage_ref ~ '^orchestrator/video/[0-9]+/[A-Za-z0-9_.-]+$'
        AND storage_ref !~* '^(data:|javascript:|vbscript:|https?:)'
        AND storage_ref !~* '[?#]|token=|signature=|X-Amz-|authorization'),
      CONSTRAINT orchestrator_video_generation_outputs_honesty_class_check
        CHECK (honesty_class IN ('fixture','synthetic','demo','test','mock')),
      CONSTRAINT orchestrator_video_generation_outputs_provenance_check CHECK (provenance IN ('fixture')),
      CONSTRAINT orchestrator_video_generation_outputs_moderation_status_check
        CHECK (moderation_status IN ('passed','failed')),
      CONSTRAINT orchestrator_video_generation_outputs_moderation_source_check
        CHECK (moderation_source IN ('fixture','synthetic','internal')),
      CONSTRAINT orchestrator_video_generation_outputs_usable_check
        CHECK (usable = false OR moderation_status = 'passed')
    );
  `);

  await p.query(`ALTER TABLE orchestrator_video_generation_outputs
    ADD COLUMN IF NOT EXISTS storage_ref TEXT,
    ADD COLUMN IF NOT EXISTS request_hash TEXT,
    ADD COLUMN IF NOT EXISTS contract_hash TEXT,
    ADD COLUMN IF NOT EXISTS duration_ms INTEGER,
    ADD COLUMN IF NOT EXISTS fps INTEGER`);

  await _ensureNamedUnique(p, 'orchestrator_video_generation_outputs',
    'orchestrator_video_generation_outputs_tenant_unique_job', 'tenant_id, job_id');
  await _ensureNamedFk(p, 'orchestrator_video_generation_outputs',
    'orchestrator_video_generation_outputs_tenant_job_fkey',
    'tenant_id, job_id', 'orchestrator_video_generation_jobs', 'tenant_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_video_generation_outputs',
    'orchestrator_video_generation_outputs_tenant_workflow_fkey',
    'tenant_id, workflow_id', 'orchestrator_workflows', 'tenant_id, id',
    'ON DELETE CASCADE');

  await _installInTransaction(p, `
    CREATE OR REPLACE FUNCTION orchestrator_video_generation_outputs_immutable()
    RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'orchestrator_video_generation_outputs_immutable';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = OLD.tenant_id) THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'orchestrator_video_generation_outputs_immutable';
    END;
    $fn$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS orchestrator_video_generation_outputs_immutable ON orchestrator_video_generation_outputs;
    CREATE TRIGGER orchestrator_video_generation_outputs_immutable
      BEFORE UPDATE OR DELETE ON orchestrator_video_generation_outputs
      FOR EACH ROW
      EXECUTE FUNCTION orchestrator_video_generation_outputs_immutable();
  `);

  // PR 6A — tenant-scoped campaign draft contracts + human publishing approval.
  // Does not publish, activate, pause, or mutate live advertising campaigns.
  // No outbox, connector tables, or live-platform side effects.
  // Audit events reuse orchestrator_audit_events (no fifth table).
  // publishing/published/publish_failed are on CHECK only; the trigger
  // fail-closes those transitions until a later PR extends it.
  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_campaign_drafts (
      id TEXT NOT NULL, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      workflow_id TEXT NOT NULL, label TEXT NOT NULL DEFAULT 'Campaign draft', notes TEXT NULL,
      status TEXT NOT NULL DEFAULT 'draft', current_revision INTEGER NOT NULL DEFAULT 1,
      contract_hash TEXT NOT NULL, approval_id INTEGER NULL, approval_hash TEXT NULL,
      approval_expires_at TIMESTAMPTZ NULL, idempotency_key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, id),
      CONSTRAINT orchestrator_campaign_drafts_tenant_unique_idemp UNIQUE (tenant_id, idempotency_key),
      CONSTRAINT orchestrator_campaign_drafts_status_check CHECK (status IN (
        'draft','validating','validation_failed','ready_for_approval','approved_for_publish',
        'approval_expired','publishing','published','publish_failed','cancelled')),
      CONSTRAINT orchestrator_campaign_drafts_revision_check CHECK (current_revision >= 1),
      CONSTRAINT orchestrator_campaign_drafts_len_check CHECK (
        char_length(id) BETWEEN 1 AND 128 AND char_length(idempotency_key) BETWEEN 1 AND 256
        AND char_length(label) BETWEEN 1 AND 200
        AND (notes IS NULL OR char_length(notes) <= 500)),
      CONSTRAINT orchestrator_campaign_drafts_contract_hash_check CHECK (
        char_length(contract_hash)=64 AND contract_hash ~ '^[0-9a-f]{64}$'),
      CONSTRAINT orchestrator_campaign_drafts_approval_hash_check CHECK (
        approval_hash IS NULL OR (char_length(approval_hash)=64 AND approval_hash ~ '^[0-9a-f]{64}$'))
    );
  `);
  await p.query(`ALTER TABLE orchestrator_campaign_drafts
    ADD COLUMN IF NOT EXISTS notes TEXT NULL,
    ADD COLUMN IF NOT EXISTS approval_id INTEGER NULL,
    ADD COLUMN IF NOT EXISTS approval_hash TEXT NULL,
    ADD COLUMN IF NOT EXISTS approval_expires_at TIMESTAMPTZ NULL`);
  await _ensureNamedUnique(p, 'orchestrator_campaign_drafts',
    'orchestrator_campaign_drafts_tenant_unique_idemp', 'tenant_id, idempotency_key');
  await _ensureNamedFk(p, 'orchestrator_campaign_drafts',
    'orchestrator_campaign_drafts_tenant_workflow_fkey',
    'tenant_id, workflow_id', 'orchestrator_workflows', 'tenant_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_drafts',
    'orchestrator_campaign_drafts_tenant_approval_fkey',
    'tenant_id, approval_id', 'orchestrator_approvals', 'tenant_id, id',
    'ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED');
  await _ensureNamedCheck(p, 'orchestrator_campaign_drafts', 'orchestrator_campaign_drafts_status_check',
    `status IN ('draft','validating','validation_failed','ready_for_approval','approved_for_publish','approval_expired','publishing','published','publish_failed','cancelled')`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_drafts', 'orchestrator_campaign_drafts_contract_hash_check',
    `char_length(contract_hash)=64 AND contract_hash ~ '^[0-9a-f]{64}$'`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_drafts', 'orchestrator_campaign_drafts_approval_hash_check',
    `approval_hash IS NULL OR (char_length(approval_hash)=64 AND approval_hash ~ '^[0-9a-f]{64}$')`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_orchestrator_campaign_drafts_tenant_workflow
    ON orchestrator_campaign_drafts (tenant_id, workflow_id)`);

  await _installInTransaction(p, `
    CREATE OR REPLACE FUNCTION orchestrator_campaign_drafts_immutable()
    RETURNS trigger AS $fn$
    DECLARE
      mutable_statuses TEXT[] := ARRAY['draft','validating','validation_failed','ready_for_approval'];
      entering_approved BOOLEAN;
      leaving_approved BOOLEAN;
      revision_mutable BOOLEAN;
    BEGIN
      IF TG_OP = 'DELETE' THEN
        IF NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = OLD.tenant_id) THEN
          RETURN OLD;
        END IF;
        RAISE EXCEPTION 'orchestrator_campaign_drafts_immutable';
      END IF;
      IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR OLD.id IS DISTINCT FROM NEW.id
         OR OLD.workflow_id IS DISTINCT FROM NEW.workflow_id
         OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
         OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
        RAISE EXCEPTION 'orchestrator_campaign_drafts_immutable';
      END IF;
      IF OLD.status = 'cancelled' THEN
        RAISE EXCEPTION 'orchestrator_campaign_drafts_immutable';
      END IF;
      IF NEW.status IN ('publishing','published','publish_failed') THEN
        RAISE EXCEPTION 'orchestrator_campaign_drafts_immutable';
      END IF;
      IF OLD.status IS DISTINCT FROM NEW.status AND NOT (
           (OLD.status = 'draft' AND NEW.status IN ('validating','cancelled'))
        OR (OLD.status = 'validating' AND NEW.status IN ('validation_failed','ready_for_approval','cancelled'))
        OR (OLD.status = 'validation_failed' AND NEW.status IN ('draft','validating','cancelled'))
        OR (OLD.status = 'ready_for_approval' AND NEW.status IN ('approved_for_publish','validating','draft','cancelled'))
        OR (OLD.status = 'approved_for_publish' AND NEW.status IN ('ready_for_approval','approval_expired','cancelled'))
        OR (OLD.status = 'approval_expired' AND NEW.status IN ('ready_for_approval','validating','cancelled'))
      ) THEN
        RAISE EXCEPTION 'orchestrator_campaign_drafts_immutable';
      END IF;
      entering_approved := (OLD.status IS DISTINCT FROM 'approved_for_publish' AND NEW.status = 'approved_for_publish');
      leaving_approved := (OLD.status = 'approved_for_publish' AND NEW.status IS DISTINCT FROM 'approved_for_publish');
      revision_mutable := (OLD.status = ANY (mutable_statuses) AND NEW.status = ANY (mutable_statuses));
      IF revision_mutable THEN
        IF NEW.current_revision < OLD.current_revision THEN
          RAISE EXCEPTION 'orchestrator_campaign_drafts_immutable';
        END IF;
        IF NEW.contract_hash IS DISTINCT FROM OLD.contract_hash
           AND NEW.current_revision <= OLD.current_revision THEN
          RAISE EXCEPTION 'orchestrator_campaign_drafts_immutable';
        END IF;
      ELSIF NEW.contract_hash IS DISTINCT FROM OLD.contract_hash
         OR NEW.current_revision IS DISTINCT FROM OLD.current_revision THEN
        RAISE EXCEPTION 'orchestrator_campaign_drafts_immutable';
      END IF;
      IF entering_approved THEN
        NULL;
      ELSIF leaving_approved THEN
        IF NEW.approval_id IS NOT NULL OR NEW.approval_hash IS NOT NULL
           OR NEW.approval_expires_at IS NOT NULL THEN
          RAISE EXCEPTION 'orchestrator_campaign_drafts_immutable';
        END IF;
      ELSIF NEW.approval_id IS DISTINCT FROM OLD.approval_id
         OR NEW.approval_hash IS DISTINCT FROM OLD.approval_hash
         OR NEW.approval_expires_at IS DISTINCT FROM OLD.approval_expires_at THEN
        RAISE EXCEPTION 'orchestrator_campaign_drafts_immutable';
      END IF;
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS orchestrator_campaign_drafts_immutable ON orchestrator_campaign_drafts;
    CREATE TRIGGER orchestrator_campaign_drafts_immutable
      BEFORE UPDATE OR DELETE ON orchestrator_campaign_drafts
      FOR EACH ROW
      EXECUTE FUNCTION orchestrator_campaign_drafts_immutable();
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_campaign_draft_revisions (
      id TEXT NOT NULL, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      draft_id TEXT NOT NULL, revision INTEGER NOT NULL, contract_json JSONB NOT NULL,
      contract_hash TEXT NOT NULL, validation_status TEXT NOT NULL DEFAULT 'pending',
      validation_json JSONB NOT NULL DEFAULT '{}', provenance_json JSONB NOT NULL DEFAULT '{}',
      actor_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, id),
      CONSTRAINT orchestrator_campaign_draft_revisions_tenant_unique_rev
        UNIQUE (tenant_id, draft_id, revision),
      CONSTRAINT orchestrator_campaign_draft_revisions_revision_check CHECK (revision >= 1),
      CONSTRAINT orchestrator_campaign_draft_revisions_id_check CHECK (char_length(id) BETWEEN 1 AND 128),
      CONSTRAINT orchestrator_campaign_draft_revisions_contract_hash_check CHECK (
        char_length(contract_hash)=64 AND contract_hash ~ '^[0-9a-f]{64}$'),
      CONSTRAINT orchestrator_campaign_draft_revisions_contract_json_check CHECK (
        jsonb_typeof(contract_json)='object' AND octet_length(contract_json::text) BETWEEN 2 AND 16384),
      CONSTRAINT orchestrator_campaign_draft_revisions_validation_status_check CHECK (
        validation_status IN ('pending','passed','failed')),
      CONSTRAINT orchestrator_campaign_draft_revisions_validation_json_check CHECK (
        jsonb_typeof(validation_json)='object' AND octet_length(validation_json::text) BETWEEN 2 AND 8192),
      CONSTRAINT orchestrator_campaign_draft_revisions_provenance_json_check CHECK (
        jsonb_typeof(provenance_json)='object' AND octet_length(provenance_json::text) BETWEEN 2 AND 8192)
    );
  `);
  await p.query(`ALTER TABLE orchestrator_campaign_draft_revisions
    ADD COLUMN IF NOT EXISTS validation_json JSONB,
    ADD COLUMN IF NOT EXISTS provenance_json JSONB,
    ADD COLUMN IF NOT EXISTS actor_user_id INTEGER`);
  await _ensureNamedUnique(p, 'orchestrator_campaign_draft_revisions',
    'orchestrator_campaign_draft_revisions_tenant_unique_rev', 'tenant_id, draft_id, revision');
  await _ensureNamedFk(p, 'orchestrator_campaign_draft_revisions',
    'orchestrator_campaign_draft_revisions_tenant_draft_fkey',
    'tenant_id, draft_id', 'orchestrator_campaign_drafts', 'tenant_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedCheck(p, 'orchestrator_campaign_draft_revisions',
    'orchestrator_campaign_draft_revisions_contract_hash_check',
    `char_length(contract_hash)=64 AND contract_hash ~ '^[0-9a-f]{64}$'`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_draft_revisions',
    'orchestrator_campaign_draft_revisions_validation_status_check',
    `validation_status IN ('pending','passed','failed')`);

  await _installInTransaction(p, `
    CREATE OR REPLACE FUNCTION orchestrator_campaign_draft_revisions_immutable()
    RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        IF NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = OLD.tenant_id) THEN
          RETURN OLD;
        END IF;
        RAISE EXCEPTION 'orchestrator_campaign_draft_revisions_immutable';
      END IF;
      IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR OLD.id IS DISTINCT FROM NEW.id
         OR OLD.draft_id IS DISTINCT FROM NEW.draft_id OR OLD.revision IS DISTINCT FROM NEW.revision
         OR OLD.contract_json IS DISTINCT FROM NEW.contract_json
         OR OLD.contract_hash IS DISTINCT FROM NEW.contract_hash
         OR OLD.provenance_json IS DISTINCT FROM NEW.provenance_json
         OR OLD.actor_user_id IS DISTINCT FROM NEW.actor_user_id
         OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
        RAISE EXCEPTION 'orchestrator_campaign_draft_revisions_immutable';
      END IF;
      IF OLD.validation_status IS NOT DISTINCT FROM NEW.validation_status
         AND OLD.validation_json IS NOT DISTINCT FROM NEW.validation_json THEN
        RETURN NEW;
      END IF;
      IF OLD.validation_status = 'pending' AND NEW.validation_status IN ('passed','failed') THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'orchestrator_campaign_draft_revisions_immutable';
    END;
    $fn$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS orchestrator_campaign_draft_revisions_immutable ON orchestrator_campaign_draft_revisions;
    CREATE TRIGGER orchestrator_campaign_draft_revisions_immutable
      BEFORE UPDATE OR DELETE ON orchestrator_campaign_draft_revisions
      FOR EACH ROW
      EXECUTE FUNCTION orchestrator_campaign_draft_revisions_immutable();
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_campaign_draft_creatives (
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      draft_id TEXT NOT NULL, revision INTEGER NOT NULL, kind TEXT NOT NULL,
      asset_id TEXT NOT NULL, asset_version INTEGER NOT NULL, content_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, draft_id, revision, kind, asset_id, asset_version),
      CONSTRAINT orchestrator_campaign_draft_creatives_kind_check CHECK (
        kind IN ('static_image','video','creative_brief')),
      CONSTRAINT orchestrator_campaign_draft_creatives_asset_check CHECK (
        asset_version >= 1 AND char_length(asset_id) BETWEEN 1 AND 128),
      CONSTRAINT orchestrator_campaign_draft_creatives_content_hash_check CHECK (
        char_length(content_hash)=64 AND content_hash ~ '^[0-9a-f]{64}$')
    );
  `);
  await _ensureNamedFk(p, 'orchestrator_campaign_draft_creatives',
    'orchestrator_campaign_draft_creatives_tenant_revision_fkey',
    'tenant_id, draft_id, revision', 'orchestrator_campaign_draft_revisions',
    'tenant_id, draft_id, revision', 'ON DELETE CASCADE');
  await _ensureNamedCheck(p, 'orchestrator_campaign_draft_creatives',
    'orchestrator_campaign_draft_creatives_kind_check',
    `kind IN ('static_image','video','creative_brief')`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_draft_creatives',
    'orchestrator_campaign_draft_creatives_content_hash_check',
    `char_length(content_hash)=64 AND content_hash ~ '^[0-9a-f]{64}$'`);

  await _installInTransaction(p, `
    CREATE OR REPLACE FUNCTION orchestrator_campaign_draft_creatives_immutable()
    RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'orchestrator_campaign_draft_creatives_immutable';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = OLD.tenant_id) THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'orchestrator_campaign_draft_creatives_immutable';
    END;
    $fn$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS orchestrator_campaign_draft_creatives_immutable ON orchestrator_campaign_draft_creatives;
    CREATE TRIGGER orchestrator_campaign_draft_creatives_immutable
      BEFORE UPDATE OR DELETE ON orchestrator_campaign_draft_creatives
      FOR EACH ROW
      EXECUTE FUNCTION orchestrator_campaign_draft_creatives_immutable();
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_campaign_publish_approvals (
      id TEXT NOT NULL, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      draft_id TEXT NOT NULL, revision INTEGER NOT NULL, contract_hash TEXT NOT NULL,
      snapshot_json JSONB NOT NULL, workflow_approval_id INTEGER NOT NULL,
      actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
      idempotency_key TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ NULL, revoke_reason TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, id),
      CONSTRAINT orchestrator_campaign_publish_approvals_tenant_unique_idemp
        UNIQUE (tenant_id, idempotency_key),
      CONSTRAINT orchestrator_campaign_publish_approvals_revision_check CHECK (revision >= 1),
      CONSTRAINT orchestrator_campaign_publish_approvals_len_check CHECK (
        char_length(id) BETWEEN 1 AND 128 AND char_length(idempotency_key) BETWEEN 1 AND 256),
      CONSTRAINT orchestrator_campaign_publish_approvals_contract_hash_check CHECK (
        char_length(contract_hash)=64 AND contract_hash ~ '^[0-9a-f]{64}$'),
      CONSTRAINT orchestrator_campaign_publish_approvals_snapshot_json_check CHECK (
        jsonb_typeof(snapshot_json)='object' AND octet_length(snapshot_json::text) BETWEEN 2 AND 16384),
      CONSTRAINT orchestrator_campaign_publish_approvals_expires_check CHECK (expires_at > created_at)
    );
  `);
  await p.query(`ALTER TABLE orchestrator_campaign_publish_approvals
    ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS revoke_reason TEXT NULL`);
  await _ensureNamedUnique(p, 'orchestrator_campaign_publish_approvals',
    'orchestrator_campaign_publish_approvals_tenant_unique_idemp', 'tenant_id, idempotency_key');
  await _ensureNamedCheck(p, 'orchestrator_campaign_publish_approvals',
    'orchestrator_campaign_publish_approvals_revoke_reason_check',
    `revoke_reason IS NULL OR (revoke_reason = btrim(revoke_reason) AND char_length(revoke_reason) BETWEEN 1 AND 500)`);
  await p.query(`ALTER TABLE orchestrator_campaign_publish_approvals
    DROP CONSTRAINT IF EXISTS orchestrator_campaign_publish_approvals_tenant_unique_snapshot`);
  await p.query(`DROP INDEX IF EXISTS orchestrator_campaign_publish_approvals_tenant_unique_snapshot`);
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_campaign_publish_approvals_tenant_unique_snapshot
    ON orchestrator_campaign_publish_approvals (tenant_id, draft_id, revision, contract_hash)
    WHERE revoked_at IS NULL`);
  await _ensureNamedFk(p, 'orchestrator_campaign_publish_approvals',
    'orchestrator_campaign_publish_approvals_tenant_draft_fkey',
    'tenant_id, draft_id', 'orchestrator_campaign_drafts', 'tenant_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_publish_approvals',
    'orchestrator_campaign_publish_approvals_tenant_approval_fkey',
    'tenant_id, workflow_approval_id', 'orchestrator_approvals', 'tenant_id, id',
    'ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED');
  await _ensureNamedCheck(p, 'orchestrator_campaign_publish_approvals',
    'orchestrator_campaign_publish_approvals_contract_hash_check',
    `char_length(contract_hash)=64 AND contract_hash ~ '^[0-9a-f]{64}$'`);

  await _installInTransaction(p, `
    CREATE OR REPLACE FUNCTION orchestrator_campaign_publish_approvals_immutable()
    RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        IF NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = OLD.tenant_id) THEN
          RETURN OLD;
        END IF;
        RAISE EXCEPTION 'orchestrator_campaign_publish_approvals_immutable';
      END IF;
      IF OLD.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION 'orchestrator_campaign_publish_approvals_immutable';
      END IF;
      IF NEW.revoked_at IS NOT NULL THEN
        IF NEW.revoke_reason IS NULL
           OR NEW.revoke_reason IS DISTINCT FROM btrim(NEW.revoke_reason)
           OR char_length(NEW.revoke_reason) < 1
           OR char_length(NEW.revoke_reason) > 500 THEN
          RAISE EXCEPTION 'orchestrator_campaign_publish_approvals_immutable';
        END IF;
        IF OLD.tenant_id IS NOT DISTINCT FROM NEW.tenant_id
           AND OLD.id IS NOT DISTINCT FROM NEW.id
           AND OLD.draft_id IS NOT DISTINCT FROM NEW.draft_id
           AND OLD.revision IS NOT DISTINCT FROM NEW.revision
           AND OLD.contract_hash IS NOT DISTINCT FROM NEW.contract_hash
           AND OLD.snapshot_json IS NOT DISTINCT FROM NEW.snapshot_json
           AND OLD.workflow_approval_id IS NOT DISTINCT FROM NEW.workflow_approval_id
           AND OLD.actor_user_id IS NOT DISTINCT FROM NEW.actor_user_id
           AND OLD.idempotency_key IS NOT DISTINCT FROM NEW.idempotency_key
           AND OLD.expires_at IS NOT DISTINCT FROM NEW.expires_at
           AND OLD.created_at IS NOT DISTINCT FROM NEW.created_at
           AND OLD.revoke_reason IS NULL THEN
          RETURN NEW;
        END IF;
        RAISE EXCEPTION 'orchestrator_campaign_publish_approvals_immutable';
      END IF;
      RAISE EXCEPTION 'orchestrator_campaign_publish_approvals_immutable';
    END;
    $fn$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS orchestrator_campaign_publish_approvals_immutable ON orchestrator_campaign_publish_approvals;
    CREATE TRIGGER orchestrator_campaign_publish_approvals_immutable
      BEFORE UPDATE OR DELETE ON orchestrator_campaign_publish_approvals
      FOR EACH ROW
      EXECUTE FUNCTION orchestrator_campaign_publish_approvals_immutable();
  `);

  // PR 6B — tenant-scoped guarded internal publishing request.
  // Binds to an exact approved snapshot (draft + publishing approval +
  // workflow approval + revision/contract_hash/snapshot_hash). Status is
  // frozen at requested; confirmation_version is frozen at 1.
  // Does not store credentials, vault payloads, tokens, headers, provider
  // data, external campaign IDs, arbitrary bodies, confirmation phrases, or
  // a duplicate of snapshot_json. Does not publish/activate/pause.
  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_campaign_publish_requests (
      id TEXT NOT NULL, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      draft_id TEXT NOT NULL, publish_approval_id TEXT NOT NULL, workflow_approval_id INTEGER NOT NULL,
      revision INTEGER NOT NULL, contract_hash TEXT NOT NULL, snapshot_hash TEXT NOT NULL,
      requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'requested', confirmation_version INTEGER NOT NULL DEFAULT 1,
      idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, id),
      CONSTRAINT orchestrator_campaign_publish_requests_tenant_unique_idemp
        UNIQUE (tenant_id, idempotency_key),
      CONSTRAINT orchestrator_campaign_publish_requests_tenant_unique_snapshot
        UNIQUE (tenant_id, draft_id, revision, contract_hash, snapshot_hash),
      CONSTRAINT orchestrator_campaign_publish_requests_status_check CHECK (status = 'requested'),
      CONSTRAINT orchestrator_campaign_publish_requests_confirm_ver_check
        CHECK (confirmation_version = 1),
      CONSTRAINT orchestrator_campaign_publish_requests_revision_check CHECK (revision >= 1),
      CONSTRAINT orchestrator_campaign_publish_requests_len_check CHECK (
        char_length(id) BETWEEN 1 AND 128
        AND char_length(draft_id) BETWEEN 1 AND 128
        AND char_length(publish_approval_id) BETWEEN 1 AND 128
        AND char_length(idempotency_key) BETWEEN 1 AND 256),
      CONSTRAINT orchestrator_campaign_publish_requests_contract_hash_check CHECK (
        char_length(contract_hash)=64 AND contract_hash ~ '^[0-9a-f]{64}$'),
      CONSTRAINT orchestrator_campaign_publish_requests_snapshot_hash_check CHECK (
        char_length(snapshot_hash)=64 AND snapshot_hash ~ '^[0-9a-f]{64}$'),
      CONSTRAINT orchestrator_campaign_publish_requests_request_hash_check CHECK (
        char_length(request_hash)=64 AND request_hash ~ '^[0-9a-f]{64}$')
    );
  `);
  await p.query(`ALTER TABLE orchestrator_campaign_publish_requests
    ADD COLUMN IF NOT EXISTS draft_id TEXT,
    ADD COLUMN IF NOT EXISTS publish_approval_id TEXT,
    ADD COLUMN IF NOT EXISTS workflow_approval_id INTEGER,
    ADD COLUMN IF NOT EXISTS revision INTEGER,
    ADD COLUMN IF NOT EXISTS contract_hash TEXT,
    ADD COLUMN IF NOT EXISTS snapshot_hash TEXT,
    ADD COLUMN IF NOT EXISTS requested_by INTEGER,
    ADD COLUMN IF NOT EXISTS status TEXT,
    ADD COLUMN IF NOT EXISTS confirmation_version INTEGER,
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
    ADD COLUMN IF NOT EXISTS request_hash TEXT,
    ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`);
  await _ensureNamedUnique(p, 'orchestrator_campaign_publish_requests',
    'orchestrator_campaign_publish_requests_tenant_unique_idemp', 'tenant_id, idempotency_key');
  await _ensureNamedUnique(p, 'orchestrator_campaign_publish_requests',
    'orchestrator_campaign_publish_requests_tenant_unique_snapshot',
    'tenant_id, draft_id, revision, contract_hash, snapshot_hash');
  await p.query(`ALTER TABLE orchestrator_campaign_publish_requests
    DROP CONSTRAINT IF EXISTS orchestrator_campaign_publish_requests_tenant_publish_approval_,
    DROP CONSTRAINT IF EXISTS orchestrator_campaign_publish_requests_tenant_workflow_approval,
    DROP CONSTRAINT IF EXISTS orchestrator_campaign_publish_requests_confirmation_version_che`);
  await p.query(`DROP INDEX IF EXISTS idx_orchestrator_campaign_publish_requests_tenant_publish_appro`);
  await _ensureNamedFk(p, 'orchestrator_campaign_publish_requests',
    'orchestrator_campaign_publish_requests_tenant_draft_fkey',
    'tenant_id, draft_id', 'orchestrator_campaign_drafts', 'tenant_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_publish_requests',
    'orchestrator_campaign_publish_requests_tenant_pub_appr_fkey',
    'tenant_id, publish_approval_id', 'orchestrator_campaign_publish_approvals', 'tenant_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_publish_requests',
    'orchestrator_campaign_publish_requests_tenant_wf_appr_fkey',
    'tenant_id, workflow_approval_id', 'orchestrator_approvals', 'tenant_id, id',
    'ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED');
  await _ensureNamedCheck(p, 'orchestrator_campaign_publish_requests',
    'orchestrator_campaign_publish_requests_status_check', `status = 'requested'`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_publish_requests',
    'orchestrator_campaign_publish_requests_confirm_ver_check', `confirmation_version = 1`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_publish_requests',
    'orchestrator_campaign_publish_requests_revision_check', `revision >= 1`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_publish_requests',
    'orchestrator_campaign_publish_requests_contract_hash_check',
    `char_length(contract_hash)=64 AND contract_hash ~ '^[0-9a-f]{64}$'`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_publish_requests',
    'orchestrator_campaign_publish_requests_snapshot_hash_check',
    `char_length(snapshot_hash)=64 AND snapshot_hash ~ '^[0-9a-f]{64}$'`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_publish_requests',
    'orchestrator_campaign_publish_requests_request_hash_check',
    `char_length(request_hash)=64 AND request_hash ~ '^[0-9a-f]{64}$'`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_orchestrator_campaign_publish_requests_tenant_draft
    ON orchestrator_campaign_publish_requests (tenant_id, draft_id)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_orchestrator_campaign_publish_requests_tenant_pub_appr
    ON orchestrator_campaign_publish_requests (tenant_id, publish_approval_id)`);

  await _installInTransaction(p, `
    CREATE OR REPLACE FUNCTION orchestrator_campaign_publish_requests_immutable()
    RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'orchestrator_campaign_publish_requests_immutable';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = OLD.tenant_id) THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'orchestrator_campaign_publish_requests_immutable';
    END;
    $fn$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS orchestrator_campaign_publish_requests_immutable ON orchestrator_campaign_publish_requests;
    CREATE TRIGGER orchestrator_campaign_publish_requests_immutable
      BEFORE UPDATE OR DELETE ON orchestrator_campaign_publish_requests
      FOR EACH ROW
      EXECUTE FUNCTION orchestrator_campaign_publish_requests_immutable();
  `);

  // PR 6C — tenant-scoped immutable campaign delivery intent.
  // Binds 1:1 to a publish request (and its draft / publishing approval /
  // workflow approval) and to exactly one pregenerated outbox id via a
  // DEFERRABLE INITIALLY DEFERRED composite FK so intent+outbox can be
  // inserted in either order inside one transaction. Frozen at
  // campaign_delivery_v1 / create_provider_draft / pending.
  // Does not store credentials, vault payloads, tokens, headers, provider
  // data, external campaign IDs, or raw payloads. Does not send/activate.
  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_campaign_delivery_intents (
      id TEXT NOT NULL, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      publishing_request_id TEXT NOT NULL, draft_id TEXT NOT NULL, publish_approval_id TEXT NOT NULL,
      workflow_approval_id INTEGER NOT NULL, outbox_id TEXT NOT NULL, revision INTEGER NOT NULL,
      contract_hash TEXT NOT NULL, snapshot_hash TEXT NOT NULL, intent_hash TEXT NOT NULL,
      contract_version TEXT NOT NULL DEFAULT 'campaign_delivery_v1',
      operation TEXT NOT NULL DEFAULT 'create_provider_draft',
      status TEXT NOT NULL DEFAULT 'pending', idempotency_key TEXT NOT NULL,
      requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, id),
      CONSTRAINT orchestrator_campaign_delivery_intents_tenant_unique_pub_req
        UNIQUE (tenant_id, publishing_request_id),
      CONSTRAINT orchestrator_campaign_delivery_intents_tenant_unique_outbox
        UNIQUE (tenant_id, outbox_id),
      CONSTRAINT orchestrator_campaign_delivery_intents_tenant_unique_idemp
        UNIQUE (tenant_id, idempotency_key),
      CONSTRAINT orchestrator_campaign_delivery_intents_contract_ver_check
        CHECK (contract_version = 'campaign_delivery_v1'),
      CONSTRAINT orchestrator_campaign_delivery_intents_operation_check
        CHECK (operation = 'create_provider_draft'),
      CONSTRAINT orchestrator_campaign_delivery_intents_status_check CHECK (status = 'pending'),
      CONSTRAINT orchestrator_campaign_delivery_intents_revision_check CHECK (revision >= 1),
      CONSTRAINT orchestrator_campaign_delivery_intents_len_check CHECK (
        char_length(id) BETWEEN 1 AND 128
        AND char_length(publishing_request_id) BETWEEN 1 AND 128
        AND char_length(draft_id) BETWEEN 1 AND 128
        AND char_length(publish_approval_id) BETWEEN 1 AND 128
        AND char_length(outbox_id) BETWEEN 1 AND 128
        AND char_length(idempotency_key) BETWEEN 1 AND 256),
      CONSTRAINT orchestrator_campaign_delivery_intents_contract_hash_check CHECK (
        char_length(contract_hash)=64 AND contract_hash ~ '^[0-9a-f]{64}$'),
      CONSTRAINT orchestrator_campaign_delivery_intents_snapshot_hash_check CHECK (
        char_length(snapshot_hash)=64 AND snapshot_hash ~ '^[0-9a-f]{64}$'),
      CONSTRAINT orchestrator_campaign_delivery_intents_intent_hash_check CHECK (
        char_length(intent_hash)=64 AND intent_hash ~ '^[0-9a-f]{64}$')
    );
  `);
  await p.query(`ALTER TABLE orchestrator_campaign_delivery_intents
    ADD COLUMN IF NOT EXISTS publishing_request_id TEXT,
    ADD COLUMN IF NOT EXISTS draft_id TEXT,
    ADD COLUMN IF NOT EXISTS publish_approval_id TEXT,
    ADD COLUMN IF NOT EXISTS workflow_approval_id INTEGER,
    ADD COLUMN IF NOT EXISTS outbox_id TEXT,
    ADD COLUMN IF NOT EXISTS revision INTEGER,
    ADD COLUMN IF NOT EXISTS contract_hash TEXT,
    ADD COLUMN IF NOT EXISTS snapshot_hash TEXT,
    ADD COLUMN IF NOT EXISTS intent_hash TEXT,
    ADD COLUMN IF NOT EXISTS contract_version TEXT,
    ADD COLUMN IF NOT EXISTS operation TEXT,
    ADD COLUMN IF NOT EXISTS status TEXT,
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
    ADD COLUMN IF NOT EXISTS requested_by INTEGER,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`);
  await _ensureNamedUnique(p, 'orchestrator_campaign_delivery_intents',
    'orchestrator_campaign_delivery_intents_tenant_unique_pub_req',
    'tenant_id, publishing_request_id');
  await _ensureNamedUnique(p, 'orchestrator_campaign_delivery_intents',
    'orchestrator_campaign_delivery_intents_tenant_unique_outbox',
    'tenant_id, outbox_id');
  await _ensureNamedUnique(p, 'orchestrator_campaign_delivery_intents',
    'orchestrator_campaign_delivery_intents_tenant_unique_idemp',
    'tenant_id, idempotency_key');
  // Parent unique for sandbox-outcome composite binding FK
  // (tenant_id, outbox_id, intent_id) → intents(tenant_id, outbox_id, id).
  await _ensureNamedUnique(p, 'orchestrator_campaign_delivery_intents',
    'orchestrator_campaign_delivery_intents_tenant_unique_outbox_id',
    'tenant_id, outbox_id, id');
  await _ensureNamedFk(p, 'orchestrator_campaign_delivery_intents',
    'orchestrator_campaign_delivery_intents_tenant_pub_req_fkey',
    'tenant_id, publishing_request_id', 'orchestrator_campaign_publish_requests', 'tenant_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_delivery_intents',
    'orchestrator_campaign_delivery_intents_tenant_draft_fkey',
    'tenant_id, draft_id', 'orchestrator_campaign_drafts', 'tenant_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_delivery_intents',
    'orchestrator_campaign_delivery_intents_tenant_pub_appr_fkey',
    'tenant_id, publish_approval_id', 'orchestrator_campaign_publish_approvals', 'tenant_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_delivery_intents',
    'orchestrator_campaign_delivery_intents_tenant_wf_appr_fkey',
    'tenant_id, workflow_approval_id', 'orchestrator_approvals', 'tenant_id, id',
    'ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED');
  await _ensureNamedFk(p, 'orchestrator_campaign_delivery_intents',
    'orchestrator_campaign_delivery_intents_tenant_outbox_fkey',
    'tenant_id, outbox_id', 'orchestrator_outbox', 'tenant_id, id',
    'ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED');
  await _ensureNamedCheck(p, 'orchestrator_campaign_delivery_intents',
    'orchestrator_campaign_delivery_intents_contract_ver_check',
    `contract_version = 'campaign_delivery_v1'`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_delivery_intents',
    'orchestrator_campaign_delivery_intents_operation_check',
    `operation = 'create_provider_draft'`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_delivery_intents',
    'orchestrator_campaign_delivery_intents_status_check', `status = 'pending'`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_delivery_intents',
    'orchestrator_campaign_delivery_intents_revision_check', `revision >= 1`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_delivery_intents',
    'orchestrator_campaign_delivery_intents_contract_hash_check',
    `char_length(contract_hash)=64 AND contract_hash ~ '^[0-9a-f]{64}$'`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_delivery_intents',
    'orchestrator_campaign_delivery_intents_snapshot_hash_check',
    `char_length(snapshot_hash)=64 AND snapshot_hash ~ '^[0-9a-f]{64}$'`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_delivery_intents',
    'orchestrator_campaign_delivery_intents_intent_hash_check',
    `char_length(intent_hash)=64 AND intent_hash ~ '^[0-9a-f]{64}$'`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_orchestrator_campaign_delivery_intents_tenant_draft
    ON orchestrator_campaign_delivery_intents (tenant_id, draft_id)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_orchestrator_campaign_delivery_intents_tenant_pub_appr
    ON orchestrator_campaign_delivery_intents (tenant_id, publish_approval_id)`);

  await _installInTransaction(p, `
    CREATE OR REPLACE FUNCTION orchestrator_campaign_delivery_intents_immutable()
    RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'orchestrator_campaign_delivery_intents_immutable';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = OLD.tenant_id) THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'orchestrator_campaign_delivery_intents_immutable';
    END;
    $fn$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS orchestrator_campaign_delivery_intents_immutable ON orchestrator_campaign_delivery_intents;
    CREATE TRIGGER orchestrator_campaign_delivery_intents_immutable
      BEFORE UPDATE OR DELETE ON orchestrator_campaign_delivery_intents
      FOR EACH ROW
      EXECUTE FUNCTION orchestrator_campaign_delivery_intents_immutable();
  `);

  // PR 6D — tenant-scoped campaign delivery attempt ledger.
  // Append-only history of simulated create_provider_draft attempts bound to
  // an intent + outbox. Multiple historical attempts may share the same
  // (tenant_id, outbox_id) and (tenant_id, intent_id); uniqueness is
  // (outbox_id, attempt_number), (outbox_id, generation), and claim_token.
  // A started row may terminalize once; identity/claim/lease fields stay
  // frozen. Does not store credentials, vault payloads, provider campaign
  // IDs, or live publish/activate side effects. simulated stays TRUE;
  // published and external_action_taken stay FALSE.
  // Brief unique suffix tenant_unique_generation is 64 chars; use
  // _tenant_unique_gen so the identifier stays within Postgres' 63-char limit.
  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_campaign_delivery_attempts (
      id TEXT NOT NULL,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      intent_id TEXT NOT NULL,
      outbox_id TEXT NOT NULL,
      draft_id TEXT NOT NULL,
      publishing_request_id TEXT NOT NULL,
      attempt_number INTEGER NOT NULL,
      generation INTEGER NOT NULL,
      claim_token TEXT NOT NULL,
      lease_holder TEXT NOT NULL,
      lease_expires_at TIMESTAMPTZ NOT NULL,
      platform TEXT NOT NULL,
      intent_hash TEXT NOT NULL,
      contract_version TEXT NOT NULL DEFAULT 'campaign_delivery_v1',
      operation TEXT NOT NULL DEFAULT 'create_provider_draft',
      connector TEXT NOT NULL DEFAULT 'fake',
      status TEXT NOT NULL DEFAULT 'started',
      scenario TEXT NULL,
      error_code TEXT NULL,
      retryable BOOLEAN NULL,
      simulated BOOLEAN NOT NULL DEFAULT TRUE,
      published BOOLEAN NOT NULL DEFAULT FALSE,
      external_action_taken BOOLEAN NOT NULL DEFAULT FALSE,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      settled_at TIMESTAMPTZ NULL,
      PRIMARY KEY (tenant_id, id),
      CONSTRAINT orchestrator_campaign_delivery_attempts_tenant_unique_number
        UNIQUE (tenant_id, outbox_id, attempt_number),
      CONSTRAINT orchestrator_campaign_delivery_attempts_tenant_unique_gen
        UNIQUE (tenant_id, outbox_id, generation),
      CONSTRAINT orchestrator_campaign_delivery_attempts_tenant_unique_claim
        UNIQUE (tenant_id, claim_token),
      CONSTRAINT orchestrator_campaign_delivery_attempts_status_check CHECK (
        status IN (
          'started','simulated_ok','simulated_duplicate',
          'retry_transient','retry_rate_limit','retry_timeout',
          'dead_letter_permanent','dead_letter_malformed','dead_letter_blocked',
          'authorization_rejected','abandoned_lease'
        )
      ),
      CONSTRAINT orchestrator_campaign_delivery_attempts_frozen_check CHECK (
        contract_version = 'campaign_delivery_v1'
        AND operation = 'create_provider_draft'
        AND connector = 'fake'
      ),
      CONSTRAINT orchestrator_campaign_delivery_attempts_platform_check
        CHECK (platform IN ('meta','google','tiktok')),
      CONSTRAINT orchestrator_campaign_delivery_attempts_sim_check CHECK (
        simulated = TRUE AND published = FALSE AND external_action_taken = FALSE
      ),
      CONSTRAINT orchestrator_campaign_delivery_attempts_number_check CHECK (
        attempt_number >= 1 AND generation >= 1 AND generation = attempt_number
      ),
      CONSTRAINT orchestrator_campaign_delivery_attempts_error_code_check CHECK (
        error_code IS NULL OR error_code ~ '^[a-z0-9_]{1,40}$'
      ),
      CONSTRAINT orchestrator_campaign_delivery_attempts_intent_hash_check CHECK (
        char_length(intent_hash)=64 AND intent_hash ~ '^[0-9a-f]{64}$'
      ),
      CONSTRAINT orchestrator_campaign_delivery_attempts_terminal_check CHECK (
        (status = 'started' AND settled_at IS NULL AND scenario IS NULL
          AND error_code IS NULL AND retryable IS NULL)
        OR (status <> 'started' AND settled_at IS NOT NULL AND retryable IS NOT NULL)
      ),
      CONSTRAINT orchestrator_campaign_delivery_attempts_len_check CHECK (
        char_length(id) BETWEEN 1 AND 128
        AND char_length(intent_id) BETWEEN 1 AND 128
        AND char_length(outbox_id) BETWEEN 1 AND 128
        AND char_length(draft_id) BETWEEN 1 AND 128
        AND char_length(publishing_request_id) BETWEEN 1 AND 128
        AND char_length(claim_token) BETWEEN 8 AND 128
        AND char_length(lease_holder) BETWEEN 1 AND 128
        AND (scenario IS NULL OR char_length(scenario) BETWEEN 1 AND 128)
      )
    );
  `);
  await p.query(`ALTER TABLE orchestrator_campaign_delivery_attempts
    ADD COLUMN IF NOT EXISTS id TEXT,
    ADD COLUMN IF NOT EXISTS tenant_id INTEGER,
    ADD COLUMN IF NOT EXISTS intent_id TEXT,
    ADD COLUMN IF NOT EXISTS outbox_id TEXT,
    ADD COLUMN IF NOT EXISTS draft_id TEXT,
    ADD COLUMN IF NOT EXISTS publishing_request_id TEXT,
    ADD COLUMN IF NOT EXISTS attempt_number INTEGER,
    ADD COLUMN IF NOT EXISTS generation INTEGER,
    ADD COLUMN IF NOT EXISTS claim_token TEXT,
    ADD COLUMN IF NOT EXISTS lease_holder TEXT,
    ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS platform TEXT,
    ADD COLUMN IF NOT EXISTS intent_hash TEXT,
    ADD COLUMN IF NOT EXISTS contract_version TEXT,
    ADD COLUMN IF NOT EXISTS operation TEXT,
    ADD COLUMN IF NOT EXISTS connector TEXT,
    ADD COLUMN IF NOT EXISTS status TEXT,
    ADD COLUMN IF NOT EXISTS scenario TEXT,
    ADD COLUMN IF NOT EXISTS error_code TEXT,
    ADD COLUMN IF NOT EXISTS retryable BOOLEAN,
    ADD COLUMN IF NOT EXISTS simulated BOOLEAN,
    ADD COLUMN IF NOT EXISTS published BOOLEAN,
    ADD COLUMN IF NOT EXISTS external_action_taken BOOLEAN,
    ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ`);
  await _ensureNamedUnique(p, 'orchestrator_campaign_delivery_attempts',
    'orchestrator_campaign_delivery_attempts_tenant_unique_number',
    'tenant_id, outbox_id, attempt_number');
  await _ensureNamedUnique(p, 'orchestrator_campaign_delivery_attempts',
    'orchestrator_campaign_delivery_attempts_tenant_unique_gen',
    'tenant_id, outbox_id, generation');
  await _ensureNamedUnique(p, 'orchestrator_campaign_delivery_attempts',
    'orchestrator_campaign_delivery_attempts_tenant_unique_claim',
    'tenant_id, claim_token');
  await _ensureNamedFk(p, 'orchestrator_campaign_delivery_attempts',
    'orchestrator_cda_tenant_intent_fkey',
    'tenant_id, intent_id', 'orchestrator_campaign_delivery_intents', 'tenant_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_delivery_attempts',
    'orchestrator_cda_tenant_outbox_fkey',
    'tenant_id, outbox_id', 'orchestrator_outbox', 'tenant_id, id',
    'ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED');
  await _ensureNamedFk(p, 'orchestrator_campaign_delivery_attempts',
    'orchestrator_cda_tenant_draft_fkey',
    'tenant_id, draft_id', 'orchestrator_campaign_drafts', 'tenant_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_delivery_attempts',
    'orchestrator_cda_tenant_pub_req_fkey',
    'tenant_id, publishing_request_id', 'orchestrator_campaign_publish_requests', 'tenant_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedCheck(p, 'orchestrator_campaign_delivery_attempts',
    'orchestrator_campaign_delivery_attempts_status_check',
    `status IN (
      'started','simulated_ok','simulated_duplicate',
      'retry_transient','retry_rate_limit','retry_timeout',
      'dead_letter_permanent','dead_letter_malformed','dead_letter_blocked',
      'authorization_rejected','abandoned_lease',
      'provider_draft_complete','provider_draft_partial','provider_draft_failed'
    )`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_delivery_attempts',
    'orchestrator_campaign_delivery_attempts_frozen_check',
    `contract_version = 'campaign_delivery_v1'
     AND operation = 'create_provider_draft'
     AND connector IN ('fake','meta')`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_delivery_attempts',
    'orchestrator_campaign_delivery_attempts_platform_check',
    `platform IN ('meta','google','tiktok')`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_delivery_attempts',
    'orchestrator_campaign_delivery_attempts_sim_check',
    `(connector = 'fake'
      AND simulated = TRUE AND published = FALSE AND external_action_taken = FALSE)
     OR (connector = 'meta'
      AND simulated = FALSE AND published = FALSE)`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_delivery_attempts',
    'orchestrator_campaign_delivery_attempts_number_check',
    `attempt_number >= 1 AND generation >= 1 AND generation = attempt_number`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_delivery_attempts',
    'orchestrator_campaign_delivery_attempts_error_code_check',
    `error_code IS NULL OR error_code ~ '^[a-z0-9_]{1,40}$'`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_delivery_attempts',
    'orchestrator_campaign_delivery_attempts_intent_hash_check',
    `char_length(intent_hash)=64 AND intent_hash ~ '^[0-9a-f]{64}$'`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_delivery_attempts',
    'orchestrator_campaign_delivery_attempts_terminal_check',
    `(status = 'started' AND settled_at IS NULL AND scenario IS NULL
      AND error_code IS NULL AND retryable IS NULL)
     OR (status <> 'started' AND settled_at IS NOT NULL AND retryable IS NOT NULL)`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_delivery_attempts',
    'orchestrator_campaign_delivery_attempts_len_check',
    `char_length(id) BETWEEN 1 AND 128
     AND char_length(intent_id) BETWEEN 1 AND 128
     AND char_length(outbox_id) BETWEEN 1 AND 128
     AND char_length(draft_id) BETWEEN 1 AND 128
     AND char_length(publishing_request_id) BETWEEN 1 AND 128
     AND char_length(claim_token) BETWEEN 8 AND 128
     AND char_length(lease_holder) BETWEEN 1 AND 128
     AND (scenario IS NULL OR char_length(scenario) BETWEEN 1 AND 128)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_cda_outbox_history
    ON orchestrator_campaign_delivery_attempts (tenant_id, outbox_id, attempt_number DESC)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_cda_active_lease
    ON orchestrator_campaign_delivery_attempts (tenant_id, outbox_id, lease_expires_at)
    WHERE status = 'started'`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_cda_intent_history
    ON orchestrator_campaign_delivery_attempts (tenant_id, intent_id, attempt_number DESC)`);

  await _installInTransaction(p, `
    CREATE OR REPLACE FUNCTION orchestrator_campaign_delivery_attempts_guard()
    RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        IF OLD.status IS DISTINCT FROM 'started'
           OR NEW.status IS NOT DISTINCT FROM 'started'
           OR NEW.id IS DISTINCT FROM OLD.id
           OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
           OR NEW.intent_id IS DISTINCT FROM OLD.intent_id
           OR NEW.outbox_id IS DISTINCT FROM OLD.outbox_id
           OR NEW.draft_id IS DISTINCT FROM OLD.draft_id
           OR NEW.publishing_request_id IS DISTINCT FROM OLD.publishing_request_id
           OR NEW.attempt_number IS DISTINCT FROM OLD.attempt_number
           OR NEW.generation IS DISTINCT FROM OLD.generation
           OR NEW.claim_token IS DISTINCT FROM OLD.claim_token
           OR NEW.lease_holder IS DISTINCT FROM OLD.lease_holder
           OR NEW.lease_expires_at IS DISTINCT FROM OLD.lease_expires_at
           OR NEW.platform IS DISTINCT FROM OLD.platform
           OR NEW.intent_hash IS DISTINCT FROM OLD.intent_hash
           OR NEW.contract_version IS DISTINCT FROM OLD.contract_version
           OR NEW.operation IS DISTINCT FROM OLD.operation
           OR NEW.started_at IS DISTINCT FROM OLD.started_at
        THEN
          RAISE EXCEPTION 'orchestrator_campaign_delivery_attempts_immutable';
        END IF;
        IF NEW.status IN ('provider_draft_complete','provider_draft_partial','provider_draft_failed') THEN
          IF OLD.connector IS DISTINCT FROM 'fake' AND OLD.connector IS DISTINCT FROM 'meta' THEN
            RAISE EXCEPTION 'orchestrator_campaign_delivery_attempts_immutable';
          END IF;
          IF NEW.connector IS DISTINCT FROM 'meta'
             OR NEW.simulated IS DISTINCT FROM FALSE
             OR NEW.published IS DISTINCT FROM FALSE THEN
            RAISE EXCEPTION 'orchestrator_campaign_delivery_attempts_immutable';
          END IF;
          RETURN NEW;
        END IF;
        IF OLD.connector IS DISTINCT FROM 'fake'
           OR NEW.connector IS DISTINCT FROM 'fake'
           OR NEW.simulated IS DISTINCT FROM TRUE
           OR NEW.published IS DISTINCT FROM FALSE
           OR NEW.external_action_taken IS DISTINCT FROM FALSE
        THEN
          RAISE EXCEPTION 'orchestrator_campaign_delivery_attempts_immutable';
        END IF;
        RETURN NEW;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = OLD.tenant_id) THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'orchestrator_campaign_delivery_attempts_immutable';
    END;
    $fn$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS orchestrator_campaign_delivery_attempts_guard ON orchestrator_campaign_delivery_attempts;
    CREATE TRIGGER orchestrator_campaign_delivery_attempts_guard
      BEFORE UPDATE OR DELETE ON orchestrator_campaign_delivery_attempts
      FOR EACH ROW
      EXECUTE FUNCTION orchestrator_campaign_delivery_attempts_guard();
  `);

  // PR 6E — governed sandbox outcome source for the fake delivery worker.
  // Append-only until a single consume transition (consumed_at /
  // consumed_attempt_id). No secrets, vault payloads, provider IDs, or
  // credential_ref. Unique unconsumed row per (tenant_id, outbox_id).
  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_campaign_delivery_sandbox_outcomes (
      id TEXT NOT NULL,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      outbox_id TEXT NOT NULL,
      intent_id TEXT NOT NULL,
      scenario TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'sandbox',
      simulated BOOLEAN NOT NULL DEFAULT TRUE,
      published BOOLEAN NOT NULL DEFAULT FALSE,
      external_action_taken BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      consumed_at TIMESTAMPTZ NULL,
      consumed_attempt_id TEXT NULL,
      PRIMARY KEY (tenant_id, id),
      CONSTRAINT orchestrator_cdso_source_check CHECK (source = 'sandbox'),
      CONSTRAINT orchestrator_cdso_scenario_check CHECK (
        scenario IN (
          'success','duplicate','transient','rate_limit','timeout',
          'permanent','malformed','blocked'
        )
      ),
      CONSTRAINT orchestrator_cdso_sim_check CHECK (
        simulated = TRUE AND published = FALSE AND external_action_taken = FALSE
      ),
      CONSTRAINT orchestrator_cdso_consume_check CHECK (
        (consumed_at IS NULL AND consumed_attempt_id IS NULL)
        OR (consumed_at IS NOT NULL AND consumed_attempt_id IS NOT NULL)
      ),
      CONSTRAINT orchestrator_cdso_len_check CHECK (
        char_length(id) BETWEEN 1 AND 128
        AND char_length(outbox_id) BETWEEN 1 AND 128
        AND char_length(intent_id) BETWEEN 1 AND 128
        AND char_length(scenario) BETWEEN 1 AND 128
        AND (consumed_attempt_id IS NULL OR char_length(consumed_attempt_id) BETWEEN 1 AND 128)
      )
    );
  `);
  await p.query(`ALTER TABLE orchestrator_campaign_delivery_sandbox_outcomes
    ADD COLUMN IF NOT EXISTS id TEXT,
    ADD COLUMN IF NOT EXISTS tenant_id INTEGER,
    ADD COLUMN IF NOT EXISTS outbox_id TEXT,
    ADD COLUMN IF NOT EXISTS intent_id TEXT,
    ADD COLUMN IF NOT EXISTS scenario TEXT,
    ADD COLUMN IF NOT EXISTS source TEXT,
    ADD COLUMN IF NOT EXISTS simulated BOOLEAN,
    ADD COLUMN IF NOT EXISTS published BOOLEAN,
    ADD COLUMN IF NOT EXISTS external_action_taken BOOLEAN,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS consumed_attempt_id TEXT`);
  await _ensureNamedFk(p, 'orchestrator_campaign_delivery_sandbox_outcomes',
    'orchestrator_cdso_tenant_outbox_fkey',
    'tenant_id, outbox_id', 'orchestrator_outbox', 'tenant_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_delivery_sandbox_outcomes',
    'orchestrator_cdso_tenant_intent_fkey',
    'tenant_id, intent_id', 'orchestrator_campaign_delivery_intents', 'tenant_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_delivery_sandbox_outcomes',
    'orchestrator_cdso_tenant_outbox_intent_fkey',
    'tenant_id, outbox_id, intent_id',
    'orchestrator_campaign_delivery_intents', 'tenant_id, outbox_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_delivery_sandbox_outcomes',
    'orchestrator_cdso_tenant_consumed_attempt_fkey',
    'tenant_id, consumed_attempt_id',
    'orchestrator_campaign_delivery_attempts', 'tenant_id, id',
    'ON DELETE NO ACTION');
  await _ensureNamedCheck(p, 'orchestrator_campaign_delivery_sandbox_outcomes',
    'orchestrator_cdso_source_check',
    `source = 'sandbox'`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_delivery_sandbox_outcomes',
    'orchestrator_cdso_scenario_check',
    `scenario IN (
      'success','duplicate','transient','rate_limit','timeout',
      'permanent','malformed','blocked'
    )`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_delivery_sandbox_outcomes',
    'orchestrator_cdso_sim_check',
    `simulated = TRUE AND published = FALSE AND external_action_taken = FALSE`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_delivery_sandbox_outcomes',
    'orchestrator_cdso_consume_check',
    `(consumed_at IS NULL AND consumed_attempt_id IS NULL)
     OR (consumed_at IS NOT NULL AND consumed_attempt_id IS NOT NULL)`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_delivery_sandbox_outcomes',
    'orchestrator_cdso_len_check',
    `char_length(id) BETWEEN 1 AND 128
     AND char_length(outbox_id) BETWEEN 1 AND 128
     AND char_length(intent_id) BETWEEN 1 AND 128
     AND char_length(scenario) BETWEEN 1 AND 128
     AND (consumed_attempt_id IS NULL OR char_length(consumed_attempt_id) BETWEEN 1 AND 128)`);
  await p.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_cdso_tenant_unique_unconsumed
      ON orchestrator_campaign_delivery_sandbox_outcomes (tenant_id, outbox_id)
      WHERE consumed_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_cdso_tenant_outbox_created
      ON orchestrator_campaign_delivery_sandbox_outcomes (tenant_id, outbox_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cdso_tenant_unconsumed
      ON orchestrator_campaign_delivery_sandbox_outcomes (tenant_id, outbox_id)
      WHERE consumed_at IS NULL;
  `);

  await _installInTransaction(p, `
    CREATE OR REPLACE FUNCTION orchestrator_cdso_guard()
    RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        -- Outcomes must be born unconsumed; consume is UPDATE-only.
        IF NEW.consumed_at IS NOT NULL OR NEW.consumed_attempt_id IS NOT NULL THEN
          RAISE EXCEPTION 'orchestrator_cdso_immutable';
        END IF;
        RETURN NEW;
      END IF;
      IF TG_OP = 'UPDATE' THEN
        IF OLD.consumed_at IS NOT NULL
           OR NEW.id IS DISTINCT FROM OLD.id
           OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
           OR NEW.outbox_id IS DISTINCT FROM OLD.outbox_id
           OR NEW.intent_id IS DISTINCT FROM OLD.intent_id
           OR NEW.scenario IS DISTINCT FROM OLD.scenario
           OR NEW.source IS DISTINCT FROM OLD.source
           OR NEW.source IS DISTINCT FROM 'sandbox'
           OR NEW.simulated IS DISTINCT FROM TRUE
           OR NEW.published IS DISTINCT FROM FALSE
           OR NEW.external_action_taken IS DISTINCT FROM FALSE
           OR NEW.created_at IS DISTINCT FROM OLD.created_at
           OR NEW.consumed_at IS NULL
           OR NEW.consumed_attempt_id IS NULL
           OR OLD.consumed_attempt_id IS NOT NULL
        THEN
          RAISE EXCEPTION 'orchestrator_cdso_immutable';
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM orchestrator_campaign_delivery_attempts a
           WHERE a.tenant_id = NEW.tenant_id
             AND a.id = NEW.consumed_attempt_id
             AND a.outbox_id = NEW.outbox_id
             AND a.intent_id = NEW.intent_id
        ) THEN
          RAISE EXCEPTION 'orchestrator_cdso_consume_binding';
        END IF;
        RETURN NEW;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = OLD.tenant_id) THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'orchestrator_cdso_immutable';
    END;
    $fn$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS orchestrator_cdso_guard ON orchestrator_campaign_delivery_sandbox_outcomes;
    CREATE TRIGGER orchestrator_cdso_guard
      BEFORE INSERT OR UPDATE OR DELETE ON orchestrator_campaign_delivery_sandbox_outcomes
      FOR EACH ROW
      EXECUTE FUNCTION orchestrator_cdso_guard();
  `);

  // PR 6F-0 — tenant-owned Meta credential-reference metadata and
  // provider challenge / execution confirmation. Reference metadata
  // only: no secret material, provider IDs, access tokens, or object
  // ledger. Challenge TTL is capped at 5 minutes; confirmation TTL at
  // 2 minutes. Confirmation phrases are salted digests only.
  await _ensureNamedUnique(p, 'orchestrator_campaign_delivery_attempts',
    'orchestrator_cda_tenant_unique_id_bind',
    'tenant_id, id, outbox_id, intent_id');

  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_tenant_meta_credential_refs (
      id TEXT NOT NULL,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      platform TEXT NOT NULL DEFAULT 'meta',
      environment TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      account_fingerprint TEXT NOT NULL,
      page_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
      revoked_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, id),
      CONSTRAINT orchestrator_tmcr_tenant_unique_fp_ver
        UNIQUE (tenant_id, account_fingerprint, version),
      CONSTRAINT orchestrator_tmcr_platform_check CHECK (platform = 'meta'),
      CONSTRAINT orchestrator_tmcr_environment_check CHECK (environment IN ('test','sandbox')),
      CONSTRAINT orchestrator_tmcr_status_check CHECK (status IN ('active','revoked')),
      CONSTRAINT orchestrator_tmcr_revoke_check CHECK (
        (status = 'active' AND revoked_at IS NULL)
        OR (status = 'revoked' AND revoked_at IS NOT NULL AND revoked_at >= created_at)
      ),
      CONSTRAINT orchestrator_tmcr_version_check CHECK (version >= 1),
      CONSTRAINT orchestrator_tmcr_fingerprint_check CHECK (
        char_length(account_fingerprint)=64 AND account_fingerprint ~ '^[0-9a-f]{64}$'
      ),
      CONSTRAINT orchestrator_tmcr_len_check CHECK (
        char_length(id) BETWEEN 1 AND 128
      )
    );
  `);
  await p.query(`ALTER TABLE orchestrator_tenant_meta_credential_refs
    ADD COLUMN IF NOT EXISTS id TEXT,
    ADD COLUMN IF NOT EXISTS tenant_id INTEGER,
    ADD COLUMN IF NOT EXISTS platform TEXT,
    ADD COLUMN IF NOT EXISTS environment TEXT,
    ADD COLUMN IF NOT EXISTS status TEXT,
    ADD COLUMN IF NOT EXISTS account_fingerprint TEXT,
    ADD COLUMN IF NOT EXISTS page_id TEXT,
    ADD COLUMN IF NOT EXISTS version INTEGER,
    ADD COLUMN IF NOT EXISTS owner_user_id INTEGER,
    ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`);
  await _ensureNamedUnique(p, 'orchestrator_tenant_meta_credential_refs',
    'orchestrator_tmcr_tenant_unique_fp_ver',
    'tenant_id, account_fingerprint, version');
  await _ensureNamedCheck(p, 'orchestrator_tenant_meta_credential_refs',
    'orchestrator_tmcr_platform_check', `platform = 'meta'`);
  await _ensureNamedCheck(p, 'orchestrator_tenant_meta_credential_refs',
    'orchestrator_tmcr_environment_check', `environment IN ('test','sandbox')`);
  await _ensureNamedCheck(p, 'orchestrator_tenant_meta_credential_refs',
    'orchestrator_tmcr_status_check', `status IN ('active','revoked')`);
  await _ensureNamedCheck(p, 'orchestrator_tenant_meta_credential_refs',
    'orchestrator_tmcr_revoke_check',
    `(status = 'active' AND revoked_at IS NULL)
     OR (status = 'revoked' AND revoked_at IS NOT NULL AND revoked_at >= created_at)`);
  await _ensureNamedCheck(p, 'orchestrator_tenant_meta_credential_refs',
    'orchestrator_tmcr_version_check', `version >= 1`);
  await _ensureNamedCheck(p, 'orchestrator_tenant_meta_credential_refs',
    'orchestrator_tmcr_fingerprint_check',
    `char_length(account_fingerprint)=64 AND account_fingerprint ~ '^[0-9a-f]{64}$'`);
  await _ensureNamedCheck(p, 'orchestrator_tenant_meta_credential_refs',
    'orchestrator_tmcr_page_id_check',
    `page_id ~ '^[0-9]{1,32}$'`);
  await _ensureNamedCheck(p, 'orchestrator_tenant_meta_credential_refs',
    'orchestrator_tmcr_len_check', `char_length(id) BETWEEN 1 AND 128`);
  await p.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_tmcr_tenant_unique_active_fp
      ON orchestrator_tenant_meta_credential_refs (tenant_id, account_fingerprint)
      WHERE status = 'active';
    CREATE INDEX IF NOT EXISTS idx_tmcr_tenant_owner
      ON orchestrator_tenant_meta_credential_refs (tenant_id, owner_user_id);
  `);

  await _installInTransaction(p, `
    CREATE OR REPLACE FUNCTION orchestrator_tmcr_guard()
    RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        IF NEW.status IS DISTINCT FROM 'active' OR NEW.revoked_at IS NOT NULL THEN
          RAISE EXCEPTION 'orchestrator_tmcr_immutable';
        END IF;
        RETURN NEW;
      END IF;
      IF TG_OP = 'UPDATE' THEN
        IF OLD.status IS DISTINCT FROM 'active'
           OR NEW.status IS DISTINCT FROM 'revoked'
           OR NEW.revoked_at IS NULL
           OR NEW.id IS DISTINCT FROM OLD.id
           OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
           OR NEW.platform IS DISTINCT FROM OLD.platform
           OR NEW.platform IS DISTINCT FROM 'meta'
           OR NEW.environment IS DISTINCT FROM OLD.environment
           OR NEW.account_fingerprint IS DISTINCT FROM OLD.account_fingerprint
           OR NEW.version IS DISTINCT FROM OLD.version
           OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
           OR NEW.created_at IS DISTINCT FROM OLD.created_at
           OR OLD.revoked_at IS NOT NULL
        THEN
          RAISE EXCEPTION 'orchestrator_tmcr_immutable';
        END IF;
        RETURN NEW;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = OLD.tenant_id) THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'orchestrator_tmcr_immutable';
    END;
    $fn$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS orchestrator_tmcr_guard ON orchestrator_tenant_meta_credential_refs;
    CREATE TRIGGER orchestrator_tmcr_guard
      BEFORE INSERT OR UPDATE OR DELETE ON orchestrator_tenant_meta_credential_refs
      FOR EACH ROW
      EXECUTE FUNCTION orchestrator_tmcr_guard();
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_campaign_provider_challenges (
      id TEXT NOT NULL,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      draft_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      publish_approval_id TEXT NOT NULL,
      workflow_approval_id INTEGER NOT NULL,
      publishing_request_id TEXT NOT NULL,
      intent_id TEXT NOT NULL,
      outbox_id TEXT NOT NULL,
      attempt_id TEXT NOT NULL,
      credential_ref_id TEXT NOT NULL,
      generation INTEGER NOT NULL,
      contract_hash TEXT NOT NULL,
      snapshot_hash TEXT NOT NULL,
      intent_hash TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      claim_token_hash TEXT NOT NULL,
      contract_version TEXT NOT NULL DEFAULT 'campaign_delivery_v1',
      operation TEXT NOT NULL DEFAULT 'create_provider_draft',
      platform TEXT NOT NULL DEFAULT 'meta',
      phrase_salt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      idempotency_key TEXT NOT NULL,
      requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      consumed_at TIMESTAMPTZ NULL,
      consumed_confirmation_id TEXT NULL,
      PRIMARY KEY (tenant_id, id),
      CONSTRAINT orchestrator_cpc_tenant_unique_idemp
        UNIQUE (tenant_id, idempotency_key),
      CONSTRAINT orchestrator_cpc_tenant_unique_attempt
        UNIQUE (tenant_id, attempt_id),
      CONSTRAINT orchestrator_cpc_status_check CHECK (status IN ('open','consumed')),
      CONSTRAINT orchestrator_cpc_consume_check CHECK (
        (status = 'open' AND consumed_at IS NULL AND consumed_confirmation_id IS NULL)
        OR (status = 'consumed' AND consumed_at IS NOT NULL AND consumed_confirmation_id IS NOT NULL
            AND consumed_at >= created_at)
      ),
      CONSTRAINT orchestrator_cpc_ttl_check CHECK (
        expires_at > created_at AND expires_at <= created_at + INTERVAL '5 minutes'
      ),
      CONSTRAINT orchestrator_cpc_frozen_check CHECK (
        contract_version = 'campaign_delivery_v1'
        AND operation = 'create_provider_draft'
        AND platform = 'meta'
      ),
      CONSTRAINT orchestrator_cpc_revision_check CHECK (revision >= 1),
      CONSTRAINT orchestrator_cpc_generation_check CHECK (generation >= 1),
      CONSTRAINT orchestrator_cpc_salt_check CHECK (
        char_length(phrase_salt)=64 AND phrase_salt ~ '^[0-9a-f]{64}$'
      ),
      CONSTRAINT orchestrator_cpc_contract_hash_check CHECK (
        char_length(contract_hash)=64 AND contract_hash ~ '^[0-9a-f]{64}$'
      ),
      CONSTRAINT orchestrator_cpc_snapshot_hash_check CHECK (
        char_length(snapshot_hash)=64 AND snapshot_hash ~ '^[0-9a-f]{64}$'
      ),
      CONSTRAINT orchestrator_cpc_intent_hash_check CHECK (
        char_length(intent_hash)=64 AND intent_hash ~ '^[0-9a-f]{64}$'
      ),
      CONSTRAINT orchestrator_cpc_request_hash_check CHECK (
        char_length(request_hash)=64 AND request_hash ~ '^[0-9a-f]{64}$'
      ),
      CONSTRAINT orchestrator_cpc_claim_hash_check CHECK (
        char_length(claim_token_hash)=64 AND claim_token_hash ~ '^[0-9a-f]{64}$'
      ),
      CONSTRAINT orchestrator_cpc_len_check CHECK (
        char_length(id) BETWEEN 1 AND 128
        AND char_length(draft_id) BETWEEN 1 AND 128
        AND char_length(publish_approval_id) BETWEEN 1 AND 128
        AND char_length(publishing_request_id) BETWEEN 1 AND 128
        AND char_length(intent_id) BETWEEN 1 AND 128
        AND char_length(outbox_id) BETWEEN 1 AND 128
        AND char_length(attempt_id) BETWEEN 1 AND 128
        AND char_length(credential_ref_id) BETWEEN 1 AND 128
        AND char_length(idempotency_key) BETWEEN 1 AND 256
        AND (consumed_confirmation_id IS NULL
             OR char_length(consumed_confirmation_id) BETWEEN 1 AND 128)
      )
    );
  `);
  await p.query(`ALTER TABLE orchestrator_campaign_provider_challenges
    ADD COLUMN IF NOT EXISTS id TEXT,
    ADD COLUMN IF NOT EXISTS tenant_id INTEGER,
    ADD COLUMN IF NOT EXISTS draft_id TEXT,
    ADD COLUMN IF NOT EXISTS revision INTEGER,
    ADD COLUMN IF NOT EXISTS publish_approval_id TEXT,
    ADD COLUMN IF NOT EXISTS workflow_approval_id INTEGER,
    ADD COLUMN IF NOT EXISTS publishing_request_id TEXT,
    ADD COLUMN IF NOT EXISTS intent_id TEXT,
    ADD COLUMN IF NOT EXISTS outbox_id TEXT,
    ADD COLUMN IF NOT EXISTS attempt_id TEXT,
    ADD COLUMN IF NOT EXISTS credential_ref_id TEXT,
    ADD COLUMN IF NOT EXISTS generation INTEGER,
    ADD COLUMN IF NOT EXISTS contract_hash TEXT,
    ADD COLUMN IF NOT EXISTS snapshot_hash TEXT,
    ADD COLUMN IF NOT EXISTS intent_hash TEXT,
    ADD COLUMN IF NOT EXISTS request_hash TEXT,
    ADD COLUMN IF NOT EXISTS claim_token_hash TEXT,
    ADD COLUMN IF NOT EXISTS contract_version TEXT,
    ADD COLUMN IF NOT EXISTS operation TEXT,
    ADD COLUMN IF NOT EXISTS platform TEXT,
    ADD COLUMN IF NOT EXISTS phrase_salt TEXT,
    ADD COLUMN IF NOT EXISTS status TEXT,
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
    ADD COLUMN IF NOT EXISTS requested_by INTEGER,
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS consumed_confirmation_id TEXT`);
  await _ensureNamedUnique(p, 'orchestrator_campaign_provider_challenges',
    'orchestrator_cpc_tenant_unique_idemp', 'tenant_id, idempotency_key');
  await _ensureNamedUnique(p, 'orchestrator_campaign_provider_challenges',
    'orchestrator_cpc_tenant_unique_attempt', 'tenant_id, attempt_id');
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_challenges',
    'orchestrator_cpc_tenant_draft_fkey',
    'tenant_id, draft_id', 'orchestrator_campaign_drafts', 'tenant_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_challenges',
    'orchestrator_cpc_tenant_rev_fkey',
    'tenant_id, draft_id, revision', 'orchestrator_campaign_draft_revisions',
    'tenant_id, draft_id, revision',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_challenges',
    'orchestrator_cpc_tenant_pub_appr_fkey',
    'tenant_id, publish_approval_id', 'orchestrator_campaign_publish_approvals',
    'tenant_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_challenges',
    'orchestrator_cpc_tenant_wf_appr_fkey',
    'tenant_id, workflow_approval_id', 'orchestrator_approvals', 'tenant_id, id',
    'ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED');
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_challenges',
    'orchestrator_cpc_tenant_pub_req_fkey',
    'tenant_id, publishing_request_id', 'orchestrator_campaign_publish_requests',
    'tenant_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_challenges',
    'orchestrator_cpc_tenant_intent_fkey',
    'tenant_id, intent_id', 'orchestrator_campaign_delivery_intents', 'tenant_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_challenges',
    'orchestrator_cpc_tenant_outbox_fkey',
    'tenant_id, outbox_id', 'orchestrator_outbox', 'tenant_id, id',
    'ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED');
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_challenges',
    'orchestrator_cpc_tenant_outbox_intent_fkey',
    'tenant_id, outbox_id, intent_id',
    'orchestrator_campaign_delivery_intents', 'tenant_id, outbox_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_challenges',
    'orchestrator_cpc_tenant_attempt_fkey',
    'tenant_id, attempt_id', 'orchestrator_campaign_delivery_attempts', 'tenant_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_challenges',
    'orchestrator_cpc_tenant_attempt_bind_fkey',
    'tenant_id, attempt_id, outbox_id, intent_id',
    'orchestrator_campaign_delivery_attempts', 'tenant_id, id, outbox_id, intent_id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_challenges',
    'orchestrator_cpc_tenant_cred_ref_fkey',
    'tenant_id, credential_ref_id', 'orchestrator_tenant_meta_credential_refs',
    'tenant_id, id',
    'ON DELETE NO ACTION');
  await _ensureNamedCheck(p, 'orchestrator_campaign_provider_challenges',
    'orchestrator_cpc_status_check', `status IN ('open','consumed')`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_provider_challenges',
    'orchestrator_cpc_consume_check',
    `(status = 'open' AND consumed_at IS NULL AND consumed_confirmation_id IS NULL)
     OR (status = 'consumed' AND consumed_at IS NOT NULL AND consumed_confirmation_id IS NOT NULL
         AND consumed_at >= created_at)`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_provider_challenges',
    'orchestrator_cpc_ttl_check',
    `expires_at > created_at AND expires_at <= created_at + INTERVAL '5 minutes'`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_provider_challenges',
    'orchestrator_cpc_frozen_check',
    `contract_version = 'campaign_delivery_v1'
     AND operation = 'create_provider_draft'
     AND platform = 'meta'`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_provider_challenges',
    'orchestrator_cpc_revision_check', `revision >= 1`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_provider_challenges',
    'orchestrator_cpc_generation_check', `generation >= 1`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_provider_challenges',
    'orchestrator_cpc_salt_check',
    `char_length(phrase_salt)=64 AND phrase_salt ~ '^[0-9a-f]{64}$'`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_provider_challenges',
    'orchestrator_cpc_contract_hash_check',
    `char_length(contract_hash)=64 AND contract_hash ~ '^[0-9a-f]{64}$'`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_provider_challenges',
    'orchestrator_cpc_snapshot_hash_check',
    `char_length(snapshot_hash)=64 AND snapshot_hash ~ '^[0-9a-f]{64}$'`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_provider_challenges',
    'orchestrator_cpc_intent_hash_check',
    `char_length(intent_hash)=64 AND intent_hash ~ '^[0-9a-f]{64}$'`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_provider_challenges',
    'orchestrator_cpc_request_hash_check',
    `char_length(request_hash)=64 AND request_hash ~ '^[0-9a-f]{64}$'`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_provider_challenges',
    'orchestrator_cpc_claim_hash_check',
    `char_length(claim_token_hash)=64 AND claim_token_hash ~ '^[0-9a-f]{64}$'`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_provider_challenges',
    'orchestrator_cpc_len_check',
    `char_length(id) BETWEEN 1 AND 128
     AND char_length(draft_id) BETWEEN 1 AND 128
     AND char_length(publish_approval_id) BETWEEN 1 AND 128
     AND char_length(publishing_request_id) BETWEEN 1 AND 128
     AND char_length(intent_id) BETWEEN 1 AND 128
     AND char_length(outbox_id) BETWEEN 1 AND 128
     AND char_length(attempt_id) BETWEEN 1 AND 128
     AND char_length(credential_ref_id) BETWEEN 1 AND 128
     AND char_length(idempotency_key) BETWEEN 1 AND 256
     AND (consumed_confirmation_id IS NULL
          OR char_length(consumed_confirmation_id) BETWEEN 1 AND 128)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_cpc_tenant_attempt
    ON orchestrator_campaign_provider_challenges (tenant_id, attempt_id)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_cpc_tenant_open
    ON orchestrator_campaign_provider_challenges (tenant_id, attempt_id)
    WHERE consumed_at IS NULL`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_campaign_provider_confirmations (
      id TEXT NOT NULL,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      challenge_id TEXT NOT NULL,
      draft_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      publish_approval_id TEXT NOT NULL,
      workflow_approval_id INTEGER NOT NULL,
      publishing_request_id TEXT NOT NULL,
      intent_id TEXT NOT NULL,
      outbox_id TEXT NOT NULL,
      attempt_id TEXT NOT NULL,
      credential_ref_id TEXT NOT NULL,
      generation INTEGER NOT NULL,
      contract_hash TEXT NOT NULL,
      snapshot_hash TEXT NOT NULL,
      intent_hash TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      claim_token_hash TEXT NOT NULL,
      contract_version TEXT NOT NULL DEFAULT 'campaign_delivery_v1',
      operation TEXT NOT NULL DEFAULT 'create_provider_draft',
      platform TEXT NOT NULL DEFAULT 'meta',
      phrase_salt TEXT NOT NULL,
      phrase_digest TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed',
      idempotency_key TEXT NOT NULL,
      requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      spent_at TIMESTAMPTZ NULL,
      PRIMARY KEY (tenant_id, id),
      CONSTRAINT orchestrator_cpcf_tenant_unique_idemp
        UNIQUE (tenant_id, idempotency_key),
      CONSTRAINT orchestrator_cpcf_tenant_unique_challenge
        UNIQUE (tenant_id, challenge_id),
      CONSTRAINT orchestrator_cpcf_tenant_unique_attempt
        UNIQUE (tenant_id, attempt_id),
      CONSTRAINT orchestrator_cpcf_status_check CHECK (status IN ('confirmed','spent')),
      CONSTRAINT orchestrator_cpcf_spend_check CHECK (
        (status = 'confirmed' AND spent_at IS NULL)
        OR (status = 'spent' AND spent_at IS NOT NULL AND spent_at >= created_at)
      ),
      CONSTRAINT orchestrator_cpcf_ttl_check CHECK (
        expires_at > created_at AND expires_at <= created_at + INTERVAL '2 minutes'
      ),
      CONSTRAINT orchestrator_cpcf_frozen_check CHECK (
        contract_version = 'campaign_delivery_v1'
        AND operation = 'create_provider_draft'
        AND platform = 'meta'
      ),
      CONSTRAINT orchestrator_cpcf_revision_check CHECK (revision >= 1),
      CONSTRAINT orchestrator_cpcf_generation_check CHECK (generation >= 1),
      CONSTRAINT orchestrator_cpcf_salt_check CHECK (
        char_length(phrase_salt)=64 AND phrase_salt ~ '^[0-9a-f]{64}$'
      ),
      CONSTRAINT orchestrator_cpcf_digest_check CHECK (
        char_length(phrase_digest)=64 AND phrase_digest ~ '^[0-9a-f]{64}$'
      ),
      CONSTRAINT orchestrator_cpcf_contract_hash_check CHECK (
        char_length(contract_hash)=64 AND contract_hash ~ '^[0-9a-f]{64}$'
      ),
      CONSTRAINT orchestrator_cpcf_snapshot_hash_check CHECK (
        char_length(snapshot_hash)=64 AND snapshot_hash ~ '^[0-9a-f]{64}$'
      ),
      CONSTRAINT orchestrator_cpcf_intent_hash_check CHECK (
        char_length(intent_hash)=64 AND intent_hash ~ '^[0-9a-f]{64}$'
      ),
      CONSTRAINT orchestrator_cpcf_request_hash_check CHECK (
        char_length(request_hash)=64 AND request_hash ~ '^[0-9a-f]{64}$'
      ),
      CONSTRAINT orchestrator_cpcf_claim_hash_check CHECK (
        char_length(claim_token_hash)=64 AND claim_token_hash ~ '^[0-9a-f]{64}$'
      ),
      CONSTRAINT orchestrator_cpcf_len_check CHECK (
        char_length(id) BETWEEN 1 AND 128
        AND char_length(challenge_id) BETWEEN 1 AND 128
        AND char_length(draft_id) BETWEEN 1 AND 128
        AND char_length(publish_approval_id) BETWEEN 1 AND 128
        AND char_length(publishing_request_id) BETWEEN 1 AND 128
        AND char_length(intent_id) BETWEEN 1 AND 128
        AND char_length(outbox_id) BETWEEN 1 AND 128
        AND char_length(attempt_id) BETWEEN 1 AND 128
        AND char_length(credential_ref_id) BETWEEN 1 AND 128
        AND char_length(idempotency_key) BETWEEN 1 AND 256
      )
    );
  `);
  await p.query(`ALTER TABLE orchestrator_campaign_provider_confirmations
    ADD COLUMN IF NOT EXISTS id TEXT,
    ADD COLUMN IF NOT EXISTS tenant_id INTEGER,
    ADD COLUMN IF NOT EXISTS challenge_id TEXT,
    ADD COLUMN IF NOT EXISTS draft_id TEXT,
    ADD COLUMN IF NOT EXISTS revision INTEGER,
    ADD COLUMN IF NOT EXISTS publish_approval_id TEXT,
    ADD COLUMN IF NOT EXISTS workflow_approval_id INTEGER,
    ADD COLUMN IF NOT EXISTS publishing_request_id TEXT,
    ADD COLUMN IF NOT EXISTS intent_id TEXT,
    ADD COLUMN IF NOT EXISTS outbox_id TEXT,
    ADD COLUMN IF NOT EXISTS attempt_id TEXT,
    ADD COLUMN IF NOT EXISTS credential_ref_id TEXT,
    ADD COLUMN IF NOT EXISTS generation INTEGER,
    ADD COLUMN IF NOT EXISTS contract_hash TEXT,
    ADD COLUMN IF NOT EXISTS snapshot_hash TEXT,
    ADD COLUMN IF NOT EXISTS intent_hash TEXT,
    ADD COLUMN IF NOT EXISTS request_hash TEXT,
    ADD COLUMN IF NOT EXISTS claim_token_hash TEXT,
    ADD COLUMN IF NOT EXISTS contract_version TEXT,
    ADD COLUMN IF NOT EXISTS operation TEXT,
    ADD COLUMN IF NOT EXISTS platform TEXT,
    ADD COLUMN IF NOT EXISTS phrase_salt TEXT,
    ADD COLUMN IF NOT EXISTS phrase_digest TEXT,
    ADD COLUMN IF NOT EXISTS status TEXT,
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
    ADD COLUMN IF NOT EXISTS requested_by INTEGER,
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS spent_at TIMESTAMPTZ`);
  await _ensureNamedUnique(p, 'orchestrator_campaign_provider_confirmations',
    'orchestrator_cpcf_tenant_unique_idemp', 'tenant_id, idempotency_key');
  await _ensureNamedUnique(p, 'orchestrator_campaign_provider_confirmations',
    'orchestrator_cpcf_tenant_unique_challenge', 'tenant_id, challenge_id');
  await _ensureNamedUnique(p, 'orchestrator_campaign_provider_confirmations',
    'orchestrator_cpcf_tenant_unique_attempt', 'tenant_id, attempt_id');
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_confirmations',
    'orchestrator_cpcf_tenant_challenge_fkey',
    'tenant_id, challenge_id', 'orchestrator_campaign_provider_challenges',
    'tenant_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_confirmations',
    'orchestrator_cpcf_tenant_draft_fkey',
    'tenant_id, draft_id', 'orchestrator_campaign_drafts', 'tenant_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_confirmations',
    'orchestrator_cpcf_tenant_rev_fkey',
    'tenant_id, draft_id, revision', 'orchestrator_campaign_draft_revisions',
    'tenant_id, draft_id, revision',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_confirmations',
    'orchestrator_cpcf_tenant_pub_appr_fkey',
    'tenant_id, publish_approval_id', 'orchestrator_campaign_publish_approvals',
    'tenant_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_confirmations',
    'orchestrator_cpcf_tenant_wf_appr_fkey',
    'tenant_id, workflow_approval_id', 'orchestrator_approvals', 'tenant_id, id',
    'ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED');
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_confirmations',
    'orchestrator_cpcf_tenant_pub_req_fkey',
    'tenant_id, publishing_request_id', 'orchestrator_campaign_publish_requests',
    'tenant_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_confirmations',
    'orchestrator_cpcf_tenant_intent_fkey',
    'tenant_id, intent_id', 'orchestrator_campaign_delivery_intents', 'tenant_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_confirmations',
    'orchestrator_cpcf_tenant_outbox_fkey',
    'tenant_id, outbox_id', 'orchestrator_outbox', 'tenant_id, id',
    'ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED');
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_confirmations',
    'orchestrator_cpcf_tenant_outbox_intent_fkey',
    'tenant_id, outbox_id, intent_id',
    'orchestrator_campaign_delivery_intents', 'tenant_id, outbox_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_confirmations',
    'orchestrator_cpcf_tenant_attempt_fkey',
    'tenant_id, attempt_id', 'orchestrator_campaign_delivery_attempts', 'tenant_id, id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_confirmations',
    'orchestrator_cpcf_tenant_attempt_bind_fkey',
    'tenant_id, attempt_id, outbox_id, intent_id',
    'orchestrator_campaign_delivery_attempts', 'tenant_id, id, outbox_id, intent_id',
    'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_confirmations',
    'orchestrator_cpcf_tenant_cred_ref_fkey',
    'tenant_id, credential_ref_id', 'orchestrator_tenant_meta_credential_refs',
    'tenant_id, id',
    'ON DELETE NO ACTION');
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_challenges',
    'orchestrator_cpc_tenant_consumed_conf_fkey',
    'tenant_id, consumed_confirmation_id',
    'orchestrator_campaign_provider_confirmations', 'tenant_id, id',
    'ON DELETE NO ACTION');
  await _ensureNamedCheck(p, 'orchestrator_campaign_provider_confirmations',
    'orchestrator_cpcf_status_check', `status IN ('confirmed','spent')`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_provider_confirmations',
    'orchestrator_cpcf_spend_check',
    `(status = 'confirmed' AND spent_at IS NULL)
     OR (status = 'spent' AND spent_at IS NOT NULL AND spent_at >= created_at)`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_provider_confirmations',
    'orchestrator_cpcf_ttl_check',
    `expires_at > created_at AND expires_at <= created_at + INTERVAL '2 minutes'`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_provider_confirmations',
    'orchestrator_cpcf_frozen_check',
    `contract_version = 'campaign_delivery_v1'
     AND operation = 'create_provider_draft'
     AND platform = 'meta'`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_provider_confirmations',
    'orchestrator_cpcf_revision_check', `revision >= 1`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_provider_confirmations',
    'orchestrator_cpcf_generation_check', `generation >= 1`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_provider_confirmations',
    'orchestrator_cpcf_salt_check',
    `char_length(phrase_salt)=64 AND phrase_salt ~ '^[0-9a-f]{64}$'`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_provider_confirmations',
    'orchestrator_cpcf_digest_check',
    `char_length(phrase_digest)=64 AND phrase_digest ~ '^[0-9a-f]{64}$'`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_provider_confirmations',
    'orchestrator_cpcf_contract_hash_check',
    `char_length(contract_hash)=64 AND contract_hash ~ '^[0-9a-f]{64}$'`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_provider_confirmations',
    'orchestrator_cpcf_snapshot_hash_check',
    `char_length(snapshot_hash)=64 AND snapshot_hash ~ '^[0-9a-f]{64}$'`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_provider_confirmations',
    'orchestrator_cpcf_intent_hash_check',
    `char_length(intent_hash)=64 AND intent_hash ~ '^[0-9a-f]{64}$'`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_provider_confirmations',
    'orchestrator_cpcf_request_hash_check',
    `char_length(request_hash)=64 AND request_hash ~ '^[0-9a-f]{64}$'`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_provider_confirmations',
    'orchestrator_cpcf_claim_hash_check',
    `char_length(claim_token_hash)=64 AND claim_token_hash ~ '^[0-9a-f]{64}$'`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_provider_confirmations',
    'orchestrator_cpcf_len_check',
    `char_length(id) BETWEEN 1 AND 128
     AND char_length(challenge_id) BETWEEN 1 AND 128
     AND char_length(draft_id) BETWEEN 1 AND 128
     AND char_length(publish_approval_id) BETWEEN 1 AND 128
     AND char_length(publishing_request_id) BETWEEN 1 AND 128
     AND char_length(intent_id) BETWEEN 1 AND 128
     AND char_length(outbox_id) BETWEEN 1 AND 128
     AND char_length(attempt_id) BETWEEN 1 AND 128
     AND char_length(credential_ref_id) BETWEEN 1 AND 128
     AND char_length(idempotency_key) BETWEEN 1 AND 256`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_cpcf_tenant_challenge
    ON orchestrator_campaign_provider_confirmations (tenant_id, challenge_id)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_cpcf_tenant_unspent
    ON orchestrator_campaign_provider_confirmations (tenant_id, attempt_id)
    WHERE spent_at IS NULL`);

  await _installInTransaction(p, `
    CREATE OR REPLACE FUNCTION orchestrator_cpc_guard()
    RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        IF NEW.status IS DISTINCT FROM 'open'
           OR NEW.consumed_at IS NOT NULL
           OR NEW.consumed_confirmation_id IS NOT NULL THEN
          RAISE EXCEPTION 'orchestrator_cpc_immutable';
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM orchestrator_campaign_delivery_attempts a
           WHERE a.tenant_id = NEW.tenant_id
             AND a.id = NEW.attempt_id
             AND a.outbox_id = NEW.outbox_id
             AND a.intent_id = NEW.intent_id
             AND a.draft_id = NEW.draft_id
             AND a.publishing_request_id = NEW.publishing_request_id
             AND a.generation = NEW.generation
             AND a.platform = NEW.platform
        ) THEN
          RAISE EXCEPTION 'orchestrator_cpc_binding';
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM orchestrator_tenant_meta_credential_refs r
           WHERE r.tenant_id = NEW.tenant_id
             AND r.id = NEW.credential_ref_id
             AND r.status = 'active'
             AND r.revoked_at IS NULL
             AND r.platform = 'meta'
        ) THEN
          RAISE EXCEPTION 'orchestrator_cpc_binding';
        END IF;
        RETURN NEW;
      END IF;
      IF TG_OP = 'UPDATE' THEN
        IF OLD.consumed_at IS NOT NULL
           OR NEW.id IS DISTINCT FROM OLD.id
           OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
           OR NEW.draft_id IS DISTINCT FROM OLD.draft_id
           OR NEW.revision IS DISTINCT FROM OLD.revision
           OR NEW.publish_approval_id IS DISTINCT FROM OLD.publish_approval_id
           OR NEW.workflow_approval_id IS DISTINCT FROM OLD.workflow_approval_id
           OR NEW.publishing_request_id IS DISTINCT FROM OLD.publishing_request_id
           OR NEW.intent_id IS DISTINCT FROM OLD.intent_id
           OR NEW.outbox_id IS DISTINCT FROM OLD.outbox_id
           OR NEW.attempt_id IS DISTINCT FROM OLD.attempt_id
           OR NEW.credential_ref_id IS DISTINCT FROM OLD.credential_ref_id
           OR NEW.generation IS DISTINCT FROM OLD.generation
           OR NEW.contract_hash IS DISTINCT FROM OLD.contract_hash
           OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash
           OR NEW.intent_hash IS DISTINCT FROM OLD.intent_hash
           OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
           OR NEW.claim_token_hash IS DISTINCT FROM OLD.claim_token_hash
           OR NEW.contract_version IS DISTINCT FROM OLD.contract_version
           OR NEW.operation IS DISTINCT FROM OLD.operation
           OR NEW.platform IS DISTINCT FROM OLD.platform
           OR NEW.phrase_salt IS DISTINCT FROM OLD.phrase_salt
           OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
           OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
           OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
           OR NEW.created_at IS DISTINCT FROM OLD.created_at
           OR NEW.status IS DISTINCT FROM 'consumed'
           OR NEW.consumed_at IS NULL
           OR NEW.consumed_confirmation_id IS NULL
           OR OLD.consumed_confirmation_id IS NOT NULL
        THEN
          RAISE EXCEPTION 'orchestrator_cpc_immutable';
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM orchestrator_campaign_provider_confirmations f
           WHERE f.tenant_id = NEW.tenant_id
             AND f.id = NEW.consumed_confirmation_id
             AND f.challenge_id = NEW.id
             AND f.attempt_id = NEW.attempt_id
             AND f.outbox_id = NEW.outbox_id
             AND f.intent_id = NEW.intent_id
        ) THEN
          RAISE EXCEPTION 'orchestrator_cpc_consume_binding';
        END IF;
        RETURN NEW;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = OLD.tenant_id) THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'orchestrator_cpc_immutable';
    END;
    $fn$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS orchestrator_cpc_guard ON orchestrator_campaign_provider_challenges;
    CREATE TRIGGER orchestrator_cpc_guard
      BEFORE INSERT OR UPDATE OR DELETE ON orchestrator_campaign_provider_challenges
      FOR EACH ROW
      EXECUTE FUNCTION orchestrator_cpc_guard();

    CREATE OR REPLACE FUNCTION orchestrator_cpcf_guard()
    RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        IF NEW.status IS DISTINCT FROM 'confirmed' OR NEW.spent_at IS NOT NULL THEN
          RAISE EXCEPTION 'orchestrator_cpcf_immutable';
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM orchestrator_campaign_provider_challenges c
           WHERE c.tenant_id = NEW.tenant_id
             AND c.id = NEW.challenge_id
             AND c.status = 'open'
             AND c.consumed_at IS NULL
             AND c.draft_id = NEW.draft_id
             AND c.revision = NEW.revision
             AND c.publish_approval_id = NEW.publish_approval_id
             AND c.workflow_approval_id = NEW.workflow_approval_id
             AND c.publishing_request_id = NEW.publishing_request_id
             AND c.intent_id = NEW.intent_id
             AND c.outbox_id = NEW.outbox_id
             AND c.attempt_id = NEW.attempt_id
             AND c.credential_ref_id = NEW.credential_ref_id
             AND c.generation = NEW.generation
             AND c.contract_hash = NEW.contract_hash
             AND c.snapshot_hash = NEW.snapshot_hash
             AND c.intent_hash = NEW.intent_hash
             AND c.request_hash = NEW.request_hash
             AND c.claim_token_hash = NEW.claim_token_hash
             AND c.contract_version = NEW.contract_version
             AND c.operation = NEW.operation
             AND c.platform = NEW.platform
             AND c.phrase_salt = NEW.phrase_salt
        ) THEN
          RAISE EXCEPTION 'orchestrator_cpcf_binding';
        END IF;
        RETURN NEW;
      END IF;
      IF TG_OP = 'UPDATE' THEN
        IF OLD.status IS DISTINCT FROM 'confirmed'
           OR NEW.status IS DISTINCT FROM 'spent'
           OR NEW.spent_at IS NULL
           OR NEW.id IS DISTINCT FROM OLD.id
           OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
           OR NEW.challenge_id IS DISTINCT FROM OLD.challenge_id
           OR NEW.draft_id IS DISTINCT FROM OLD.draft_id
           OR NEW.revision IS DISTINCT FROM OLD.revision
           OR NEW.publish_approval_id IS DISTINCT FROM OLD.publish_approval_id
           OR NEW.workflow_approval_id IS DISTINCT FROM OLD.workflow_approval_id
           OR NEW.publishing_request_id IS DISTINCT FROM OLD.publishing_request_id
           OR NEW.intent_id IS DISTINCT FROM OLD.intent_id
           OR NEW.outbox_id IS DISTINCT FROM OLD.outbox_id
           OR NEW.attempt_id IS DISTINCT FROM OLD.attempt_id
           OR NEW.credential_ref_id IS DISTINCT FROM OLD.credential_ref_id
           OR NEW.generation IS DISTINCT FROM OLD.generation
           OR NEW.contract_hash IS DISTINCT FROM OLD.contract_hash
           OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash
           OR NEW.intent_hash IS DISTINCT FROM OLD.intent_hash
           OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
           OR NEW.claim_token_hash IS DISTINCT FROM OLD.claim_token_hash
           OR NEW.contract_version IS DISTINCT FROM OLD.contract_version
           OR NEW.operation IS DISTINCT FROM OLD.operation
           OR NEW.platform IS DISTINCT FROM OLD.platform
           OR NEW.phrase_salt IS DISTINCT FROM OLD.phrase_salt
           OR NEW.phrase_digest IS DISTINCT FROM OLD.phrase_digest
           OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
           OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
           OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
           OR NEW.created_at IS DISTINCT FROM OLD.created_at
           OR OLD.spent_at IS NOT NULL
        THEN
          RAISE EXCEPTION 'orchestrator_cpcf_immutable';
        END IF;
        RETURN NEW;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = OLD.tenant_id) THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'orchestrator_cpcf_immutable';
    END;
    $fn$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS orchestrator_cpcf_guard ON orchestrator_campaign_provider_confirmations;
    CREATE TRIGGER orchestrator_cpcf_guard
      BEFORE INSERT OR UPDATE OR DELETE ON orchestrator_campaign_provider_confirmations
      FOR EACH ROW
      EXECUTE FUNCTION orchestrator_cpcf_guard();
  `);

  // PR 6F-1 — one synchronous bounded Meta paused-draft execution per confirmation.
  // Stores outcome metadata only; provider object ids live in the append-only
  // objects ledger. No credentials, tokens, account ids, or raw payloads.
  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_campaign_provider_draft_executions (
      id TEXT NOT NULL,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      confirmation_id TEXT NOT NULL,
      challenge_id TEXT NOT NULL,
      draft_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      publish_approval_id TEXT NOT NULL,
      workflow_approval_id INTEGER NOT NULL,
      publishing_request_id TEXT NOT NULL,
      intent_id TEXT NOT NULL,
      outbox_id TEXT NOT NULL,
      attempt_id TEXT NOT NULL,
      credential_ref_id TEXT NOT NULL,
      credential_ref_version INTEGER NOT NULL,
      account_fingerprint TEXT NOT NULL,
      generation INTEGER NOT NULL,
      contract_hash TEXT NOT NULL,
      snapshot_hash TEXT NOT NULL,
      intent_hash TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      claim_token_hash TEXT NOT NULL,
      contract_version TEXT NOT NULL DEFAULT 'campaign_delivery_v1',
      operation TEXT NOT NULL DEFAULT 'create_provider_draft',
      platform TEXT NOT NULL DEFAULT 'meta',
      connector TEXT NOT NULL DEFAULT 'meta',
      status TEXT NOT NULL DEFAULT 'started',
      outcome TEXT NULL,
      error_code TEXT NULL,
      objects_created INTEGER NOT NULL DEFAULT 0,
      objects_compensated INTEGER NOT NULL DEFAULT 0,
      simulated BOOLEAN NOT NULL DEFAULT FALSE,
      published BOOLEAN NOT NULL DEFAULT FALSE,
      external_action_taken BOOLEAN NOT NULL DEFAULT FALSE,
      idempotency_key TEXT NOT NULL,
      requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      settled_at TIMESTAMPTZ NULL,
      PRIMARY KEY (tenant_id, id),
      CONSTRAINT orchestrator_cpdex_tenant_unique_confirmation
        UNIQUE (tenant_id, confirmation_id),
      CONSTRAINT orchestrator_cpdex_tenant_unique_idemp
        UNIQUE (tenant_id, idempotency_key),
      CONSTRAINT orchestrator_cpdex_status_check CHECK (
        status IN ('started','complete','partial','failed')
      ),
      CONSTRAINT orchestrator_cpdex_outcome_check CHECK (
        outcome IS NULL OR outcome IN ('complete','partial','failed')
      ),
      CONSTRAINT orchestrator_cpdex_frozen_check CHECK (
        contract_version = 'campaign_delivery_v1'
        AND operation = 'create_provider_draft'
        AND platform = 'meta'
        AND connector = 'meta'
      ),
      CONSTRAINT orchestrator_cpdex_sim_check CHECK (
        simulated = FALSE AND published = FALSE
      ),
      CONSTRAINT orchestrator_cpdex_terminal_check CHECK (
        (status = 'started' AND settled_at IS NULL AND outcome IS NULL
          AND error_code IS NULL)
        OR (status <> 'started' AND settled_at IS NOT NULL AND outcome IS NOT NULL)
      ),
      CONSTRAINT orchestrator_cpdex_objects_check CHECK (
        objects_created >= 0 AND objects_compensated >= 0
        AND objects_compensated <= objects_created
      ),
      CONSTRAINT orchestrator_cpdex_error_code_check CHECK (
        error_code IS NULL OR error_code ~ '^[a-z0-9_]{1,40}$'
      ),
      CONSTRAINT orchestrator_cpdex_complete_cardinality_check CHECK (
        status <> 'complete'
        OR (outcome = 'complete' AND objects_created = 4 AND objects_compensated = 0)
      ),
      CONSTRAINT orchestrator_cpdex_cred_ver_check CHECK (credential_ref_version >= 1),
      CONSTRAINT orchestrator_cpdex_account_fp_check CHECK (
        char_length(account_fingerprint)=64 AND account_fingerprint ~ '^[0-9a-f]{64}$'
      ),
      CONSTRAINT orchestrator_cpdex_len_check CHECK (
        char_length(id) BETWEEN 1 AND 128
        AND char_length(confirmation_id) BETWEEN 1 AND 128
        AND char_length(challenge_id) BETWEEN 1 AND 128
        AND char_length(draft_id) BETWEEN 1 AND 128
        AND char_length(publish_approval_id) BETWEEN 1 AND 128
        AND char_length(publishing_request_id) BETWEEN 1 AND 128
        AND char_length(intent_id) BETWEEN 1 AND 128
        AND char_length(outbox_id) BETWEEN 1 AND 128
        AND char_length(attempt_id) BETWEEN 1 AND 128
        AND char_length(credential_ref_id) BETWEEN 1 AND 128
        AND char_length(idempotency_key) BETWEEN 1 AND 256
      )
    );
  `);
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_draft_executions',
    'orchestrator_cpdex_tenant_confirmation_fkey',
    'tenant_id, confirmation_id', 'orchestrator_campaign_provider_confirmations',
    'tenant_id, id', 'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_draft_executions',
    'orchestrator_cpdex_tenant_attempt_fkey',
    'tenant_id, attempt_id', 'orchestrator_campaign_delivery_attempts',
    'tenant_id, id', 'ON DELETE CASCADE');
  await p.query(`CREATE INDEX IF NOT EXISTS idx_cpdex_tenant_attempt
    ON orchestrator_campaign_provider_draft_executions (tenant_id, attempt_id)`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_campaign_provider_objects (
      id TEXT NOT NULL,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      execution_id TEXT NOT NULL,
      confirmation_id TEXT NOT NULL,
      attempt_id TEXT NOT NULL,
      publishing_request_id TEXT NOT NULL,
      intent_id TEXT NOT NULL,
      snapshot_hash TEXT NOT NULL,
      account_fingerprint TEXT NOT NULL,
      object_kind TEXT NOT NULL,
      provider_object_id TEXT NOT NULL,
      provider_object_id_digest TEXT NOT NULL,
      display_ref TEXT NOT NULL,
      parent_campaign_digest TEXT NULL,
      parent_adset_digest TEXT NULL,
      parent_creative_digest TEXT NULL,
      provider_status TEXT NOT NULL DEFAULT 'PAUSED',
      sequence_number INTEGER NOT NULL,
      compensated BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      compensated_at TIMESTAMPTZ NULL,
      PRIMARY KEY (tenant_id, id),
      CONSTRAINT orchestrator_cpo_tenant_execution_seq
        UNIQUE (tenant_id, execution_id, sequence_number),
      CONSTRAINT orchestrator_cpo_tenant_execution_kind
        UNIQUE (tenant_id, execution_id, object_kind),
      CONSTRAINT orchestrator_cpo_tenant_execution_digest
        UNIQUE (tenant_id, execution_id, provider_object_id_digest),
      CONSTRAINT orchestrator_cpo_tenant_account_digest
        UNIQUE (tenant_id, account_fingerprint, provider_object_id_digest),
      CONSTRAINT orchestrator_cpo_kind_check CHECK (
        object_kind IN ('campaign','adset','creative','ad')
      ),
      CONSTRAINT orchestrator_cpo_status_check CHECK (provider_status = 'PAUSED'),
      CONSTRAINT orchestrator_cpo_seq_check CHECK (
        sequence_number >= 1 AND sequence_number <= 4
      ),
      CONSTRAINT orchestrator_cpo_compensate_check CHECK (
        (compensated = FALSE AND compensated_at IS NULL)
        OR (compensated = TRUE AND compensated_at IS NOT NULL)
      ),
      CONSTRAINT orchestrator_cpo_digest_check CHECK (
        char_length(provider_object_id_digest)=64
        AND provider_object_id_digest ~ '^[0-9a-f]{64}$'
        AND char_length(display_ref)=12
        AND display_ref = substr(provider_object_id_digest, 1, 12)
      ),
      CONSTRAINT orchestrator_cpo_account_fp_check CHECK (
        char_length(account_fingerprint)=64 AND account_fingerprint ~ '^[0-9a-f]{64}$'
      ),
      CONSTRAINT orchestrator_cpo_snapshot_hash_check CHECK (
        char_length(snapshot_hash)=64 AND snapshot_hash ~ '^[0-9a-f]{64}$'
      ),
      CONSTRAINT orchestrator_cpo_parent_lineage_check CHECK (
        (object_kind = 'campaign'
          AND parent_campaign_digest IS NULL
          AND parent_adset_digest IS NULL
          AND parent_creative_digest IS NULL)
        OR (object_kind = 'adset'
          AND parent_campaign_digest IS NOT NULL
          AND parent_adset_digest IS NULL
          AND parent_creative_digest IS NULL
          AND char_length(parent_campaign_digest)=64
          AND parent_campaign_digest ~ '^[0-9a-f]{64}$')
        OR (object_kind = 'creative'
          AND parent_campaign_digest IS NOT NULL
          AND parent_adset_digest IS NULL
          AND parent_creative_digest IS NULL
          AND char_length(parent_campaign_digest)=64
          AND parent_campaign_digest ~ '^[0-9a-f]{64}$')
        OR (object_kind = 'ad'
          AND parent_campaign_digest IS NOT NULL
          AND parent_adset_digest IS NOT NULL
          AND parent_creative_digest IS NOT NULL
          AND char_length(parent_campaign_digest)=64
          AND char_length(parent_adset_digest)=64
          AND char_length(parent_creative_digest)=64
          AND parent_campaign_digest ~ '^[0-9a-f]{64}$'
          AND parent_adset_digest ~ '^[0-9a-f]{64}$'
          AND parent_creative_digest ~ '^[0-9a-f]{64}$')
      ),
      CONSTRAINT orchestrator_cpo_len_check CHECK (
        char_length(id) BETWEEN 1 AND 128
        AND char_length(execution_id) BETWEEN 1 AND 128
        AND char_length(confirmation_id) BETWEEN 1 AND 128
        AND char_length(attempt_id) BETWEEN 1 AND 128
        AND char_length(publishing_request_id) BETWEEN 1 AND 128
        AND char_length(intent_id) BETWEEN 1 AND 128
        AND char_length(provider_object_id) BETWEEN 1 AND 128
        AND char_length(object_kind) BETWEEN 1 AND 32
      )
    );
  `);
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_objects',
    'orchestrator_cpo_tenant_execution_fkey',
    'tenant_id, execution_id', 'orchestrator_campaign_provider_draft_executions',
    'tenant_id, id', 'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_objects',
    'orchestrator_cpo_tenant_confirmation_fkey',
    'tenant_id, confirmation_id', 'orchestrator_campaign_provider_confirmations',
    'tenant_id, id', 'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_objects',
    'orchestrator_cpo_tenant_attempt_fkey',
    'tenant_id, attempt_id', 'orchestrator_campaign_delivery_attempts',
    'tenant_id, id', 'ON DELETE CASCADE');
  await p.query(`CREATE INDEX IF NOT EXISTS idx_cpo_tenant_execution
    ON orchestrator_campaign_provider_objects (tenant_id, execution_id, sequence_number)`);

  // PR 6F-1R — one-transaction upgrade (DROP old guards → ADD/backfill/SET NOT
  // NULL → constraints if absent → events → new guards). Other sessions keep
  // the old triggers until COMMIT. Post-upgrade helpers below re-ensure
  // idempotently in their own transactions and must not run inside the TX.
  await _upgradePr6f1rProviderLineage(p);

  await _ensureNamedCheck(p, 'orchestrator_campaign_provider_draft_executions',
    'orchestrator_cpdex_complete_cardinality_check',
    `status <> 'complete'
     OR (outcome = 'complete' AND objects_created = 4 AND objects_compensated = 0)`,
    { notValid: true });
  await _ensureNamedCheck(p, 'orchestrator_campaign_provider_draft_executions',
    'orchestrator_cpdex_cred_ver_check', `credential_ref_version >= 1`, { notValid: true });
  await _ensureNamedCheck(p, 'orchestrator_campaign_provider_draft_executions',
    'orchestrator_cpdex_account_fp_check',
    `char_length(account_fingerprint)=64 AND account_fingerprint ~ '^[0-9a-f]{64}$'`,
    { notValid: true });
  await _ensureNamedUnique(p, 'orchestrator_campaign_provider_draft_executions',
    'orchestrator_cpdex_tenant_unique_id_fp', 'tenant_id, id, account_fingerprint');
  await _ensureNamedUnique(p, 'orchestrator_campaign_provider_draft_executions',
    'orchestrator_cpdex_tenant_unique_id_snap', 'tenant_id, id, snapshot_hash');
  await _ensureNamedUnique(p, 'orchestrator_campaign_provider_draft_executions',
    'orchestrator_cpdex_tenant_unique_id_pubreq', 'tenant_id, id, publishing_request_id');
  await _ensureNamedUnique(p, 'orchestrator_campaign_provider_draft_executions',
    'orchestrator_cpdex_tenant_unique_id_intent', 'tenant_id, id, intent_id');

  await _ensureNamedUnique(p, 'orchestrator_campaign_provider_objects',
    'orchestrator_cpo_tenant_execution_kind', 'tenant_id, execution_id, object_kind');
  await _ensureNamedUnique(p, 'orchestrator_campaign_provider_objects',
    'orchestrator_cpo_tenant_execution_digest', 'tenant_id, execution_id, provider_object_id_digest');
  await _ensureNamedUnique(p, 'orchestrator_campaign_provider_objects',
    'orchestrator_cpo_tenant_account_digest', 'tenant_id, account_fingerprint, provider_object_id_digest');
  await _ensureNamedCheck(p, 'orchestrator_campaign_provider_objects',
    'orchestrator_cpo_digest_check',
    `char_length(provider_object_id_digest)=64
     AND provider_object_id_digest ~ '^[0-9a-f]{64}$'
     AND char_length(display_ref)=12
     AND display_ref = substr(provider_object_id_digest, 1, 12)`,
    { notValid: true });
  await _ensureNamedCheck(p, 'orchestrator_campaign_provider_objects',
    'orchestrator_cpo_account_fp_check',
    `char_length(account_fingerprint)=64 AND account_fingerprint ~ '^[0-9a-f]{64}$'`,
    { notValid: true });
  await _ensureNamedCheck(p, 'orchestrator_campaign_provider_objects',
    'orchestrator_cpo_snapshot_hash_check',
    `char_length(snapshot_hash)=64 AND snapshot_hash ~ '^[0-9a-f]{64}$'`,
    { notValid: true });
  await _ensureNamedCheck(p, 'orchestrator_campaign_provider_objects',
    'orchestrator_cpo_parent_lineage_check',
    `(object_kind = 'campaign'
       AND parent_campaign_digest IS NULL
       AND parent_adset_digest IS NULL
       AND parent_creative_digest IS NULL)
     OR (object_kind = 'adset'
       AND parent_campaign_digest IS NOT NULL
       AND parent_adset_digest IS NULL
       AND parent_creative_digest IS NULL
       AND char_length(parent_campaign_digest)=64
       AND parent_campaign_digest ~ '^[0-9a-f]{64}$')
     OR (object_kind = 'creative'
       AND parent_campaign_digest IS NOT NULL
       AND parent_adset_digest IS NULL
       AND parent_creative_digest IS NULL
       AND char_length(parent_campaign_digest)=64
       AND parent_campaign_digest ~ '^[0-9a-f]{64}$')
     OR (object_kind = 'ad'
       AND parent_campaign_digest IS NOT NULL
       AND parent_adset_digest IS NOT NULL
       AND parent_creative_digest IS NOT NULL
       AND char_length(parent_campaign_digest)=64
       AND char_length(parent_adset_digest)=64
       AND char_length(parent_creative_digest)=64
       AND parent_campaign_digest ~ '^[0-9a-f]{64}$'
       AND parent_adset_digest ~ '^[0-9a-f]{64}$'
       AND parent_creative_digest ~ '^[0-9a-f]{64}$')`,
    { notValid: true });
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_objects',
    'orchestrator_cpo_tenant_pub_req_fkey',
    'tenant_id, publishing_request_id', 'orchestrator_campaign_publish_requests',
    'tenant_id, id', 'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_objects',
    'orchestrator_cpo_tenant_intent_fkey',
    'tenant_id, intent_id', 'orchestrator_campaign_delivery_intents',
    'tenant_id, id', 'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_objects',
    'orchestrator_cpo_tenant_exec_fp_fkey',
    'tenant_id, execution_id, account_fingerprint',
    'orchestrator_campaign_provider_draft_executions',
    'tenant_id, id, account_fingerprint', 'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_objects',
    'orchestrator_cpo_tenant_exec_snap_fkey',
    'tenant_id, execution_id, snapshot_hash',
    'orchestrator_campaign_provider_draft_executions',
    'tenant_id, id, snapshot_hash', 'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_objects',
    'orchestrator_cpo_tenant_exec_pubreq_fkey',
    'tenant_id, execution_id, publishing_request_id',
    'orchestrator_campaign_provider_draft_executions',
    'tenant_id, id, publishing_request_id', 'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_objects',
    'orchestrator_cpo_tenant_exec_intent_fkey',
    'tenant_id, execution_id, intent_id',
    'orchestrator_campaign_provider_draft_executions',
    'tenant_id, id, intent_id', 'ON DELETE CASCADE');

  await _ensureNamedFk(p, 'orchestrator_campaign_provider_object_events',
    'orchestrator_cpoe_tenant_object_fkey',
    'tenant_id, object_id', 'orchestrator_campaign_provider_objects',
    'tenant_id, id', 'ON DELETE CASCADE');
  await _ensureNamedFk(p, 'orchestrator_campaign_provider_object_events',
    'orchestrator_cpoe_tenant_execution_fkey',
    'tenant_id, execution_id', 'orchestrator_campaign_provider_draft_executions',
    'tenant_id, id', 'ON DELETE CASCADE');

  for (const t of ADVERTISING_ORCH_TABLES) {
    try { await addTenantIdColumn(t); } catch (_) { /* idempotent */ }
  }
  return true;
}

module.exports = {
  ensureAgentOrchestratorSchema,
  identifyLegacyResearchCleanup,
  _tryAdvisoryLockUntil,
};
