'use strict';
// PR 6F-1R — reconciliation-ready provider lineage: transactional upgrade + scratch DB.

process.env.PERMISSION_ENFORCEMENT = 'on';
process.env.MULTITENANT_ENFORCEMENT = 'on';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const {
  scratchName,
  swapDatabase,
  createScratchDatabase,
  dropScratchDatabase,
  SSL,
} = require('./helpers/scratch_db');

const ADMIN_URL = process.env.DATABASE_URL || '';
const db = require('../db');
if (db.hasDb()) db.getPool();

const { ensureAgentOrchestratorSchema } = require('../services/agent_orchestrator/schema');
const { ensureTenantSchema } = require('../services/tenants/schema');
const { ensureAuthSchema } = require('../services/auth/schema');

const HAS_DB = !!ADMIN_URL;
const SCHEMA_SRC = fs.readFileSync(
  path.join(__dirname, '../services/agent_orchestrator/schema.js'),
  'utf8'
);

const HEX = 'a'.repeat(64);
const SUFFIX = `${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
const NSU_ROLE = `ao6f1rnsu${SUFFIX}`.slice(0, 63);
const NSU_PASS = crypto.randomBytes(16).toString('hex');
const SCRATCH_DB = scratchName('lin6f1r');
const SCRATCH_URL = ADMIN_URL ? swapDatabase(ADMIN_URL, SCRATCH_DB) : '';

let seq = 0;
const nid = (p) => { seq += 1; return `${p}-${SUFFIX}-${seq}`; };
const nextHex = () => { seq += 1; return seq.toString(16).padStart(64, '0'); };
const sha256Hex = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');

function extractFn(src, name) {
  const start = src.indexOf(`async function ${name}`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = src.indexOf('\nasync function ', start + 1);
  const cut = end > start ? end : src.indexOf('\nmodule.exports', start);
  return src.slice(start, cut > start ? cut : src.length);
}

test('PR6F-1R schema source keeps adset kind and append-only compensation events', () => {
  assert.match(SCHEMA_SRC, /object_kind IN \('campaign','adset','creative','ad'\)/);
  assert.doesNotMatch(SCHEMA_SRC, /object_kind IN \('campaign','ad_set'/);
  assert.match(SCHEMA_SRC, /CREATE TABLE IF NOT EXISTS orchestrator_campaign_provider_object_events/);
  assert.match(SCHEMA_SRC, /orchestrator_cpoe_immutable/);
  assert.match(SCHEMA_SRC, /orchestrator_cpdex_cardinality/);
  assert.match(SCHEMA_SRC, /credential_ref_version INTEGER NOT NULL/);
  assert.match(SCHEMA_SRC, /provider_object_id_digest TEXT NOT NULL/);
  assert.doesNotMatch(SCHEMA_SRC, /SET compensated=TRUE/);
  const dropIdx = SCHEMA_SRC.indexOf('DROP TRIGGER IF EXISTS orchestrator_cpdex_guard ON orchestrator_campaign_provider_draft_executions');
  const backfillIdx = SCHEMA_SRC.indexOf('SET credential_ref_version = r.version');
  assert.ok(dropIdx > 0 && dropIdx < backfillIdx, 'immutability guards must drop before lineage backfill');
  assert.match(SCHEMA_SRC, /encode\(sha256\(convert_to/);
  assert.doesNotMatch(SCHEMA_SRC, /digest\(convert_to/);
  assert.doesNotMatch(SCHEMA_SRC, /CREATE EXTENSION/);
  assert.doesNotMatch(SCHEMA_SRC, /pgcrypto/);
});

test('PR6F-1R upgrade helper is one transaction: BEGIN before DROP TRIGGER, COMMIT after new guards', () => {
  const fn = extractFn(SCHEMA_SRC, '_upgradePr6f1rProviderLineage');
  const beginIdx = fn.indexOf("await p.query('BEGIN')");
  const dropIdx = fn.indexOf('DROP TRIGGER IF EXISTS orchestrator_cpdex_guard ON orchestrator_campaign_provider_draft_executions');
  const guardIdx = fn.lastIndexOf('CREATE TRIGGER orchestrator_cpoe_guard');
  const commitIdx = fn.indexOf("await p.query('COMMIT')");
  assert.ok(beginIdx >= 0 && dropIdx > beginIdx, 'BEGIN must precede DROP TRIGGER');
  assert.ok(guardIdx > dropIdx, 'new cpoe_guard must follow DROP TRIGGER');
  assert.ok(commitIdx > guardIdx, 'COMMIT must follow new guards');
  assert.match(fn, /encode\(sha256\(convert_to/);
  assert.doesNotMatch(fn, /_ensureNamedCheck\(/);
  assert.doesNotMatch(fn, /_ensureNamedFk\(/);
  assert.doesNotMatch(fn, /_ensureNamedUnique\(/);
  assert.doesNotMatch(fn, /_installInTransaction\(/);
});

const PR6F1_EXECUTIONS_SQL = `
CREATE TABLE orchestrator_campaign_provider_draft_executions (
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
)`;

const PR6F1_OBJECTS_SQL = `
CREATE TABLE orchestrator_campaign_provider_objects (
  id TEXT NOT NULL,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  execution_id TEXT NOT NULL,
  confirmation_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  object_kind TEXT NOT NULL,
  provider_object_id TEXT NOT NULL,
  provider_status TEXT NOT NULL DEFAULT 'PAUSED',
  sequence_number INTEGER NOT NULL,
  compensated BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  compensated_at TIMESTAMPTZ NULL,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT orchestrator_cpo_tenant_execution_seq
    UNIQUE (tenant_id, execution_id, sequence_number),
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
  CONSTRAINT orchestrator_cpo_len_check CHECK (
    char_length(id) BETWEEN 1 AND 128
    AND char_length(execution_id) BETWEEN 1 AND 128
    AND char_length(confirmation_id) BETWEEN 1 AND 128
    AND char_length(attempt_id) BETWEEN 1 AND 128
    AND char_length(provider_object_id) BETWEEN 1 AND 128
    AND char_length(object_kind) BETWEEN 1 AND 32
  )
)`;

const PR6F1_GUARDS_SQL = `
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
    IF OLD.compensated IS DISTINCT FROM FALSE
       OR NEW.id IS DISTINCT FROM OLD.id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.execution_id IS DISTINCT FROM OLD.execution_id
       OR NEW.confirmation_id IS DISTINCT FROM OLD.confirmation_id
       OR NEW.attempt_id IS DISTINCT FROM OLD.attempt_id
       OR NEW.object_kind IS DISTINCT FROM OLD.object_kind
       OR NEW.provider_object_id IS DISTINCT FROM OLD.provider_object_id
       OR NEW.provider_status IS DISTINCT FROM OLD.provider_status
       OR NEW.sequence_number IS DISTINCT FROM OLD.sequence_number
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.compensated IS DISTINCT FROM TRUE
       OR NEW.compensated_at IS NULL
    THEN
      RAISE EXCEPTION 'orchestrator_cpo_immutable';
    END IF;
    RETURN NEW;
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
`;

function poolFor(url) {
  return new Pool({ connectionString: url, ssl: SSL, max: 5 });
}

async function withPool(pool, fn) {
  const orig = db.getPool;
  db.getPool = () => pool;
  try {
    return await fn();
  } finally {
    db.getPool = orig;
  }
}

async function columnsOf(pool, table) {
  const r = await pool.query(
    `SELECT column_name, is_nullable
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1
      ORDER BY column_name`,
    [table]
  );
  return r.rows;
}

async function functionDef(pool, name) {
  const r = await pool.query(
    `SELECT pg_get_functiondef(p.oid) AS def
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='public' AND p.proname=$1
      LIMIT 1`,
    [name]
  );
  return r.rowCount ? r.rows[0].def : '';
}

async function triggerNames(pool, table) {
  const r = await pool.query(
    `SELECT tgname FROM pg_trigger
      WHERE tgrelid = $1::regclass AND NOT tgisinternal
      ORDER BY tgname`,
    [`public.${table}`]
  );
  return r.rows.map((row) => row.tgname);
}

async function installPr6f1Ledger(pool) {
  await pool.query(`DROP TABLE IF EXISTS orchestrator_campaign_provider_object_events`);
  await pool.query(`DROP TABLE IF EXISTS orchestrator_campaign_provider_objects CASCADE`);
  await pool.query(`DROP TABLE IF EXISTS orchestrator_campaign_provider_draft_executions CASCADE`);
  await pool.query(PR6F1_EXECUTIONS_SQL);
  await pool.query(`
    ALTER TABLE orchestrator_campaign_provider_draft_executions
      ADD CONSTRAINT orchestrator_cpdex_tenant_confirmation_fkey
      FOREIGN KEY (tenant_id, confirmation_id)
      REFERENCES orchestrator_campaign_provider_confirmations (tenant_id, id)
      ON DELETE CASCADE
  `);
  await pool.query(`
    ALTER TABLE orchestrator_campaign_provider_draft_executions
      ADD CONSTRAINT orchestrator_cpdex_tenant_attempt_fkey
      FOREIGN KEY (tenant_id, attempt_id)
      REFERENCES orchestrator_campaign_delivery_attempts (tenant_id, id)
      ON DELETE CASCADE
  `);
  await pool.query(`CREATE INDEX idx_cpdex_tenant_attempt
    ON orchestrator_campaign_provider_draft_executions (tenant_id, attempt_id)`);
  await pool.query(PR6F1_OBJECTS_SQL);
  await pool.query(`
    ALTER TABLE orchestrator_campaign_provider_objects
      ADD CONSTRAINT orchestrator_cpo_tenant_execution_fkey
      FOREIGN KEY (tenant_id, execution_id)
      REFERENCES orchestrator_campaign_provider_draft_executions (tenant_id, id)
      ON DELETE CASCADE
  `);
  await pool.query(`
    ALTER TABLE orchestrator_campaign_provider_objects
      ADD CONSTRAINT orchestrator_cpo_tenant_confirmation_fkey
      FOREIGN KEY (tenant_id, confirmation_id)
      REFERENCES orchestrator_campaign_provider_confirmations (tenant_id, id)
      ON DELETE CASCADE
  `);
  await pool.query(`
    ALTER TABLE orchestrator_campaign_provider_objects
      ADD CONSTRAINT orchestrator_cpo_tenant_attempt_fkey
      FOREIGN KEY (tenant_id, attempt_id)
      REFERENCES orchestrator_campaign_delivery_attempts (tenant_id, id)
      ON DELETE CASCADE
  `);
  await pool.query(`CREATE INDEX idx_cpo_tenant_execution
    ON orchestrator_campaign_provider_objects (tenant_id, execution_id, sequence_number)`);
  await pool.query(PR6F1_GUARDS_SQL);
}

async function grantOrchestratorMigrator(admin, name) {
  await admin.query(`GRANT SELECT, REFERENCES ON TABLE tenants TO ${name}`);
  const users = await admin.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users'`
  );
  if (users.rowCount) {
    await admin.query(`GRANT SELECT, REFERENCES ON TABLE users TO ${name}`);
  }
  await admin.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${name}`);
  const tables = (await admin.query(`
    SELECT tablename FROM pg_tables
     WHERE schemaname='public'
       AND (tablename LIKE 'orchestrator_%' OR tablename = 'agent_orchestrator_runs')
  `)).rows;
  for (const t of tables) {
    await admin.query(`ALTER TABLE public.${t.tablename} OWNER TO ${name}`);
  }
  const fns = (await admin.query(`
    SELECT p.oid::regprocedure AS ident
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname LIKE 'orchestrator_%'
  `)).rows;
  for (const f of fns) {
    await admin.query(`ALTER FUNCTION ${f.ident} OWNER TO ${name}`);
  }
}

async function dropLoginRole(admin, name) {
  await admin.query(`REASSIGN OWNED BY ${name} TO CURRENT_USER`);
  await admin.query(`DROP OWNED BY ${name}`);
  await admin.query(`DROP ROLE IF EXISTS ${name}`);
}

async function seedHost(p, tenantId) {
  const wfId = nid('wf');
  await p.query(`INSERT INTO orchestrator_workflows (id, tenant_id, name) VALUES ($1,$2,$3)`, [wfId, tenantId, wfId]);
  const approvalId = (await p.query(
    `INSERT INTO orchestrator_approvals (tenant_id, workflow_id, gate, content_hash, decision, object_version, approved_platforms)
     VALUES ($1,$2,'campaign_publishing',$3,'approved',1,'["meta"]'::jsonb) RETURNING id`, [tenantId, wfId, HEX]
  )).rows[0].id;
  return { wfId, approvalId };
}

async function seedBoundGraph(p, tenantId, host, userId, opts = {}) {
  const draftId = nid('draft');
  await p.query(
    `INSERT INTO orchestrator_campaign_drafts
       (id, tenant_id, workflow_id, contract_hash, idempotency_key, status, current_revision)
     VALUES ($1,$2,$3,$4,$5,'draft',1)`,
    [draftId, tenantId, host.wfId, HEX, nid('didemp')]
  );
  await p.query(
    `INSERT INTO orchestrator_campaign_draft_revisions
       (id, tenant_id, draft_id, revision, contract_json, contract_hash)
     VALUES ($1,$2,$3,1,$4::jsonb,$5)`,
    [nid('rev'), tenantId, draftId, '{"ok":true}', HEX]
  );
  const pubId = nid('pub');
  await p.query(
    `INSERT INTO orchestrator_campaign_publish_approvals
       (id, tenant_id, draft_id, revision, contract_hash, snapshot_json, workflow_approval_id,
        actor_user_id, idempotency_key, expires_at)
     VALUES ($1,$2,$3,1,$4,$5::jsonb,$6,$7,$8,now()+'1 hour'::interval)`,
    [pubId, tenantId, draftId, HEX, '{"ok":true}', host.approvalId, userId, nid('pidemp')]
  );
  const reqId = nid('req');
  const requestHash = nextHex();
  const snapshotHash = nextHex();
  await p.query(
    `INSERT INTO orchestrator_campaign_publish_requests
       (id, tenant_id, draft_id, publish_approval_id, workflow_approval_id, revision,
        contract_hash, snapshot_hash, requested_by, status, confirmation_version,
        idempotency_key, request_hash)
     VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8,'requested',1,$9,$10)`,
    [reqId, tenantId, draftId, pubId, host.approvalId, HEX, snapshotHash, userId, nid('ridemp'), requestHash]
  );
  const outboxId = nid('obx');
  await p.query(
    `INSERT INTO orchestrator_outbox
       (id, tenant_id, workflow_id, destination, operation, payload, state, idempotency_key)
     VALUES ($1,$2,$3,'internal','create_provider_draft','{}'::jsonb,'pending',$4)`,
    [outboxId, tenantId, host.wfId, nid('oidemp')]
  );
  const intentId = nid('intent');
  const intentHash = nextHex();
  await p.query(
    `INSERT INTO orchestrator_campaign_delivery_intents
       (id, tenant_id, publishing_request_id, draft_id, publish_approval_id, workflow_approval_id,
        outbox_id, revision, contract_hash, snapshot_hash, intent_hash, contract_version,
        operation, status, idempotency_key, requested_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10,'campaign_delivery_v1','create_provider_draft','pending',$11,$12)`,
    [intentId, tenantId, reqId, draftId, pubId, host.approvalId, outboxId, HEX, snapshotHash, intentHash, nid('iidemp'), userId]
  );
  const attemptId = nid('att');
  await p.query(
    `INSERT INTO orchestrator_campaign_delivery_attempts
       (id, tenant_id, intent_id, outbox_id, draft_id, publishing_request_id,
        attempt_number, generation, claim_token, lease_holder, lease_expires_at,
        platform, intent_hash, contract_version, operation, connector, status)
     VALUES ($1,$2,$3,$4,$5,$6,1,1,$7,'worker-fake-1',now()+'5 minutes'::interval,
             'meta',$8,'campaign_delivery_v1','create_provider_draft','fake','started')`,
    [attemptId, tenantId, intentId, outboxId, draftId, reqId, nid('claimtok'), intentHash]
  );
  const credId = opts.credId || nid('mcr');
  if (!opts.credId) {
    await p.query(
      `INSERT INTO orchestrator_tenant_meta_credential_refs
         (id, tenant_id, platform, environment, status, account_fingerprint, page_id, version, owner_user_id)
       VALUES ($1,$2,'meta','sandbox','active',$3,'1122334455667',1,$4)`,
      [credId, tenantId, opts.fingerprint || nextHex(), userId]
    );
  }
  const chalId = nid('chal');
  const claimTokenHash = nextHex();
  const phraseSalt = nextHex();
  await p.query(
    `INSERT INTO orchestrator_campaign_provider_challenges
       (id, tenant_id, draft_id, revision, publish_approval_id, workflow_approval_id,
        publishing_request_id, intent_id, outbox_id, attempt_id, credential_ref_id,
        generation, contract_hash, snapshot_hash, intent_hash, request_hash, claim_token_hash,
        contract_version, operation, platform, phrase_salt, status, idempotency_key,
        requested_by, expires_at, created_at)
     VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14,$15,
             'campaign_delivery_v1','create_provider_draft','meta',$16,'open',$17,$18,
             now() + interval '5 minutes', now())`,
    [
      chalId, tenantId, draftId, pubId, host.approvalId, reqId, intentId, outboxId, attemptId, credId,
      HEX, snapshotHash, intentHash, requestHash, claimTokenHash, phraseSalt, nid('cidemp'), userId,
    ]
  );
  const confId = nid('conf');
  await p.query(
    `INSERT INTO orchestrator_campaign_provider_confirmations
       (id, tenant_id, challenge_id, draft_id, revision, publish_approval_id, workflow_approval_id,
        publishing_request_id, intent_id, outbox_id, attempt_id, credential_ref_id,
        generation, contract_hash, snapshot_hash, intent_hash, request_hash, claim_token_hash,
        contract_version, operation, platform, phrase_salt, phrase_digest, status,
        idempotency_key, requested_by, expires_at, created_at)
     VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10,$11,1,$12,$13,$14,$15,$16,
             'campaign_delivery_v1','create_provider_draft','meta',$17,$18,'confirmed',
             $19,$20, now() + interval '2 minutes', now())`,
    [
      confId, tenantId, chalId, draftId, pubId, host.approvalId, reqId, intentId, outboxId, attemptId, credId,
      HEX, snapshotHash, intentHash, requestHash, claimTokenHash, phraseSalt, nextHex(), nid('fidemp'), userId,
    ]
  );
  return {
    draftId, pubId, reqId, intentId, outboxId, attemptId, credId, chalId, confId,
    snapshotHash, intentHash, requestHash, claimTokenHash, approvalId: host.approvalId,
  };
}

async function insertStartedExecution(p, tenantId, userId, graph, opts = {}) {
  const id = opts.id || nid('ex');
  await p.query(
    `INSERT INTO orchestrator_campaign_provider_draft_executions
       (id, tenant_id, confirmation_id, challenge_id, draft_id, revision,
        publish_approval_id, workflow_approval_id, publishing_request_id, intent_id,
        outbox_id, attempt_id, credential_ref_id, generation, contract_hash, snapshot_hash,
        intent_hash, request_hash, claim_token_hash, idempotency_key, requested_by)
     VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10,$11,$12,1,$13,$14,$15,$16,$17,$18,$19)`,
    [
      id, tenantId, graph.confId, graph.chalId, graph.draftId, graph.pubId, graph.approvalId,
      graph.reqId, graph.intentId, graph.outboxId, graph.attemptId,
      opts.credentialRefId || graph.credId, HEX, graph.snapshotHash, graph.intentHash,
      graph.requestHash, graph.claimTokenHash, opts.idempotencyKey || nid('eidemp'), userId,
    ]
  );
  return id;
}

async function settleExecution(p, tenantId, id, { status, objectsCreated, objectsCompensated, errorCode = null }) {
  await p.query(
    `UPDATE orchestrator_campaign_provider_draft_executions
        SET status=$3, outcome=$3, objects_created=$4, objects_compensated=$5,
            error_code=$6, settled_at=now()
      WHERE tenant_id=$1 AND id=$2`,
    [tenantId, id, status, objectsCreated, objectsCompensated, errorCode]
  );
}

async function insertObject(p, tenantId, graph, executionId, { kind, seqNo, providerId }) {
  const id = nid(`obj-${kind}`);
  await p.query(
    `INSERT INTO orchestrator_campaign_provider_objects
       (id, tenant_id, execution_id, confirmation_id, attempt_id, object_kind,
        provider_object_id, sequence_number)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, tenantId, executionId, graph.confId, graph.attemptId, kind, providerId, seqNo]
  );
  return id;
}

