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
  // PR 6F-1R2 — consume-once authorization metadata for one bounded GET-only
  // reconciliation observation. Contains no provider ids or credential material.
  'orchestrator_campaign_reconciliation_read_authorizations',
  'orchestrator_campaign_reconciliation_runs',
  // PR 6F-3 — authoritative human review case plus append-only decisions.
  'orchestrator_campaign_reconciliation_review_cases',
  'orchestrator_campaign_reconciliation_review_events',
  // PR 6F-4 — immutable closed-review to fresh authorization/run provenance.
  'orchestrator_campaign_reconciliation_rereconciliation_attempts',
  // PR 7A — consume-once human Meta activation capability. This is only an
  // authorization record; it cannot call a provider or change object status.
  'orchestrator_campaign_activation_capabilities',
  'orchestrator_campaign_activation_attempts',
  'orchestrator_campaign_activation_events',
  // PR 7C — bounded, GET-only post-activation observations.
  'orchestrator_campaign_monitoring_runs',
  // PR 7D — human operational disposition of eligible terminal monitoring.
  'orchestrator_campaign_delivery_discrepancy_cases',
  'orchestrator_campaign_delivery_discrepancy_events',
  // PR 8B — human-controlled, internal-only optimization execution plans.
  'orchestrator_optimization_execution_requests',
  'orchestrator_optimization_execution_events',
  // PR 8C admission controls. These do not authorize provider mutation.
  // orchestrator_advertising_global_kill_switches is a platform-wide GLOBAL
  // singleton (PK switch_key, no tenant_id). Do not list it here — that would
  // re-inject a nullable tenant_id via addTenantIdColumn. Companion
  // orchestrator_advertising_tenant_kill_switches stays tenant-scoped.
  'orchestrator_advertising_tenant_kill_switches',
  // PR10A — metadata-only Google Ads authority. These rows contain no OAuth
  // material, provider payload, raw customer id, or external side effect.
  'orchestrator_tenant_google_ads_credential_refs',
  'orchestrator_google_ads_provider_draft_capabilities',
  // PR10B.1 — metadata-only Google Ads provider-operation ledger (no mutation).
  'orchestrator_google_ads_provider_draft_operations',
  // PR10B.2a — append-only PAUSED provider-object evidence for those operations.
  'orchestrator_google_ads_provider_draft_objects',
  // PR10C.1 — tenant-leading Google Ads reconciliation read-authorizations.
  'orchestrator_google_ads_reconciliation_read_authorizations',
  // PR10C.2 — sanitized, durable Google Ads reconciliation outcomes.
  'orchestrator_google_ads_reconciliation_runs',
  // PR 8C — synchronous internal-simulation runs and their distinct lifecycle.
  'orchestrator_optimization_executions',
  'orchestrator_optimization_execution_run_events',
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
  await _ensureNamedUnique(p, 'orchestrator_campaign_drafts',
    'orchestrator_campaign_drafts_tenant_unique_id_workflow',
    'tenant_id, id, workflow_id');

  // PR 6F-1R2 — immutable, tenant-leading authorization for exactly one
  // invocation over a complete PR 6F-1R execution graph. Issuance validates
  // the four-object lineage in the service; row locking makes reservation and
  // consumption atomic before either vault access or provider egress.
  await p.query('BEGIN');
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS orchestrator_campaign_reconciliation_read_authorizations (
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        nonce_hash TEXT NOT NULL,
        requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        workflow_id TEXT NOT NULL,
        draft_id TEXT NOT NULL,
        publishing_request_id TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        snapshot_hash TEXT NOT NULL,
        intent_id TEXT NOT NULL,
        intent_hash TEXT NOT NULL,
        credential_ref_id TEXT NOT NULL,
        credential_ref_version INTEGER NOT NULL,
        account_fingerprint TEXT NOT NULL,
        ledger_root_hash TEXT NOT NULL,
        credential_owner_user_id INTEGER NULL REFERENCES users(id) ON DELETE RESTRICT,
        purpose TEXT NOT NULL DEFAULT 'initial',
        review_case_id TEXT NULL,
        review_version INTEGER NULL,
        closure_event_id BIGINT NULL,
        expected_object_kinds TEXT[] NOT NULL
          DEFAULT ARRAY['campaign','adset','creative','ad']::TEXT[],
        status TEXT NOT NULL DEFAULT 'issued',
        invocation_id_hash TEXT NULL,
        issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        reserved_at TIMESTAMPTZ NULL,
        consumed_at TIMESTAMPTZ NULL,
        revoked_at TIMESTAMPTZ NULL,
        PRIMARY KEY (tenant_id, id),
        UNIQUE (tenant_id, nonce_hash),
        CONSTRAINT orchestrator_crra_workflow_fkey
          FOREIGN KEY (tenant_id, workflow_id)
          REFERENCES orchestrator_workflows (tenant_id, id)
          ON DELETE CASCADE,
        CONSTRAINT orchestrator_crra_draft_workflow_fkey
          FOREIGN KEY (tenant_id, draft_id, workflow_id)
          REFERENCES orchestrator_campaign_drafts (tenant_id, id, workflow_id)
          ON DELETE CASCADE,
        CONSTRAINT orchestrator_crra_execution_account_fkey
          FOREIGN KEY (tenant_id, execution_id, account_fingerprint)
          REFERENCES orchestrator_campaign_provider_draft_executions
            (tenant_id, id, account_fingerprint)
          ON DELETE CASCADE,
        CONSTRAINT orchestrator_crra_execution_snapshot_fkey
          FOREIGN KEY (tenant_id, execution_id, snapshot_hash)
          REFERENCES orchestrator_campaign_provider_draft_executions
            (tenant_id, id, snapshot_hash)
          ON DELETE CASCADE,
        CONSTRAINT orchestrator_crra_execution_request_fkey
          FOREIGN KEY (tenant_id, execution_id, publishing_request_id)
          REFERENCES orchestrator_campaign_provider_draft_executions
            (tenant_id, id, publishing_request_id)
          ON DELETE CASCADE,
        CONSTRAINT orchestrator_crra_execution_intent_fkey
          FOREIGN KEY (tenant_id, execution_id, intent_id)
          REFERENCES orchestrator_campaign_provider_draft_executions
            (tenant_id, id, intent_id)
          ON DELETE CASCADE,
        CONSTRAINT orchestrator_crra_request_fkey
          FOREIGN KEY (tenant_id, publishing_request_id)
          REFERENCES orchestrator_campaign_publish_requests(tenant_id, id)
          ON DELETE CASCADE,
        CONSTRAINT orchestrator_crra_intent_fkey
          FOREIGN KEY (tenant_id, intent_id)
          REFERENCES orchestrator_campaign_delivery_intents(tenant_id, id)
          ON DELETE CASCADE,
        CONSTRAINT orchestrator_crra_status_check
          CHECK (status IN ('issued','reserved','consumed','revoked','expired')),
        CONSTRAINT orchestrator_crra_purpose_check CHECK (
          (purpose = 'initial' AND review_case_id IS NULL AND review_version IS NULL
            AND closure_event_id IS NULL)
          OR (purpose = 'post_review' AND review_case_id IS NOT NULL AND review_version >= 1
            AND closure_event_id IS NOT NULL AND credential_owner_user_id IS NOT NULL)),
        CONSTRAINT orchestrator_crra_kinds_check CHECK (
          expected_object_kinds = ARRAY['campaign','adset','creative','ad']::TEXT[]),
        CONSTRAINT orchestrator_crra_hashes_check CHECK (
          nonce_hash ~ '^[0-9a-f]{64}$'
          AND snapshot_hash ~ '^[0-9a-f]{64}$'
          AND intent_hash ~ '^[0-9a-f]{64}$'
          AND account_fingerprint ~ '^[0-9a-f]{64}$'
          AND ledger_root_hash ~ '^[0-9a-f]{64}$'),
        CONSTRAINT orchestrator_crra_lifecycle_check CHECK (
          expires_at > issued_at
          AND ((status = 'issued' AND invocation_id_hash IS NULL
                AND reserved_at IS NULL AND consumed_at IS NULL
                AND revoked_at IS NULL)
            OR (status = 'reserved' AND invocation_id_hash ~ '^[0-9a-f]{64}$'
                AND reserved_at IS NOT NULL AND consumed_at IS NULL
                AND revoked_at IS NULL)
            OR (status = 'consumed' AND invocation_id_hash ~ '^[0-9a-f]{64}$'
                AND reserved_at IS NOT NULL AND consumed_at IS NOT NULL
                AND revoked_at IS NULL)
            OR (status = 'revoked' AND consumed_at IS NULL
                AND revoked_at IS NOT NULL)
            OR (status = 'expired' AND consumed_at IS NULL
                AND revoked_at IS NULL)))
      );

      CREATE OR REPLACE FUNCTION orchestrator_crra_guard() RETURNS trigger AS $fn$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          IF NEW.credential_owner_user_id IS NULL AND NEW.purpose = 'initial' THEN
            NEW.credential_owner_user_id := NEW.requested_by;
          END IF;
          RETURN NEW;
        END IF;
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'orchestrator_crra_immutable';
        END IF;
        IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
           OR NEW.id IS DISTINCT FROM OLD.id
           OR NEW.nonce_hash IS DISTINCT FROM OLD.nonce_hash
           OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
           OR NEW.workflow_id IS DISTINCT FROM OLD.workflow_id
           OR NEW.draft_id IS DISTINCT FROM OLD.draft_id
           OR NEW.publishing_request_id IS DISTINCT FROM OLD.publishing_request_id
           OR NEW.execution_id IS DISTINCT FROM OLD.execution_id
           OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash
           OR NEW.intent_id IS DISTINCT FROM OLD.intent_id
           OR NEW.intent_hash IS DISTINCT FROM OLD.intent_hash
           OR NEW.credential_ref_id IS DISTINCT FROM OLD.credential_ref_id
           OR NEW.credential_ref_version IS DISTINCT FROM OLD.credential_ref_version
           OR NEW.account_fingerprint IS DISTINCT FROM OLD.account_fingerprint
           OR NEW.ledger_root_hash IS DISTINCT FROM OLD.ledger_root_hash
           OR NEW.credential_owner_user_id IS DISTINCT FROM OLD.credential_owner_user_id
           OR NEW.purpose IS DISTINCT FROM OLD.purpose
           OR NEW.review_case_id IS DISTINCT FROM OLD.review_case_id
           OR NEW.review_version IS DISTINCT FROM OLD.review_version
           OR NEW.closure_event_id IS DISTINCT FROM OLD.closure_event_id
           OR NEW.expected_object_kinds IS DISTINCT FROM OLD.expected_object_kinds
           OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
           OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
          RAISE EXCEPTION 'orchestrator_crra_immutable_binding';
        END IF;
        IF NOT ((OLD.status = 'issued' AND NEW.status IN ('reserved','revoked','expired'))
             OR (OLD.status = 'reserved' AND NEW.status IN ('consumed','revoked','expired'))) THEN
          RAISE EXCEPTION 'orchestrator_crra_invalid_transition';
        END IF;
        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS orchestrator_crra_guard
        ON orchestrator_campaign_reconciliation_read_authorizations;
      CREATE TRIGGER orchestrator_crra_guard
        BEFORE INSERT OR UPDATE OR DELETE
        ON orchestrator_campaign_reconciliation_read_authorizations
        FOR EACH ROW EXECUTE FUNCTION orchestrator_crra_guard();
    `);
    await p.query('COMMIT');
  } catch (e) {
    try { await p.query('ROLLBACK'); } catch (_) { /* already aborted */ }
    throw e;
  }

  // Existing installations predate authorization purposes. Additive columns
  // preserve every original row as an initial authorization.
  await p.query(`ALTER TABLE orchestrator_campaign_reconciliation_read_authorizations
    ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'initial',
    ADD COLUMN IF NOT EXISTS review_case_id TEXT NULL,
    ADD COLUMN IF NOT EXISTS review_version INTEGER NULL,
    ADD COLUMN IF NOT EXISTS closure_event_id BIGINT NULL,
    ADD COLUMN IF NOT EXISTS credential_owner_user_id INTEGER NULL REFERENCES users(id) ON DELETE RESTRICT`);
  // Legacy initial-authorization fixtures and rows may omit the derived owner;
  // the post-review purpose check requires it and new issuance always writes it.
  await p.query(`ALTER TABLE orchestrator_campaign_reconciliation_read_authorizations
    ALTER COLUMN credential_owner_user_id DROP NOT NULL`);
  // PR 6F-1R2 allowed one authorization for an execution/ledger forever. PR
  // 6F-4 narrows that invariant to initial issuance so one fresh post-review
  // authorization can be issued without resetting or reusing the consumed row.
  await p.query(`DO $do$ DECLARE c RECORD; BEGIN
    FOR c IN SELECT conname FROM pg_constraint
      WHERE conrelid='orchestrator_campaign_reconciliation_read_authorizations'::regclass
        AND contype='u'
        AND pg_get_constraintdef(oid) = 'UNIQUE (tenant_id, execution_id, ledger_root_hash)'
    LOOP EXECUTE format('ALTER TABLE orchestrator_campaign_reconciliation_read_authorizations DROP CONSTRAINT %I', c.conname); END LOOP;
  END $do$`);
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_crra_initial_execution_ledger_unique
    ON orchestrator_campaign_reconciliation_read_authorizations(tenant_id,execution_id,ledger_root_hash)
    WHERE purpose='initial'`);
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_crra_post_review_case_version_unique
    ON orchestrator_campaign_reconciliation_read_authorizations(tenant_id,review_case_id,review_version)
    WHERE purpose='post_review'`);
  await _ensureNamedCheck(p, 'orchestrator_campaign_reconciliation_read_authorizations',
    'orchestrator_crra_purpose_check',
    `((purpose = 'initial' AND review_case_id IS NULL AND review_version IS NULL
        AND closure_event_id IS NULL)
      OR (purpose = 'post_review' AND review_case_id IS NOT NULL AND review_version >= 1
        AND closure_event_id IS NOT NULL AND credential_owner_user_id IS NOT NULL))`, { notValid: true });

  // PR 6F-2 — sanitized outcome of exactly one consume-once reconciliation.
  // Provider IDs and raw provider responses never enter this table.
  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_campaign_reconciliation_runs (
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      authorization_id TEXT NOT NULL,
      invocation_id_hash TEXT NOT NULL,
      requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      workflow_id TEXT NOT NULL,
      draft_id TEXT NOT NULL,
      publishing_request_id TEXT NOT NULL,
      execution_id TEXT NOT NULL,
      snapshot_hash TEXT NOT NULL,
      intent_id TEXT NOT NULL,
      intent_hash TEXT NOT NULL,
      credential_ref_id TEXT NOT NULL,
      credential_ref_version INTEGER NOT NULL,
      account_fingerprint TEXT NOT NULL,
      ledger_root_hash TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending',
      observations JSONB NOT NULL DEFAULT '[]'::jsonb,
      classifications TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      audit_ref TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      observing_at TIMESTAMPTZ NULL,
      observation_deadline TIMESTAMPTZ NULL,
      completed_at TIMESTAMPTZ NULL,
      PRIMARY KEY (tenant_id,id),
      UNIQUE (tenant_id,authorization_id),
      UNIQUE (tenant_id,invocation_id_hash),
      UNIQUE (tenant_id,audit_ref),
      FOREIGN KEY (tenant_id,authorization_id)
        REFERENCES orchestrator_campaign_reconciliation_read_authorizations(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_crr_state_check CHECK
        (state IN ('pending','observing','verified','discrepancy_detected','failed')),
      CONSTRAINT orchestrator_crr_hash_check CHECK
        (invocation_id_hash ~ '^[0-9a-f]{64}$' AND snapshot_hash ~ '^[0-9a-f]{64}$'
         AND intent_hash ~ '^[0-9a-f]{64}$' AND account_fingerprint ~ '^[0-9a-f]{64}$'
         AND ledger_root_hash ~ '^[0-9a-f]{64}$'),
      CONSTRAINT orchestrator_crr_observations_check CHECK
        (jsonb_typeof(observations)='array' AND jsonb_array_length(observations) <= 4),
      CONSTRAINT orchestrator_crr_lifecycle_check CHECK
        ((state='pending' AND observing_at IS NULL AND observation_deadline IS NULL AND completed_at IS NULL)
         OR (state='observing' AND observing_at IS NOT NULL AND observation_deadline > observing_at AND completed_at IS NULL)
         OR (state IN ('verified','discrepancy_detected','failed') AND observing_at IS NOT NULL
             AND observation_deadline > observing_at AND completed_at IS NOT NULL))
    );

    CREATE OR REPLACE FUNCTION orchestrator_crr_guard() RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP='DELETE' THEN RAISE EXCEPTION 'orchestrator_crr_immutable'; END IF;
      IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id
        OR NEW.authorization_id IS DISTINCT FROM OLD.authorization_id
        OR NEW.invocation_id_hash IS DISTINCT FROM OLD.invocation_id_hash
        OR NEW.requested_by IS DISTINCT FROM OLD.requested_by OR NEW.workflow_id IS DISTINCT FROM OLD.workflow_id
        OR NEW.draft_id IS DISTINCT FROM OLD.draft_id OR NEW.publishing_request_id IS DISTINCT FROM OLD.publishing_request_id
        OR NEW.execution_id IS DISTINCT FROM OLD.execution_id OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash
        OR NEW.intent_id IS DISTINCT FROM OLD.intent_id OR NEW.intent_hash IS DISTINCT FROM OLD.intent_hash
        OR NEW.credential_ref_id IS DISTINCT FROM OLD.credential_ref_id
        OR NEW.credential_ref_version IS DISTINCT FROM OLD.credential_ref_version
        OR NEW.account_fingerprint IS DISTINCT FROM OLD.account_fingerprint
        OR NEW.ledger_root_hash IS DISTINCT FROM OLD.ledger_root_hash OR NEW.audit_ref IS DISTINCT FROM OLD.audit_ref
        OR NEW.observation_deadline IS DISTINCT FROM OLD.observation_deadline
        OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'orchestrator_crr_immutable_binding';
      END IF;
      IF NOT ((OLD.state='pending' AND NEW.state IN ('observing','discrepancy_detected','failed'))
        OR (OLD.state='observing' AND NEW.state IN ('verified','discrepancy_detected','failed')))
        THEN RAISE EXCEPTION 'orchestrator_crr_invalid_transition'; END IF;
      RETURN NEW;
    END; $fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_crr_guard ON orchestrator_campaign_reconciliation_runs;
    CREATE TRIGGER orchestrator_crr_guard BEFORE UPDATE OR DELETE ON orchestrator_campaign_reconciliation_runs
      FOR EACH ROW EXECUTE FUNCTION orchestrator_crr_guard();
  `);
  await p.query(`ALTER TABLE orchestrator_campaign_reconciliation_runs
    ADD COLUMN IF NOT EXISTS observation_deadline TIMESTAMPTZ NULL`);
  await p.query('BEGIN');
  try {
    await p.query(`ALTER TABLE orchestrator_campaign_reconciliation_runs
      DROP CONSTRAINT IF EXISTS orchestrator_crr_lifecycle_check`);
    await p.query(`ALTER TABLE orchestrator_campaign_reconciliation_runs
      ADD CONSTRAINT orchestrator_crr_lifecycle_check CHECK
      ((state='pending' AND observing_at IS NULL AND observation_deadline IS NULL AND completed_at IS NULL)
       OR (state='observing' AND observing_at IS NOT NULL AND observation_deadline > observing_at AND completed_at IS NULL)
       OR (state IN ('verified','discrepancy_detected','failed') AND observing_at IS NOT NULL
           AND observation_deadline > observing_at AND completed_at IS NOT NULL)) NOT VALID`);
    await p.query('COMMIT');
  } catch (e) { try { await p.query('ROLLBACK'); } catch (_) {} throw e; }

  // PR 6F-3. Sensitive lineage is retained for integrity but is never selected
  // by the public projection. The reconciliation row remains immutable.
  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_campaign_reconciliation_review_cases (
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
      id TEXT NOT NULL,
      reconciliation_run_id TEXT NOT NULL,
      authorization_id TEXT NOT NULL,
      workflow_id TEXT NOT NULL,
      draft_id TEXT NOT NULL,
      publishing_request_id TEXT NOT NULL,
      snapshot_hash TEXT NOT NULL,
      intent_id TEXT NOT NULL,
      intent_hash TEXT NOT NULL,
      execution_id TEXT NOT NULL,
      credential_ref_id TEXT NOT NULL,
      credential_ref_version INTEGER NOT NULL,
      account_fingerprint TEXT NOT NULL,
      ledger_root_hash TEXT NOT NULL,
      original_state TEXT NOT NULL,
      original_classifications TEXT[] NOT NULL,
      original_requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      original_created_at TIMESTAMPTZ NOT NULL,
      original_completed_at TIMESTAMPTZ NOT NULL,
      state TEXT NOT NULL DEFAULT 'open',
      classification TEXT NULL,
      assigned_reviewer_id INTEGER NULL REFERENCES users(id) ON DELETE RESTRICT,
      note TEXT NULL,
      note_digest TEXT NULL,
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      acknowledged_at TIMESTAMPTZ NULL,
      escalated_at TIMESTAMPTZ NULL,
      closed_at TIMESTAMPTZ NULL,
      audit_ref TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (tenant_id,id),
      UNIQUE (tenant_id,reconciliation_run_id),
      UNIQUE (tenant_id,audit_ref),
      FOREIGN KEY (tenant_id,reconciliation_run_id)
        REFERENCES orchestrator_campaign_reconciliation_runs(tenant_id,id) ON DELETE RESTRICT,
      CHECK (original_state IN ('discrepancy_detected','failed')),
      CHECK (state IN ('open','acknowledged','escalated','closed')),
      CHECK (classification IS NULL OR classification IN
        ('provider_investigation_required','external_remediation_required','unexpected_activation','object_missing',
         'relationship_mismatch','account_mismatch','observation_failure','accepted_risk','false_positive','closed_unresolved')),
      CHECK (version >= 0), CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 1000),
      CHECK (note_digest IS NULL OR note_digest ~ '^[0-9a-f]{64}$'),
      CHECK ((state='open' AND acknowledged_at IS NULL AND escalated_at IS NULL AND closed_at IS NULL)
        OR (state='acknowledged' AND acknowledged_at IS NOT NULL AND escalated_at IS NULL AND closed_at IS NULL)
        OR (state='escalated' AND escalated_at IS NOT NULL AND closed_at IS NULL)
        OR (state='closed' AND closed_at IS NOT NULL))
    );
    CREATE TABLE IF NOT EXISTS orchestrator_campaign_reconciliation_review_events (
      tenant_id INTEGER NOT NULL,
      id BIGSERIAL,
      case_id TEXT NOT NULL,
      decision_id TEXT NOT NULL,
      from_state TEXT NULL,
      to_state TEXT NOT NULL,
      classification TEXT NULL,
      actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      note TEXT NULL,
      note_digest TEXT NULL,
      audit_ref TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id,id), UNIQUE (tenant_id,case_id,decision_id), UNIQUE (tenant_id,audit_ref),
      FOREIGN KEY (tenant_id,case_id)
        REFERENCES orchestrator_campaign_reconciliation_review_cases(tenant_id,id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS orchestrator_crrc_tenant_created
      ON orchestrator_campaign_reconciliation_review_cases(tenant_id,created_at DESC,id DESC);
    CREATE OR REPLACE FUNCTION orchestrator_crrc_guard() RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP='DELETE' THEN RAISE EXCEPTION 'orchestrator_crrc_delete_prohibited'; END IF;
      IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id
        OR NEW.reconciliation_run_id IS DISTINCT FROM OLD.reconciliation_run_id
        OR NEW.authorization_id IS DISTINCT FROM OLD.authorization_id OR NEW.workflow_id IS DISTINCT FROM OLD.workflow_id
        OR NEW.draft_id IS DISTINCT FROM OLD.draft_id OR NEW.publishing_request_id IS DISTINCT FROM OLD.publishing_request_id
        OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash OR NEW.intent_id IS DISTINCT FROM OLD.intent_id
        OR NEW.intent_hash IS DISTINCT FROM OLD.intent_hash
        OR NEW.execution_id IS DISTINCT FROM OLD.execution_id OR NEW.credential_ref_id IS DISTINCT FROM OLD.credential_ref_id
        OR NEW.credential_ref_version IS DISTINCT FROM OLD.credential_ref_version
        OR NEW.account_fingerprint IS DISTINCT FROM OLD.account_fingerprint OR NEW.ledger_root_hash IS DISTINCT FROM OLD.ledger_root_hash
        OR NEW.original_state IS DISTINCT FROM OLD.original_state
        OR NEW.original_classifications IS DISTINCT FROM OLD.original_classifications
        OR NEW.original_requested_by IS DISTINCT FROM OLD.original_requested_by
        OR NEW.original_created_at IS DISTINCT FROM OLD.original_created_at
        OR NEW.original_completed_at IS DISTINCT FROM OLD.original_completed_at
        OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at
        OR NEW.audit_ref IS DISTINCT FROM OLD.audit_ref OR NEW.version <> OLD.version + 1
        THEN RAISE EXCEPTION 'orchestrator_crrc_immutable_binding'; END IF;
      IF OLD.state='closed' OR NOT ((OLD.state='open' AND NEW.state IN ('acknowledged','escalated'))
        OR (OLD.state='acknowledged' AND NEW.state IN ('escalated','closed'))
        OR (OLD.state='escalated' AND NEW.state='closed'))
        THEN RAISE EXCEPTION 'orchestrator_crrc_invalid_transition'; END IF;
      RETURN NEW;
    END; $fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_crrc_guard ON orchestrator_campaign_reconciliation_review_cases;
    CREATE TRIGGER orchestrator_crrc_guard BEFORE UPDATE OR DELETE
      ON orchestrator_campaign_reconciliation_review_cases FOR EACH ROW EXECUTE FUNCTION orchestrator_crrc_guard();
    CREATE OR REPLACE FUNCTION orchestrator_crre_guard() RETURNS trigger AS $fn$
    BEGIN RAISE EXCEPTION 'orchestrator_crre_append_only'; END; $fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_crre_guard ON orchestrator_campaign_reconciliation_review_events;
    CREATE TRIGGER orchestrator_crre_guard BEFORE UPDATE OR DELETE
      ON orchestrator_campaign_reconciliation_review_events FOR EACH ROW EXECUTE FUNCTION orchestrator_crre_guard();
  `);

  // PR 6F-4 — one immutable re-reconciliation per exact closed review
  // version. This is provenance only: it cannot alter either the original run
  // or closed review, and every edge is tenant-leading and deletion-restricted.
  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_campaign_reconciliation_rereconciliation_attempts (
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
      id TEXT NOT NULL,
      review_case_id TEXT NOT NULL,
      review_version INTEGER NOT NULL,
      closure_event_id BIGINT NOT NULL,
      original_reconciliation_run_id TEXT NOT NULL,
      original_authorization_id TEXT NOT NULL,
      new_authorization_id TEXT NOT NULL,
      new_reconciliation_run_id TEXT NOT NULL,
      invocation_id_hash TEXT NOT NULL,
      initiated_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      audit_ref TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id,id),
      UNIQUE (tenant_id,review_case_id,review_version),
      UNIQUE (tenant_id,new_authorization_id),
      UNIQUE (tenant_id,new_reconciliation_run_id),
      UNIQUE (tenant_id,invocation_id_hash),
      UNIQUE (tenant_id,audit_ref),
      FOREIGN KEY (tenant_id,review_case_id)
        REFERENCES orchestrator_campaign_reconciliation_review_cases(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id,closure_event_id)
        REFERENCES orchestrator_campaign_reconciliation_review_events(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id,original_reconciliation_run_id)
        REFERENCES orchestrator_campaign_reconciliation_runs(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id,original_authorization_id)
        REFERENCES orchestrator_campaign_reconciliation_read_authorizations(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id,new_authorization_id)
        REFERENCES orchestrator_campaign_reconciliation_read_authorizations(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id,new_reconciliation_run_id)
        REFERENCES orchestrator_campaign_reconciliation_runs(tenant_id,id) ON DELETE RESTRICT,
      CHECK (review_version >= 1),
      CHECK (original_authorization_id <> new_authorization_id),
      CHECK (original_reconciliation_run_id <> new_reconciliation_run_id),
      CHECK (invocation_id_hash ~ '^[0-9a-f]{64}$')
    );
    CREATE INDEX IF NOT EXISTS orchestrator_crrra_tenant_created
      ON orchestrator_campaign_reconciliation_rereconciliation_attempts(tenant_id,created_at DESC,id DESC);

    CREATE OR REPLACE FUNCTION orchestrator_crrra_guard() RETURNS trigger AS $fn$
    DECLARE rc RECORD; ce RECORD; na RECORD; nr RECORD;
    BEGIN
      IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'orchestrator_crrra_immutable'; END IF;
      SELECT * INTO rc FROM orchestrator_campaign_reconciliation_review_cases
        WHERE tenant_id=NEW.tenant_id AND id=NEW.review_case_id FOR KEY SHARE;
      SELECT * INTO ce FROM orchestrator_campaign_reconciliation_review_events
        WHERE tenant_id=NEW.tenant_id AND id=NEW.closure_event_id;
      SELECT * INTO na FROM orchestrator_campaign_reconciliation_read_authorizations
        WHERE tenant_id=NEW.tenant_id AND id=NEW.new_authorization_id;
      SELECT * INTO nr FROM orchestrator_campaign_reconciliation_runs
        WHERE tenant_id=NEW.tenant_id AND id=NEW.new_reconciliation_run_id;
      IF rc.state <> 'closed' OR rc.version <> NEW.review_version
        OR rc.reconciliation_run_id <> NEW.original_reconciliation_run_id
        OR rc.authorization_id <> NEW.original_authorization_id
        OR ce.case_id <> NEW.review_case_id OR ce.to_state <> 'closed'
        OR ce.classification <> 'external_remediation_required'
        OR na.purpose <> 'post_review' OR na.review_case_id <> NEW.review_case_id
        OR na.review_version <> NEW.review_version OR na.closure_event_id <> NEW.closure_event_id
        OR nr.authorization_id <> NEW.new_authorization_id
        OR na.workflow_id <> rc.workflow_id OR na.draft_id <> rc.draft_id
        OR na.publishing_request_id <> rc.publishing_request_id OR na.execution_id <> rc.execution_id
        OR na.snapshot_hash <> rc.snapshot_hash OR na.intent_id <> rc.intent_id OR na.intent_hash <> rc.intent_hash
        OR na.credential_ref_id <> rc.credential_ref_id OR na.credential_ref_version <> rc.credential_ref_version
        OR na.account_fingerprint <> rc.account_fingerprint OR na.ledger_root_hash <> rc.ledger_root_hash
      THEN RAISE EXCEPTION 'orchestrator_crrra_invalid_provenance'; END IF;
      RETURN NEW;
    END; $fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_crrra_guard
      ON orchestrator_campaign_reconciliation_rereconciliation_attempts;
    CREATE TRIGGER orchestrator_crrra_guard BEFORE INSERT OR UPDATE OR DELETE
      ON orchestrator_campaign_reconciliation_rereconciliation_attempts
      FOR EACH ROW EXECUTE FUNCTION orchestrator_crrra_guard();
  `);

  await _ensureNamedFk(p, 'orchestrator_campaign_reconciliation_read_authorizations',
    'orchestrator_crra_review_case_fkey', 'tenant_id, review_case_id',
    'orchestrator_campaign_reconciliation_review_cases', 'tenant_id, id', 'ON DELETE RESTRICT');
  await _ensureNamedFk(p, 'orchestrator_campaign_reconciliation_read_authorizations',
    'orchestrator_crra_closure_event_fkey', 'tenant_id, closure_event_id',
    'orchestrator_campaign_reconciliation_review_events', 'tenant_id, id', 'ON DELETE RESTRICT');

  // PR 7A — immutable, tenant-leading authority for one future invocation.
  // Provider/account identifiers are represented only by one-way digests. The
  // lifecycle columns are the sole mutable portion and are guarded below so a
  // reservation cannot be stolen, reset, or consumed twice.
  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_campaign_activation_capabilities (
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
      id TEXT NOT NULL,
      actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      session_id_hash TEXT NOT NULL,
      draft_id TEXT NOT NULL,
      draft_revision INTEGER NOT NULL,
      snapshot_hash TEXT NOT NULL,
      publish_approval_id TEXT NOT NULL,
      publishing_request_id TEXT NOT NULL,
      intent_id TEXT NOT NULL,
      execution_id TEXT NOT NULL,
      reconciliation_run_id TEXT NOT NULL,
      advertising_account_id_hash TEXT NOT NULL,
      credential_ref_id TEXT NOT NULL,
      credential_ref_version INTEGER NOT NULL,
      account_fingerprint TEXT NOT NULL,
      ledger_root_hash TEXT NOT NULL,
      final_confirmation_hash TEXT NOT NULL,
      confirmed_at TIMESTAMPTZ NOT NULL,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'issued',
      reservation_id_hash TEXT NULL,
      reserved_at TIMESTAMPTZ NULL,
      revoked_at TIMESTAMPTZ NULL,
      revoked_by INTEGER NULL REFERENCES users(id) ON DELETE RESTRICT,
      consumed_at TIMESTAMPTZ NULL,
      invocation_id_hash TEXT NULL,
      audit_ref TEXT NOT NULL,
      PRIMARY KEY (tenant_id,id),
      UNIQUE (tenant_id,final_confirmation_hash),
      UNIQUE (tenant_id,audit_ref),
      FOREIGN KEY (tenant_id,execution_id)
        REFERENCES orchestrator_campaign_provider_draft_executions(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id,reconciliation_run_id)
        REFERENCES orchestrator_campaign_reconciliation_runs(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_cac_status_check CHECK
        (status IN ('issued','reserved','consumed','revoked','expired')),
      CONSTRAINT orchestrator_cac_version_check CHECK
        (draft_revision >= 1 AND credential_ref_version >= 1),
      CONSTRAINT orchestrator_cac_hash_check CHECK
        (session_id_hash ~ '^[0-9a-f]{64}$' AND snapshot_hash ~ '^[0-9a-f]{64}$'
         AND advertising_account_id_hash ~ '^[0-9a-f]{64}$'
         AND account_fingerprint ~ '^[0-9a-f]{64}$' AND ledger_root_hash ~ '^[0-9a-f]{64}$'
         AND final_confirmation_hash ~ '^[0-9a-f]{64}$'
         AND (reservation_id_hash IS NULL OR reservation_id_hash ~ '^[0-9a-f]{64}$')
         AND (invocation_id_hash IS NULL OR invocation_id_hash ~ '^[0-9a-f]{64}$')),
      CONSTRAINT orchestrator_cac_expiry_check CHECK
        (confirmed_at <= issued_at AND expires_at > issued_at),
      CONSTRAINT orchestrator_cac_lifecycle_check CHECK
        ((status='issued' AND reservation_id_hash IS NULL AND reserved_at IS NULL
           AND revoked_at IS NULL AND revoked_by IS NULL AND consumed_at IS NULL AND invocation_id_hash IS NULL)
         OR (status='reserved' AND reservation_id_hash IS NOT NULL AND reserved_at IS NOT NULL
           AND revoked_at IS NULL AND revoked_by IS NULL AND consumed_at IS NULL AND invocation_id_hash IS NULL)
         OR (status='consumed' AND reservation_id_hash IS NOT NULL AND reserved_at IS NOT NULL
           AND revoked_at IS NULL AND revoked_by IS NULL AND consumed_at IS NOT NULL AND invocation_id_hash IS NOT NULL)
         OR (status='revoked' AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL
           AND consumed_at IS NULL AND invocation_id_hash IS NULL)
         OR (status='expired' AND revoked_at IS NULL AND revoked_by IS NULL
           AND consumed_at IS NULL AND invocation_id_hash IS NULL))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_cac_tenant_invocation_unique
      ON orchestrator_campaign_activation_capabilities(tenant_id,invocation_id_hash)
      WHERE invocation_id_hash IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_cac_tenant_reservation_unique
      ON orchestrator_campaign_activation_capabilities(tenant_id,reservation_id_hash)
      WHERE reservation_id_hash IS NOT NULL;
    CREATE INDEX IF NOT EXISTS orchestrator_cac_tenant_expiry
      ON orchestrator_campaign_activation_capabilities(tenant_id,expires_at,id);

    CREATE OR REPLACE FUNCTION orchestrator_cac_guard() RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP='DELETE' THEN RAISE EXCEPTION 'orchestrator_cac_delete_prohibited'; END IF;
      IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id
        OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
        OR NEW.session_id_hash IS DISTINCT FROM OLD.session_id_hash
        OR NEW.draft_id IS DISTINCT FROM OLD.draft_id OR NEW.draft_revision IS DISTINCT FROM OLD.draft_revision
        OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash
        OR NEW.publish_approval_id IS DISTINCT FROM OLD.publish_approval_id
        OR NEW.publishing_request_id IS DISTINCT FROM OLD.publishing_request_id
        OR NEW.intent_id IS DISTINCT FROM OLD.intent_id OR NEW.execution_id IS DISTINCT FROM OLD.execution_id
        OR NEW.reconciliation_run_id IS DISTINCT FROM OLD.reconciliation_run_id
        OR NEW.advertising_account_id_hash IS DISTINCT FROM OLD.advertising_account_id_hash
        OR NEW.credential_ref_id IS DISTINCT FROM OLD.credential_ref_id
        OR NEW.credential_ref_version IS DISTINCT FROM OLD.credential_ref_version
        OR NEW.account_fingerprint IS DISTINCT FROM OLD.account_fingerprint
        OR NEW.ledger_root_hash IS DISTINCT FROM OLD.ledger_root_hash
        OR NEW.final_confirmation_hash IS DISTINCT FROM OLD.final_confirmation_hash
        OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
        OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.audit_ref IS DISTINCT FROM OLD.audit_ref
      THEN RAISE EXCEPTION 'orchestrator_cac_immutable_binding'; END IF;
      IF NOT ((OLD.status='issued' AND NEW.status IN ('reserved','revoked','expired'))
        OR (OLD.status='reserved' AND NEW.status IN ('consumed','revoked','expired')))
      THEN RAISE EXCEPTION 'orchestrator_cac_invalid_transition'; END IF;
      IF OLD.status='reserved' AND NEW.reservation_id_hash IS DISTINCT FROM OLD.reservation_id_hash
        THEN RAISE EXCEPTION 'orchestrator_cac_reservation_mismatch'; END IF;
      IF OLD.status='reserved' AND NEW.reserved_at IS DISTINCT FROM OLD.reserved_at
        THEN RAISE EXCEPTION 'orchestrator_cac_reservation_mismatch'; END IF;
      RETURN NEW;
    END; $fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_cac_guard ON orchestrator_campaign_activation_capabilities;
    CREATE TRIGGER orchestrator_cac_guard BEFORE UPDATE OR DELETE
      ON orchestrator_campaign_activation_capabilities FOR EACH ROW EXECUTE FUNCTION orchestrator_cac_guard();
  `);

  // PR 7B — one synchronous activation attempt per consumed PR7A capability.
  // Provider ids stay in the existing private ledger; these rows contain only
  // immutable lineage, safe object kinds, and normalized outcomes.
  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_campaign_activation_attempts (
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
      id TEXT NOT NULL, capability_id TEXT NOT NULL, invocation_id_hash TEXT NOT NULL,
      actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      session_id_hash TEXT NOT NULL, publishing_request_id TEXT NOT NULL,
      snapshot_hash TEXT NOT NULL, intent_id TEXT NOT NULL, execution_id TEXT NOT NULL,
      reconciliation_run_id TEXT NOT NULL, credential_ref_id TEXT NOT NULL,
      credential_ref_version INTEGER NOT NULL, account_fingerprint TEXT NOT NULL,
      ledger_root_hash TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'started',
      audit_ref TEXT NOT NULL, started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      settled_at TIMESTAMPTZ NULL,
      PRIMARY KEY (tenant_id,id), UNIQUE (tenant_id,capability_id),
      UNIQUE (tenant_id,invocation_id_hash), UNIQUE (tenant_id,audit_ref),
      FOREIGN KEY (tenant_id,capability_id) REFERENCES orchestrator_campaign_activation_capabilities(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id,execution_id) REFERENCES orchestrator_campaign_provider_draft_executions(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_caa_state_check CHECK (state IN ('started','activated','failed','partial_failure','outcome_unknown','compensated')),
      CONSTRAINT orchestrator_caa_terminal_check CHECK ((state='started' AND settled_at IS NULL) OR (state<>'started' AND settled_at IS NOT NULL)),
      CONSTRAINT orchestrator_caa_hash_check CHECK (session_id_hash ~ '^[0-9a-f]{64}$' AND invocation_id_hash ~ '^[0-9a-f]{64}$' AND snapshot_hash ~ '^[0-9a-f]{64}$' AND account_fingerprint ~ '^[0-9a-f]{64}$' AND ledger_root_hash ~ '^[0-9a-f]{64}$')
    );
    CREATE TABLE IF NOT EXISTS orchestrator_campaign_activation_events (
      tenant_id INTEGER NOT NULL, id BIGSERIAL, attempt_id TEXT NOT NULL,
      object_kind TEXT NOT NULL, operation TEXT NOT NULL, outcome TEXT NOT NULL,
      error_code TEXT NULL, occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id,id),
      FOREIGN KEY (tenant_id,attempt_id) REFERENCES orchestrator_campaign_activation_attempts(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_cae_kind_check CHECK (object_kind IN ('campaign','adset','creative','ad')),
      CONSTRAINT orchestrator_cae_operation_check CHECK (operation IN ('activate','verify_unchanged')),
      CONSTRAINT orchestrator_cae_outcome_check CHECK (outcome IN ('attempted','confirmed','rejected','failed','outcome_unknown')),
      CONSTRAINT orchestrator_cae_error_check CHECK (error_code IS NULL OR error_code ~ '^[a-z0-9_]{1,40}$')
    );
    CREATE OR REPLACE FUNCTION orchestrator_caa_guard() RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP='DELETE' THEN RAISE EXCEPTION 'orchestrator_caa_delete_prohibited'; END IF;
      IF OLD.state<>'started' THEN RAISE EXCEPTION 'orchestrator_caa_terminal_immutable'; END IF;
      IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id
        OR NEW.capability_id IS DISTINCT FROM OLD.capability_id OR NEW.invocation_id_hash IS DISTINCT FROM OLD.invocation_id_hash
        OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id OR NEW.session_id_hash IS DISTINCT FROM OLD.session_id_hash
        OR NEW.publishing_request_id IS DISTINCT FROM OLD.publishing_request_id OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash
        OR NEW.intent_id IS DISTINCT FROM OLD.intent_id OR NEW.execution_id IS DISTINCT FROM OLD.execution_id
        OR NEW.reconciliation_run_id IS DISTINCT FROM OLD.reconciliation_run_id OR NEW.credential_ref_id IS DISTINCT FROM OLD.credential_ref_id
        OR NEW.credential_ref_version IS DISTINCT FROM OLD.credential_ref_version OR NEW.account_fingerprint IS DISTINCT FROM OLD.account_fingerprint
        OR NEW.ledger_root_hash IS DISTINCT FROM OLD.ledger_root_hash OR NEW.audit_ref IS DISTINCT FROM OLD.audit_ref
        OR NEW.started_at IS DISTINCT FROM OLD.started_at OR NEW.state='started'
      THEN RAISE EXCEPTION 'orchestrator_caa_immutable_binding'; END IF;
      RETURN NEW;
    END; $fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_caa_guard ON orchestrator_campaign_activation_attempts;
    CREATE TRIGGER orchestrator_caa_guard BEFORE UPDATE OR DELETE ON orchestrator_campaign_activation_attempts FOR EACH ROW EXECUTE FUNCTION orchestrator_caa_guard();
    CREATE OR REPLACE FUNCTION orchestrator_cae_guard() RETURNS trigger AS $fn$
    BEGIN RAISE EXCEPTION 'orchestrator_cae_append_only'; END; $fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_cae_guard ON orchestrator_campaign_activation_events;
    CREATE TRIGGER orchestrator_cae_guard BEFORE UPDATE OR DELETE ON orchestrator_campaign_activation_events FOR EACH ROW EXECUTE FUNCTION orchestrator_cae_guard();
  `);

  // PR 7C — one durable monitoring result for one successfully activated graph.
  // Provider identifiers and raw provider responses are deliberately excluded.
  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_campaign_monitoring_runs (
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
      id TEXT NOT NULL, activation_attempt_id TEXT NOT NULL,
      invocation_id_hash TEXT NOT NULL,
      actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      session_id_hash TEXT NOT NULL, capability_id TEXT NOT NULL,
      publishing_request_id TEXT NOT NULL, snapshot_hash TEXT NOT NULL,
      intent_id TEXT NOT NULL, execution_id TEXT NOT NULL,
      reconciliation_run_id TEXT NOT NULL, credential_ref_id TEXT NOT NULL,
      credential_ref_version INTEGER NOT NULL, account_fingerprint TEXT NOT NULL,
      ledger_root_hash TEXT NOT NULL, workflow_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending', observations JSONB NOT NULL DEFAULT '[]'::jsonb,
      classifications TEXT[] NOT NULL DEFAULT '{}'::text[],
      failure_classifications TEXT[] NOT NULL DEFAULT '{}'::text[],
      audit_ref TEXT NOT NULL, started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      observation_deadline TIMESTAMPTZ NOT NULL, completed_at TIMESTAMPTZ NULL,
      PRIMARY KEY (tenant_id,id), UNIQUE (tenant_id,activation_attempt_id),
      UNIQUE (tenant_id,invocation_id_hash), UNIQUE (tenant_id,audit_ref),
      FOREIGN KEY (tenant_id,activation_attempt_id)
        REFERENCES orchestrator_campaign_activation_attempts(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id,capability_id)
        REFERENCES orchestrator_campaign_activation_capabilities(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id,execution_id)
        REFERENCES orchestrator_campaign_provider_draft_executions(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id,reconciliation_run_id)
        REFERENCES orchestrator_campaign_reconciliation_runs(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_cmr_state_check CHECK (state IN
        ('pending','observing','verified_active','delivery_pending','discrepancy_detected','failed')),
      CONSTRAINT orchestrator_cmr_hash_check CHECK
        (invocation_id_hash ~ '^[0-9a-f]{64}$' AND session_id_hash ~ '^[0-9a-f]{64}$'
         AND snapshot_hash ~ '^[0-9a-f]{64}$' AND account_fingerprint ~ '^[0-9a-f]{64}$'
         AND ledger_root_hash ~ '^[0-9a-f]{64}$'),
      CONSTRAINT orchestrator_cmr_time_check CHECK
        (observation_deadline > started_at AND
         ((state IN ('pending','observing') AND completed_at IS NULL)
          OR (state IN ('verified_active','delivery_pending','discrepancy_detected','failed')
              AND completed_at IS NOT NULL AND completed_at >= started_at))),
      CONSTRAINT orchestrator_cmr_observations_check CHECK (jsonb_typeof(observations)='array')
    );
    CREATE INDEX IF NOT EXISTS orchestrator_cmr_tenant_state_deadline
      ON orchestrator_campaign_monitoring_runs(tenant_id,state,observation_deadline,id);
    CREATE OR REPLACE FUNCTION orchestrator_cmr_guard() RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP='DELETE' THEN RAISE EXCEPTION 'orchestrator_cmr_delete_prohibited'; END IF;
      IF OLD.state IN ('verified_active','delivery_pending','discrepancy_detected','failed')
        THEN RAISE EXCEPTION 'orchestrator_cmr_terminal_immutable'; END IF;
      IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id
        OR NEW.activation_attempt_id IS DISTINCT FROM OLD.activation_attempt_id
        OR NEW.invocation_id_hash IS DISTINCT FROM OLD.invocation_id_hash
        OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
        OR NEW.session_id_hash IS DISTINCT FROM OLD.session_id_hash
        OR NEW.capability_id IS DISTINCT FROM OLD.capability_id
        OR NEW.publishing_request_id IS DISTINCT FROM OLD.publishing_request_id
        OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash
        OR NEW.intent_id IS DISTINCT FROM OLD.intent_id OR NEW.execution_id IS DISTINCT FROM OLD.execution_id
        OR NEW.reconciliation_run_id IS DISTINCT FROM OLD.reconciliation_run_id
        OR NEW.credential_ref_id IS DISTINCT FROM OLD.credential_ref_id
        OR NEW.credential_ref_version IS DISTINCT FROM OLD.credential_ref_version
        OR NEW.account_fingerprint IS DISTINCT FROM OLD.account_fingerprint
        OR NEW.ledger_root_hash IS DISTINCT FROM OLD.ledger_root_hash
        OR NEW.workflow_id IS DISTINCT FROM OLD.workflow_id OR NEW.audit_ref IS DISTINCT FROM OLD.audit_ref
        OR NEW.started_at IS DISTINCT FROM OLD.started_at
        OR NEW.observation_deadline IS DISTINCT FROM OLD.observation_deadline
      THEN RAISE EXCEPTION 'orchestrator_cmr_immutable_binding'; END IF;
      IF NOT ((OLD.state='pending' AND NEW.state='observing')
        OR (OLD.state='observing' AND NEW.state IN
          ('verified_active','delivery_pending','discrepancy_detected','failed')))
      THEN RAISE EXCEPTION 'orchestrator_cmr_invalid_transition'; END IF;
      RETURN NEW;
    END; $fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_cmr_guard ON orchestrator_campaign_monitoring_runs;
    CREATE TRIGGER orchestrator_cmr_guard BEFORE UPDATE OR DELETE
      ON orchestrator_campaign_monitoring_runs FOR EACH ROW EXECUTE FUNCTION orchestrator_cmr_guard();
  `);

  // PR 7D — durable human-only operational cases. Frozen source evidence and
  // lineage are copied by the service from locked authoritative rows. These
  // tables contain no provider identifiers, secrets, or raw observations.
  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_campaign_delivery_discrepancy_cases (
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
      id TEXT NOT NULL,
      monitoring_run_id TEXT NOT NULL,
      source_state TEXT NOT NULL,
      source_classifications TEXT[] NOT NULL DEFAULT '{}'::text[],
      source_failure_classifications TEXT[] NOT NULL DEFAULT '{}'::text[],
      source_audit_ref TEXT NOT NULL,
      activation_attempt_id TEXT NOT NULL,
      capability_id TEXT NOT NULL,
      publishing_request_id TEXT NOT NULL,
      publish_approval_id TEXT NOT NULL,
      workflow_approval_id INTEGER NOT NULL,
      workflow_id TEXT NOT NULL,
      draft_id TEXT NOT NULL,
      draft_revision INTEGER NOT NULL,
      snapshot_hash TEXT NOT NULL,
      intent_id TEXT NOT NULL,
      intent_hash TEXT NOT NULL,
      execution_id TEXT NOT NULL,
      reconciliation_run_id TEXT NOT NULL,
      credential_ref_id TEXT NOT NULL,
      credential_ref_version INTEGER NOT NULL,
      account_fingerprint TEXT NOT NULL,
      ledger_root_hash TEXT NOT NULL,
      source_actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      source_started_at TIMESTAMPTZ NOT NULL,
      source_completed_at TIMESTAMPTZ NOT NULL,
      creation_actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      state TEXT NOT NULL DEFAULT 'open',
      version INTEGER NOT NULL DEFAULT 1,
      classification TEXT NULL,
      note TEXT NULL,
      audit_ref TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolved_at TIMESTAMPTZ NULL,
      PRIMARY KEY (tenant_id,id),
      UNIQUE (tenant_id,monitoring_run_id),
      UNIQUE (tenant_id,audit_ref),
      FOREIGN KEY (tenant_id,monitoring_run_id)
        REFERENCES orchestrator_campaign_monitoring_runs(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id,activation_attempt_id)
        REFERENCES orchestrator_campaign_activation_attempts(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id,capability_id)
        REFERENCES orchestrator_campaign_activation_capabilities(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id,publishing_request_id)
        REFERENCES orchestrator_campaign_publish_requests(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id,publish_approval_id)
        REFERENCES orchestrator_campaign_publish_approvals(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id,workflow_approval_id)
        REFERENCES orchestrator_approvals(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id,draft_id)
        REFERENCES orchestrator_campaign_drafts(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id,intent_id)
        REFERENCES orchestrator_campaign_delivery_intents(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id,execution_id)
        REFERENCES orchestrator_campaign_provider_draft_executions(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id,reconciliation_run_id)
        REFERENCES orchestrator_campaign_reconciliation_runs(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY (tenant_id,credential_ref_id)
        REFERENCES orchestrator_tenant_meta_credential_refs(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_cddc_source_state_check CHECK
        (source_state IN ('delivery_pending','discrepancy_detected','failed')),
      CONSTRAINT orchestrator_cddc_state_check CHECK
        (state IN ('open','acknowledged','escalated','resolved')),
      CONSTRAINT orchestrator_cddc_classification_check CHECK (classification IS NULL OR classification IN
        ('delivery_confirmed_externally','provider_delay_accepted','provider_configuration_required',
         'credential_remediation_required','campaign_remediation_required','monitoring_failure_accepted',
         'false_positive','other_documented_resolution')),
      CONSTRAINT orchestrator_cddc_shape_check CHECK
        (version >= 1 AND draft_revision >= 1 AND credential_ref_version >= 1
         AND (note IS NULL OR char_length(note) BETWEEN 1 AND 1000)
         AND source_completed_at >= source_started_at AND updated_at >= created_at
         AND ((state='resolved' AND resolved_at IS NOT NULL AND classification IS NOT NULL)
           OR (state<>'resolved' AND resolved_at IS NULL)))
    );
    CREATE INDEX IF NOT EXISTS orchestrator_cddc_tenant_list
      ON orchestrator_campaign_delivery_discrepancy_cases(tenant_id,created_at DESC,id DESC);

    CREATE TABLE IF NOT EXISTS orchestrator_campaign_delivery_discrepancy_events (
      tenant_id INTEGER NOT NULL,
      id BIGSERIAL,
      case_id TEXT NOT NULL,
      case_version INTEGER NOT NULL,
      previous_state TEXT NULL,
      new_state TEXT NOT NULL,
      classification TEXT NULL,
      note TEXT NULL,
      actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      decision_id TEXT NULL,
      input_hash TEXT NULL,
      audit_ref TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id,id),
      UNIQUE (tenant_id,case_id,case_version),
      UNIQUE (tenant_id,audit_ref),
      FOREIGN KEY (tenant_id,case_id)
        REFERENCES orchestrator_campaign_delivery_discrepancy_cases(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_cdde_version_check CHECK (case_version >= 1),
      CONSTRAINT orchestrator_cdde_state_check CHECK
        (new_state IN ('open','acknowledged','escalated','resolved') AND
         (previous_state IS NULL OR previous_state IN ('open','acknowledged','escalated'))),
      CONSTRAINT orchestrator_cdde_classification_check CHECK (classification IS NULL OR classification IN
        ('delivery_confirmed_externally','provider_delay_accepted','provider_configuration_required',
         'credential_remediation_required','campaign_remediation_required','monitoring_failure_accepted',
         'false_positive','other_documented_resolution')),
      CONSTRAINT orchestrator_cdde_safe_check CHECK
        ((note IS NULL OR char_length(note) BETWEEN 1 AND 1000)
         AND ((decision_id IS NULL AND input_hash IS NULL AND case_version=1
               AND previous_state IS NULL AND new_state='open')
           OR (decision_id ~ '^[A-Za-z0-9._:-]{1,100}$' AND input_hash ~ '^[0-9a-f]{64}$')))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_cdde_tenant_decision_unique
      ON orchestrator_campaign_delivery_discrepancy_events(tenant_id,decision_id)
      WHERE decision_id IS NOT NULL;

    CREATE OR REPLACE FUNCTION orchestrator_cddc_guard() RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP='DELETE' THEN RAISE EXCEPTION 'orchestrator_cddc_delete_prohibited'; END IF;
      IF OLD.state='resolved' THEN RAISE EXCEPTION 'orchestrator_cddc_terminal_immutable'; END IF;
      IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id
        OR NEW.monitoring_run_id IS DISTINCT FROM OLD.monitoring_run_id
        OR NEW.source_state IS DISTINCT FROM OLD.source_state
        OR NEW.source_classifications IS DISTINCT FROM OLD.source_classifications
        OR NEW.source_failure_classifications IS DISTINCT FROM OLD.source_failure_classifications
        OR NEW.source_audit_ref IS DISTINCT FROM OLD.source_audit_ref
        OR NEW.activation_attempt_id IS DISTINCT FROM OLD.activation_attempt_id
        OR NEW.capability_id IS DISTINCT FROM OLD.capability_id
        OR NEW.publishing_request_id IS DISTINCT FROM OLD.publishing_request_id
        OR NEW.publish_approval_id IS DISTINCT FROM OLD.publish_approval_id
        OR NEW.workflow_approval_id IS DISTINCT FROM OLD.workflow_approval_id
        OR NEW.workflow_id IS DISTINCT FROM OLD.workflow_id OR NEW.draft_id IS DISTINCT FROM OLD.draft_id
        OR NEW.draft_revision IS DISTINCT FROM OLD.draft_revision OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash
        OR NEW.intent_id IS DISTINCT FROM OLD.intent_id OR NEW.intent_hash IS DISTINCT FROM OLD.intent_hash
        OR NEW.execution_id IS DISTINCT FROM OLD.execution_id OR NEW.reconciliation_run_id IS DISTINCT FROM OLD.reconciliation_run_id
        OR NEW.credential_ref_id IS DISTINCT FROM OLD.credential_ref_id
        OR NEW.credential_ref_version IS DISTINCT FROM OLD.credential_ref_version
        OR NEW.account_fingerprint IS DISTINCT FROM OLD.account_fingerprint
        OR NEW.ledger_root_hash IS DISTINCT FROM OLD.ledger_root_hash
        OR NEW.source_actor_user_id IS DISTINCT FROM OLD.source_actor_user_id
        OR NEW.source_started_at IS DISTINCT FROM OLD.source_started_at
        OR NEW.source_completed_at IS DISTINCT FROM OLD.source_completed_at
        OR NEW.creation_actor_user_id IS DISTINCT FROM OLD.creation_actor_user_id
        OR NEW.audit_ref IS DISTINCT FROM OLD.audit_ref OR NEW.created_at IS DISTINCT FROM OLD.created_at
      THEN RAISE EXCEPTION 'orchestrator_cddc_immutable_lineage'; END IF;
      IF NEW.version <> OLD.version + 1 THEN RAISE EXCEPTION 'orchestrator_cddc_invalid_version'; END IF;
      IF NOT ((OLD.state='open' AND NEW.state IN ('acknowledged','escalated'))
        OR (OLD.state='acknowledged' AND NEW.state IN ('escalated','resolved'))
        OR (OLD.state='escalated' AND NEW.state='resolved'))
      THEN RAISE EXCEPTION 'orchestrator_cddc_invalid_transition'; END IF;
      RETURN NEW;
    END; $fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_cddc_guard ON orchestrator_campaign_delivery_discrepancy_cases;
    CREATE TRIGGER orchestrator_cddc_guard BEFORE UPDATE OR DELETE
      ON orchestrator_campaign_delivery_discrepancy_cases FOR EACH ROW EXECUTE FUNCTION orchestrator_cddc_guard();

    CREATE OR REPLACE FUNCTION orchestrator_cdde_guard() RETURNS trigger AS $fn$
    DECLARE c orchestrator_campaign_delivery_discrepancy_cases%ROWTYPE;
    BEGIN
      IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'orchestrator_cdde_append_only'; END IF;
      SELECT * INTO c FROM orchestrator_campaign_delivery_discrepancy_cases
        WHERE tenant_id=NEW.tenant_id AND id=NEW.case_id;
      IF NOT FOUND OR c.version<>NEW.case_version OR c.state<>NEW.new_state
        OR c.classification IS DISTINCT FROM NEW.classification OR c.note IS DISTINCT FROM NEW.note
      THEN RAISE EXCEPTION 'orchestrator_cdde_case_mismatch'; END IF;
      IF NEW.case_version>1 AND NOT EXISTS (
        SELECT 1 FROM orchestrator_campaign_delivery_discrepancy_events
         WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id
           AND case_version=NEW.case_version-1 AND new_state=NEW.previous_state)
      THEN RAISE EXCEPTION 'orchestrator_cdde_nonmonotonic'; END IF;
      RETURN NEW;
    END; $fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_cdde_guard ON orchestrator_campaign_delivery_discrepancy_events;
    CREATE TRIGGER orchestrator_cdde_guard BEFORE INSERT OR UPDATE OR DELETE
      ON orchestrator_campaign_delivery_discrepancy_events FOR EACH ROW EXECUTE FUNCTION orchestrator_cdde_guard();

    CREATE OR REPLACE FUNCTION orchestrator_cddc_event_consistency() RETURNS trigger AS $fn$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM orchestrator_campaign_delivery_discrepancy_events
        WHERE tenant_id=NEW.tenant_id AND case_id=NEW.id AND case_version=NEW.version
          AND new_state=NEW.state AND classification IS NOT DISTINCT FROM NEW.classification
          AND note IS NOT DISTINCT FROM NEW.note)
      THEN RAISE EXCEPTION 'orchestrator_cddc_event_required'; END IF;
      RETURN NULL;
    END; $fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_cddc_event_consistency
      ON orchestrator_campaign_delivery_discrepancy_cases;
    CREATE CONSTRAINT TRIGGER orchestrator_cddc_event_consistency
      AFTER INSERT OR UPDATE ON orchestrator_campaign_delivery_discrepancy_cases
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION orchestrator_cddc_event_consistency();
  `);

  // PR 8A — advisory-only optimization recommendations. Sensitive lineage is
  // frozen internally; the API exposes only bounded operational evidence.
  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_campaign_optimization_recommendation_sets (
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT, id TEXT NOT NULL,
      monitoring_run_id TEXT NOT NULL, case_id TEXT NULL, case_version INTEGER NULL,
      case_event_ref TEXT NULL, case_classification TEXT NULL,
      case_resolver_user_id INTEGER NULL REFERENCES users(id) ON DELETE RESTRICT, case_resolved_at TIMESTAMPTZ NULL,
      activation_attempt_id TEXT NOT NULL, capability_id TEXT NOT NULL, publishing_request_id TEXT NOT NULL,
      publish_approval_id TEXT NOT NULL, workflow_approval_id INTEGER NOT NULL, workflow_id TEXT NOT NULL,
      draft_id TEXT NOT NULL, draft_revision INTEGER NOT NULL, snapshot_hash TEXT NOT NULL,
      intent_id TEXT NOT NULL, intent_hash TEXT NOT NULL, execution_id TEXT NOT NULL,
      reconciliation_run_id TEXT NOT NULL, credential_ref_id TEXT NOT NULL, credential_ref_version INTEGER NOT NULL,
      account_fingerprint TEXT NOT NULL, ledger_root_hash TEXT NOT NULL,
      source_state TEXT NOT NULL, source_classifications TEXT[] NOT NULL DEFAULT '{}',
      source_failure_classifications TEXT[] NOT NULL DEFAULT '{}', source_actor_user_id INTEGER NOT NULL REFERENCES users(id),
      source_started_at TIMESTAMPTZ NOT NULL, source_completed_at TIMESTAMPTZ NOT NULL,
      creation_actor_user_id INTEGER NOT NULL REFERENCES users(id), creation_session_hash TEXT NOT NULL,
      invocation_hash TEXT NOT NULL, generation INTEGER NOT NULL DEFAULT 1, predecessor_set_id TEXT NULL, successor_set_id TEXT NULL, engine_version TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'draft',
      version INTEGER NOT NULL DEFAULT 1, audit_ref TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), submitted_at TIMESTAMPTZ NULL, approved_at TIMESTAMPTZ NULL,
      rejected_at TIMESTAMPTZ NULL, superseded_at TIMESTAMPTZ NULL,
      PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,monitoring_run_id,invocation_hash), UNIQUE(tenant_id,monitoring_run_id,generation), UNIQUE(tenant_id,audit_ref),
      FOREIGN KEY(tenant_id,monitoring_run_id) REFERENCES orchestrator_campaign_monitoring_runs(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,case_id) REFERENCES orchestrator_campaign_delivery_discrepancy_cases(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,activation_attempt_id) REFERENCES orchestrator_campaign_activation_attempts(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,capability_id) REFERENCES orchestrator_campaign_activation_capabilities(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,publishing_request_id) REFERENCES orchestrator_campaign_publish_requests(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,publish_approval_id) REFERENCES orchestrator_campaign_publish_approvals(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,workflow_approval_id) REFERENCES orchestrator_approvals(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,draft_id) REFERENCES orchestrator_campaign_drafts(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,intent_id) REFERENCES orchestrator_campaign_delivery_intents(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,execution_id) REFERENCES orchestrator_campaign_provider_draft_executions(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,reconciliation_run_id) REFERENCES orchestrator_campaign_reconciliation_runs(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,credential_ref_id) REFERENCES orchestrator_tenant_meta_credential_refs(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,predecessor_set_id) REFERENCES orchestrator_campaign_optimization_recommendation_sets(tenant_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY(tenant_id,successor_set_id) REFERENCES orchestrator_campaign_optimization_recommendation_sets(tenant_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
      CONSTRAINT orchestrator_cors_state CHECK(state IN('draft','submitted','approved','rejected','superseded')),
      CONSTRAINT orchestrator_cors_source CHECK(source_state IN('verified_active','delivery_pending','discrepancy_detected','failed')),
      CONSTRAINT orchestrator_cors_case CHECK((case_id IS NULL AND case_version IS NULL AND case_event_ref IS NULL AND case_classification IS NULL AND case_resolver_user_id IS NULL AND case_resolved_at IS NULL) OR
        (case_id IS NOT NULL AND case_version>=1 AND case_event_ref IS NOT NULL AND case_classification IN('delivery_confirmed_externally','provider_delay_accepted','monitoring_failure_accepted','false_positive') AND case_resolver_user_id IS NOT NULL AND case_resolved_at IS NOT NULL)),
      CONSTRAINT orchestrator_cors_successor CHECK((predecessor_set_id IS NULL OR predecessor_set_id<>id) AND (successor_set_id IS NULL OR successor_set_id<>id)),
      CONSTRAINT orchestrator_cors_shape CHECK(version>=1 AND generation>=1 AND draft_revision>=1 AND credential_ref_version>=1 AND source_completed_at>=source_started_at AND
        snapshot_hash~'^[0-9a-f]{64}$' AND intent_hash~'^[0-9a-f]{64}$' AND account_fingerprint~'^[0-9a-f]{64}$' AND ledger_root_hash~'^[0-9a-f]{64}$' AND creation_session_hash~'^[0-9a-f]{64}$' AND invocation_hash~'^[0-9a-f]{64}$' AND
        ((state='draft' AND submitted_at IS NULL AND approved_at IS NULL AND rejected_at IS NULL AND superseded_at IS NULL) OR
         (state='submitted' AND submitted_at IS NOT NULL AND approved_at IS NULL AND rejected_at IS NULL AND superseded_at IS NULL) OR
         (state='approved' AND submitted_at IS NOT NULL AND approved_at IS NOT NULL AND rejected_at IS NULL AND superseded_at IS NULL AND successor_set_id IS NULL) OR
         (state='rejected' AND submitted_at IS NOT NULL AND rejected_at IS NOT NULL AND approved_at IS NULL AND superseded_at IS NULL) OR
         (state='superseded' AND approved_at IS NOT NULL AND superseded_at IS NOT NULL AND successor_set_id IS NOT NULL)))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_cors_one_active_approval ON orchestrator_campaign_optimization_recommendation_sets(tenant_id,monitoring_run_id) WHERE state='approved';
    CREATE INDEX IF NOT EXISTS orchestrator_cors_list ON orchestrator_campaign_optimization_recommendation_sets(tenant_id,created_at DESC,id DESC);
    CREATE TABLE IF NOT EXISTS orchestrator_campaign_optimization_recommendations(
      tenant_id INTEGER NOT NULL,id TEXT NOT NULL,set_id TEXT NOT NULL,ordinal INTEGER NOT NULL,
      category TEXT NOT NULL,rationale TEXT NOT NULL,evidence_refs TEXT[] NOT NULL,confidence TEXT NOT NULL,
      priority TEXT NOT NULL,proposed_action TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,set_id,ordinal),
      FOREIGN KEY(tenant_id,set_id) REFERENCES orchestrator_campaign_optimization_recommendation_sets(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_cor_category CHECK(category IN('monitor_longer','review_budget_allocation','review_bid_strategy','review_audience_targeting','review_placements','review_schedule','review_creative_performance','review_delivery_configuration','no_change_recommended')),
      CONSTRAINT orchestrator_cor_confidence CHECK(confidence IN('low','medium','high')),
      CONSTRAINT orchestrator_cor_priority CHECK(priority IN('low','medium','high')),
      CONSTRAINT orchestrator_cor_shape CHECK(ordinal BETWEEN 1 AND 9 AND char_length(rationale) BETWEEN 1 AND 1000 AND char_length(proposed_action) BETWEEN 1 AND 1000 AND cardinality(evidence_refs) BETWEEN 1 AND 8)
    );
    CREATE TABLE IF NOT EXISTS orchestrator_campaign_optimization_review_events(
      tenant_id INTEGER NOT NULL,id BIGSERIAL,set_id TEXT NOT NULL,set_version INTEGER NOT NULL,
      previous_state TEXT NULL,new_state TEXT NOT NULL,note TEXT NULL,actor_user_id INTEGER NOT NULL REFERENCES users(id),
      decision_id TEXT NULL,input_hash TEXT NULL,audit_ref TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,set_id,set_version),UNIQUE(tenant_id,audit_ref),
      FOREIGN KEY(tenant_id,set_id) REFERENCES orchestrator_campaign_optimization_recommendation_sets(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_core_state CHECK(new_state IN('draft','submitted','approved','rejected','superseded') AND (previous_state IS NULL OR previous_state IN('draft','submitted','approved'))),
      CONSTRAINT orchestrator_core_shape CHECK(set_version>=1 AND (note IS NULL OR char_length(note) BETWEEN 1 AND 1000) AND ((set_version=1 AND previous_state IS NULL AND new_state='draft' AND decision_id IS NULL AND input_hash IS NULL) OR (decision_id~'^[A-Za-z0-9._:-]{1,100}$' AND input_hash~'^[0-9a-f]{64}$')))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_core_decision ON orchestrator_campaign_optimization_review_events(tenant_id,decision_id) WHERE decision_id IS NOT NULL;
    CREATE OR REPLACE FUNCTION orchestrator_cors_guard() RETURNS trigger AS $fn$ BEGIN
      IF TG_OP='DELETE' THEN RAISE EXCEPTION 'orchestrator_cors_delete_prohibited';END IF;
      IF OLD.state IN('rejected','superseded') THEN RAISE EXCEPTION 'orchestrator_cors_terminal_immutable';END IF;
      IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.monitoring_run_id IS DISTINCT FROM OLD.monitoring_run_id OR NEW.case_id IS DISTINCT FROM OLD.case_id OR NEW.case_version IS DISTINCT FROM OLD.case_version OR NEW.case_event_ref IS DISTINCT FROM OLD.case_event_ref OR NEW.case_classification IS DISTINCT FROM OLD.case_classification OR NEW.case_resolver_user_id IS DISTINCT FROM OLD.case_resolver_user_id OR NEW.case_resolved_at IS DISTINCT FROM OLD.case_resolved_at OR
       NEW.activation_attempt_id IS DISTINCT FROM OLD.activation_attempt_id OR NEW.capability_id IS DISTINCT FROM OLD.capability_id OR NEW.publishing_request_id IS DISTINCT FROM OLD.publishing_request_id OR NEW.publish_approval_id IS DISTINCT FROM OLD.publish_approval_id OR NEW.workflow_approval_id IS DISTINCT FROM OLD.workflow_approval_id OR NEW.workflow_id IS DISTINCT FROM OLD.workflow_id OR NEW.draft_id IS DISTINCT FROM OLD.draft_id OR NEW.draft_revision IS DISTINCT FROM OLD.draft_revision OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash OR NEW.intent_id IS DISTINCT FROM OLD.intent_id OR NEW.intent_hash IS DISTINCT FROM OLD.intent_hash OR NEW.execution_id IS DISTINCT FROM OLD.execution_id OR NEW.reconciliation_run_id IS DISTINCT FROM OLD.reconciliation_run_id OR NEW.credential_ref_id IS DISTINCT FROM OLD.credential_ref_id OR NEW.credential_ref_version IS DISTINCT FROM OLD.credential_ref_version OR NEW.account_fingerprint IS DISTINCT FROM OLD.account_fingerprint OR NEW.ledger_root_hash IS DISTINCT FROM OLD.ledger_root_hash OR NEW.source_state IS DISTINCT FROM OLD.source_state OR NEW.source_classifications IS DISTINCT FROM OLD.source_classifications OR NEW.source_failure_classifications IS DISTINCT FROM OLD.source_failure_classifications OR NEW.source_actor_user_id IS DISTINCT FROM OLD.source_actor_user_id OR NEW.source_started_at IS DISTINCT FROM OLD.source_started_at OR NEW.source_completed_at IS DISTINCT FROM OLD.source_completed_at OR NEW.creation_actor_user_id IS DISTINCT FROM OLD.creation_actor_user_id OR NEW.creation_session_hash IS DISTINCT FROM OLD.creation_session_hash OR NEW.invocation_hash IS DISTINCT FROM OLD.invocation_hash OR NEW.generation IS DISTINCT FROM OLD.generation OR NEW.predecessor_set_id IS DISTINCT FROM OLD.predecessor_set_id OR NEW.engine_version IS DISTINCT FROM OLD.engine_version OR NEW.audit_ref IS DISTINCT FROM OLD.audit_ref OR NEW.created_at IS DISTINCT FROM OLD.created_at
      THEN RAISE EXCEPTION 'orchestrator_cors_immutable_lineage';END IF;
      IF NEW.successor_set_id IS DISTINCT FROM OLD.successor_set_id AND NOT (OLD.state='approved' AND NEW.state='superseded' AND OLD.successor_set_id IS NULL AND NEW.successor_set_id IS NOT NULL) THEN RAISE EXCEPTION 'orchestrator_cors_invalid_successor';END IF;
      IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'orchestrator_cors_invalid_version';END IF;
      IF NOT ((OLD.state='draft' AND NEW.state='submitted') OR (OLD.state='submitted' AND NEW.state IN('approved','rejected')) OR (OLD.state='approved' AND NEW.state='superseded')) THEN RAISE EXCEPTION 'orchestrator_cors_invalid_transition';END IF;RETURN NEW;END;$fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_cors_guard ON orchestrator_campaign_optimization_recommendation_sets;
    CREATE TRIGGER orchestrator_cors_guard BEFORE UPDATE OR DELETE ON orchestrator_campaign_optimization_recommendation_sets FOR EACH ROW EXECUTE FUNCTION orchestrator_cors_guard();
    CREATE OR REPLACE FUNCTION orchestrator_cor_guard() RETURNS trigger AS $fn$ DECLARE s TEXT;BEGIN IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'orchestrator_cor_immutable';END IF;SELECT state INTO s FROM orchestrator_campaign_optimization_recommendation_sets WHERE tenant_id=NEW.tenant_id AND id=NEW.set_id;IF s<>'draft' THEN RAISE EXCEPTION 'orchestrator_cor_set_frozen';END IF;RETURN NEW;END;$fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_cor_guard ON orchestrator_campaign_optimization_recommendations;
    CREATE TRIGGER orchestrator_cor_guard BEFORE INSERT OR UPDATE OR DELETE ON orchestrator_campaign_optimization_recommendations FOR EACH ROW EXECUTE FUNCTION orchestrator_cor_guard();
    CREATE OR REPLACE FUNCTION orchestrator_core_guard() RETURNS trigger AS $fn$ DECLARE s orchestrator_campaign_optimization_recommendation_sets%ROWTYPE;BEGIN IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'orchestrator_core_append_only';END IF;SELECT * INTO s FROM orchestrator_campaign_optimization_recommendation_sets WHERE tenant_id=NEW.tenant_id AND id=NEW.set_id;IF NOT FOUND OR s.version<>NEW.set_version OR s.state<>NEW.new_state THEN RAISE EXCEPTION 'orchestrator_core_set_mismatch';END IF;IF NEW.set_version>1 AND NOT EXISTS(SELECT 1 FROM orchestrator_campaign_optimization_review_events WHERE tenant_id=NEW.tenant_id AND set_id=NEW.set_id AND set_version=NEW.set_version-1 AND new_state=NEW.previous_state) THEN RAISE EXCEPTION 'orchestrator_core_nonmonotonic';END IF;RETURN NEW;END;$fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_core_guard ON orchestrator_campaign_optimization_review_events;
    CREATE TRIGGER orchestrator_core_guard BEFORE INSERT OR UPDATE OR DELETE ON orchestrator_campaign_optimization_review_events FOR EACH ROW EXECUTE FUNCTION orchestrator_core_guard();
    CREATE OR REPLACE FUNCTION orchestrator_cors_successor_consistency() RETURNS trigger AS $fn$ DECLARE next_set orchestrator_campaign_optimization_recommendation_sets%ROWTYPE;BEGIN
      IF NEW.state='superseded' THEN SELECT * INTO next_set FROM orchestrator_campaign_optimization_recommendation_sets WHERE tenant_id=NEW.tenant_id AND id=NEW.successor_set_id;IF NOT FOUND OR next_set.state<>'approved' OR next_set.predecessor_set_id<>NEW.id OR next_set.monitoring_run_id<>NEW.monitoring_run_id OR next_set.generation<=NEW.generation THEN RAISE EXCEPTION 'orchestrator_cors_invalid_approved_successor';END IF;END IF;RETURN NULL;END;$fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_cors_successor_consistency ON orchestrator_campaign_optimization_recommendation_sets;
    CREATE CONSTRAINT TRIGGER orchestrator_cors_successor_consistency AFTER INSERT OR UPDATE ON orchestrator_campaign_optimization_recommendation_sets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION orchestrator_cors_successor_consistency();
    CREATE OR REPLACE FUNCTION orchestrator_cors_event_consistency() RETURNS trigger AS $fn$ BEGIN IF NOT EXISTS(SELECT 1 FROM orchestrator_campaign_optimization_review_events WHERE tenant_id=NEW.tenant_id AND set_id=NEW.id AND set_version=NEW.version AND new_state=NEW.state) THEN RAISE EXCEPTION 'orchestrator_cors_event_required';END IF;RETURN NULL;END;$fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_cors_event_consistency ON orchestrator_campaign_optimization_recommendation_sets;
    CREATE CONSTRAINT TRIGGER orchestrator_cors_event_consistency AFTER INSERT OR UPDATE ON orchestrator_campaign_optimization_recommendation_sets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION orchestrator_cors_event_consistency();
  `);

  // PR 8B — a frozen internal plan only. These rows contain digest metadata,
  // never provider identifiers, credentials, payloads, or an execution result.
  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_optimization_execution_requests(
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
      id TEXT NOT NULL, invocation_hash TEXT NOT NULL, input_hash TEXT NOT NULL,
      recommendation_set_id TEXT NOT NULL, recommendation_id TEXT NOT NULL,
      recommendation_set_generation INTEGER NOT NULL, recommendation_set_version INTEGER NOT NULL,
      monitoring_run_id TEXT NOT NULL, case_id TEXT NULL, case_version INTEGER NULL, case_resolution_event_id TEXT NULL,
      activation_attempt_id TEXT NOT NULL, capability_id TEXT NOT NULL, workflow_id TEXT NOT NULL,
      draft_id TEXT NOT NULL, draft_revision INTEGER NOT NULL,
      publishing_request_id TEXT NOT NULL, publish_approval_id TEXT NOT NULL,
      snapshot_hash TEXT NOT NULL, intent_id TEXT NOT NULL, intent_hash TEXT NOT NULL,
      execution_id TEXT NOT NULL, reconciliation_run_id TEXT NOT NULL,
      credential_ref_id TEXT NOT NULL, credential_ref_version INTEGER NOT NULL,
      account_fingerprint TEXT NOT NULL, ledger_root_hash TEXT NOT NULL,
      proposed_action TEXT NOT NULL, rationale TEXT NOT NULL, evidence_refs TEXT[] NOT NULL,
      creator_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      state TEXT NOT NULL DEFAULT 'draft', version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), submitted_at TIMESTAMPTZ NULL, decided_at TIMESTAMPTZ NULL,
      decision_id TEXT NULL, decision_hash TEXT NULL,
      deciding_user_id INTEGER NULL REFERENCES users(id) ON DELETE RESTRICT,
      creation_session_hash TEXT NOT NULL, note TEXT NULL, audit_ref TEXT NOT NULL,
      PRIMARY KEY(tenant_id,id),
      UNIQUE(tenant_id,invocation_hash), UNIQUE(tenant_id,audit_ref),
      FOREIGN KEY(tenant_id,recommendation_set_id) REFERENCES orchestrator_campaign_optimization_recommendation_sets(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,recommendation_id) REFERENCES orchestrator_campaign_optimization_recommendations(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,monitoring_run_id) REFERENCES orchestrator_campaign_monitoring_runs(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,case_id) REFERENCES orchestrator_campaign_delivery_discrepancy_cases(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,activation_attempt_id) REFERENCES orchestrator_campaign_activation_attempts(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,capability_id) REFERENCES orchestrator_campaign_activation_capabilities(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,workflow_id) REFERENCES orchestrator_workflows(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,draft_id) REFERENCES orchestrator_campaign_drafts(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,publishing_request_id) REFERENCES orchestrator_campaign_publish_requests(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,publish_approval_id) REFERENCES orchestrator_campaign_publish_approvals(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,intent_id) REFERENCES orchestrator_campaign_delivery_intents(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,execution_id) REFERENCES orchestrator_campaign_provider_draft_executions(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,reconciliation_run_id) REFERENCES orchestrator_campaign_reconciliation_runs(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,credential_ref_id) REFERENCES orchestrator_tenant_meta_credential_refs(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_oer_state CHECK(state IN('draft','submitted','approved','rejected','invalidated')),
      CONSTRAINT orchestrator_oer_action CHECK(proposed_action IN('review_delivery_configuration','review_campaign_configuration','review_credential_configuration','prepare_campaign_remediation')),
      CONSTRAINT orchestrator_oer_shape CHECK(
        version>=1 AND recommendation_set_generation>=1 AND recommendation_set_version>=1 AND draft_revision>=1 AND credential_ref_version>=1
        AND invocation_hash~'^[0-9a-f]{64}$' AND input_hash~'^[0-9a-f]{64}$' AND creation_session_hash~'^[0-9a-f]{64}$'
        AND snapshot_hash~'^[0-9a-f]{64}$' AND intent_hash~'^[0-9a-f]{64}$'
        AND account_fingerprint~'^[0-9a-f]{64}$' AND ledger_root_hash~'^[0-9a-f]{64}$'
        AND char_length(rationale) BETWEEN 1 AND 1000 AND cardinality(evidence_refs) BETWEEN 1 AND 8
        AND (note IS NULL OR char_length(note) BETWEEN 1 AND 1000)
        AND ((case_id IS NULL AND case_version IS NULL AND case_resolution_event_id IS NULL) OR (case_id IS NOT NULL AND case_version>=1 AND case_resolution_event_id IS NOT NULL))
        AND ((state='draft' AND submitted_at IS NULL AND decided_at IS NULL AND decision_id IS NULL AND decision_hash IS NULL AND deciding_user_id IS NULL)
          OR (state='submitted' AND submitted_at IS NOT NULL AND decided_at IS NULL AND decision_id IS NULL AND decision_hash IS NULL AND deciding_user_id IS NULL)
          OR (state IN('approved','rejected') AND submitted_at IS NOT NULL AND decided_at IS NOT NULL AND decision_id IS NOT NULL AND decision_hash~'^[0-9a-f]{64}$' AND deciding_user_id IS NOT NULL)
          OR (state='invalidated' AND decided_at IS NOT NULL))
        AND (state<>'approved' OR creator_user_id<>deciding_user_id)
      )
    );
    CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_oer_one_active ON orchestrator_optimization_execution_requests(tenant_id,recommendation_set_id,recommendation_id) WHERE state IN('draft','submitted');
    CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_oer_decision_id ON orchestrator_optimization_execution_requests(tenant_id,decision_id) WHERE decision_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS orchestrator_oer_list ON orchestrator_optimization_execution_requests(tenant_id,created_at DESC,id DESC);

    CREATE TABLE IF NOT EXISTS orchestrator_optimization_execution_events(
      tenant_id INTEGER NOT NULL, id BIGSERIAL, request_id TEXT NOT NULL, request_version INTEGER NOT NULL,
      previous_state TEXT NULL, new_state TEXT NOT NULL, actor_user_id INTEGER NULL REFERENCES users(id) ON DELETE RESTRICT,
      decision_id TEXT NULL, input_hash TEXT NULL, audit_ref TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,request_id,request_version), UNIQUE(tenant_id,audit_ref),
      FOREIGN KEY(tenant_id,request_id) REFERENCES orchestrator_optimization_execution_requests(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_oee_state CHECK(new_state IN('draft','submitted','approved','rejected','invalidated') AND (previous_state IS NULL OR previous_state IN('draft','submitted'))),
      CONSTRAINT orchestrator_oee_shape CHECK(request_version>=1 AND ((request_version=1 AND previous_state IS NULL AND new_state='draft' AND decision_id IS NULL AND input_hash IS NULL)
          OR (request_version>1 AND decision_id~'^[A-Za-z0-9._:-]{1,100}$' AND input_hash~'^[0-9a-f]{64}$')))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_oee_decision ON orchestrator_optimization_execution_events(tenant_id,decision_id) WHERE decision_id IS NOT NULL;

    CREATE OR REPLACE FUNCTION orchestrator_oer_guard() RETURNS trigger AS $fn$ BEGIN
      IF TG_OP='DELETE' THEN RAISE EXCEPTION 'orchestrator_oer_delete_prohibited';END IF;
      IF OLD.state IN('approved','rejected','invalidated') THEN RAISE EXCEPTION 'orchestrator_oer_terminal_immutable';END IF;
      IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.invocation_hash IS DISTINCT FROM OLD.invocation_hash
        OR NEW.recommendation_set_id IS DISTINCT FROM OLD.recommendation_set_id OR NEW.recommendation_id IS DISTINCT FROM OLD.recommendation_id OR NEW.recommendation_set_generation IS DISTINCT FROM OLD.recommendation_set_generation OR NEW.recommendation_set_version IS DISTINCT FROM OLD.recommendation_set_version
        OR NEW.monitoring_run_id IS DISTINCT FROM OLD.monitoring_run_id OR NEW.case_id IS DISTINCT FROM OLD.case_id OR NEW.case_version IS DISTINCT FROM OLD.case_version OR NEW.case_resolution_event_id IS DISTINCT FROM OLD.case_resolution_event_id
        OR NEW.activation_attempt_id IS DISTINCT FROM OLD.activation_attempt_id OR NEW.capability_id IS DISTINCT FROM OLD.capability_id OR NEW.workflow_id IS DISTINCT FROM OLD.workflow_id OR NEW.draft_id IS DISTINCT FROM OLD.draft_id OR NEW.draft_revision IS DISTINCT FROM OLD.draft_revision
        OR NEW.publishing_request_id IS DISTINCT FROM OLD.publishing_request_id OR NEW.publish_approval_id IS DISTINCT FROM OLD.publish_approval_id OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash OR NEW.intent_id IS DISTINCT FROM OLD.intent_id OR NEW.intent_hash IS DISTINCT FROM OLD.intent_hash
        OR NEW.execution_id IS DISTINCT FROM OLD.execution_id OR NEW.reconciliation_run_id IS DISTINCT FROM OLD.reconciliation_run_id OR NEW.credential_ref_id IS DISTINCT FROM OLD.credential_ref_id OR NEW.credential_ref_version IS DISTINCT FROM OLD.credential_ref_version OR NEW.account_fingerprint IS DISTINCT FROM OLD.account_fingerprint OR NEW.ledger_root_hash IS DISTINCT FROM OLD.ledger_root_hash
        OR NEW.proposed_action IS DISTINCT FROM OLD.proposed_action OR NEW.rationale IS DISTINCT FROM OLD.rationale OR NEW.evidence_refs IS DISTINCT FROM OLD.evidence_refs OR NEW.creator_user_id IS DISTINCT FROM OLD.creator_user_id OR NEW.creation_session_hash IS DISTINCT FROM OLD.creation_session_hash OR NEW.input_hash IS DISTINCT FROM OLD.input_hash OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.audit_ref IS DISTINCT FROM OLD.audit_ref
      THEN RAISE EXCEPTION 'orchestrator_oer_immutable_lineage';END IF;
      IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'orchestrator_oer_invalid_version';END IF;
      IF NOT ((OLD.state='draft' AND NEW.state IN('submitted','invalidated')) OR (OLD.state='submitted' AND NEW.state IN('approved','rejected','invalidated'))) THEN RAISE EXCEPTION 'orchestrator_oer_invalid_transition';END IF;
      RETURN NEW;END;$fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_oer_guard ON orchestrator_optimization_execution_requests;
    CREATE TRIGGER orchestrator_oer_guard BEFORE UPDATE OR DELETE ON orchestrator_optimization_execution_requests FOR EACH ROW EXECUTE FUNCTION orchestrator_oer_guard();
    CREATE OR REPLACE FUNCTION orchestrator_oee_guard() RETURNS trigger AS $fn$ DECLARE r orchestrator_optimization_execution_requests%ROWTYPE;BEGIN
      IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'orchestrator_oee_append_only';END IF;
      SELECT * INTO r FROM orchestrator_optimization_execution_requests WHERE tenant_id=NEW.tenant_id AND id=NEW.request_id;
      IF NOT FOUND OR r.version<>NEW.request_version OR r.state<>NEW.new_state THEN RAISE EXCEPTION 'orchestrator_oee_request_mismatch';END IF;
      IF NEW.request_version>1 AND NOT EXISTS(SELECT 1 FROM orchestrator_optimization_execution_events WHERE tenant_id=NEW.tenant_id AND request_id=NEW.request_id AND request_version=NEW.request_version-1 AND new_state=NEW.previous_state) THEN RAISE EXCEPTION 'orchestrator_oee_nonmonotonic';END IF;
      RETURN NEW;END;$fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_oee_guard ON orchestrator_optimization_execution_events;
    CREATE TRIGGER orchestrator_oee_guard BEFORE INSERT OR UPDATE OR DELETE ON orchestrator_optimization_execution_events FOR EACH ROW EXECUTE FUNCTION orchestrator_oee_guard();
    CREATE OR REPLACE FUNCTION orchestrator_oer_event_consistency() RETURNS trigger AS $fn$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM orchestrator_optimization_execution_events WHERE tenant_id=NEW.tenant_id AND request_id=NEW.id AND request_version=NEW.version AND new_state=NEW.state) THEN RAISE EXCEPTION 'orchestrator_oer_event_required';END IF;RETURN NULL;END;$fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_oer_event_consistency ON orchestrator_optimization_execution_requests;
    CREATE CONSTRAINT TRIGGER orchestrator_oer_event_consistency AFTER INSERT OR UPDATE ON orchestrator_optimization_execution_requests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION orchestrator_oer_event_consistency();
  `);

  // PR10A — metadata-only Google Ads credential reference plus a durable,
  // human-session-bound single-use authority lifecycle. Nothing in these
  // tables can resolve a credential or contact a provider.
  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_tenant_google_ads_credential_refs(
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
      id TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'google_ads',
      status TEXT NOT NULL DEFAULT 'active',
      account_fingerprint TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      revoked_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(tenant_id,id),
      UNIQUE(tenant_id,id,version,account_fingerprint),
      CONSTRAINT orchestrator_tgacr_platform_check CHECK(platform='google_ads'),
      CONSTRAINT orchestrator_tgacr_status_check CHECK(status IN ('active','revoked')),
      CONSTRAINT orchestrator_tgacr_lifecycle_check CHECK(
        (status='active' AND revoked_at IS NULL) OR
        (status='revoked' AND revoked_at IS NOT NULL AND revoked_at>=created_at)),
      CONSTRAINT orchestrator_tgacr_version_check CHECK(version>=1),
      CONSTRAINT orchestrator_tgacr_fingerprint_check CHECK(
        char_length(account_fingerprint)=64 AND account_fingerprint~'^[0-9a-f]{64}$'),
      CONSTRAINT orchestrator_tgacr_id_check CHECK(char_length(id) BETWEEN 1 AND 128)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_tgacr_one_active_account
      ON orchestrator_tenant_google_ads_credential_refs(tenant_id,account_fingerprint)
      WHERE status='active';
    CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_tgacr_tenant_id_version
      ON orchestrator_tenant_google_ads_credential_refs(tenant_id,id,version);

    CREATE TABLE IF NOT EXISTS orchestrator_google_ads_provider_draft_confirmations(
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
      id TEXT NOT NULL,
      actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      session_id_hash TEXT NOT NULL,
      draft_id TEXT NOT NULL,
      draft_revision INTEGER NOT NULL,
      publishing_request_id TEXT NOT NULL,
      publish_approval_id TEXT NOT NULL,
      intent_id TEXT NOT NULL,
      credential_ref_id TEXT NOT NULL,
      credential_ref_version INTEGER NOT NULL,
      phrase_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ NULL,
      capability_id TEXT NULL,
      PRIMARY KEY(tenant_id,id),
      CHECK(session_id_hash~'^[0-9a-f]{64}$' AND phrase_hash~'^[0-9a-f]{64}$'),
      CHECK(expires_at>created_at AND expires_at<=created_at+INTERVAL '2 minutes'),
      CHECK((consumed_at IS NULL AND capability_id IS NULL) OR
        (consumed_at IS NOT NULL AND consumed_at>=created_at AND capability_id IS NOT NULL)),
      FOREIGN KEY(tenant_id,draft_id) REFERENCES orchestrator_campaign_drafts(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,publishing_request_id) REFERENCES orchestrator_campaign_publish_requests(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,publish_approval_id) REFERENCES orchestrator_campaign_publish_approvals(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,intent_id) REFERENCES orchestrator_campaign_delivery_intents(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,credential_ref_id,credential_ref_version)
        REFERENCES orchestrator_tenant_google_ads_credential_refs(tenant_id,id,version) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS orchestrator_google_ads_provider_draft_capabilities(
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
      id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'issued',
      actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      session_id_hash TEXT NOT NULL,
      workflow_id TEXT NOT NULL,
      draft_id TEXT NOT NULL,
      draft_revision INTEGER NOT NULL,
      contract_hash TEXT NOT NULL,
      publishing_request_id TEXT NOT NULL,
      publish_approval_id TEXT NOT NULL,
      workflow_approval_id INTEGER NOT NULL,
      snapshot_hash TEXT NOT NULL,
      intent_id TEXT NOT NULL,
      intent_hash TEXT NOT NULL,
      credential_ref_id TEXT NOT NULL,
      credential_ref_version INTEGER NOT NULL,
      account_fingerprint TEXT NOT NULL,
      final_confirmation_id TEXT NOT NULL,
      final_confirmation_hash TEXT NOT NULL,
      confirmed_at TIMESTAMPTZ NOT NULL,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      reservation_id_hash TEXT NULL,
      reserved_at TIMESTAMPTZ NULL,
      invocation_id_hash TEXT NULL,
      consumed_at TIMESTAMPTZ NULL,
      revoked_at TIMESTAMPTZ NULL,
      revoked_by INTEGER NULL REFERENCES users(id) ON DELETE RESTRICT,
      audit_ref TEXT NOT NULL,
      PRIMARY KEY(tenant_id,id),
      CONSTRAINT orchestrator_gapdc_status_check
        CHECK(status IN ('issued','reserved','consumed','revoked','expired')),
      CONSTRAINT orchestrator_gapdc_lifecycle_check CHECK(
        (status='issued' AND reservation_id_hash IS NULL AND reserved_at IS NULL
          AND invocation_id_hash IS NULL AND consumed_at IS NULL AND revoked_at IS NULL AND revoked_by IS NULL) OR
        (status='reserved' AND reservation_id_hash IS NOT NULL AND reserved_at IS NOT NULL
          AND invocation_id_hash IS NULL AND consumed_at IS NULL AND revoked_at IS NULL AND revoked_by IS NULL) OR
        (status='consumed' AND reservation_id_hash IS NOT NULL AND reserved_at IS NOT NULL
          AND invocation_id_hash IS NOT NULL AND consumed_at IS NOT NULL AND revoked_at IS NULL AND revoked_by IS NULL) OR
        (status='revoked' AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL
          AND invocation_id_hash IS NULL AND consumed_at IS NULL) OR
        (status='expired' AND invocation_id_hash IS NULL AND consumed_at IS NULL
          AND revoked_at IS NULL AND revoked_by IS NULL)),
      CONSTRAINT orchestrator_gapdc_time_check CHECK(
        confirmed_at<=issued_at AND expires_at>issued_at
        AND expires_at<=issued_at+INTERVAL '10 minutes'
        AND (reserved_at IS NULL OR reserved_at>=issued_at)
        AND (consumed_at IS NULL OR consumed_at>=reserved_at)
        AND (revoked_at IS NULL OR revoked_at>=issued_at)),
      CONSTRAINT orchestrator_gapdc_revision_check CHECK(draft_revision>=1 AND credential_ref_version>=1),
      CONSTRAINT orchestrator_gapdc_hashes_check CHECK(
        session_id_hash~'^[0-9a-f]{64}$' AND contract_hash~'^[0-9a-f]{64}$'
        AND snapshot_hash~'^[0-9a-f]{64}$' AND intent_hash~'^[0-9a-f]{64}$'
        AND account_fingerprint~'^[0-9a-f]{64}$' AND final_confirmation_hash~'^[0-9a-f]{64}$'
        AND (reservation_id_hash IS NULL OR reservation_id_hash~'^[0-9a-f]{64}$')
        AND (invocation_id_hash IS NULL OR invocation_id_hash~'^[0-9a-f]{64}$')),
      CONSTRAINT orchestrator_gapdc_ids_check CHECK(
        char_length(id) BETWEEN 1 AND 128 AND char_length(workflow_id) BETWEEN 1 AND 128
        AND char_length(draft_id) BETWEEN 1 AND 128 AND char_length(publishing_request_id) BETWEEN 1 AND 128
        AND char_length(publish_approval_id) BETWEEN 1 AND 128 AND char_length(intent_id) BETWEEN 1 AND 128
        AND char_length(credential_ref_id) BETWEEN 1 AND 128 AND char_length(final_confirmation_id) BETWEEN 1 AND 128
        AND char_length(audit_ref) BETWEEN 1 AND 128),
      FOREIGN KEY(tenant_id,workflow_id) REFERENCES orchestrator_workflows(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,draft_id) REFERENCES orchestrator_campaign_drafts(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,draft_id,draft_revision)
        REFERENCES orchestrator_campaign_draft_revisions(tenant_id,draft_id,revision) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,publishing_request_id)
        REFERENCES orchestrator_campaign_publish_requests(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,publish_approval_id)
        REFERENCES orchestrator_campaign_publish_approvals(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,workflow_approval_id)
        REFERENCES orchestrator_approvals(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,intent_id)
        REFERENCES orchestrator_campaign_delivery_intents(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,credential_ref_id,credential_ref_version,account_fingerprint)
        REFERENCES orchestrator_tenant_google_ads_credential_refs(tenant_id,id,version,account_fingerprint)
        ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,final_confirmation_id)
        REFERENCES orchestrator_google_ads_provider_draft_confirmations(tenant_id,id) ON DELETE RESTRICT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_gapdc_one_live_authority
      ON orchestrator_google_ads_provider_draft_capabilities
        (tenant_id,draft_id,draft_revision,publishing_request_id,publish_approval_id,intent_id,account_fingerprint)
      WHERE status IN ('issued','reserved');
    CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_gapdc_unique_reservation
      ON orchestrator_google_ads_provider_draft_capabilities(tenant_id,reservation_id_hash)
      WHERE reservation_id_hash IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_gapdc_unique_invocation
      ON orchestrator_google_ads_provider_draft_capabilities(tenant_id,invocation_id_hash)
      WHERE invocation_id_hash IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_gapdc_unique_confirmation
      ON orchestrator_google_ads_provider_draft_capabilities(tenant_id,final_confirmation_hash);

    CREATE OR REPLACE FUNCTION orchestrator_tgacr_guard() RETURNS trigger AS $fn$ BEGIN
      IF TG_OP='INSERT' THEN
        IF NEW.status<>'active' OR NEW.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'orchestrator_tgacr_invalid_insert';END IF;
        RETURN NEW;
      END IF;
      IF TG_OP='DELETE' OR OLD.status<>'active' OR NEW.status<>'revoked' OR NEW.revoked_at IS NULL
        OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id
        OR NEW.platform IS DISTINCT FROM OLD.platform OR NEW.account_fingerprint IS DISTINCT FROM OLD.account_fingerprint
        OR NEW.version IS DISTINCT FROM OLD.version OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.updated_at<=OLD.updated_at
      THEN RAISE EXCEPTION 'orchestrator_tgacr_immutable';END IF;
      RETURN NEW;END;$fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_tgacr_guard ON orchestrator_tenant_google_ads_credential_refs;
    CREATE TRIGGER orchestrator_tgacr_guard BEFORE INSERT OR UPDATE OR DELETE
      ON orchestrator_tenant_google_ads_credential_refs FOR EACH ROW EXECUTE FUNCTION orchestrator_tgacr_guard();

    CREATE OR REPLACE FUNCTION orchestrator_gapdcf_guard() RETURNS trigger AS $fn$ BEGIN
      IF TG_OP='INSERT' THEN RETURN NEW;END IF;
      IF TG_OP='DELETE' OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL OR NEW.capability_id IS NULL
        OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id
        OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id OR NEW.session_id_hash IS DISTINCT FROM OLD.session_id_hash
        OR NEW.draft_id IS DISTINCT FROM OLD.draft_id OR NEW.draft_revision IS DISTINCT FROM OLD.draft_revision
        OR NEW.publishing_request_id IS DISTINCT FROM OLD.publishing_request_id
        OR NEW.publish_approval_id IS DISTINCT FROM OLD.publish_approval_id OR NEW.intent_id IS DISTINCT FROM OLD.intent_id
        OR NEW.credential_ref_id IS DISTINCT FROM OLD.credential_ref_id
        OR NEW.credential_ref_version IS DISTINCT FROM OLD.credential_ref_version
        OR NEW.phrase_hash IS DISTINCT FROM OLD.phrase_hash OR NEW.created_at IS DISTINCT FROM OLD.created_at
        OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN RAISE EXCEPTION 'orchestrator_gapdcf_immutable';END IF;
      RETURN NEW;END;$fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_gapdcf_guard ON orchestrator_google_ads_provider_draft_confirmations;
    CREATE TRIGGER orchestrator_gapdcf_guard BEFORE UPDATE OR DELETE
      ON orchestrator_google_ads_provider_draft_confirmations FOR EACH ROW EXECUTE FUNCTION orchestrator_gapdcf_guard();

    CREATE OR REPLACE FUNCTION orchestrator_gapdc_guard() RETURNS trigger AS $fn$ BEGIN
      IF TG_OP='INSERT' THEN
        IF NEW.status<>'issued' THEN RAISE EXCEPTION 'orchestrator_gapdc_invalid_insert';END IF;
        RETURN NEW;
      END IF;
      IF TG_OP='DELETE' THEN RAISE EXCEPTION 'orchestrator_gapdc_audit_evidence';END IF;
      IF OLD.status IN ('consumed','revoked','expired')
        OR NOT ((OLD.status='issued' AND NEW.status IN ('reserved','revoked','expired'))
          OR (OLD.status='reserved' AND NEW.status IN ('consumed','revoked','expired')))
        OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id
        OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id OR NEW.session_id_hash IS DISTINCT FROM OLD.session_id_hash
        OR NEW.workflow_id IS DISTINCT FROM OLD.workflow_id OR NEW.draft_id IS DISTINCT FROM OLD.draft_id
        OR NEW.draft_revision IS DISTINCT FROM OLD.draft_revision OR NEW.contract_hash IS DISTINCT FROM OLD.contract_hash
        OR NEW.publishing_request_id IS DISTINCT FROM OLD.publishing_request_id
        OR NEW.publish_approval_id IS DISTINCT FROM OLD.publish_approval_id
        OR NEW.workflow_approval_id IS DISTINCT FROM OLD.workflow_approval_id
        OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash OR NEW.intent_id IS DISTINCT FROM OLD.intent_id
        OR NEW.intent_hash IS DISTINCT FROM OLD.intent_hash OR NEW.credential_ref_id IS DISTINCT FROM OLD.credential_ref_id
        OR NEW.credential_ref_version IS DISTINCT FROM OLD.credential_ref_version
        OR NEW.account_fingerprint IS DISTINCT FROM OLD.account_fingerprint
        OR NEW.final_confirmation_id IS DISTINCT FROM OLD.final_confirmation_id
        OR NEW.final_confirmation_hash IS DISTINCT FROM OLD.final_confirmation_hash
        OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
        OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.audit_ref IS DISTINCT FROM OLD.audit_ref
        OR (OLD.reservation_id_hash IS NOT NULL AND NEW.reservation_id_hash IS DISTINCT FROM OLD.reservation_id_hash)
        OR (OLD.reserved_at IS NOT NULL AND NEW.reserved_at IS DISTINCT FROM OLD.reserved_at)
      THEN RAISE EXCEPTION 'orchestrator_gapdc_immutable';END IF;
      RETURN NEW;END;$fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_gapdc_guard ON orchestrator_google_ads_provider_draft_capabilities;
    CREATE TRIGGER orchestrator_gapdc_guard BEFORE INSERT OR UPDATE OR DELETE
      ON orchestrator_google_ads_provider_draft_capabilities FOR EACH ROW EXECUTE FUNCTION orchestrator_gapdc_guard();
  `);

  // PR10B.1 — tenant-leading Google Ads provider-operation ledger. Stores no
  // provider mutation, secrets, tokens, raw account identifiers, or payloads.
  // PR10B.2 — published/activated stay FALSE; external_action_taken may flip
  // FALSE→TRUE only on in_progress→succeeded with provider_create_succeeded.
  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_google_ads_provider_draft_operations(
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
      id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      session_id_hash TEXT NOT NULL,
      workflow_id TEXT NOT NULL,
      draft_id TEXT NOT NULL,
      draft_revision INTEGER NOT NULL,
      contract_hash TEXT NOT NULL,
      publishing_request_id TEXT NOT NULL,
      publish_approval_id TEXT NOT NULL,
      workflow_approval_id INTEGER NOT NULL,
      snapshot_hash TEXT NOT NULL,
      intent_id TEXT NOT NULL,
      intent_hash TEXT NOT NULL,
      capability_id TEXT NOT NULL,
      credential_ref_id TEXT NOT NULL,
      credential_ref_version INTEGER NOT NULL,
      account_fingerprint TEXT NOT NULL,
      reservation_id_hash TEXT NOT NULL,
      invocation_id_hash TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      provider_operation_key TEXT NOT NULL,
      requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL,
      started_at TIMESTAMPTZ NULL,
      settled_at TIMESTAMPTZ NULL,
      result_code TEXT NULL,
      published BOOLEAN NOT NULL DEFAULT FALSE,
      activated BOOLEAN NOT NULL DEFAULT FALSE,
      external_action_taken BOOLEAN NOT NULL DEFAULT FALSE,
      audit_ref TEXT NOT NULL,
      PRIMARY KEY(tenant_id,id),
      CONSTRAINT orchestrator_gapdo_tenant_unique_idemp UNIQUE(tenant_id,idempotency_key),
      CONSTRAINT orchestrator_gapdo_tenant_unique_capability UNIQUE(tenant_id,capability_id),
      CONSTRAINT orchestrator_gapdo_tenant_unique_invocation UNIQUE(tenant_id,invocation_id_hash),
      CONSTRAINT orchestrator_gapdo_tenant_unique_opkey UNIQUE(tenant_id,provider_operation_key),
      CONSTRAINT orchestrator_gapdo_tenant_unique_audit UNIQUE(tenant_id,audit_ref),
      CONSTRAINT orchestrator_gapdo_status_check
        CHECK(status IN ('pending','in_progress','succeeded','failed','unknown')),
      CONSTRAINT orchestrator_gapdo_no_mutation_check
        CHECK(published=FALSE AND activated=FALSE
          AND external_action_taken=(status='succeeded' AND result_code='provider_create_succeeded')),
      CONSTRAINT orchestrator_gapdo_lifecycle_check CHECK(
        (status='pending' AND started_at IS NULL AND settled_at IS NULL AND result_code IS NULL) OR
        (status='in_progress' AND started_at IS NOT NULL AND settled_at IS NULL AND result_code IS NULL) OR
        (status IN ('succeeded','failed','unknown') AND started_at IS NOT NULL AND settled_at IS NOT NULL AND result_code IS NOT NULL)),
      CONSTRAINT orchestrator_gapdo_result_check
        CHECK(result_code IS NULL OR result_code IN ('ready_for_provider','provider_create_failed','provider_outcome_unknown','provider_create_succeeded')),
      CONSTRAINT orchestrator_gapdo_actor_check CHECK(actor_user_id=requested_by),
      CONSTRAINT orchestrator_gapdo_hashes_check CHECK(
        session_id_hash~'^[0-9a-f]{64}$' AND contract_hash~'^[0-9a-f]{64}$'
        AND snapshot_hash~'^[0-9a-f]{64}$' AND intent_hash~'^[0-9a-f]{64}$'
        AND account_fingerprint~'^[0-9a-f]{64}$'
        AND reservation_id_hash~'^[0-9a-f]{64}$' AND invocation_id_hash~'^[0-9a-f]{64}$'),
      CONSTRAINT orchestrator_gapdo_revision_check CHECK(draft_revision>=1 AND credential_ref_version>=1),
      CONSTRAINT orchestrator_gapdo_ids_check CHECK(
        char_length(id) BETWEEN 1 AND 128 AND char_length(workflow_id) BETWEEN 1 AND 128
        AND char_length(draft_id) BETWEEN 1 AND 128 AND char_length(publishing_request_id) BETWEEN 1 AND 128
        AND char_length(publish_approval_id) BETWEEN 1 AND 128 AND char_length(intent_id) BETWEEN 1 AND 128
        AND char_length(capability_id) BETWEEN 1 AND 128 AND char_length(credential_ref_id) BETWEEN 1 AND 128
        AND char_length(provider_operation_key) BETWEEN 1 AND 128 AND char_length(audit_ref) BETWEEN 1 AND 128
        AND char_length(idempotency_key) BETWEEN 1 AND 256),
      FOREIGN KEY(tenant_id,workflow_id) REFERENCES orchestrator_workflows(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,draft_id) REFERENCES orchestrator_campaign_drafts(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,draft_id,draft_revision)
        REFERENCES orchestrator_campaign_draft_revisions(tenant_id,draft_id,revision) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,publishing_request_id)
        REFERENCES orchestrator_campaign_publish_requests(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,publish_approval_id)
        REFERENCES orchestrator_campaign_publish_approvals(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,workflow_approval_id)
        REFERENCES orchestrator_approvals(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,intent_id)
        REFERENCES orchestrator_campaign_delivery_intents(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,capability_id)
        REFERENCES orchestrator_google_ads_provider_draft_capabilities(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,credential_ref_id,credential_ref_version,account_fingerprint)
        REFERENCES orchestrator_tenant_google_ads_credential_refs(tenant_id,id,version,account_fingerprint)
        ON DELETE RESTRICT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_gapdo_one_live_operation
      ON orchestrator_google_ads_provider_draft_operations
        (tenant_id,draft_id,draft_revision,publishing_request_id,publish_approval_id,intent_id,account_fingerprint)
      WHERE status IN ('pending','in_progress');

    CREATE OR REPLACE FUNCTION orchestrator_gapdo_guard() RETURNS trigger AS $fn$ BEGIN
      IF TG_OP='INSERT' THEN
        IF NEW.status<>'pending' THEN RAISE EXCEPTION 'orchestrator_gapdo_invalid_insert';END IF;
        RETURN NEW;
      END IF;
      IF TG_OP='DELETE' THEN RAISE EXCEPTION 'orchestrator_gapdo_audit_evidence';END IF;
      IF OLD.status IN ('succeeded','failed','unknown')
        OR NOT ((OLD.status='pending' AND NEW.status='in_progress')
          OR (OLD.status='in_progress' AND NEW.status IN ('succeeded','failed','unknown')))
        OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id
        OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
        OR NEW.session_id_hash IS DISTINCT FROM OLD.session_id_hash
        OR NEW.workflow_id IS DISTINCT FROM OLD.workflow_id OR NEW.draft_id IS DISTINCT FROM OLD.draft_id
        OR NEW.draft_revision IS DISTINCT FROM OLD.draft_revision OR NEW.contract_hash IS DISTINCT FROM OLD.contract_hash
        OR NEW.publishing_request_id IS DISTINCT FROM OLD.publishing_request_id
        OR NEW.publish_approval_id IS DISTINCT FROM OLD.publish_approval_id
        OR NEW.workflow_approval_id IS DISTINCT FROM OLD.workflow_approval_id
        OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash OR NEW.intent_id IS DISTINCT FROM OLD.intent_id
        OR NEW.intent_hash IS DISTINCT FROM OLD.intent_hash OR NEW.capability_id IS DISTINCT FROM OLD.capability_id
        OR NEW.credential_ref_id IS DISTINCT FROM OLD.credential_ref_id
        OR NEW.credential_ref_version IS DISTINCT FROM OLD.credential_ref_version
        OR NEW.account_fingerprint IS DISTINCT FROM OLD.account_fingerprint
        OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
        OR NEW.provider_operation_key IS DISTINCT FROM OLD.provider_operation_key
        OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.audit_ref IS DISTINCT FROM OLD.audit_ref
        OR NEW.published IS DISTINCT FROM OLD.published OR NEW.activated IS DISTINCT FROM OLD.activated
        OR (NEW.external_action_taken IS DISTINCT FROM OLD.external_action_taken
          AND NOT (OLD.external_action_taken=FALSE AND NEW.external_action_taken=TRUE
            AND OLD.status='in_progress' AND NEW.status='succeeded'
            AND NEW.result_code='provider_create_succeeded'))
        OR (OLD.reservation_id_hash IS NOT NULL AND NEW.reservation_id_hash IS DISTINCT FROM OLD.reservation_id_hash)
        OR (OLD.invocation_id_hash IS NOT NULL AND NEW.invocation_id_hash IS DISTINCT FROM OLD.invocation_id_hash)
      THEN RAISE EXCEPTION 'orchestrator_gapdo_immutable';END IF;
      RETURN NEW;END;$fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_gapdo_guard ON orchestrator_google_ads_provider_draft_operations;
    CREATE TRIGGER orchestrator_gapdo_guard BEFORE INSERT OR UPDATE OR DELETE
      ON orchestrator_google_ads_provider_draft_operations FOR EACH ROW EXECUTE FUNCTION orchestrator_gapdo_guard();
  `);
  // PR10B.2 — idempotent fence migration for existing databases.
  await p.query('BEGIN');
  try {
    await p.query(`ALTER TABLE orchestrator_google_ads_provider_draft_operations
      DROP CONSTRAINT IF EXISTS orchestrator_gapdo_no_mutation_check`);
    await p.query(`ALTER TABLE orchestrator_google_ads_provider_draft_operations
      ADD CONSTRAINT orchestrator_gapdo_no_mutation_check CHECK(
        published=FALSE AND activated=FALSE
          AND external_action_taken=(status='succeeded' AND result_code='provider_create_succeeded')
      ) NOT VALID`);
    await p.query('COMMIT');
  } catch (e) { try { await p.query('ROLLBACK'); } catch (_) {} throw e; }

  // PR10B.2a — append-only evidence of the PAUSED, non-serving objects one
  // provider-draft operation actually created. Tenant-leading and linked to the
  // funded operation. Stores no OAuth material, no raw account identifier, no
  // request payload and no provider response body: only object lineage and the
  // reconciliation posture needed to prove what exists at the provider.
  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_google_ads_provider_draft_objects(
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
      id TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      capability_id TEXT NOT NULL,
      account_fingerprint TEXT NOT NULL,
      object_kind TEXT NOT NULL,
      sequence_number INTEGER NOT NULL,
      provider_object_id TEXT NOT NULL,
      provider_object_id_digest TEXT NOT NULL,
      provider_status TEXT NOT NULL,
      result_code TEXT NOT NULL,
      published BOOLEAN NOT NULL DEFAULT FALSE, activated BOOLEAN NOT NULL DEFAULT FALSE,
      serving BOOLEAN NOT NULL DEFAULT FALSE,
      requires_reconciliation BOOLEAN NOT NULL DEFAULT FALSE,
      reconciliation_state TEXT NOT NULL DEFAULT 'not_required',
      recorded_at TIMESTAMPTZ NOT NULL,
      audit_ref TEXT NOT NULL,
      PRIMARY KEY(tenant_id,id),
      CONSTRAINT orchestrator_gapdobj_tenant_unique_kind UNIQUE(tenant_id,operation_id,object_kind),
      CONSTRAINT orchestrator_gapdobj_tenant_unique_sequence UNIQUE(tenant_id,operation_id,sequence_number),
      CONSTRAINT orchestrator_gapdobj_tenant_unique_digest UNIQUE(tenant_id,provider_object_id_digest),
      CONSTRAINT orchestrator_gapdobj_tenant_unique_audit UNIQUE(tenant_id,audit_ref),
      CONSTRAINT orchestrator_gapdobj_kind_check CHECK(object_kind IN ('campaign_budget','campaign','ad_group')),
      CONSTRAINT orchestrator_gapdobj_sequence_check CHECK(
        sequence_number=CASE object_kind WHEN 'campaign_budget' THEN 1 WHEN 'campaign' THEN 2 ELSE 3 END),
      CONSTRAINT orchestrator_gapdobj_paused_check CHECK(provider_status='PAUSED' AND serving=FALSE AND published=FALSE AND activated=FALSE),
      CONSTRAINT orchestrator_gapdobj_result_check CHECK(result_code='provider_create_succeeded'),
      CONSTRAINT orchestrator_gapdobj_reconciliation_check CHECK(
        (requires_reconciliation=FALSE AND reconciliation_state='not_required')
        OR (requires_reconciliation=TRUE AND reconciliation_state='pending')),
      CONSTRAINT orchestrator_gapdobj_identifier_check CHECK(
        provider_object_id~'^[0-9]{1,32}$' AND provider_object_id_digest~'^[0-9a-f]{64}$'
        AND account_fingerprint~'^[0-9a-f]{64}$'
        AND char_length(id) BETWEEN 1 AND 128 AND char_length(operation_id) BETWEEN 1 AND 128
        AND char_length(capability_id) BETWEEN 1 AND 128 AND char_length(audit_ref) BETWEEN 1 AND 128),
      FOREIGN KEY(tenant_id,operation_id)
        REFERENCES orchestrator_google_ads_provider_draft_operations(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,capability_id)
        REFERENCES orchestrator_google_ads_provider_draft_capabilities(tenant_id,id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS orchestrator_gapdobj_operation_idx
      ON orchestrator_google_ads_provider_draft_objects(tenant_id,operation_id,sequence_number);

    CREATE OR REPLACE FUNCTION orchestrator_gapdobj_guard() RETURNS trigger AS $fn$
    DECLARE parent RECORD;BEGIN
      IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'orchestrator_gapdobj_immutable';END IF;
      IF TG_OP='DELETE' THEN RAISE EXCEPTION 'orchestrator_gapdobj_audit_evidence';END IF;
      SELECT status,capability_id,account_fingerprint INTO parent FROM
        orchestrator_google_ads_provider_draft_operations WHERE tenant_id=NEW.tenant_id AND id=NEW.operation_id;
      IF NOT FOUND OR parent.status NOT IN ('in_progress','succeeded')
        OR parent.capability_id IS DISTINCT FROM NEW.capability_id
        OR parent.account_fingerprint IS DISTINCT FROM NEW.account_fingerprint
      THEN RAISE EXCEPTION 'orchestrator_gapdobj_operation_lineage';END IF;
      RETURN NEW;END;$fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_gapdobj_guard ON orchestrator_google_ads_provider_draft_objects;
    CREATE TRIGGER orchestrator_gapdobj_guard BEFORE INSERT OR UPDATE OR DELETE
      ON orchestrator_google_ads_provider_draft_objects FOR EACH ROW EXECUTE FUNCTION orchestrator_gapdobj_guard();
  `);

  // PR10C.1 — tenant-leading Google Ads reconciliation read-authorizations.
  // Consume-once GET-only observation grant bound to one PR10B operation and
  // its three PAUSED objects. First-issuance only; no review-closure columns,
  // no runs table, no secrets or raw account identifiers.
  await _ensureNamedUnique(p, 'orchestrator_google_ads_provider_draft_operations',
    'orchestrator_gapdo_tenant_unique_id_fp', 'tenant_id, id, account_fingerprint');
  await _ensureNamedUnique(p, 'orchestrator_google_ads_provider_draft_operations',
    'orchestrator_gapdo_tenant_unique_id_snap', 'tenant_id, id, snapshot_hash');
  await _ensureNamedUnique(p, 'orchestrator_google_ads_provider_draft_operations',
    'orchestrator_gapdo_tenant_unique_id_cap', 'tenant_id, id, capability_id');
  await _ensureNamedUnique(p, 'orchestrator_google_ads_provider_draft_operations',
    'orchestrator_gapdo_tenant_unique_id_cred',
    'tenant_id, id, credential_ref_id, credential_ref_version, account_fingerprint');
  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_google_ads_reconciliation_read_authorizations(
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
      id TEXT NOT NULL,
      nonce_hash TEXT NOT NULL,
      requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      session_id_hash TEXT NOT NULL,
      workflow_id TEXT NOT NULL,
      draft_id TEXT NOT NULL,
      publishing_request_id TEXT NOT NULL,
      intent_id TEXT NOT NULL,
      snapshot_hash TEXT NOT NULL,
      intent_hash TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      capability_id TEXT NOT NULL,
      credential_ref_id TEXT NOT NULL,
      credential_ref_version INTEGER NOT NULL,
      account_fingerprint TEXT NOT NULL,
      ledger_root_hash TEXT NOT NULL,
      expected_object_kinds TEXT[] NOT NULL
        DEFAULT ARRAY['campaign_budget','campaign','ad_group']::TEXT[],
      status TEXT NOT NULL DEFAULT 'issued',
      invocation_id_hash TEXT NULL,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      reserved_at TIMESTAMPTZ NULL,
      consumed_at TIMESTAMPTZ NULL,
      revoked_at TIMESTAMPTZ NULL,
      audit_ref TEXT NOT NULL,
      PRIMARY KEY(tenant_id,id),
      CONSTRAINT orchestrator_garr_tenant_unique_nonce UNIQUE(tenant_id,nonce_hash),
      CONSTRAINT orchestrator_garr_tenant_unique_audit UNIQUE(tenant_id,audit_ref),
      CONSTRAINT orchestrator_garr_tenant_unique_operation_ledger
        UNIQUE(tenant_id,operation_id,ledger_root_hash),
      CONSTRAINT orchestrator_garr_status_check
        CHECK(status IN ('issued','reserved','consumed','revoked','expired')),
      CONSTRAINT orchestrator_garr_kinds_check CHECK(
        expected_object_kinds = ARRAY['campaign_budget','campaign','ad_group']::TEXT[]),
      CONSTRAINT orchestrator_garr_hashes_check CHECK(
        nonce_hash~'^[0-9a-f]{64}$' AND session_id_hash~'^[0-9a-f]{64}$'
        AND snapshot_hash~'^[0-9a-f]{64}$' AND intent_hash~'^[0-9a-f]{64}$'
        AND account_fingerprint~'^[0-9a-f]{64}$' AND ledger_root_hash~'^[0-9a-f]{64}$'
        AND (invocation_id_hash IS NULL OR invocation_id_hash~'^[0-9a-f]{64}$')),
      CONSTRAINT orchestrator_garr_ids_check CHECK(
        char_length(id) BETWEEN 1 AND 128 AND id~'^garr_'
        AND char_length(workflow_id) BETWEEN 1 AND 128 AND char_length(draft_id) BETWEEN 1 AND 128
        AND char_length(publishing_request_id) BETWEEN 1 AND 128 AND char_length(intent_id) BETWEEN 1 AND 128
        AND char_length(operation_id) BETWEEN 1 AND 128 AND char_length(capability_id) BETWEEN 1 AND 128
        AND char_length(credential_ref_id) BETWEEN 1 AND 128 AND char_length(audit_ref) BETWEEN 1 AND 128),
      CONSTRAINT orchestrator_garr_cred_ver_check CHECK(credential_ref_version>=1),
      CONSTRAINT orchestrator_garr_lifecycle_check CHECK(
        expires_at>issued_at
        AND ((status='issued' AND invocation_id_hash IS NULL
              AND reserved_at IS NULL AND consumed_at IS NULL AND revoked_at IS NULL)
          OR (status='reserved' AND invocation_id_hash~'^[0-9a-f]{64}$'
              AND reserved_at IS NOT NULL AND consumed_at IS NULL AND revoked_at IS NULL)
          OR (status='consumed' AND invocation_id_hash~'^[0-9a-f]{64}$'
              AND reserved_at IS NOT NULL AND consumed_at IS NOT NULL AND revoked_at IS NULL)
          OR (status='revoked' AND consumed_at IS NULL AND revoked_at IS NOT NULL)
          OR (status='expired' AND consumed_at IS NULL AND revoked_at IS NULL))),
      CONSTRAINT orchestrator_garr_workflow_fkey
        FOREIGN KEY(tenant_id,workflow_id)
        REFERENCES orchestrator_workflows(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_garr_draft_fkey
        FOREIGN KEY(tenant_id,draft_id)
        REFERENCES orchestrator_campaign_drafts(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_garr_request_fkey
        FOREIGN KEY(tenant_id,publishing_request_id)
        REFERENCES orchestrator_campaign_publish_requests(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_garr_intent_fkey
        FOREIGN KEY(tenant_id,intent_id)
        REFERENCES orchestrator_campaign_delivery_intents(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_garr_operation_fkey
        FOREIGN KEY(tenant_id,operation_id)
        REFERENCES orchestrator_google_ads_provider_draft_operations(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_garr_capability_fkey
        FOREIGN KEY(tenant_id,capability_id)
        REFERENCES orchestrator_google_ads_provider_draft_capabilities(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_garr_operation_account_fkey
        FOREIGN KEY(tenant_id,operation_id,account_fingerprint)
        REFERENCES orchestrator_google_ads_provider_draft_operations(tenant_id,id,account_fingerprint)
        ON DELETE RESTRICT,
      CONSTRAINT orchestrator_garr_operation_snapshot_fkey
        FOREIGN KEY(tenant_id,operation_id,snapshot_hash)
        REFERENCES orchestrator_google_ads_provider_draft_operations(tenant_id,id,snapshot_hash)
        ON DELETE RESTRICT,
      CONSTRAINT orchestrator_garr_operation_capability_fkey
        FOREIGN KEY(tenant_id,operation_id,capability_id)
        REFERENCES orchestrator_google_ads_provider_draft_operations(tenant_id,id,capability_id)
        ON DELETE RESTRICT,
      CONSTRAINT orchestrator_garr_operation_cred_fkey
        FOREIGN KEY(tenant_id,operation_id,credential_ref_id,credential_ref_version,account_fingerprint)
        REFERENCES orchestrator_google_ads_provider_draft_operations
          (tenant_id,id,credential_ref_id,credential_ref_version,account_fingerprint)
        ON DELETE RESTRICT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_garr_unique_invocation
      ON orchestrator_google_ads_reconciliation_read_authorizations(tenant_id,invocation_id_hash)
      WHERE invocation_id_hash IS NOT NULL;

    CREATE OR REPLACE FUNCTION orchestrator_garr_guard() RETURNS trigger AS $fn$
    DECLARE n INTEGER; BEGIN
      IF TG_OP='INSERT' THEN
        IF NEW.status<>'issued' THEN RAISE EXCEPTION 'orchestrator_garr_invalid_insert'; END IF;
        IF NOT EXISTS(SELECT 1 FROM orchestrator_google_ads_provider_draft_operations
          WHERE tenant_id=NEW.tenant_id AND id=NEW.operation_id)
        THEN RAISE EXCEPTION 'orchestrator_garr_operation_lineage'; END IF;
        SELECT count(*) INTO n FROM orchestrator_google_ads_provider_draft_objects
          WHERE tenant_id=NEW.tenant_id AND operation_id=NEW.operation_id
            AND object_kind=ANY(ARRAY['campaign_budget','campaign','ad_group']::TEXT[])
            AND provider_status='PAUSED' AND serving=FALSE
            AND published=FALSE AND activated=FALSE;
        IF n<>3 THEN RAISE EXCEPTION 'orchestrator_garr_object_lineage'; END IF;
        RETURN NEW;
      END IF;
      IF TG_OP='DELETE' THEN RAISE EXCEPTION 'orchestrator_garr_audit_evidence'; END IF;
      IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id
        OR NEW.nonce_hash IS DISTINCT FROM OLD.nonce_hash
        OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
        OR NEW.session_id_hash IS DISTINCT FROM OLD.session_id_hash
        OR NEW.workflow_id IS DISTINCT FROM OLD.workflow_id
        OR NEW.draft_id IS DISTINCT FROM OLD.draft_id
        OR NEW.publishing_request_id IS DISTINCT FROM OLD.publishing_request_id
        OR NEW.intent_id IS DISTINCT FROM OLD.intent_id
        OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash
        OR NEW.intent_hash IS DISTINCT FROM OLD.intent_hash
        OR NEW.operation_id IS DISTINCT FROM OLD.operation_id
        OR NEW.capability_id IS DISTINCT FROM OLD.capability_id
        OR NEW.credential_ref_id IS DISTINCT FROM OLD.credential_ref_id
        OR NEW.credential_ref_version IS DISTINCT FROM OLD.credential_ref_version
        OR NEW.account_fingerprint IS DISTINCT FROM OLD.account_fingerprint
        OR NEW.ledger_root_hash IS DISTINCT FROM OLD.ledger_root_hash
        OR NEW.expected_object_kinds IS DISTINCT FROM OLD.expected_object_kinds
        OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
        OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
        OR NEW.audit_ref IS DISTINCT FROM OLD.audit_ref
      THEN RAISE EXCEPTION 'orchestrator_garr_immutable_binding'; END IF;
      IF OLD.status IN ('consumed','revoked','expired')
        OR NOT ((OLD.status='issued' AND NEW.status IN ('reserved','revoked','expired'))
          OR (OLD.status='reserved' AND NEW.status IN ('consumed','revoked','expired')))
      THEN RAISE EXCEPTION 'orchestrator_garr_invalid_transition'; END IF;
      RETURN NEW;
    END; $fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_garr_guard
      ON orchestrator_google_ads_reconciliation_read_authorizations;
    CREATE TRIGGER orchestrator_garr_guard BEFORE INSERT OR UPDATE OR DELETE
      ON orchestrator_google_ads_reconciliation_read_authorizations
      FOR EACH ROW EXECUTE FUNCTION orchestrator_garr_guard();
  `);

  // PR10C.2 — immutable outcome of one consume-once Google Ads observation.
  // The run deliberately omits provider/customer identifiers, account/session
  // bindings and credential material. The insert guard binds every retained
  // lineage value to the still-locked PR10C.1 authorization.
  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_google_ads_reconciliation_runs(
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
      id TEXT NOT NULL,
      authorization_id TEXT NOT NULL,
      invocation_id_hash TEXT NOT NULL,
      requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      workflow_id TEXT NOT NULL,
      draft_id TEXT NOT NULL,
      publishing_request_id TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      snapshot_hash TEXT NOT NULL,
      intent_id TEXT NOT NULL,
      intent_hash TEXT NOT NULL,
      credential_ref_id TEXT NOT NULL,
      credential_ref_version INTEGER NOT NULL,
      ledger_root_hash TEXT NOT NULL,
      state TEXT NOT NULL,
      observations JSONB NOT NULL DEFAULT '[]'::jsonb,
      classifications TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      audit_ref TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      observing_at TIMESTAMPTZ NOT NULL,
      observation_deadline TIMESTAMPTZ NOT NULL,
      completed_at TIMESTAMPTZ NULL,
      PRIMARY KEY(tenant_id,id),
      CONSTRAINT orchestrator_garrun_unique_authorization UNIQUE(tenant_id,authorization_id),
      CONSTRAINT orchestrator_garrun_unique_invocation UNIQUE(tenant_id,invocation_id_hash),
      CONSTRAINT orchestrator_garrun_unique_audit UNIQUE(tenant_id,audit_ref),
      CONSTRAINT orchestrator_garrun_authorization_fkey FOREIGN KEY(tenant_id,authorization_id)
        REFERENCES orchestrator_google_ads_reconciliation_read_authorizations(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_garrun_workflow_fkey FOREIGN KEY(tenant_id,workflow_id)
        REFERENCES orchestrator_workflows(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_garrun_draft_workflow_fkey FOREIGN KEY(tenant_id,draft_id,workflow_id)
        REFERENCES orchestrator_campaign_drafts(tenant_id,id,workflow_id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_garrun_request_fkey FOREIGN KEY(tenant_id,publishing_request_id)
        REFERENCES orchestrator_campaign_publish_requests(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_garrun_intent_fkey FOREIGN KEY(tenant_id,intent_id)
        REFERENCES orchestrator_campaign_delivery_intents(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_garrun_operation_fkey FOREIGN KEY(tenant_id,operation_id)
        REFERENCES orchestrator_google_ads_provider_draft_operations(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_garrun_state_check
        CHECK(state IN ('observing','verified','discrepancy_detected','failed')),
      CONSTRAINT orchestrator_garrun_ids_check CHECK(
        char_length(id) BETWEEN 1 AND 128 AND id~'^garrun_'
        AND char_length(authorization_id) BETWEEN 1 AND 128
        AND char_length(workflow_id) BETWEEN 1 AND 128 AND char_length(draft_id) BETWEEN 1 AND 128
        AND char_length(publishing_request_id) BETWEEN 1 AND 128 AND char_length(operation_id) BETWEEN 1 AND 128
        AND char_length(intent_id) BETWEEN 1 AND 128 AND char_length(credential_ref_id) BETWEEN 1 AND 128
        AND char_length(audit_ref) BETWEEN 1 AND 128),
      CONSTRAINT orchestrator_garrun_hashes_check CHECK(
        invocation_id_hash~'^[0-9a-f]{64}$' AND snapshot_hash~'^[0-9a-f]{64}$'
        AND intent_hash~'^[0-9a-f]{64}$' AND ledger_root_hash~'^[0-9a-f]{64}$'),
      CONSTRAINT orchestrator_garrun_cred_ver_check CHECK(credential_ref_version>=1),
      CONSTRAINT orchestrator_garrun_observations_check CHECK(
        jsonb_typeof(observations)='array' AND jsonb_array_length(observations)<=3
        AND NOT jsonb_path_exists(observations,
          '$[*].keyvalue() ? (@.key != "object_kind" && @.key != "outcome" && @.key != "status_classification" && @.key != "account_binding_matches" && @.key != "campaign_parent_matches" && @.key != "budget_parent_matches" && @.key != "error_classification" && @.key != "observed_at")')),
      CONSTRAINT orchestrator_garrun_classifications_check CHECK(
        cardinality(classifications)=0 OR (cardinality(classifications)<=12
          AND array_to_string(classifications,',')~'^[a-z0-9_]{1,96}(,[a-z0-9_]{1,96})*$')),
      CONSTRAINT orchestrator_garrun_lifecycle_check CHECK(
        observation_deadline>observing_at
        AND ((state='observing' AND observations='[]'::jsonb AND cardinality(classifications)=0 AND completed_at IS NULL)
          OR (state IN ('verified','discrepancy_detected','failed') AND completed_at IS NOT NULL)))
    );

    CREATE OR REPLACE FUNCTION orchestrator_garrun_guard() RETURNS trigger AS $fn$
    DECLARE a orchestrator_google_ads_reconciliation_read_authorizations%ROWTYPE; BEGIN
      IF TG_OP='INSERT' THEN
        SELECT * INTO a FROM orchestrator_google_ads_reconciliation_read_authorizations
          WHERE tenant_id=NEW.tenant_id AND id=NEW.authorization_id FOR UPDATE;
        IF NOT FOUND OR a.status<>'issued' OR a.invocation_id_hash IS NOT NULL
          OR NEW.state<>'observing'
          OR NEW.requested_by IS DISTINCT FROM a.requested_by
          OR NEW.workflow_id IS DISTINCT FROM a.workflow_id OR NEW.draft_id IS DISTINCT FROM a.draft_id
          OR NEW.publishing_request_id IS DISTINCT FROM a.publishing_request_id
          OR NEW.operation_id IS DISTINCT FROM a.operation_id OR NEW.snapshot_hash IS DISTINCT FROM a.snapshot_hash
          OR NEW.intent_id IS DISTINCT FROM a.intent_id OR NEW.intent_hash IS DISTINCT FROM a.intent_hash
          OR NEW.credential_ref_id IS DISTINCT FROM a.credential_ref_id
          OR NEW.credential_ref_version IS DISTINCT FROM a.credential_ref_version
          OR NEW.ledger_root_hash IS DISTINCT FROM a.ledger_root_hash
        THEN RAISE EXCEPTION 'orchestrator_garrun_authorization_lineage'; END IF;
        RETURN NEW;
      END IF;
      IF TG_OP='DELETE' THEN RAISE EXCEPTION 'orchestrator_garrun_audit_evidence'; END IF;
      IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id
        OR NEW.authorization_id IS DISTINCT FROM OLD.authorization_id
        OR NEW.invocation_id_hash IS DISTINCT FROM OLD.invocation_id_hash
        OR NEW.requested_by IS DISTINCT FROM OLD.requested_by OR NEW.workflow_id IS DISTINCT FROM OLD.workflow_id
        OR NEW.draft_id IS DISTINCT FROM OLD.draft_id
        OR NEW.publishing_request_id IS DISTINCT FROM OLD.publishing_request_id
        OR NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash
        OR NEW.intent_id IS DISTINCT FROM OLD.intent_id OR NEW.intent_hash IS DISTINCT FROM OLD.intent_hash
        OR NEW.credential_ref_id IS DISTINCT FROM OLD.credential_ref_id
        OR NEW.credential_ref_version IS DISTINCT FROM OLD.credential_ref_version
        OR NEW.ledger_root_hash IS DISTINCT FROM OLD.ledger_root_hash OR NEW.audit_ref IS DISTINCT FROM OLD.audit_ref
        OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.observing_at IS DISTINCT FROM OLD.observing_at
        OR NEW.observation_deadline IS DISTINCT FROM OLD.observation_deadline
      THEN RAISE EXCEPTION 'orchestrator_garrun_immutable_lineage'; END IF;
      IF OLD.state<>'observing' OR NEW.state NOT IN ('verified','discrepancy_detected','failed')
      THEN RAISE EXCEPTION 'orchestrator_garrun_invalid_transition'; END IF;
      RETURN NEW;
    END; $fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_garrun_guard ON orchestrator_google_ads_reconciliation_runs;
    CREATE TRIGGER orchestrator_garrun_guard BEFORE INSERT OR UPDATE OR DELETE
      ON orchestrator_google_ads_reconciliation_runs FOR EACH ROW EXECUTE FUNCTION orchestrator_garrun_guard();
  `);

  // PR 8C — consumes one approved PR8B request without changing it. No provider
  // identifiers, credential references, source hashes, payloads, or errors are stored.
  // orchestrator_advertising_global_kill_switches is a platform-wide GLOBAL
  // singleton (PK switch_key). It must never receive tenant_id.
  await p.query(`
    CREATE TABLE IF NOT EXISTS orchestrator_advertising_global_kill_switches(
      switch_key TEXT PRIMARY KEY, active BOOLEAN NOT NULL DEFAULT false, version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT orchestrator_agks_key CHECK(switch_key IN ('optimization_execution','google_ads_provider_draft')),
      CONSTRAINT orchestrator_agks_version CHECK(version>0)
    );
    CREATE TABLE IF NOT EXISTS orchestrator_advertising_tenant_kill_switches(
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, switch_key TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT false, version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(tenant_id,switch_key),
      CONSTRAINT orchestrator_atks_key CHECK(switch_key IN ('optimization_execution','google_ads_provider_draft')),
      CONSTRAINT orchestrator_atks_version CHECK(version>0)
    );
    CREATE OR REPLACE FUNCTION orchestrator_advertising_kill_switch_guard() RETURNS trigger AS $fn$ BEGIN
      IF TG_OP='DELETE' THEN
        IF TG_TABLE_NAME='orchestrator_advertising_global_kill_switches' OR pg_trigger_depth()=1 THEN
          RAISE EXCEPTION 'orchestrator_advertising_kill_switch_delete_prohibited';
        END IF;
        RETURN OLD;
      END IF;
      IF NEW.switch_key IS DISTINCT FROM OLD.switch_key OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'orchestrator_advertising_kill_switch_identity_immutable';
      END IF;
      IF TG_TABLE_NAME='orchestrator_advertising_tenant_kill_switches' THEN
        IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
          RAISE EXCEPTION 'orchestrator_advertising_kill_switch_identity_immutable';
        END IF;
      END IF;
      IF NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at THEN
        RAISE EXCEPTION 'orchestrator_advertising_kill_switch_invalid_version';
      END IF;
      RETURN NEW;
    END;$fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_agks_guard ON orchestrator_advertising_global_kill_switches;
    CREATE TRIGGER orchestrator_agks_guard BEFORE UPDATE OR DELETE ON orchestrator_advertising_global_kill_switches FOR EACH ROW EXECUTE FUNCTION orchestrator_advertising_kill_switch_guard();
    DROP TRIGGER IF EXISTS orchestrator_atks_guard ON orchestrator_advertising_tenant_kill_switches;
    CREATE TRIGGER orchestrator_atks_guard BEFORE UPDATE OR DELETE ON orchestrator_advertising_tenant_kill_switches FOR EACH ROW EXECUTE FUNCTION orchestrator_advertising_kill_switch_guard();
    DO $migration$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='orchestrator_advertising_tenant_kill_switches'::regclass AND conname='orchestrator_advertising_tenant_kill_switches_tenant_id_fkey' AND confdeltype='c') THEN
        ALTER TABLE orchestrator_advertising_tenant_kill_switches DROP CONSTRAINT IF EXISTS orchestrator_advertising_tenant_kill_switches_tenant_id_fkey;
        ALTER TABLE orchestrator_advertising_tenant_kill_switches ADD CONSTRAINT orchestrator_advertising_tenant_kill_switches_tenant_id_fkey FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
      END IF;
    END $migration$;
    ALTER TABLE orchestrator_advertising_global_kill_switches DROP CONSTRAINT IF EXISTS orchestrator_agks_key;
    ALTER TABLE orchestrator_advertising_global_kill_switches ADD CONSTRAINT orchestrator_agks_key
      CHECK(switch_key IN ('optimization_execution','google_ads_provider_draft'));
    ALTER TABLE orchestrator_advertising_tenant_kill_switches DROP CONSTRAINT IF EXISTS orchestrator_atks_key;
    ALTER TABLE orchestrator_advertising_tenant_kill_switches ADD CONSTRAINT orchestrator_atks_key
      CHECK(switch_key IN ('optimization_execution','google_ads_provider_draft'));
    INSERT INTO orchestrator_advertising_global_kill_switches(switch_key,active)
      VALUES('optimization_execution',false),('google_ads_provider_draft',false)
      ON CONFLICT(switch_key) DO NOTHING;
    DO $backfill$ DECLARE tenant_row RECORD; BEGIN
      FOR tenant_row IN SELECT id FROM tenants LOOP
        BEGIN
          INSERT INTO orchestrator_advertising_tenant_kill_switches(tenant_id,switch_key,active)
            VALUES(tenant_row.id,'optimization_execution',false),(tenant_row.id,'google_ads_provider_draft',false)
            ON CONFLICT(tenant_id,switch_key) DO NOTHING;
        EXCEPTION WHEN foreign_key_violation THEN NULL;
        END;
      END LOOP;
    END $backfill$;
    CREATE OR REPLACE FUNCTION orchestrator_seed_advertising_kill_switch() RETURNS trigger AS $fn$ BEGIN
      INSERT INTO orchestrator_advertising_tenant_kill_switches(tenant_id,switch_key,active)
        VALUES(NEW.id,'optimization_execution',false),(NEW.id,'google_ads_provider_draft',false);
      RETURN NEW;END;$fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_seed_advertising_kill_switch ON tenants;
    CREATE TRIGGER orchestrator_seed_advertising_kill_switch AFTER INSERT ON tenants FOR EACH ROW EXECUTE FUNCTION orchestrator_seed_advertising_kill_switch();

    CREATE TABLE IF NOT EXISTS orchestrator_optimization_executions(
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
      id TEXT NOT NULL, request_id TEXT NOT NULL, request_version INTEGER NOT NULL,
      recommendation_set_id TEXT NOT NULL, recommendation_id TEXT NOT NULL, monitoring_run_id TEXT NOT NULL,
      case_id TEXT NULL, case_version INTEGER NULL, case_resolution_event_id TEXT NULL,
      activation_attempt_id TEXT NOT NULL, capability_id TEXT NOT NULL, workflow_id TEXT NOT NULL,
      draft_id TEXT NOT NULL, draft_revision INTEGER NOT NULL, publishing_request_id TEXT NOT NULL,
      publish_approval_id TEXT NOT NULL, delivery_intent_id TEXT NOT NULL,
      provider_execution_metadata_id TEXT NOT NULL, reconciliation_run_id TEXT NOT NULL,
      approved_action TEXT NOT NULL, execution_mode TEXT NOT NULL DEFAULT 'internal_simulation',
      invocation_id TEXT NOT NULL, invocation_hash TEXT NOT NULL, invocation_input_hash TEXT NOT NULL,
      reservation_hash TEXT NOT NULL, attempt_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'reserved', version INTEGER NOT NULL DEFAULT 1,
      invoking_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      approved_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      reserved_at TIMESTAMPTZ NOT NULL DEFAULT now(), started_at TIMESTAMPTZ NULL,
      completed_at TIMESTAMPTZ NULL, failed_at TIMESTAMPTZ NULL,
      result_code TEXT NULL, provider_contacted BOOLEAN NOT NULL DEFAULT false,
      provider_mutation_performed BOOLEAN NOT NULL DEFAULT false,
      audit_ref TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,request_id), UNIQUE(tenant_id,invocation_hash),
      UNIQUE(tenant_id,attempt_id), UNIQUE(tenant_id,audit_ref),
      FOREIGN KEY(tenant_id,request_id) REFERENCES orchestrator_optimization_execution_requests(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,recommendation_set_id) REFERENCES orchestrator_campaign_optimization_recommendation_sets(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,recommendation_id) REFERENCES orchestrator_campaign_optimization_recommendations(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,monitoring_run_id) REFERENCES orchestrator_campaign_monitoring_runs(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,case_id) REFERENCES orchestrator_campaign_delivery_discrepancy_cases(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,activation_attempt_id) REFERENCES orchestrator_campaign_activation_attempts(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,capability_id) REFERENCES orchestrator_campaign_activation_capabilities(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,workflow_id) REFERENCES orchestrator_workflows(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,draft_id) REFERENCES orchestrator_campaign_drafts(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,publishing_request_id) REFERENCES orchestrator_campaign_publish_requests(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,publish_approval_id) REFERENCES orchestrator_campaign_publish_approvals(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,delivery_intent_id) REFERENCES orchestrator_campaign_delivery_intents(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,provider_execution_metadata_id) REFERENCES orchestrator_campaign_provider_draft_executions(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,reconciliation_run_id) REFERENCES orchestrator_campaign_reconciliation_runs(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_oxe_state CHECK(state IN('reserved','running','succeeded','failed','indeterminate','cancelled')),
      CONSTRAINT orchestrator_oxe_action CHECK(approved_action IN('review_delivery_configuration','review_campaign_configuration','review_credential_configuration','prepare_campaign_remediation')),
      CONSTRAINT orchestrator_oxe_mode CHECK(execution_mode='internal_simulation' AND provider_contacted=false AND provider_mutation_performed=false),
      CONSTRAINT orchestrator_oxe_result CHECK(result_code IS NULL OR result_code IN('internal_review_recorded','remediation_plan_prepared','internal_execution_failed','internal_outcome_indeterminate')),
      CONSTRAINT orchestrator_oxe_shape CHECK(version>=1 AND request_version>=1 AND draft_revision>=1
        AND invocation_id~'^[A-Za-z0-9_.:-]{1,100}$' AND invocation_hash~'^[0-9a-f]{64}$'
        AND invocation_input_hash~'^[0-9a-f]{64}$' AND reservation_hash~'^[0-9a-f]{64}$'
        AND attempt_id~'^attempt_[0-9a-f-]{36}$' AND invoking_user_id>0 AND approved_by_user_id>0
        AND ((case_id IS NULL AND case_version IS NULL AND case_resolution_event_id IS NULL) OR (case_id IS NOT NULL AND case_version>=1 AND case_resolution_event_id IS NOT NULL))
        AND ((state='reserved' AND version=1 AND started_at IS NULL AND completed_at IS NULL AND failed_at IS NULL AND result_code IS NULL)
          OR (state='running' AND version=2 AND started_at IS NOT NULL AND completed_at IS NULL AND failed_at IS NULL AND result_code IS NULL)
          OR (state='succeeded' AND version=3 AND started_at IS NOT NULL AND completed_at IS NOT NULL AND failed_at IS NULL AND result_code IN('internal_review_recorded','remediation_plan_prepared'))
          OR (state IN('failed','indeterminate') AND version=3 AND started_at IS NOT NULL AND completed_at IS NULL AND failed_at IS NOT NULL AND result_code IN('internal_execution_failed','internal_outcome_indeterminate'))
          OR (state='cancelled' AND version=2 AND started_at IS NULL AND completed_at IS NULL AND failed_at IS NULL AND result_code IS NULL)))
    );
    CREATE INDEX IF NOT EXISTS orchestrator_oxe_list ON orchestrator_optimization_executions(tenant_id,id DESC);
    CREATE TABLE IF NOT EXISTS orchestrator_optimization_execution_run_events(
      tenant_id INTEGER NOT NULL, id BIGSERIAL, execution_id TEXT NOT NULL, execution_version INTEGER NOT NULL,
      previous_state TEXT NULL, new_state TEXT NOT NULL, event_type TEXT NOT NULL,
      actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT, audit_ref TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id),
      UNIQUE(tenant_id,execution_id,execution_version), UNIQUE(tenant_id,audit_ref),
      FOREIGN KEY(tenant_id,execution_id) REFERENCES orchestrator_optimization_executions(tenant_id,id) ON DELETE RESTRICT,
      CONSTRAINT orchestrator_oxee_state CHECK(new_state IN('reserved','running','succeeded','failed','indeterminate','cancelled') AND event_type=new_state),
      CONSTRAINT orchestrator_oxee_shape CHECK(execution_version BETWEEN 1 AND 3 AND actor_user_id>0 AND
        ((execution_version=1 AND previous_state IS NULL AND new_state='reserved')
          OR (execution_version=2 AND previous_state='reserved' AND new_state IN('running','cancelled'))
          OR (execution_version=3 AND previous_state='running' AND new_state IN('succeeded','failed','indeterminate'))))
    );
    CREATE OR REPLACE FUNCTION orchestrator_oxe_guard() RETURNS trigger AS $fn$ BEGIN
      IF TG_OP='DELETE' THEN RAISE EXCEPTION 'orchestrator_oxe_delete_prohibited';END IF;
      IF OLD.state IN('succeeded','failed','indeterminate','cancelled') THEN RAISE EXCEPTION 'orchestrator_oxe_terminal_immutable';END IF;
      IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.request_version IS DISTINCT FROM OLD.request_version OR NEW.recommendation_set_id IS DISTINCT FROM OLD.recommendation_set_id OR NEW.recommendation_id IS DISTINCT FROM OLD.recommendation_id OR NEW.monitoring_run_id IS DISTINCT FROM OLD.monitoring_run_id OR NEW.case_id IS DISTINCT FROM OLD.case_id OR NEW.case_version IS DISTINCT FROM OLD.case_version OR NEW.case_resolution_event_id IS DISTINCT FROM OLD.case_resolution_event_id OR NEW.activation_attempt_id IS DISTINCT FROM OLD.activation_attempt_id OR NEW.capability_id IS DISTINCT FROM OLD.capability_id OR NEW.workflow_id IS DISTINCT FROM OLD.workflow_id OR NEW.draft_id IS DISTINCT FROM OLD.draft_id OR NEW.draft_revision IS DISTINCT FROM OLD.draft_revision OR NEW.publishing_request_id IS DISTINCT FROM OLD.publishing_request_id OR NEW.publish_approval_id IS DISTINCT FROM OLD.publish_approval_id OR NEW.delivery_intent_id IS DISTINCT FROM OLD.delivery_intent_id OR NEW.provider_execution_metadata_id IS DISTINCT FROM OLD.provider_execution_metadata_id OR NEW.reconciliation_run_id IS DISTINCT FROM OLD.reconciliation_run_id OR NEW.approved_action IS DISTINCT FROM OLD.approved_action OR NEW.execution_mode IS DISTINCT FROM OLD.execution_mode OR NEW.invocation_id IS DISTINCT FROM OLD.invocation_id OR NEW.invocation_hash IS DISTINCT FROM OLD.invocation_hash OR NEW.invocation_input_hash IS DISTINCT FROM OLD.invocation_input_hash OR NEW.reservation_hash IS DISTINCT FROM OLD.reservation_hash OR NEW.attempt_id IS DISTINCT FROM OLD.attempt_id OR NEW.invoking_user_id IS DISTINCT FROM OLD.invoking_user_id OR NEW.approved_by_user_id IS DISTINCT FROM OLD.approved_by_user_id OR NEW.provider_contacted IS DISTINCT FROM OLD.provider_contacted OR NEW.provider_mutation_performed IS DISTINCT FROM OLD.provider_mutation_performed OR NEW.audit_ref IS DISTINCT FROM OLD.audit_ref OR NEW.reserved_at IS DISTINCT FROM OLD.reserved_at OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'orchestrator_oxe_immutable_lineage';END IF;
      IF NEW.version<>OLD.version+1 OR NOT ((OLD.state='reserved' AND NEW.state IN('running','cancelled')) OR (OLD.state='running' AND NEW.state IN('succeeded','failed','indeterminate'))) THEN RAISE EXCEPTION 'orchestrator_oxe_invalid_transition';END IF;RETURN NEW;END;$fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_oxe_guard ON orchestrator_optimization_executions;
    CREATE TRIGGER orchestrator_oxe_guard BEFORE UPDATE OR DELETE ON orchestrator_optimization_executions FOR EACH ROW EXECUTE FUNCTION orchestrator_oxe_guard();
    CREATE OR REPLACE FUNCTION orchestrator_oxee_guard() RETURNS trigger AS $fn$ DECLARE r orchestrator_optimization_executions%ROWTYPE;BEGIN IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'orchestrator_oxee_append_only';END IF;SELECT * INTO r FROM orchestrator_optimization_executions WHERE tenant_id=NEW.tenant_id AND id=NEW.execution_id;IF NOT FOUND OR r.version<>NEW.execution_version OR r.state<>NEW.new_state THEN RAISE EXCEPTION 'orchestrator_oxee_execution_mismatch';END IF;IF NEW.execution_version>1 AND NOT EXISTS(SELECT 1 FROM orchestrator_optimization_execution_run_events WHERE tenant_id=NEW.tenant_id AND execution_id=NEW.execution_id AND execution_version=NEW.execution_version-1 AND new_state=NEW.previous_state) THEN RAISE EXCEPTION 'orchestrator_oxee_nonmonotonic';END IF;RETURN NEW;END;$fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_oxee_guard ON orchestrator_optimization_execution_run_events;
    CREATE TRIGGER orchestrator_oxee_guard BEFORE INSERT OR UPDATE OR DELETE ON orchestrator_optimization_execution_run_events FOR EACH ROW EXECUTE FUNCTION orchestrator_oxee_guard();
    CREATE OR REPLACE FUNCTION orchestrator_oxe_event_consistency() RETURNS trigger AS $fn$ BEGIN IF NOT EXISTS(SELECT 1 FROM orchestrator_optimization_execution_run_events WHERE tenant_id=NEW.tenant_id AND execution_id=NEW.id AND execution_version=NEW.version AND new_state=NEW.state) THEN RAISE EXCEPTION 'orchestrator_oxe_event_required';END IF;RETURN NULL;END;$fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS orchestrator_oxe_event_consistency ON orchestrator_optimization_executions;
    CREATE CONSTRAINT TRIGGER orchestrator_oxe_event_consistency AFTER INSERT OR UPDATE ON orchestrator_optimization_executions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION orchestrator_oxe_event_consistency();
  `);

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

  // Undo accidental addTenantIdColumn injection from a prior
  // ADVERTISING_ORCH_TABLES listing. Catalog-check first: a converged boot
  // must not issue no-op DROP/ALTER (those take ACCESS EXCLUSIVE).
  // Do not re-list this table in ADVERTISING_ORCH_TABLES or NULLABLE_OK.
  const globalKillTable = 'orchestrator_advertising_global_kill_switches';
  const hasAccidentalTenantId = await _columnExists(p, globalKillTable, 'tenant_id');
  const hasAccidentalTenantIdx = (await p.query(
    `SELECT 1 FROM pg_indexes
      WHERE schemaname='public' AND indexname=$1 LIMIT 1`,
    ['orchestrator_advertising_global_kill_switches_tenant_idx']
  )).rowCount > 0;
  if (hasAccidentalTenantIdx) {
    await p.query('DROP INDEX IF EXISTS orchestrator_advertising_global_kill_switches_tenant_idx');
  }
  if (hasAccidentalTenantId) {
    await p.query('ALTER TABLE orchestrator_advertising_global_kill_switches DROP COLUMN IF EXISTS tenant_id');
  }

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
