'use strict';

process.env.PERMISSION_ENFORCEMENT = 'on';
process.env.MULTITENANT_ENFORCEMENT = 'on';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../db');
const { ensureAgentOrchestratorSchema } = require('../services/agent_orchestrator/schema');
const { ensureTenantSchema } = require('../services/tenants/schema');
const { ensureAuthSchema } = require('../services/auth/schema');

const HAS_DB = db.hasDb();
const CRED_TABLE = 'orchestrator_tenant_meta_credential_refs';
const CHALLENGE_TABLE = 'orchestrator_campaign_provider_challenges';
const CONFIRM_TABLE = 'orchestrator_campaign_provider_confirmations';
const TABLES = [CRED_TABLE, CHALLENGE_TABLE, CONFIRM_TABLE];
const SCHEMA_SRC_PATH = path.join(__dirname, '../services/agent_orchestrator/schema.js');
const HEX = 'a'.repeat(64);
const SUFFIX = `ao6f0-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let seq = 0;
const nid = (p) => { seq += 1; return `${p}-${SUFFIX}-${seq}`; };
const nextHex = () => { seq += 1; return seq.toString(16).padStart(64, '0'); };

const CRED_REQUIRED = [
  'id', 'tenant_id', 'platform', 'environment', 'status',
  'account_fingerprint', 'page_id', 'version', 'owner_user_id', 'created_at', 'updated_at',
];
const CRED_NULLABLE = ['revoked_at'];
const CRED_COLUMNS = [...CRED_REQUIRED, ...CRED_NULLABLE];

const CHALLENGE_REQUIRED = [
  'id', 'tenant_id', 'draft_id', 'revision', 'publish_approval_id',
  'workflow_approval_id', 'publishing_request_id', 'intent_id', 'outbox_id',
  'attempt_id', 'credential_ref_id', 'generation', 'contract_hash',
  'snapshot_hash', 'intent_hash', 'request_hash', 'claim_token_hash',
  'contract_version', 'operation', 'platform', 'phrase_salt', 'status',
  'idempotency_key', 'requested_by', 'expires_at', 'created_at',
];
const CHALLENGE_NULLABLE = ['consumed_at', 'consumed_confirmation_id'];
const CHALLENGE_COLUMNS = [...CHALLENGE_REQUIRED, ...CHALLENGE_NULLABLE];

const CONFIRM_REQUIRED = [
  'id', 'tenant_id', 'challenge_id', 'draft_id', 'revision', 'publish_approval_id',
  'workflow_approval_id', 'publishing_request_id', 'intent_id', 'outbox_id',
  'attempt_id', 'credential_ref_id', 'generation', 'contract_hash',
  'snapshot_hash', 'intent_hash', 'request_hash', 'claim_token_hash',
  'contract_version', 'operation', 'platform', 'phrase_salt', 'phrase_digest',
  'status', 'idempotency_key', 'requested_by', 'expires_at', 'created_at',
];
const CONFIRM_NULLABLE = ['spent_at'];
const CONFIRM_COLUMNS = [...CONFIRM_REQUIRED, ...CONFIRM_NULLABLE];

const FORBIDDEN_SECRET_RE =
  /ciphertext|access_token|refresh_token|vault_payload|confirmation_phrase|confirm_phrase|provider_id|ad_account|pixel_id|api_key/i;
const CRED_FORBIDDEN_SECRET_RE =
  /ciphertext|access_token|refresh_token|vault_payload|confirmation_phrase|confirm_phrase|provider_id|ad_account|pixel_id|api_key/i;
const CRED_PUBLIC_IDENTITY_COLUMNS = Object.freeze(['page_id']);
const CRED_ALLOWLIST_COLUMNS = Object.freeze([...CRED_PUBLIC_IDENTITY_COLUMNS]);
const FORBIDDEN_COLUMNS = [
  'credential', 'credentials', 'credential_ref', 'token', 'tokens', 'access_token',
  'refresh_token', 'secret', 'password', 'vault', 'vault_payload', 'authorization',
  'header', 'headers', 'provider', 'provider_data', 'provider_campaign_id',
  'provider_id', 'external_campaign_id', 'external_id', 'body', 'request_body',
  'raw_body', 'confirmation_phrase', 'confirmation_text', 'confirm_phrase',
  'snapshot_json', 'snapshot', 'payload', 'api_key', 'ciphertext', 'iv', 'tag',
  'ad_account_id', 'pixel_id',
];

function schemaSrc() {
  return fs.readFileSync(SCHEMA_SRC_PATH, 'utf8');
}

function extractCreateTable(src, table) {
  const start = src.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
  assert.ok(start >= 0, `${table} CREATE TABLE IF NOT EXISTS must exist`);
  const from = src.indexOf('(', start);
  let depth = 0;
  for (let i = from; i < src.length; i += 1) {
    if (src[i] === '(') depth += 1;
    else if (src[i] === ')') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unclosed CREATE TABLE for ${table}`);
}

function extractFunctionSource(src, name) {
  const start = src.indexOf(`CREATE OR REPLACE FUNCTION ${name}`);
  assert.ok(start >= 0, `${name} must exist`);
  const marker = src.indexOf('$fn$', start);
  const end = src.indexOf('$fn$ LANGUAGE plpgsql', marker + 4);
  assert.ok(end > marker, `${name} function body must close`);
  return src.slice(start, end);
}

async function pkAndUniques(table) {
  return (await db.getPool().query(
    `SELECT tc.constraint_name, tc.constraint_type,
            string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS cols
       FROM information_schema.table_constraints tc
       LEFT JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        AND tc.table_name = kcu.table_name
      WHERE tc.table_schema='public' AND tc.table_name=$1 AND tc.constraint_type IN ('PRIMARY KEY','UNIQUE')
      GROUP BY tc.constraint_name, tc.constraint_type`, [table]
  )).rows;
}

async function checkDef(table, name) {
  return (await db.getPool().query(
    `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint WHERE conrelid=$1::regclass AND conname=$2`,
    [`public.${table}`, name]
  )).rows[0];
}