async function compensateObject(p, tenantId, id) {
  await p.query(
    `UPDATE orchestrator_campaign_provider_objects
        SET compensated=TRUE, compensated_at=now()
      WHERE tenant_id=$1 AND id=$2`,
    [tenantId, id]
  );
}

if (!HAS_DB) {
  test('PR6F-1R lineage schema skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else {
  describe('PR6F-1R scratch-database upgrade', { concurrency: 1 }, () => {
    let adminPool = null;
    let nsuPool = null;
    let scratchReady = false;
    const origGetPool = db.getPool.bind(db);

    before(async () => {
      await createScratchDatabase(ADMIN_URL, SCRATCH_DB);
      scratchReady = true;
      adminPool = poolFor(SCRATCH_URL);
      await adminPool.query(`CREATE ROLE ${NSU_ROLE} LOGIN NOSUPERUSER PASSWORD '${NSU_PASS}'`);
      await adminPool.query(`GRANT CONNECT ON DATABASE ${SCRATCH_DB} TO ${NSU_ROLE}`);
      await adminPool.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${NSU_ROLE}`);
      const u = new URL(SCRATCH_URL);
      nsuPool = poolFor(
        `postgres://${NSU_ROLE}:${NSU_PASS}@${u.hostname}:${u.port || '5432'}/${SCRATCH_DB}`
      );
    });

    after(async () => {
      db.getPool = origGetPool;
      try { if (nsuPool) await nsuPool.end(); } catch { /* ignore */ }
      if (adminPool) {
        try { await dropLoginRole(adminPool, NSU_ROLE); } catch { /* ignore */ }
        try { await adminPool.end(); } catch { /* ignore */ }
      }
      if (scratchReady) {
        try { await dropScratchDatabase(ADMIN_URL, SCRATCH_DB); } catch { /* ignore */ }
      }
    });

    test('Test A — empty scratch + NOSUPERUSER ensure is idempotent without pgcrypto', async () => {
      const who = (await nsuPool.query(
        `SELECT current_user AS u, rolsuper FROM pg_roles WHERE rolname = current_user`
      )).rows[0];
      assert.equal(who.u, NSU_ROLE);
      assert.equal(who.rolsuper, false);

      await withPool(nsuPool, async () => {
        await ensureAuthSchema();
        await ensureTenantSchema();
        await ensureAgentOrchestratorSchema();
        await ensureAgentOrchestratorSchema();
      });

      const execCols = await columnsOf(nsuPool, 'orchestrator_campaign_provider_draft_executions');
      for (const col of ['credential_ref_version', 'account_fingerprint', 'snapshot_hash', 'contract_hash']) {
        const row = execCols.find((c) => c.column_name === col);
        assert.ok(row, col);
        assert.equal(row.is_nullable, 'NO', col);
      }
      const objCols = await columnsOf(nsuPool, 'orchestrator_campaign_provider_objects');
      for (const col of [
        'publishing_request_id', 'intent_id', 'snapshot_hash', 'account_fingerprint',
        'provider_object_id_digest', 'display_ref', 'parent_campaign_digest',
        'parent_adset_digest', 'parent_creative_digest',
      ]) {
        assert.ok(objCols.some((c) => c.column_name === col), col);
      }
      const events = await nsuPool.query(
        `SELECT 1 FROM information_schema.tables
          WHERE table_schema='public' AND table_name='orchestrator_campaign_provider_object_events'`
      );
      assert.equal(events.rowCount, 1);
      const ext = await nsuPool.query(`SELECT 1 FROM pg_extension WHERE extname='pgcrypto'`);
      assert.equal(ext.rowCount, 0, 'pgcrypto must not be required');
      const digest = (await nsuPool.query(
        `SELECT encode(sha256(convert_to('x', 'UTF8')), 'hex') AS d`
      )).rows[0].d;
      assert.equal(digest, sha256Hex('x'));
    });

    test('Test B — exact PR6F-1 history upgrades under NOSUPERUSER and stays immutable', async () => {
      await withPool(adminPool, async () => {
        await ensureAuthSchema();
        await ensureTenantSchema();
        await ensureAgentOrchestratorSchema();
      });

      const tenantId = (await adminPool.query(
        `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
        [`AO6F1R ${SUFFIX}`, `ao6f1r-${SUFFIX}`]
      )).rows[0].id;
      const userId = (await adminPool.query(
        `INSERT INTO users (email, password_hash, name) VALUES ($1,'x','pr6f1r') RETURNING id`,
        [`pr6f1r-${SUFFIX}@example.test`]
      )).rows[0].id;
      const host = await seedHost(adminPool, tenantId);

      await installPr6f1Ledger(adminPool);

      const startedGraph = await seedBoundGraph(adminPool, tenantId, host, userId);
      const startedId = await insertStartedExecution(adminPool, tenantId, userId, startedGraph);

      const completeGraph = await seedBoundGraph(adminPool, tenantId, host, userId);
      const completeId = await insertStartedExecution(adminPool, tenantId, userId, completeGraph);
      const completeKinds = [
        { kind: 'campaign', seqNo: 1, providerId: `camp_${SUFFIX}` },
        { kind: 'adset', seqNo: 2, providerId: `adset_${SUFFIX}` },
        { kind: 'creative', seqNo: 3, providerId: `creative_${SUFFIX}` },
        { kind: 'ad', seqNo: 4, providerId: `ad_${SUFFIX}` },
      ];
      for (const spec of completeKinds) {
        await insertObject(adminPool, tenantId, completeGraph, completeId, spec);
      }
      await settleExecution(adminPool, tenantId, completeId, {
        status: 'complete', objectsCreated: 4, objectsCompensated: 0,
      });

      const failedGraph = await seedBoundGraph(adminPool, tenantId, host, userId);
      const failedId = await insertStartedExecution(adminPool, tenantId, userId, failedGraph);
      const failedCamp = await insertObject(adminPool, tenantId, failedGraph, failedId, {
        kind: 'campaign', seqNo: 1, providerId: `fail_camp_${SUFFIX}`,
      });
      const failedAdset = await insertObject(adminPool, tenantId, failedGraph, failedId, {
        kind: 'adset', seqNo: 2, providerId: `fail_adset_${SUFFIX}`,
      });
      await compensateObject(adminPool, tenantId, failedCamp);
      await compensateObject(adminPool, tenantId, failedAdset);
      await settleExecution(adminPool, tenantId, failedId, {
        status: 'failed', objectsCreated: 2, objectsCompensated: 2, errorCode: 'provider_failed',
      });

      const partialGraph = await seedBoundGraph(adminPool, tenantId, host, userId);
      const partialId = await insertStartedExecution(adminPool, tenantId, userId, partialGraph);
      await insertObject(adminPool, tenantId, partialGraph, partialId, {
        kind: 'campaign', seqNo: 1, providerId: `part_camp_${SUFFIX}`,
      });
      const partialAdset = await insertObject(adminPool, tenantId, partialGraph, partialId, {
        kind: 'adset', seqNo: 2, providerId: `part_adset_${SUFFIX}`,
      });
      await insertObject(adminPool, tenantId, partialGraph, partialId, {
        kind: 'creative', seqNo: 3, providerId: `part_cr_${SUFFIX}`,
      });
      await compensateObject(adminPool, tenantId, partialAdset);
      await settleExecution(adminPool, tenantId, partialId, {
        status: 'partial', objectsCreated: 3, objectsCompensated: 1,
      });

      const preCols = await columnsOf(adminPool, 'orchestrator_campaign_provider_draft_executions');
      assert.equal(preCols.some((c) => c.column_name === 'credential_ref_version'), false);

      await grantOrchestratorMigrator(adminPool, NSU_ROLE);
      await withPool(nsuPool, async () => {
        await ensureAgentOrchestratorSchema();
        await ensureAgentOrchestratorSchema();
      });

      const who = (await nsuPool.query(
        `SELECT current_user AS u, rolsuper FROM pg_roles WHERE rolname = current_user`
      )).rows[0];
      assert.equal(who.rolsuper, false);

      const cred = (await adminPool.query(
        `SELECT version, account_fingerprint FROM orchestrator_tenant_meta_credential_refs
          WHERE tenant_id=$1 AND id=$2`,
        [tenantId, completeGraph.credId]
      )).rows[0];
      const execRow = (await adminPool.query(
        `SELECT credential_ref_version, account_fingerprint, status
           FROM orchestrator_campaign_provider_draft_executions
          WHERE tenant_id=$1 AND id=$2`,
        [tenantId, completeId]
      )).rows[0];
      assert.equal(execRow.credential_ref_version, cred.version);
      assert.equal(execRow.account_fingerprint, cred.account_fingerprint);
      assert.equal(execRow.status, 'complete');

      const objs = (await adminPool.query(
        `SELECT * FROM orchestrator_campaign_provider_objects
          WHERE tenant_id=$1 AND execution_id=$2 ORDER BY sequence_number`,
        [tenantId, completeId]
      )).rows;
      assert.equal(objs.length, 4);
      const byKind = Object.fromEntries(objs.map((o) => [o.object_kind, o]));
      const campDigest = sha256Hex(`camp_${SUFFIX}`);
      const adsetDigest = sha256Hex(`adset_${SUFFIX}`);
      const creativeDigest = sha256Hex(`creative_${SUFFIX}`);
      const adDigest = sha256Hex(`ad_${SUFFIX}`);
      assert.equal(byKind.campaign.provider_object_id_digest, campDigest);
      assert.equal(byKind.campaign.display_ref, campDigest.slice(0, 12));
      assert.equal(byKind.campaign.parent_campaign_digest, null);
      assert.equal(byKind.adset.parent_campaign_digest, campDigest);
      assert.equal(byKind.adset.parent_adset_digest, null);
      assert.equal(byKind.creative.parent_campaign_digest, campDigest);
      assert.equal(byKind.ad.provider_object_id_digest, adDigest);
      assert.equal(byKind.ad.display_ref, adDigest.slice(0, 12));
      assert.equal(byKind.ad.parent_campaign_digest, campDigest);
      assert.equal(byKind.ad.parent_adset_digest, adsetDigest);
      assert.equal(byKind.ad.parent_creative_digest, creativeDigest);

      const createdEvents = (await adminPool.query(
        `SELECT event_kind, object_id FROM orchestrator_campaign_provider_object_events
          WHERE tenant_id=$1 AND execution_id=$2 ORDER BY object_id, event_kind`,
        [tenantId, completeId]
      )).rows;
      assert.equal(createdEvents.filter((e) => e.event_kind === 'created').length, 4);
      assert.equal(createdEvents.filter((e) => e.event_kind === 'compensated').length, 0);

      const failedObj = (await adminPool.query(
        `SELECT id, compensated FROM orchestrator_campaign_provider_objects
          WHERE tenant_id=$1 AND execution_id=$2`,
        [tenantId, failedId]
      )).rows;
      assert.ok(failedObj.every((o) => o.compensated === true));
      const failedEvents = (await adminPool.query(
        `SELECT event_kind FROM orchestrator_campaign_provider_object_events
          WHERE tenant_id=$1 AND execution_id=$2`,
        [tenantId, failedId]
      )).rows;
      assert.equal(failedEvents.filter((e) => e.event_kind === 'created').length, 2);
      assert.equal(failedEvents.filter((e) => e.event_kind === 'compensated').length, 2);

      const startedRow = (await adminPool.query(
        `SELECT status, credential_ref_version FROM orchestrator_campaign_provider_draft_executions
          WHERE tenant_id=$1 AND id=$2`,
        [tenantId, startedId]
      )).rows[0];
      assert.equal(startedRow.status, 'started');
      assert.equal(typeof startedRow.credential_ref_version, 'number');

      await assert.rejects(
        () => adminPool.query(
          `UPDATE orchestrator_campaign_provider_objects SET compensated=TRUE, compensated_at=now()
            WHERE tenant_id=$1 AND id=$2`,
          [tenantId, byKind.campaign.id]
        ),
        (err) => err && /orchestrator_cpo_immutable/.test(String(err.message))
      );
      await assert.rejects(
        () => adminPool.query(
          `UPDATE orchestrator_campaign_provider_draft_executions SET objects_created=3
            WHERE tenant_id=$1 AND id=$2`,
          [tenantId, completeId]
        ),
        (err) => err && /orchestrator_cpdex_immutable/.test(String(err.message))
      );
      const eventRow = (await adminPool.query(
        `SELECT tenant_id, id FROM orchestrator_campaign_provider_object_events
          WHERE tenant_id=$1 LIMIT 1`,
        [tenantId]
      )).rows[0];
      await assert.rejects(
        () => adminPool.query(
          `UPDATE orchestrator_campaign_provider_object_events SET event_kind='created' WHERE tenant_id=$1 AND id=$2`,
          [eventRow.tenant_id, eventRow.id]
        ),
        (err) => err && /orchestrator_cpoe_immutable/.test(String(err.message))
      );
      await assert.rejects(
        () => adminPool.query(
          `DELETE FROM orchestrator_campaign_provider_object_events WHERE tenant_id=$1 AND id=$2`,
          [eventRow.tenant_id, eventRow.id]
        ),
        (err) => err && /orchestrator_cpoe_immutable/.test(String(err.message))
      );

      const cons = await adminPool.query(
        `SELECT c.conname, pg_get_constraintdef(c.oid) AS def
           FROM pg_constraint c
           JOIN pg_class rel ON rel.oid = c.conrelid
          WHERE rel.relname IN (
            'orchestrator_campaign_provider_objects',
            'orchestrator_campaign_provider_object_events'
          )
            AND c.contype IN ('u','f')`
      );
      const defs = cons.rows.map((row) => `${row.conname} ${row.def}`).join('\n');
      assert.match(defs, /orchestrator_cpo_tenant_execution_kind/);
      assert.match(defs, /orchestrator_cpo_tenant_account_digest/);
      assert.match(defs, /UNIQUE \(tenant_id, execution_id, object_kind\)/);
      assert.match(defs, /UNIQUE \(tenant_id, account_fingerprint, provider_object_id_digest\)/);
      assert.match(defs, /orchestrator_cpoe_tenant_object_kind/);
    });

    test('Test C — unbound backfill rolls back; old PR6F-1 guards remain', async () => {
      await withPool(adminPool, async () => {
        await ensureAuthSchema();
        await ensureTenantSchema();
        await ensureAgentOrchestratorSchema();
      });
      const tenantId = (await adminPool.query(
        `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
        [`AO6F1R unbound ${SUFFIX}`, `ao6f1r-ub-${SUFFIX}`]
      )).rows[0].id;
      const userId = (await adminPool.query(
        `INSERT INTO users (email, password_hash, name) VALUES ($1,'x','pr6f1r-ub') RETURNING id`,
        [`pr6f1r-ub-${SUFFIX}@example.test`]
      )).rows[0].id;
      const host = await seedHost(adminPool, tenantId);
      await installPr6f1Ledger(adminPool);
      const graph = await seedBoundGraph(adminPool, tenantId, host, userId);
      await insertStartedExecution(adminPool, tenantId, userId, graph, {
        credentialRefId: 'unbound_missing_ref',
      });

      const beforeExecFn = await functionDef(adminPool, 'orchestrator_cpdex_guard');
      assert.doesNotMatch(beforeExecFn, /credential_ref_version/);
      const beforeObjFn = await functionDef(adminPool, 'orchestrator_cpo_guard');
      assert.match(beforeObjFn, /OLD\.compensated IS DISTINCT FROM FALSE/);

      await grantOrchestratorMigrator(adminPool, NSU_ROLE);
      await assert.rejects(
        () => withPool(nsuPool, () => ensureAgentOrchestratorSchema()),
        (err) => {
          const msg = String(err && (err.code || err.message) || '');
          return /pr6f1r_lineage_backfill_unbound_execution/.test(msg);
        }
      );

      const execCols = await columnsOf(adminPool, 'orchestrator_campaign_provider_draft_executions');
      assert.equal(execCols.some((c) => c.column_name === 'credential_ref_version'), false);
      assert.equal(execCols.some((c) => c.column_name === 'account_fingerprint'), false);
      const objCols = await columnsOf(adminPool, 'orchestrator_campaign_provider_objects');
      assert.equal(objCols.some((c) => c.column_name === 'provider_object_id_digest'), false);
      const events = await adminPool.query(
        `SELECT 1 FROM information_schema.tables
          WHERE table_schema='public' AND table_name='orchestrator_campaign_provider_object_events'`
      );
      assert.equal(events.rowCount, 0);

      const afterExecFn = await functionDef(adminPool, 'orchestrator_cpdex_guard');
      assert.doesNotMatch(afterExecFn, /credential_ref_version/);
      const afterObjFn = await functionDef(adminPool, 'orchestrator_cpo_guard');
      assert.match(afterObjFn, /OLD\.compensated IS DISTINCT FROM FALSE/);
      assert.match(afterObjFn, /NEW\.compensated IS DISTINCT FROM TRUE/);

      const execTrigs = await triggerNames(adminPool, 'orchestrator_campaign_provider_draft_executions');
      const objTrigs = await triggerNames(adminPool, 'orchestrator_campaign_provider_objects');
      assert.ok(execTrigs.includes('orchestrator_cpdex_guard'));
      assert.ok(objTrigs.includes('orchestrator_cpo_guard'));
      assert.equal(objTrigs.includes('orchestrator_cpo_after_insert'), false);
    });
  });
}