async function fkRows(table) {
  return (await db.getPool().query(
    `SELECT con.conname,
            string_agg(att.attname, ',' ORDER BY k.n) AS cols,
            ref.relname AS ref_table,
            con.confdeltype AS deltype,
            con.condeferrable AS deferrable,
            con.condeferred AS deferred
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
       JOIN pg_class ref ON ref.oid = con.confrelid
       JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, n) ON true
       JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = k.attnum
      WHERE nsp.nspname='public' AND rel.relname=$1 AND con.contype='f'
      GROUP BY con.oid, con.conname, ref.relname, con.confdeltype, con.condeferrable, con.condeferred`,
    [table]
  )).rows;
}

async function columnsOf(table) {
  return (await db.getPool().query(
    `SELECT column_name, is_nullable, data_type
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1`,
    [table]
  )).rows;
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

async function insertDraft(p, tenantId, host, opts = {}) {
  const id = opts.id || nid('draft');
  await p.query(
    `INSERT INTO orchestrator_campaign_drafts
       (id, tenant_id, workflow_id, contract_hash, idempotency_key, status, current_revision)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, tenantId, host.wfId, HEX, opts.idempotencyKey || nid('didemp'), opts.status || 'draft', 1]
  );
  return id;
}

async function insertRevision(p, tenantId, draftId, opts = {}) {
  const id = opts.id || nid('rev');
  await p.query(
    `INSERT INTO orchestrator_campaign_draft_revisions
       (id, tenant_id, draft_id, revision, contract_json, contract_hash)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
    [id, tenantId, draftId, opts.revision || 1, opts.contractJson || '{"ok":true}', HEX]
  );
  return id;
}

async function insertPublishApproval(p, tenantId, host, draftId, opts = {}) {
  const id = opts.id || nid('pub');
  await p.query(
    `INSERT INTO orchestrator_campaign_publish_approvals
       (id, tenant_id, draft_id, revision, contract_hash, snapshot_json, workflow_approval_id,
        actor_user_id, idempotency_key, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,now()+'1 hour'::interval)`,
    [
      id, tenantId, draftId, 1, HEX, '{"ok":true}', host.approvalId,
      opts.actorUserId, opts.idempotencyKey || nid('pidemp'),
    ]
  );
  return id;
}

async function insertRequest(p, tenantId, host, draftId, publishApprovalId, opts = {}) {
  const id = opts.id || nid('req');
  const requestHash = opts.requestHash || nextHex();
  const snapshotHash = opts.snapshotHash || nextHex();
  await p.query(
    `INSERT INTO orchestrator_campaign_publish_requests
       (id, tenant_id, draft_id, publish_approval_id, workflow_approval_id, revision,
        contract_hash, snapshot_hash, requested_by, status, confirmation_version,
        idempotency_key, request_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      id, tenantId, draftId, publishApprovalId, host.approvalId, 1, HEX,
      snapshotHash, opts.requestedBy, 'requested', 1, nid('ridemp'), requestHash,
    ]
  );
  return { id, requestHash, snapshotHash };
}

async function insertBoundIntent(p, tenantId, host, draftId, publishApprovalId, publishingRequestId, opts = {}) {
  const outboxId = opts.outboxId || nid('obx');
  await p.query(
    `INSERT INTO orchestrator_outbox
       (id, tenant_id, workflow_id, destination, operation, payload, state, idempotency_key)
     VALUES ($1,$2,$3,'internal','create_provider_draft','{}'::jsonb,'pending',$4)`,
    [outboxId, tenantId, host.wfId, nid('oidemp')]
  );
  const id = opts.id || nid('intent');
  const intentHash = opts.intentHash || nextHex();
  const snapshotHash = opts.snapshotHash || nextHex();
  await p.query(
    `INSERT INTO orchestrator_campaign_delivery_intents
       (id, tenant_id, publishing_request_id, draft_id, publish_approval_id, workflow_approval_id,
        outbox_id, revision, contract_hash, snapshot_hash, intent_hash, contract_version,
        operation, status, idempotency_key, requested_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      id, tenantId, publishingRequestId, draftId, publishApprovalId, host.approvalId, outboxId,
      1, HEX, snapshotHash, intentHash, 'campaign_delivery_v1', 'create_provider_draft', 'pending',
      nid('iidemp'), opts.requestedBy,
    ]
  );
  return { id, outboxId, intentHash, snapshotHash };
}

async function insertAttempt(p, tenantId, graph, opts = {}) {
  const id = opts.id || nid('att');
  await p.query(
    `INSERT INTO orchestrator_campaign_delivery_attempts
       (id, tenant_id, intent_id, outbox_id, draft_id, publishing_request_id,
        attempt_number, generation, claim_token, lease_holder, lease_expires_at,
        platform, intent_hash, contract_version, operation, connector, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()+'5 minutes'::interval,
             'meta',$11,'campaign_delivery_v1','create_provider_draft','fake','started')`,
    [
      id, tenantId, graph.intentId, graph.outboxId, graph.draftId, graph.reqId,
      opts.attemptNumber || 1, opts.generation || 1,
      opts.claimToken || nid('claimtok'), opts.leaseHolder || 'worker-fake-1',
      graph.intentHash,
    ]
  );
  return id;
}

async function insertCredRef(p, tenantId, userId, opts = {}) {
  const id = opts.id || nid('mcr');
  await p.query(
    `INSERT INTO ${CRED_TABLE}
       (id, tenant_id, platform, environment, status, account_fingerprint, page_id, version, owner_user_id)
     VALUES ($1,$2,'meta',$3,'active',$4,$5,$6,$7)`,
    [
      id, tenantId, opts.environment || 'sandbox', opts.fingerprint || nextHex(),
      opts.pageId || '1122334455667', opts.version || 1, userId,
    ]
  );
  return id;
}

async function seedGraph(p, tenantId, host, userId) {
  const draftId = await insertDraft(p, tenantId, host);
  await insertRevision(p, tenantId, draftId);
  const pubId = await insertPublishApproval(p, tenantId, host, draftId, { actorUserId: userId });
  const req = await insertRequest(p, tenantId, host, draftId, pubId, { requestedBy: userId });
  const intent = await insertBoundIntent(p, tenantId, host, draftId, pubId, req.id, {
    requestedBy: userId, snapshotHash: req.snapshotHash,
  });
  const graph = {
    draftId, pubId, reqId: req.id, requestHash: req.requestHash,
    snapshotHash: intent.snapshotHash, intentId: intent.id, outboxId: intent.outboxId,
    intentHash: intent.intentHash, approvalId: host.approvalId,
  };
  const attemptId = await insertAttempt(p, tenantId, graph);
  const credId = await insertCredRef(p, tenantId, userId);
  graph.attemptId = attemptId;
  graph.credId = credId;
  graph.claimTokenHash = nextHex();
  graph.phraseSalt = nextHex();
  return graph;
}

async function insertChallenge(p, tenantId, host, graph, userId, opts = {}) {
  const id = opts.id || nid('chal');
  const createdAt = opts.createdAtSql || 'now()';
  const expiresSql = opts.expiresSql || "now() + interval '5 minutes'";
  await p.query(
    `INSERT INTO ${CHALLENGE_TABLE}
       (id, tenant_id, draft_id, revision, publish_approval_id, workflow_approval_id,
        publishing_request_id, intent_id, outbox_id, attempt_id, credential_ref_id,
        generation, contract_hash, snapshot_hash, intent_hash, request_hash, claim_token_hash,
        contract_version, operation, platform, phrase_salt, status, idempotency_key,
        requested_by, expires_at, created_at)
     VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14,$15,
             'campaign_delivery_v1','create_provider_draft','meta',$16,'open',$17,$18,
             ${expiresSql}, ${createdAt})`,
    [
      id, tenantId, graph.draftId, graph.pubId, host.approvalId, graph.reqId,
      opts.intentId || graph.intentId, opts.outboxId || graph.outboxId,
      opts.attemptId || graph.attemptId, opts.credentialRefId || graph.credId,
      HEX, graph.snapshotHash, graph.intentHash, graph.requestHash,
      opts.claimTokenHash || graph.claimTokenHash,
      opts.phraseSalt || graph.phraseSalt,
      opts.idempotencyKey || nid('cidemp'), userId,
    ]
  );
  return id;
}

async function insertConfirmation(p, tenantId, host, graph, challengeId, userId, opts = {}) {
  const id = opts.id || nid('conf');
  const createdAt = opts.createdAtSql || 'now()';
  const expiresSql = opts.expiresSql || "now() + interval '2 minutes'";
  await p.query(
    `INSERT INTO ${CONFIRM_TABLE}
       (id, tenant_id, challenge_id, draft_id, revision, publish_approval_id, workflow_approval_id,
        publishing_request_id, intent_id, outbox_id, attempt_id, credential_ref_id,
        generation, contract_hash, snapshot_hash, intent_hash, request_hash, claim_token_hash,
        contract_version, operation, platform, phrase_salt, phrase_digest, status,
        idempotency_key, requested_by, expires_at, created_at)
     VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10,$11,1,$12,$13,$14,$15,$16,
             'campaign_delivery_v1','create_provider_draft','meta',$17,$18,'confirmed',
             $19,$20, ${expiresSql}, ${createdAt})`,
    [
      id, tenantId, challengeId, graph.draftId, graph.pubId, host.approvalId, graph.reqId,
      graph.intentId, graph.outboxId, graph.attemptId, graph.credId,
      HEX, graph.snapshotHash, graph.intentHash, graph.requestHash, graph.claimTokenHash,
      opts.phraseSalt || graph.phraseSalt, opts.phraseDigest || nextHex(),
      opts.idempotencyKey || nid('fidemp'), userId,
    ]
  );
  return id;
}

test('PR6F-0 CREATE TABLE is tenant-leading, digest-only, TTL-capped, and omits secrets', () => {
  const src = schemaSrc();
  for (const table of TABLES) {
    assert.match(src, new RegExp(`'${table}'`));
    assert.match(src, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(src, /_ensureNamedFk\(p, 'orchestrator_campaign_provider_challenges'/);
  assert.match(src, /_ensureNamedFk\(p, 'orchestrator_campaign_provider_confirmations'/);
  assert.match(src, /_ensureNamedCheck\(p, 'orchestrator_campaign_provider_challenges'/);
  assert.match(src, /_ensureNamedCheck\(p, 'orchestrator_campaign_provider_confirmations'/);
  assert.match(src, /_ensureNamedCheck\(p, 'orchestrator_tenant_meta_credential_refs'/);

  const sandboxIdx = src.indexOf('CREATE TABLE IF NOT EXISTS orchestrator_campaign_delivery_sandbox_outcomes');
  const credIdx = src.indexOf(`CREATE TABLE IF NOT EXISTS ${CRED_TABLE}`);
  const chalIdx = src.indexOf(`CREATE TABLE IF NOT EXISTS ${CHALLENGE_TABLE}`);
  const confIdx = src.indexOf(`CREATE TABLE IF NOT EXISTS ${CONFIRM_TABLE}`);
  assert.ok(sandboxIdx >= 0 && credIdx > sandboxIdx, 'credential refs must follow PR6E sandbox outcomes');
  assert.ok(chalIdx > credIdx && confIdx > chalIdx, 'challenge then confirmation after credential refs');

  const tablesBlock = src.slice(src.indexOf('const ADVERTISING_ORCH_TABLES'), src.indexOf('];', src.indexOf('const ADVERTISING_ORCH_TABLES')) + 2);
  assert.ok(tablesBlock.indexOf(`'${CRED_TABLE}'`) >= 0);
  assert.ok(tablesBlock.indexOf(`'${CHALLENGE_TABLE}'`) > tablesBlock.indexOf(`'${CRED_TABLE}'`));
  assert.ok(tablesBlock.indexOf(`'${CONFIRM_TABLE}'`) > tablesBlock.indexOf(`'${CHALLENGE_TABLE}'`));

  const credCreate = extractCreateTable(src, CRED_TABLE);
  assert.match(credCreate, /PRIMARY KEY \(tenant_id, id\)/);
  assert.match(credCreate, /REFERENCES tenants\(id\) ON DELETE CASCADE/);
  assert.match(credCreate, /UNIQUE \(tenant_id, account_fingerprint, version\)/);
  assert.match(credCreate, /platform TEXT NOT NULL DEFAULT 'meta'/);
  assert.match(credCreate, /CHECK \(platform = 'meta'\)/);
  assert.match(credCreate, /environment IN \('test','sandbox'\)/);
  assert.match(credCreate, /status IN \('active','revoked'\)/);
  assert.match(credCreate, /\bpage_id TEXT NOT NULL\b/);
  assert.match(src, /orchestrator_tmcr_page_id_check/);
  assert.match(src, /page_id ~ '\^\[0-9\]\{1,32\}\$'/);
  assert.equal(FORBIDDEN_SECRET_RE.test('page_id'), false, 'page_id is public tenant-scoped identity metadata, not a secret surface');
  assert.equal(CRED_FORBIDDEN_SECRET_RE.test('page_id'), false, 'credential refs may declare page_id');
  assert.doesNotMatch(credCreate, CRED_FORBIDDEN_SECRET_RE);
  assert.doesNotMatch(credCreate, /\bconfirmation_phrase\b/);
  for (const col of ['ciphertext', 'access_token', 'refresh_token', 'credential_ref', 'provider_id', 'ad_account_id']) {
    assert.doesNotMatch(credCreate, new RegExp(`\\b${col}\\b`), `${CRED_TABLE} must not declare ${col}`);
  }

  const chalCreate = extractCreateTable(src, CHALLENGE_TABLE);
  assert.match(chalCreate, /PRIMARY KEY \(tenant_id, id\)/);
  assert.match(chalCreate, /REFERENCES tenants\(id\) ON DELETE CASCADE/);
  assert.match(chalCreate, /UNIQUE \(tenant_id, idempotency_key\)/);
  assert.match(chalCreate, /UNIQUE \(tenant_id, attempt_id\)/);
  assert.match(chalCreate, /INTERVAL '5 minutes'/);
  assert.match(chalCreate, /phrase_salt TEXT NOT NULL/);
  assert.doesNotMatch(chalCreate, /phrase_digest/);
  assert.doesNotMatch(chalCreate, /\bconfirmation_phrase\b/);
  assert.doesNotMatch(chalCreate, /\bprovider_id\b/);
  assert.doesNotMatch(chalCreate, /\bpage_id\b/i, `${CHALLENGE_TABLE} must not declare page_id`);
  assert.doesNotMatch(chalCreate, FORBIDDEN_SECRET_RE);
  for (const col of FORBIDDEN_COLUMNS) {
    assert.doesNotMatch(chalCreate, new RegExp(`\\b${col}\\b`, 'i'), `${CHALLENGE_TABLE} must not declare ${col}`);
  }

  const confCreate = extractCreateTable(src, CONFIRM_TABLE);
  assert.match(confCreate, /PRIMARY KEY \(tenant_id, id\)/);
  assert.match(confCreate, /REFERENCES tenants\(id\) ON DELETE CASCADE/);
  assert.match(confCreate, /UNIQUE \(tenant_id, idempotency_key\)/);
  assert.match(confCreate, /UNIQUE \(tenant_id, challenge_id\)/);
  assert.match(confCreate, /UNIQUE \(tenant_id, attempt_id\)/);
  assert.match(confCreate, /INTERVAL '2 minutes'/);
  assert.match(confCreate, /phrase_salt TEXT NOT NULL/);
  assert.match(confCreate, /phrase_digest TEXT NOT NULL/);
  assert.doesNotMatch(confCreate, /\bconfirmation_phrase\b/);
  assert.doesNotMatch(confCreate, /\bpage_id\b/i, `${CONFIRM_TABLE} must not declare page_id`);
  assert.doesNotMatch(confCreate, FORBIDDEN_SECRET_RE);
  for (const col of FORBIDDEN_COLUMNS) {
    assert.doesNotMatch(confCreate, new RegExp(`\\b${col}\\b`, 'i'), `${CONFIRM_TABLE} must not declare ${col}`);
  }

  const namedIdents = src.match(/orchestrator_(tmcr|cpc|cpcf)_[a-z0-9_]+|idx_(tmcr|cpc|cpcf)_[a-z0-9_]+|orchestrator_campaign_provider_(challenges|confirmations)_[a-z0-9_]+|orchestrator_tenant_meta_credential_refs_[a-z0-9_]+/g) || [];
  for (const name of new Set(namedIdents)) {
    assert.ok(name.length <= 63, `${name} exceeds Postgres 63-char identifier limit (${name.length})`);
  }

  const tmcrFn = extractFunctionSource(src, 'orchestrator_tmcr_guard');
  assert.match(tmcrFn, /TG_OP = 'UPDATE'/);
  assert.match(tmcrFn, /NEW\.status IS DISTINCT FROM 'revoked'/);
  assert.match(tmcrFn, /RAISE EXCEPTION 'orchestrator_tmcr_immutable'/);
  assert.match(src, /BEFORE INSERT OR UPDATE OR DELETE ON orchestrator_tenant_meta_credential_refs/);

  const cpcFn = extractFunctionSource(src, 'orchestrator_cpc_guard');
  assert.match(cpcFn, /NEW\.status IS DISTINCT FROM 'consumed'/);
  assert.match(cpcFn, /RAISE EXCEPTION 'orchestrator_cpc_immutable'/);
  assert.match(cpcFn, /RAISE EXCEPTION 'orchestrator_cpc_binding'/);
  assert.match(src, /BEFORE INSERT OR UPDATE OR DELETE ON orchestrator_campaign_provider_challenges/);

  const cpcfFn = extractFunctionSource(src, 'orchestrator_cpcf_guard');
  assert.match(cpcfFn, /NEW\.status IS DISTINCT FROM 'spent'/);
  assert.match(cpcfFn, /RAISE EXCEPTION 'orchestrator_cpcf_immutable'/);
  assert.match(cpcfFn, /RAISE EXCEPTION 'orchestrator_cpcf_binding'/);
  assert.match(src, /BEFORE INSERT OR UPDATE OR DELETE ON orchestrator_campaign_provider_confirmations/);

  assert.match(src, /orchestrator_cpc_tenant_draft_fkey/);
  assert.match(src, /orchestrator_cpc_tenant_rev_fkey/);
  assert.match(src, /orchestrator_cpc_tenant_pub_appr_fkey/);
  assert.match(src, /orchestrator_cpc_tenant_wf_appr_fkey/);
  assert.match(src, /orchestrator_cpc_tenant_pub_req_fkey/);
  assert.match(src, /orchestrator_cpc_tenant_intent_fkey/);
  assert.match(src, /orchestrator_cpc_tenant_outbox_fkey/);
  assert.match(src, /orchestrator_cpc_tenant_attempt_fkey/);
  assert.match(src, /orchestrator_cpc_tenant_attempt_bind_fkey/);
  assert.match(src, /orchestrator_cpc_tenant_cred_ref_fkey/);
  assert.match(src, /orchestrator_cda_tenant_unique_id_bind/);
  assert.match(src, /CREATE TABLE IF NOT EXISTS orchestrator_campaign_provider_draft_executions/);
  assert.match(src, /CREATE TABLE IF NOT EXISTS orchestrator_campaign_provider_objects/);
});

if (!HAS_DB) {
  test('advertising-orchestrator provider-confirmation schema skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else {
  let tenantA = null; let tenantB = null; let hostA = null; let hostB = null; let userId = null;

  before(async () => {
    await ensureAuthSchema();
    await ensureTenantSchema();
    await ensureAgentOrchestratorSchema();
    const p = db.getPool();
    const mk = async (label, slug) => (await p.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`, [label, slug]
    )).rows[0].id;
    tenantA = await mk(`AO6F0 A ${SUFFIX}`, `ao6f0-a-${SUFFIX}`);
    tenantB = await mk(`AO6F0 B ${SUFFIX}`, `ao6f0-b-${SUFFIX}`);
    hostA = await seedHost(p, tenantA);
    hostB = await seedHost(p, tenantB);
    userId = (await p.query(
      `INSERT INTO users (email, password_hash, name) VALUES ($1,'x','pr6f0') RETURNING id`,
      [`pr6f0-${SUFFIX}@example.test`]
    )).rows[0].id;
  });

  after(async () => {
    const p = db.getPool();
    const ids = [tenantA, tenantB].filter(Boolean);
    if (ids.length) await p.query(`DELETE FROM tenants WHERE id = ANY($1)`, [ids]);
    if (userId) await p.query(`DELETE FROM users WHERE id=$1`, [userId]);
  });

  test('PR6F-0 tables exist with tenant-leading PK, required columns, and no secret surfaces', async () => {
    const p = db.getPool();
    const present = (await p.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1)`,
      [TABLES]
    )).rows.map((r) => r.table_name).sort();
    assert.deepStrictEqual(present, [...TABLES].sort());

    const expectShape = [
      [CRED_TABLE, CRED_COLUMNS, CRED_REQUIRED, CRED_NULLABLE],
      [CHALLENGE_TABLE, CHALLENGE_COLUMNS, CHALLENGE_REQUIRED, CHALLENGE_NULLABLE],
      [CONFIRM_TABLE, CONFIRM_COLUMNS, CONFIRM_REQUIRED, CONFIRM_NULLABLE],
    ];
    for (const [table, all, required, nullable] of expectShape) {
      const cols = await columnsOf(table);
      assert.deepStrictEqual(cols.map((c) => c.column_name).sort(), [...all].sort(), table);
      for (const name of required) {
        const col = cols.find((c) => c.column_name === name);
        assert.ok(col, `${table}.${name} must exist`);
        if (table === CRED_TABLE && CRED_PUBLIC_IDENTITY_COLUMNS.includes(name)) {
          // page_id is public tenant-scoped Page identity metadata on credential refs.
          // CREATE DDL requires NOT NULL (source scan above); a nullable migration column
          // may exist until backfill, but the column must be present exactly once.
          continue;
        }
        assert.strictEqual(col.is_nullable, 'NO', `${table}.${name} must be NOT NULL`);
      }
      for (const name of nullable) {
        const col = cols.find((c) => c.column_name === name);
        assert.ok(col, `${table}.${name} must exist`);
        assert.strictEqual(col.is_nullable, 'YES', `${table}.${name} must be nullable`);
      }
      const tenant = cols.find((c) => c.column_name === 'tenant_id');
      assert.strictEqual(tenant.data_type, 'integer');
      const pk = (await pkAndUniques(table)).filter((c) => c.constraint_type === 'PRIMARY KEY');
      assert.ok(pk.some((c) => c.cols === 'tenant_id,id'), `${table} PK must be (tenant_id, id)`);
      const forbidden = cols.filter((c) => {
        if (table === CRED_TABLE && CRED_ALLOWLIST_COLUMNS.includes(c.column_name)) return false;
        return FORBIDDEN_COLUMNS.includes(c.column_name) || FORBIDDEN_SECRET_RE.test(c.column_name);
      });
      assert.deepStrictEqual(forbidden, [], `${table} must not store forbidden surfaces`);
    }
  });

  test('named uniques and tenant-scoped FKs lead with tenant_id', async () => {
    const credKeys = await pkAndUniques(CRED_TABLE);
    assert.ok(credKeys.some((c) => c.constraint_name === 'orchestrator_tmcr_tenant_unique_fp_ver'
      && c.cols === 'tenant_id,account_fingerprint,version'));

    const chalKeys = await pkAndUniques(CHALLENGE_TABLE);
    assert.ok(chalKeys.some((c) => c.constraint_name === 'orchestrator_cpc_tenant_unique_idemp'
      && c.cols === 'tenant_id,idempotency_key'));
    assert.ok(chalKeys.some((c) => c.constraint_name === 'orchestrator_cpc_tenant_unique_attempt'
      && c.cols === 'tenant_id,attempt_id'));

    const confKeys = await pkAndUniques(CONFIRM_TABLE);
    assert.ok(confKeys.some((c) => c.constraint_name === 'orchestrator_cpcf_tenant_unique_idemp'
      && c.cols === 'tenant_id,idempotency_key'));
    assert.ok(confKeys.some((c) => c.constraint_name === 'orchestrator_cpcf_tenant_unique_challenge'
      && c.cols === 'tenant_id,challenge_id'));
    assert.ok(confKeys.some((c) => c.constraint_name === 'orchestrator_cpcf_tenant_unique_attempt'
      && c.cols === 'tenant_id,attempt_id'));

    const attemptKeys = await pkAndUniques('orchestrator_campaign_delivery_attempts');
    assert.ok(attemptKeys.some((c) => c.constraint_name === 'orchestrator_cda_tenant_unique_id_bind'
      && c.cols === 'tenant_id,id,outbox_id,intent_id'));

    const chalFks = await fkRows(CHALLENGE_TABLE);
    const expectChal = [
      ['orchestrator_cpc_tenant_draft_fkey', 'tenant_id,draft_id', 'orchestrator_campaign_drafts', 'c'],
      ['orchestrator_cpc_tenant_rev_fkey', 'tenant_id,draft_id,revision', 'orchestrator_campaign_draft_revisions', 'c'],
      ['orchestrator_cpc_tenant_pub_appr_fkey', 'tenant_id,publish_approval_id', 'orchestrator_campaign_publish_approvals', 'c'],
      ['orchestrator_cpc_tenant_pub_req_fkey', 'tenant_id,publishing_request_id', 'orchestrator_campaign_publish_requests', 'c'],
      ['orchestrator_cpc_tenant_intent_fkey', 'tenant_id,intent_id', 'orchestrator_campaign_delivery_intents', 'c'],
      ['orchestrator_cpc_tenant_attempt_fkey', 'tenant_id,attempt_id', 'orchestrator_campaign_delivery_attempts', 'c'],
      ['orchestrator_cpc_tenant_attempt_bind_fkey', 'tenant_id,attempt_id,outbox_id,intent_id', 'orchestrator_campaign_delivery_attempts', 'c'],
      ['orchestrator_cpc_tenant_cred_ref_fkey', 'tenant_id,credential_ref_id', CRED_TABLE, 'a'],
    ];
    for (const [name, cols, ref, del] of expectChal) {
      const fk = chalFks.find((f) => f.conname === name);
      assert.ok(fk, name);
      assert.strictEqual(fk.cols, cols, name);
      assert.strictEqual(fk.ref_table, ref, name);
      assert.strictEqual(fk.deltype, del, name);
      assert.ok(fk.cols.startsWith('tenant_id'), `${name} must be tenant-leading`);
    }
    const wfFk = chalFks.find((f) => f.conname === 'orchestrator_cpc_tenant_wf_appr_fkey');
    assert.ok(wfFk);
    assert.strictEqual(wfFk.deltype, 'a');
    assert.strictEqual(wfFk.deferrable, true);
    const outboxFk = chalFks.find((f) => f.conname === 'orchestrator_cpc_tenant_outbox_fkey');
    assert.ok(outboxFk);
    assert.strictEqual(outboxFk.ref_table, 'orchestrator_outbox');
    assert.strictEqual(outboxFk.deltype, 'a');
    assert.strictEqual(outboxFk.deferrable, true);

    const confFks = await fkRows(CONFIRM_TABLE);
    const chalRef = confFks.find((f) => f.conname === 'orchestrator_cpcf_tenant_challenge_fkey');
    assert.ok(chalRef);
    assert.strictEqual(chalRef.cols, 'tenant_id,challenge_id');
    assert.strictEqual(chalRef.ref_table, CHALLENGE_TABLE);
    const bindFk = confFks.find((f) => f.conname === 'orchestrator_cpcf_tenant_attempt_bind_fkey');
    assert.ok(bindFk);
    assert.strictEqual(bindFk.cols, 'tenant_id,attempt_id,outbox_id,intent_id');
  });

  test('TTL CHECKs cap challenge at 5 minutes and confirmation at 2 minutes', async () => {
    const chalTtl = await checkDef(CHALLENGE_TABLE, 'orchestrator_cpc_ttl_check');
    assert.match(chalTtl.definition, /expires_at > created_at/);
    assert.match(chalTtl.definition, /00:05:00|INTERVAL '5 minutes'|interval '5 minutes'/i);
    const confTtl = await checkDef(CONFIRM_TABLE, 'orchestrator_cpcf_ttl_check');
    assert.match(confTtl.definition, /expires_at > created_at/);
    assert.match(confTtl.definition, /00:02:00|INTERVAL '2 minutes'|interval '2 minutes'/i);

    const p = db.getPool();
    const graph = await seedGraph(p, tenantA, hostA, userId);
    await assert.rejects(
      () => insertChallenge(p, tenantA, hostA, graph, userId, {
        expiresSql: "now() + interval '5 minutes 1 second'",
      }),
      /ttl_check|check/i
    );
    await assert.rejects(
      () => insertChallenge(p, tenantA, hostA, graph, userId, {
        createdAtSql: 'now()', expiresSql: 'now()',
      }),
      /ttl_check|check/i
    );
    const chalId = await insertChallenge(p, tenantA, hostA, graph, userId);
    await assert.rejects(
      () => insertConfirmation(p, tenantA, hostA, graph, chalId, userId, {
        expiresSql: "now() + interval '2 minutes 1 second'",
      }),
      /ttl_check|check/i
    );
    await insertConfirmation(p, tenantA, hostA, graph, chalId, userId);
  });

  test('digest-only storage: hex salt/digest accepted; plaintext phrase columns absent', async () => {
    const p = db.getPool();
    const chalCols = await columnsOf(CHALLENGE_TABLE);
    const confCols = await columnsOf(CONFIRM_TABLE);
    for (const name of ['confirmation_phrase', 'confirmation_text', 'confirm_phrase', 'phrase']) {
      assert.ok(!chalCols.some((c) => c.column_name === name), `challenge must not have ${name}`);
      assert.ok(!confCols.some((c) => c.column_name === name), `confirmation must not have ${name}`);
    }
    assert.ok(chalCols.some((c) => c.column_name === 'phrase_salt'));
    assert.ok(!chalCols.some((c) => c.column_name === 'phrase_digest'));
    assert.ok(confCols.some((c) => c.column_name === 'phrase_salt'));
    assert.ok(confCols.some((c) => c.column_name === 'phrase_digest'));

    const graph = await seedGraph(p, tenantA, hostA, userId);
    await assert.rejects(
      () => insertChallenge(p, tenantA, hostA, graph, userId, { phraseSalt: 'CONFIRM PROVIDER DRAFT' }),
      /salt_check|check/i
    );
    const chalId = await insertChallenge(p, tenantA, hostA, graph, userId);
    await assert.rejects(
      () => insertConfirmation(p, tenantA, hostA, graph, chalId, userId, {
        phraseDigest: 'please-confirm-this-phrase-now',
      }),
      /digest_check|check/i
    );
    const confId = await insertConfirmation(p, tenantA, hostA, graph, chalId, userId, {
      phraseDigest: nextHex(),
    });
    const stored = (await p.query(
      `SELECT phrase_salt, phrase_digest FROM ${CONFIRM_TABLE} WHERE tenant_id=$1 AND id=$2`,
      [tenantA, confId]
    )).rows[0];
    assert.match(stored.phrase_salt, /^[0-9a-f]{64}$/);
    assert.match(stored.phrase_digest, /^[0-9a-f]{64}$/);
  });

  test('cross-tenant FKs refuse foreign draft, attempt, outbox, intent, and credential refs', async () => {
    const p = db.getPool();
    const graphA = await seedGraph(p, tenantA, hostA, userId);
    const graphB = await seedGraph(p, tenantB, hostB, userId);

    await assert.rejects(
      () => insertChallenge(p, tenantA, hostA, { ...graphA, draftId: graphB.draftId }, userId),
      /foreign key|violates|binding/i
    );
    await assert.rejects(
      () => insertChallenge(p, tenantA, hostA, graphA, userId, { attemptId: graphB.attemptId }),
      /foreign key|violates|binding/i
    );
    await assert.rejects(
      () => insertChallenge(p, tenantA, hostA, graphA, userId, {
        outboxId: graphB.outboxId, intentId: graphB.intentId, attemptId: graphB.attemptId,
      }),
      /foreign key|violates|binding/i
    );
    await assert.rejects(
      () => insertChallenge(p, tenantA, hostA, graphA, userId, { credentialRefId: graphB.credId }),
      /foreign key|violates|binding/i
    );
    await insertChallenge(p, tenantB, hostB, graphB, userId);
  });

  test('credential refs are Meta/test-or-sandbox only and revoke monotonically', async () => {
    const p = db.getPool();
    const id = nid('mcr');
    await assert.rejects(
      () => p.query(
        `INSERT INTO ${CRED_TABLE}
           (id, tenant_id, platform, environment, status, account_fingerprint, page_id, version, owner_user_id)
         VALUES ($1,$2,'google','sandbox','active',$3,'1122334455667',1,$4)`,
        [id, tenantA, nextHex(), userId]
      ),
      /platform_check|check/i
    );
    await assert.rejects(
      () => p.query(
        `INSERT INTO ${CRED_TABLE}
           (id, tenant_id, platform, environment, status, account_fingerprint, page_id, version, owner_user_id)
         VALUES ($1,$2,'meta','production','active',$3,'1122334455667',1,$4)`,
        [nid('mcr'), tenantA, nextHex(), userId]
      ),
      /environment_check|check/i
    );
    await assert.rejects(
      () => p.query(
        `INSERT INTO ${CRED_TABLE}
           (id, tenant_id, platform, environment, status, account_fingerprint, page_id, version, owner_user_id)
         VALUES ($1,$2,'meta','test','active',$3,'not-a-page',1,$4)`,
        [nid('mcr'), tenantA, nextHex(), userId]
      ),
      /page_id_check|check/i
    );
    await assert.rejects(
      () => p.query(
        `INSERT INTO ${CRED_TABLE}
           (id, tenant_id, platform, environment, status, account_fingerprint, page_id, version, owner_user_id, revoked_at)
         VALUES ($1,$2,'meta','test','revoked',$3,'1122334455667',1,$4,now())`,
        [nid('mcr'), tenantA, nextHex(), userId]
      ),
      /tmcr_immutable|immutable/i
    );
    const credId = await insertCredRef(p, tenantA, userId, { environment: 'test' });
    await assert.rejects(
      () => p.query(`UPDATE ${CRED_TABLE} SET platform='google' WHERE tenant_id=$1 AND id=$2`, [tenantA, credId]),
      /tmcr_immutable|immutable/i
    );
    await assert.rejects(
      () => p.query(`UPDATE ${CRED_TABLE} SET version=2 WHERE tenant_id=$1 AND id=$2`, [tenantA, credId]),
      /tmcr_immutable|immutable/i
    );
    await p.query(
      `UPDATE ${CRED_TABLE} SET status='revoked', revoked_at=now(), updated_at=now() WHERE tenant_id=$1 AND id=$2`,
      [tenantA, credId]
    );
    await assert.rejects(
      () => p.query(
        `UPDATE ${CRED_TABLE} SET status='active', revoked_at=NULL WHERE tenant_id=$1 AND id=$2`,
        [tenantA, credId]
      ),
      /tmcr_immutable|immutable/i
    );
    await assert.rejects(
      () => p.query(`DELETE FROM ${CRED_TABLE} WHERE tenant_id=$1 AND id=$2`, [tenantA, credId]),
      /tmcr_immutable|immutable/i
    );
  });

  test('challenges consume once; confirmations spend once; identity stays frozen', async () => {
    const p = db.getPool();
    const graph = await seedGraph(p, tenantA, hostA, userId);
    const chalId = await insertChallenge(p, tenantA, hostA, graph, userId);
    await assert.rejects(
      () => p.query(`UPDATE ${CHALLENGE_TABLE} SET status='consumed' WHERE tenant_id=$1 AND id=$2`, [tenantA, chalId]),
      /cpc_immutable|immutable/i
    );
    await assert.rejects(
      () => p.query(`UPDATE ${CHALLENGE_TABLE} SET phrase_salt=$3 WHERE tenant_id=$1 AND id=$2`, [tenantA, chalId, nextHex()]),
      /cpc_immutable|immutable/i
    );
    const confId = await insertConfirmation(p, tenantA, hostA, graph, chalId, userId);
    await p.query(
      `UPDATE ${CHALLENGE_TABLE}
          SET status='consumed', consumed_at=now(), consumed_confirmation_id=$3
        WHERE tenant_id=$1 AND id=$2`,
      [tenantA, chalId, confId]
    );
    await assert.rejects(
      () => p.query(
        `UPDATE ${CHALLENGE_TABLE} SET consumed_confirmation_id=$3 WHERE tenant_id=$1 AND id=$2`,
        [tenantA, chalId, nid('other')]
      ),
      /cpc_immutable|immutable/i
    );
    await assert.rejects(
      () => p.query(`UPDATE ${CONFIRM_TABLE} SET phrase_digest=$3 WHERE tenant_id=$1 AND id=$2`, [tenantA, confId, nextHex()]),
      /cpcf_immutable|immutable/i
    );
    await p.query(
      `UPDATE ${CONFIRM_TABLE} SET status='spent', spent_at=now() WHERE tenant_id=$1 AND id=$2`,
      [tenantA, confId]
    );
    await assert.rejects(
      () => p.query(
        `UPDATE ${CONFIRM_TABLE} SET status='confirmed', spent_at=NULL WHERE tenant_id=$1 AND id=$2`,
        [tenantA, confId]
      ),
      /cpcf_immutable|immutable/i
    );
    await assert.rejects(
      () => p.query(`DELETE FROM ${CONFIRM_TABLE} WHERE tenant_id=$1 AND id=$2`, [tenantA, confId]),
      /cpcf_immutable|immutable/i
    );
    await assert.rejects(
      () => p.query(`DELETE FROM ${CHALLENGE_TABLE} WHERE tenant_id=$1 AND id=$2`, [tenantA, chalId]),
      /cpc_immutable|immutable/i
    );
  });

  test('confirmation insert refuses mismatched challenge bindings and salt', async () => {
    const p = db.getPool();
    const graph = await seedGraph(p, tenantA, hostA, userId);
    const chalId = await insertChallenge(p, tenantA, hostA, graph, userId);
    await assert.rejects(
      () => insertConfirmation(p, tenantA, hostA, graph, chalId, userId, { phraseSalt: nextHex() }),
      /cpcf_binding|binding/i
    );
  });

  test('mismatched attempt/outbox/intent bind is refused and tenant cascade cleans rows', async () => {
    const p = db.getPool();
    const graphA = await seedGraph(p, tenantA, hostA, userId);
    const extraDraft = await insertDraft(p, tenantA, hostA);
    await insertRevision(p, tenantA, extraDraft);
    const extraPub = await insertPublishApproval(p, tenantA, hostA, extraDraft, { actorUserId: userId });
    const extraReq = await insertRequest(p, tenantA, hostA, extraDraft, extraPub, { requestedBy: userId });
    const extraIntent = await insertBoundIntent(p, tenantA, hostA, extraDraft, extraPub, extraReq.id, {
      requestedBy: userId,
    });
    await assert.rejects(
      () => insertChallenge(p, tenantA, hostA, graphA, userId, {
        outboxId: extraIntent.outboxId, intentId: extraIntent.id,
      }),
      /foreign key|violates|binding/i
    );

    const isolated = (await p.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [`AO6F0 cascade ${SUFFIX}`, `ao6f0-c-${SUFFIX}`]
    )).rows[0].id;
    const hostC = await seedHost(p, isolated);
    const graphC = await seedGraph(p, isolated, hostC, userId);
    const chalId = await insertChallenge(p, isolated, hostC, graphC, userId);
    await insertConfirmation(p, isolated, hostC, graphC, chalId, userId);
    await p.query(`DELETE FROM tenants WHERE id=$1`, [isolated]);
    const leftover = await p.query(
      `SELECT
         (SELECT count(*)::int FROM ${CHALLENGE_TABLE} WHERE tenant_id=$1) AS challenges,
         (SELECT count(*)::int FROM ${CONFIRM_TABLE} WHERE tenant_id=$1) AS confirmations,
         (SELECT count(*)::int FROM ${CRED_TABLE} WHERE tenant_id=$1) AS creds`,
      [isolated]
    );
    assert.deepStrictEqual(leftover.rows[0], { challenges: 0, confirmations: 0, creds: 0 });
  });

  test('ensureAgentOrchestratorSchema is idempotent for PR6F-0 tables', async () => {
    await ensureAgentOrchestratorSchema();
    await ensureAgentOrchestratorSchema();
    const p = db.getPool();
    const counts = await p.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' AND table_name = ANY($1)`,
      [TABLES]
    );
    assert.equal(counts.rowCount, 3);
    const graph = await seedGraph(p, tenantA, hostA, userId);
    const chalId = await insertChallenge(p, tenantA, hostA, graph, userId);
    await insertConfirmation(p, tenantA, hostA, graph, chalId, userId);
  });
}
