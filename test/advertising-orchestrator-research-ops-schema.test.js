// test/advertising-orchestrator-research-ops-schema.test.js — PR 3A retention, quota, fingerprint
//
// Gated on DATABASE_URL. When hasDb() is true there are ZERO per-test skips.
// Self-contained: ensureTenantSchema + ensureAgentOrchestratorSchema, no server.js boot.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');

const db = require('../db');
const {
  ensureAgentOrchestratorSchema,
  identifyLegacyResearchCleanup,
} = require('../services/agent_orchestrator/schema');
const { ensureTenantSchema } = require('../services/tenants/schema');

const SCHEMA_SRC_PATH = path.join(__dirname, '../services/agent_orchestrator/schema.js');

function extractFunctionSource(src, name) {
  const start = src.indexOf(`async function ${name}`);
  assert.ok(start >= 0, `${name} must exist`);
  const brace = src.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unclosed function ${name}`);
}

function extractBacktickSql(fnSrc) {
  const out = [];
  const re = /`([^`]+)`/g;
  let m;
  while ((m = re.exec(fnSrc))) out.push(m[1]);
  return out;
}

function extractTaggedTemplates(src, callee) {
  const out = [];
  const startRe = new RegExp(callee.replace('.', '\\.') + '\\((?:[A-Za-z_][\\w]*\\s*,\\s*)?`', 'g');
  let m;
  while ((m = startRe.exec(src))) {
    const from = m.index + m[0].length;
    const to = src.indexOf('`', from);
    assert.ok(to > from, `${callee} template must close`);
    out.push(src.slice(from, to));
    startRe.lastIndex = to + 1;
  }
  return out;
}

function mentionsTriggerOn(sql, table) {
  return new RegExp(`\\bON\\s+${table}\\b`).test(sql);
}

test('production schema.js has no replica-role backfill and identify never mutates evidence rows', () => {
  const src = fs.readFileSync(SCHEMA_SRC_PATH, 'utf8');
  assert.doesNotMatch(src, /session_replication_role/);
  assert.doesNotMatch(src, /_backfillInReplicaRole/);
  assert.doesNotMatch(src, /_backfillResearchRetentionExpiry/);
  assert.doesNotMatch(src, /_backfillResearchJsonObjects/);
  assert.doesNotMatch(src, /DISABLE TRIGGER/);
  assert.doesNotMatch(src, /infogenie\.research_cleanup/);
  assert.match(src, /_preflightAgentOrchestratorSchema/);
  assert.match(src, /orchestrator_schema_preflight_failed/);
  assert.match(src, /NOT VALID/);
  assert.match(src, /VALIDATE CONSTRAINT/);
  assert.match(src, /identifyLegacyResearchCleanup/);
  assert.match(src, /orchestrator_research_cleanup_targets/);
  assert.match(src, /'orchestrator_research_cleanup_targets'/);

  const runEnsure = extractFunctionSource(src, '_runEnsureAgentOrchestratorSchema');
  assert.match(runEnsure, /SET lock_timeout = '30s'/);
  assert.match(runEnsure, /SET lock_timeout TO DEFAULT/);
  const lockTimeoutAt = runEnsure.indexOf("SET lock_timeout = '30s'");
  const advisoryAt = runEnsure.indexOf('pg_advisory_lock');
  assert.ok(lockTimeoutAt >= 0 && advisoryAt > lockTimeoutAt,
    'lock_timeout must be set on the ensure client before the advisory lock');
  assert.ok(runEnsure.includes('SET lock_timeout TO DEFAULT'),
    'ensure finally must reset lock_timeout');

  const identify = extractFunctionSource(src, '_identifyLegacyResearchCleanup');
  assert.doesNotMatch(identify, /UPDATE\s+orchestrator_research_evidence\b/);
  assert.doesNotMatch(identify, /DELETE\s+FROM\s+orchestrator_research_evidence\b/);
  assert.doesNotMatch(identify, /UPDATE\s+orchestrator_research_evidence_assets\b/);
  assert.doesNotMatch(identify, /DELETE\s+FROM\s+orchestrator_research_evidence_assets\b/);
  assert.match(identify, /legacy_short_due/);
  assert.match(identify, /missing_expiry/);
  assert.match(identify, /invalid_expiry/);
  assert.doesNotMatch(
    identify,
    /created_at \+ interval '7 days' <= now\(\)/,
    'identify must not hold every short row whose created_at is older than 7 days'
  );
  assert.match(identify, /ON CONFLICT \(tenant_id, target_kind, target_id\) DO NOTHING/);

  const srcQuota = src.slice(src.indexOf('CREATE OR REPLACE FUNCTION orchestrator_research_evidence_quota_insert'));
  assert.match(srcQuota, /FOR UPDATE/);
  assert.match(srcQuota, /COUNT\(\*\)::int/);
  assert.match(srcQuota, /orchestrator_research_evidence_payload_bytes/);
  assert.doesNotMatch(srcQuota, /evidence_count \+ 1/);
});

test('research trigger install is per-table and not one p.query locking runs+evidence', () => {
  const src = fs.readFileSync(SCHEMA_SRC_PATH, 'utf8');
  const helper = extractFunctionSource(src, '_installInTransaction');
  assert.match(helper, /p\.query\(\s*'BEGIN'\s*\)/);
  assert.match(helper, /p\.query\(\s*'COMMIT'\s*\)/);
  assert.match(helper, /p\.query\(\s*'ROLLBACK'\s*\)/);
  assert.match(helper, /catch/);

  const installSql = extractTaggedTemplates(src, '_installInTransaction');
  const querySql = extractTaggedTemplates(src, 'p.query');
  for (const sql of querySql) {
    assert.ok(
      !/CREATE\s+TRIGGER\s+orchestrator_research/i.test(sql),
      'research CREATE TRIGGER must use _installInTransaction, not a bare p.query'
    );
  }

  const triggerInstalls = installSql.filter((sql) => /CREATE\s+TRIGGER/i.test(sql));
  assert.ok(triggerInstalls.length >= 4, 'expected one trigger transaction per research table');

  for (const sql of [...installSql, ...querySql].filter((s) => /(?:DROP|CREATE)\s+TRIGGER/i.test(s))) {
    const onRuns = mentionsTriggerOn(sql, 'orchestrator_research_runs');
    const onEvidence = mentionsTriggerOn(sql, 'orchestrator_research_evidence');
    assert.ok(
      !(onRuns && onEvidence),
      'runs and evidence trigger DDL must not share a p.query / _installInTransaction string'
    );
  }

  const groups = [
    {
      table: 'orchestrator_research_runs',
      triggers: [
        'orchestrator_research_runs_approval_bind',
        'orchestrator_research_runs_identity_immutable',
      ],
    },
    {
      table: 'orchestrator_research_competitors',
      triggers: ['orchestrator_research_competitors_immutable'],
    },
    {
      table: 'orchestrator_research_evidence',
      triggers: [
        'orchestrator_research_evidence_immutable',
        'orchestrator_research_evidence_supersedes_bind',
        'orchestrator_research_evidence_quota_insert',
        'orchestrator_research_evidence_quota_delete',
      ],
    },
    {
      table: 'orchestrator_research_evidence_assets',
      triggers: ['orchestrator_research_evidence_assets_immutable'],
    },
  ];
  for (const group of groups) {
    const blob = triggerInstalls.find((sql) => mentionsTriggerOn(sql, group.table));
    assert.ok(blob, `missing _installInTransaction for ${group.table}`);
    for (const name of group.triggers) {
      assert.match(
        blob,
        new RegExp(`DROP\\s+TRIGGER\\s+IF\\s+EXISTS\\s+${name}\\s+ON\\s+${group.table}`),
        `${name} DROP must stay in the same transaction as ${group.table}`
      );
      assert.match(
        blob,
        new RegExp(`CREATE\\s+TRIGGER\\s+${name}[\\s\\S]*?\\sON\\s+${group.table}`),
        `${name} CREATE must stay in the same transaction as ${group.table}`
      );
    }
  }
});

test('legacy identify SQL is tenant-scoped and does not combine 7/30-day UPDATEs', () => {
  const src = fs.readFileSync(SCHEMA_SRC_PATH, 'utf8');
  const fn = extractFunctionSource(src, '_identifyLegacyResearchCleanup');
  assert.match(fn, /INSERT INTO orchestrator_research_legacy_holds/);
  assert.match(fn, /target_kind, target_id, reason/);
  assert.doesNotMatch(fn, /session_replication_role/);
  const sql = extractBacktickSql(fn).join('\n');
  assert.match(sql, /retention_class = 'short'/);
  assert.match(sql, /retention_class IN \('standard', 'short'\)/);
  assert.match(sql, /expires_at <= now\(\)/);
  assert.doesNotMatch(sql, /created_at \+ interval '7 days' <= now\(\)/);
  assert.doesNotMatch(sql, /interval\s+'30 days'/);
  assert.doesNotMatch(sql, /^\s*UPDATE\s+/m);
  assert.match(fn, /_legacyShortDueSnapshotOpen/);
  assert.match(fn, /_closeLegacyShortDueSnapshot/);
});

const HAS_DB = db.hasDb();
const SHA256_A = 'a'.repeat(64);
const SHA256_C = 'c'.repeat(64);
const SUFFIX = `aoro-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let seq = 0;
function nid(prefix) {
  seq += 1;
  return `${prefix}-${SUFFIX}-${seq}`;
}

async function seedResearchLimits(p, tenantId, opts = {}) {
  await p.query(
    `INSERT INTO orchestrator_tenant_limits
       (tenant_id, max_research_evidence_records, max_research_evidence_payload_bytes)
     VALUES ($1,$2,$3)
     ON CONFLICT (tenant_id) DO UPDATE SET
       max_research_evidence_records = EXCLUDED.max_research_evidence_records,
       max_research_evidence_payload_bytes = EXCLUDED.max_research_evidence_payload_bytes`,
    [tenantId, opts.records ?? 10000, opts.bytes ?? 104857600]
  );
}

async function insertWorkflow(p, tenantId, wfId) {
  await p.query(
    `INSERT INTO orchestrator_workflows (id, tenant_id, name) VALUES ($1,$2,$3)`,
    [wfId, tenantId, `research host ${wfId}`]
  );
}

async function insertApproval(p, tenantId, wfId, opts = {}) {
  const row = (await p.query(
    `INSERT INTO orchestrator_approvals
       (tenant_id, workflow_id, gate, content_hash, decision, object_version, approved_platforms)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
     RETURNING id`,
    [
      tenantId,
      wfId,
      opts.gate || 'research_execution',
      opts.contentHash || `hash-${wfId}`,
      opts.decision || 'approved',
      opts.objectVersion || 1,
      JSON.stringify(opts.approvedPlatforms || ['meta', 'google', 'tiktok']),
    ]
  )).rows[0];
  return row.id;
}

async function insertRun(p, tenantId, wfId, approvalId, opts = {}) {
  const id = opts.id || nid('run');
  const searchSql = opts.searchParametersSql || '$10::jsonb';
  const contSql = opts.continuationStateSql || `'{}'::jsonb`;
  const params = [
    id,
    tenantId,
    wfId,
    approvalId,
    opts.approvalObjectVersion || 1,
    opts.platforms || ['meta'],
    opts.idempotencyKey || nid('idemp'),
    opts.state || 'pending',
    opts.researchBrief || '',
  ];
  if (!opts.searchParametersSql) params.push(JSON.stringify(opts.searchParameters || {}));
  await p.query(
    `INSERT INTO orchestrator_research_runs
       (id, tenant_id, workflow_id, approval_id, approval_object_version,
        requested_platforms, idempotency_key, state, research_brief, search_parameters,
        continuation_state)
     VALUES ($1,$2,$3,$4,$5,$6::text[],$7,$8,$9, ${searchSql}, ${contSql})`,
    params
  );
  return id;
}

async function seedHost(p, tenantId, opts = {}) {
  const wfId = opts.wfId || nid('wf');
  if (!opts.reuseWorkflow) {
    await insertWorkflow(p, tenantId, wfId);
  }
  const approvalId = opts.approvalId || await insertApproval(p, tenantId, wfId, opts);
  const runId = await insertRun(p, tenantId, wfId, approvalId, opts);
  return { wfId, approvalId, runId };
}

async function insertCompetitor(p, tenantId, runId, opts = {}) {
  const id = opts.id || nid('comp');
  await p.query(
    `INSERT INTO orchestrator_research_competitors
       (id, tenant_id, research_run_id, platform, provider_advertiser_id, normalized_name,
        discovery_source, captured_at, dedup_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now(), $8)`,
    [
      id,
      tenantId,
      runId,
      opts.platform || 'meta',
      opts.providerAdvertiserId || nid('adv'),
      opts.normalizedName || 'Acme Ads',
      opts.discoverySource || 'ad_library',
      opts.dedupKey || nid('cdedup'),
    ]
  );
  return id;
}

async function insertEvidence(p, tenantId, runId, competitorId, opts = {}) {
  const id = opts.id || nid('ev');
  const retentionClass = opts.retentionClass || 'standard';
  const fingerprint = opts.contentFingerprint || opts.evidenceHash || SHA256_A;
  const hasExpires = Object.prototype.hasOwnProperty.call(opts, 'expiresAt');
  const hasCreated = Object.prototype.hasOwnProperty.call(opts, 'createdAt');
  const params = [
    id,
    tenantId,
    runId,
    competitorId,
    opts.platform || 'meta',
    opts.sourceType || 'ad_creative',
    opts.providerExternalId || null,
    opts.headline || '',
    opts.bodyText || '',
    opts.excerpt || '',
    opts.advertiserName || '',
    JSON.stringify(opts.providerMetrics || {}),
    opts.provenanceMethod || 'ad_library',
    opts.connectorId || 'meta_research',
    opts.connectorVersion || '1.0.0',
    fingerprint,
    opts.dedupKey || nid('ededup'),
    opts.supersedesId || null,
    retentionClass,
  ];
  const expiresSql = hasExpires ? `$${params.length + 1}::timestamptz` : `now() + interval '30 days'`;
  if (hasExpires) params.push(opts.expiresAt);
  const createdSql = hasCreated ? `$${params.length + 1}::timestamptz` : 'now()';
  if (hasCreated) params.push(opts.createdAt);
  await p.query(
    `INSERT INTO orchestrator_research_evidence
       (id, tenant_id, research_run_id, competitor_id, platform, source_type,
        provider_external_id, headline, body_text, excerpt, advertiser_name,
        captured_at, provider_metrics, provenance_method, connector_id, connector_version,
        content_fingerprint, dedup_key, supersedes_id, retention_class, expires_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now(), $12::jsonb, $13,$14,$15,$16,$17,$18,$19,
             ${expiresSql}, ${createdSql})`,
    params
  );
  return id;
}

async function insertAsset(p, tenantId, evidenceId, opts = {}) {
  const id = opts.id || nid('asset');
  const retentionClass = opts.retentionClass || 'standard';
  const hasExpires = Object.prototype.hasOwnProperty.call(opts, 'expiresAt');
  const hasCreated = Object.prototype.hasOwnProperty.call(opts, 'createdAt');
  const params = [
    id,
    tenantId,
    evidenceId,
    opts.mediaType || 'image',
    opts.storageRef || `s3://orch/${id}`,
    opts.checksum || SHA256_C,
    retentionClass,
  ];
  const expiresSql = hasExpires ? `$${params.length + 1}::timestamptz` : `now() + interval '30 days'`;
  if (hasExpires) params.push(opts.expiresAt);
  const createdSql = hasCreated ? `$${params.length + 1}::timestamptz` : 'now()';
  if (hasCreated) params.push(opts.createdAt);
  await p.query(
    `INSERT INTO orchestrator_research_evidence_assets
       (id, tenant_id, evidence_id, media_type, storage_ref, checksum_sha256, captured_at,
        retention_class, expires_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6, now(), $7, ${expiresSql}, ${createdSql})`,
    params
  );
  return id;
}

async function insertCleanupOp(p, tenantId, opts = {}) {
  const id = opts.id || nid('op');
  await p.query(
    `INSERT INTO orchestrator_research_cleanup_ops
       (id, tenant_id, idempotency_key, state)
     VALUES ($1,$2,$3,$4)`,
    [id, tenantId, opts.idempotencyKey || nid('op-idemp'), opts.state || 'approved']
  );
  return id;
}

async function insertCleanupTarget(p, tenantId, opId, kind, targetId) {
  await p.query(
    `INSERT INTO orchestrator_research_cleanup_targets
       (tenant_id, op_id, target_kind, target_id)
     VALUES ($1,$2,$3,$4)`,
    [tenantId, opId, kind, targetId]
  );
}

async function indexDef(name) {
  const row = (await db.getPool().query(
    `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname=$1`,
    [name]
  )).rows[0];
  return row ? row.indexdef : null;
}

async function checkExists(table, name) {
  const row = (await db.getPool().query(
    `SELECT 1 FROM pg_constraint WHERE conname=$1 AND conrelid=$2::regclass`,
    [name, `public.${table}`]
  )).rows[0];
  return !!row;
}

async function checkValidated(table, name) {
  const row = (await db.getPool().query(
    `SELECT convalidated FROM pg_constraint
      WHERE conname=$1 AND conrelid=$2::regclass`,
    [name, `public.${table}`]
  )).rows[0];
  return row ? row.convalidated : null;
}

async function snapshotPublicSchema(p) {
  const tables = (await p.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' ORDER BY 1`
  )).rows.map((r) => r.table_name);
  const cons = (await p.query(
    `SELECT c.relname || ':' || con.conname AS ident
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname='public'
      ORDER BY 1`
  )).rows.map((r) => r.ident);
  return { tables, cons };
}

function dbUrlParts() {
  const u = new URL(process.env.DATABASE_URL);
  return {
    host: u.hostname,
    port: u.port || '5432',
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
  };
}

async function createLoginRole(admin, { name, password, schemaCreate }) {
  const { database } = dbUrlParts();
  await admin.query(`CREATE ROLE ${name} LOGIN NOSUPERUSER PASSWORD '${password}'`);
  await admin.query(`GRANT CONNECT ON DATABASE ${database} TO ${name}`);
  if (schemaCreate) {
    await admin.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${name}`);
  } else {
    await admin.query(`GRANT USAGE ON SCHEMA public TO ${name}`);
  }
}

// Test-only: serialize AccessExclusiveLock takers (OWNER TO / REASSIGN /
// DROP OWNED) with ensure() and the concurrency locker. Gate is a third
// connection so the work client never holds 87231402 — ensure() already
// holds that lock for its whole run and would self-deadlock if we took it
// on a client we then used to call ensureAgentOrchestratorSchema().
async function withEnsureDdlGate(pool, work) {
  const gate = await pool.connect();
  const client = await pool.connect();
  try {
    await gate.query('SELECT pg_advisory_lock($1)', [87231402]);
    await client.query("SET lock_timeout = '30s'");
    return await work(client);
  } finally {
    try { await client.query('SET lock_timeout TO DEFAULT'); } catch { /* ignore */ }
    client.release();
    try { await gate.query('SELECT pg_advisory_unlock($1)', [87231402]); } catch { /* ignore */ }
    gate.release();
  }
}

async function dropLoginRole(admin, name) {
  await withEnsureDdlGate(admin, async (client) => {
    await client.query(`REASSIGN OWNED BY ${name} TO CURRENT_USER`);
    await client.query(`DROP OWNED BY ${name}`);
    await client.query(`DROP ROLE IF EXISTS ${name}`);
  });
}

async function grantOrchestratorMigrator(admin, name) {
  await withEnsureDdlGate(admin, async (client) => {
    await client.query(`GRANT SELECT, REFERENCES ON TABLE tenants TO ${name}`);
    const users = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users'`
    );
    if (users.rowCount) {
      await client.query(`GRANT SELECT, REFERENCES ON TABLE users TO ${name}`);
    }
    await client.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${name}`);
    const tables = (await client.query(`
      SELECT tablename FROM pg_tables
       WHERE schemaname='public'
         AND (tablename LIKE 'orchestrator_%' OR tablename = 'agent_orchestrator_runs')
    `)).rows;
    for (const t of tables) {
      await client.query(`ALTER TABLE public.${t.tablename} OWNER TO ${name}`);
    }
    const fns = (await client.query(`
      SELECT p.oid::regprocedure AS ident
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname='public' AND p.proname LIKE 'orchestrator_%'
    `)).rows;
    for (const f of fns) {
      await client.query(`ALTER FUNCTION ${f.ident} OWNER TO ${name}`);
    }
  });
}

if (!HAS_DB) {
  test('advertising-orchestrator research ops schema skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else {
  let tenantA = null;
  let tenantB = null;

  before(async () => {
    await ensureTenantSchema();
    await ensureAgentOrchestratorSchema();
    const p = db.getPool();
    const mk = async (label, slug) => (await p.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [label, slug]
    )).rows[0].id;
    tenantA = await mk(`AORO A ${SUFFIX}`, `aoro-a-${SUFFIX}`);
    tenantB = await mk(`AORO B ${SUFFIX}`, `aoro-b-${SUFFIX}`);
    await seedResearchLimits(p, tenantA);
    await seedResearchLimits(p, tenantB);
  });

  after(async () => {
    const p = db.getPool();
    const ids = [tenantA, tenantB].filter(Boolean);
    if (!ids.length) return;
    await p.query(`DELETE FROM tenants WHERE id = ANY($1)`, [ids]);
  });

  test('jsonb_typeof CHECKs reject arrays/scalars; second ensure is idempotent', async () => {
    const p = db.getPool();
    const wfId = nid('wf-json');
    await insertWorkflow(p, tenantA, wfId);
    const approvalId = await insertApproval(p, tenantA, wfId, { contentHash: nid('hash-json') });

    await assert.rejects(
      () => insertRun(p, tenantA, wfId, approvalId, {
        id: nid('run-json-arr'),
        searchParametersSql: `'[]'::jsonb`,
      }),
      /search_parameters|check/i,
      "'[]'::jsonb search_parameters must be rejected"
    );
    await assert.rejects(
      () => insertRun(p, tenantA, wfId, approvalId, {
        id: nid('run-json-num'),
        searchParametersSql: `'1'::jsonb`,
      }),
      /search_parameters|check/i,
      "'1'::jsonb search_parameters must be rejected"
    );
    await assert.rejects(
      () => insertRun(p, tenantA, wfId, approvalId, {
        id: nid('run-json-str'),
        searchParametersSql: `'"x"'::jsonb`,
      }),
      /search_parameters|check/i,
      "'\"x\"'::jsonb search_parameters must be rejected"
    );
    await assert.rejects(
      () => insertRun(p, tenantA, wfId, approvalId, {
        id: nid('run-cont-arr'),
        continuationStateSql: `'[]'::jsonb`,
      }),
      /continuation_state|check/i,
      "'[]'::jsonb continuation_state must be rejected"
    );
    await assert.rejects(
      () => insertRun(p, tenantA, wfId, approvalId, {
        id: nid('run-cont-num'),
        continuationStateSql: `'1'::jsonb`,
      }),
      /continuation_state|check/i
    );
    await assert.rejects(
      () => insertRun(p, tenantA, wfId, approvalId, {
        id: nid('run-cont-str'),
        continuationStateSql: `'"x"'::jsonb`,
      }),
      /continuation_state|check/i
    );

    await insertRun(p, tenantA, wfId, approvalId, {
      id: nid('run-json-ok'),
      searchParameters: {},
    });

    await ensureAgentOrchestratorSchema();
    await ensureAgentOrchestratorSchema();
    assert.ok(await checkExists('orchestrator_research_runs', 'orchestrator_research_runs_search_parameters_type_check'));
    assert.ok(await checkExists('orchestrator_research_runs', 'orchestrator_research_runs_continuation_state_type_check'));
    await insertRun(p, tenantA, wfId, approvalId, {
      id: nid('run-json-ok2'),
      searchParameters: { market: 'us' },
      state: 'completed',
    });
  });

  test('fail-closed retention: standard/short require expires_at > created_at; legal_hold may omit it', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertCompetitor(p, tenantA, host.runId);
    const ts = new Date();

    await assert.rejects(
      () => insertEvidence(p, tenantA, host.runId, comp, {
        id: nid('ev-std-null'),
        retentionClass: 'standard',
        expiresAt: null,
      }),
      /retention_expiry|check/i,
      'standard insert without expires_at must fail'
    );
    await assert.rejects(
      () => insertEvidence(p, tenantA, host.runId, comp, {
        id: nid('ev-short-null'),
        retentionClass: 'short',
        expiresAt: null,
      }),
      /retention_expiry|check/i,
      'short insert without expires_at must fail'
    );
    await assert.rejects(
      () => insertEvidence(p, tenantA, host.runId, comp, {
        id: nid('ev-std-eq'),
        retentionClass: 'standard',
        createdAt: ts,
        expiresAt: ts,
      }),
      /retention_expiry|check/i,
      'standard expires_at <= created_at must fail'
    );

    await insertEvidence(p, tenantA, host.runId, comp, {
      id: nid('ev-hold-null'),
      retentionClass: 'legal_hold',
      expiresAt: null,
    });

    const evId = await insertEvidence(p, tenantA, host.runId, comp, { id: nid('ev-asset-ret') });
    await assert.rejects(
      () => insertAsset(p, tenantA, evId, { retentionClass: 'standard', expiresAt: null }),
      /retention_expiry|check/i
    );
    await insertAsset(p, tenantA, evId, { retentionClass: 'legal_hold', expiresAt: null });
  });

  test('expired non-hold DELETE succeeds; UPDATE and live DELETE stay immutable; legal_hold DELETE refused', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertCompetitor(p, tenantA, host.runId);
    const createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const expiredAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const futureAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const liveId = await insertEvidence(p, tenantA, host.runId, comp, {
      id: nid('ev-live'),
      expiresAt: futureAt,
      createdAt,
    });
    await assert.rejects(
      () => p.query(
        `UPDATE orchestrator_research_evidence SET headline='tamper' WHERE tenant_id=$1 AND id=$2`,
        [tenantA, liveId]
      ),
      /orchestrator_research_evidence_immutable/
    );
    await assert.rejects(
      () => p.query(
        `DELETE FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
        [tenantA, liveId]
      ),
      /orchestrator_research_evidence_immutable/,
      'non-expired DELETE must stay immutable'
    );

    const expiredId = await insertEvidence(p, tenantA, host.runId, comp, {
      id: nid('ev-exp'),
      retentionClass: 'standard',
      createdAt,
      expiresAt: expiredAt,
    });
    await p.query(
      `DELETE FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, expiredId]
    );
    const gone = (await p.query(
      `SELECT 1 FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, expiredId]
    )).rows;
    assert.strictEqual(gone.length, 0, 'expired non-hold DELETE must succeed');

    const holdId = await insertEvidence(p, tenantA, host.runId, comp, {
      id: nid('ev-hold-del'),
      retentionClass: 'legal_hold',
      expiresAt: expiredAt,
      createdAt,
    });
    await assert.rejects(
      () => p.query(
        `DELETE FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
        [tenantA, holdId]
      ),
      /orchestrator_research_evidence_immutable/,
      'legal_hold DELETE must be refused while the run exists'
    );

    const futureId = await insertEvidence(p, tenantA, host.runId, comp, {
      id: nid('ev-future'),
      expiresAt: futureAt,
      createdAt,
    });
    await assert.rejects(
      () => p.query(
        `DELETE FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
        [tenantA, futureId]
      ),
      /orchestrator_research_evidence_immutable/,
      'future expires_at DELETE must fail'
    );

    const assetLive = await insertAsset(p, tenantA, liveId, { expiresAt: futureAt, createdAt });
    await assert.rejects(
      () => p.query(
        `UPDATE orchestrator_research_evidence_assets SET storage_ref='s3://tamper'
          WHERE tenant_id=$1 AND id=$2`,
        [tenantA, assetLive]
      ),
      /orchestrator_research_evidence_assets_immutable/
    );
    await assert.rejects(
      () => p.query(
        `DELETE FROM orchestrator_research_evidence_assets WHERE tenant_id=$1 AND id=$2`,
        [tenantA, assetLive]
      ),
      /orchestrator_research_evidence_assets_immutable/
    );

    const assetExp = await insertAsset(p, tenantA, liveId, {
      id: nid('asset-exp'),
      createdAt,
      expiresAt: expiredAt,
    });
    await p.query(
      `DELETE FROM orchestrator_research_evidence_assets WHERE tenant_id=$1 AND id=$2`,
      [tenantA, assetExp]
    );

    const assetHold = await insertAsset(p, tenantA, liveId, {
      retentionClass: 'legal_hold',
      expiresAt: expiredAt,
      createdAt,
    });
    await assert.rejects(
      () => p.query(
        `DELETE FROM orchestrator_research_evidence_assets WHERE tenant_id=$1 AND id=$2`,
        [tenantA, assetHold]
      ),
      /orchestrator_research_evidence_assets_immutable/
    );
  });

  test('identify does not hold naturally expired short rows after the first snapshot', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertCompetitor(p, tenantA, host.runId);
    const createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const expiredAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const shortEvId = nid('ev-ident-natural');
    const shortAssetId = nid('asset-ident-natural');
    await insertEvidence(p, tenantA, host.runId, comp, {
      id: shortEvId,
      retentionClass: 'short',
      createdAt,
      expiresAt: expiredAt,
      dedupKey: nid('ededup-ident-natural'),
    });
    await insertAsset(p, tenantA, shortEvId, {
      id: shortAssetId,
      retentionClass: 'short',
      createdAt,
      expiresAt: expiredAt,
    });

    await identifyLegacyResearchCleanup();
    await ensureAgentOrchestratorSchema();

    const leftover = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, shortEvId]
    )).rows;
    assert.strictEqual(leftover.length, 1, 'ensure() must not delete naturally expired short evidence');
    const leftoverAsset = (await p.query(
      `SELECT id FROM orchestrator_research_evidence_assets WHERE tenant_id=$1 AND id=$2`,
      [tenantA, shortAssetId]
    )).rows;
    assert.strictEqual(leftoverAsset.length, 1, 'ensure() must not delete naturally expired short assets');

    const holds = (await p.query(
      `SELECT target_kind, reason FROM orchestrator_research_legacy_holds
        WHERE tenant_id=$1 AND target_id = ANY($2)`,
      [tenantA, [shortEvId, shortAssetId]]
    )).rows;
    assert.deepStrictEqual(holds, [], 'naturally expired short rows must not gain a hold after the first snapshot');
  });

  test('CHECK stays NOT VALID when violators exist; new invalid INSERT still fails', async () => {
    const pool = db.getPool();
    // Third connection holds ensure()'s advisory lock so a sibling ensure()
    // cannot start AccessExclusiveLock while these DROP/ADD transactions run.
    // Do not take 87231402 on the ALTER client — ensure() already holds it
    // for its whole run and would self-deadlock if we called ensure() on the
    // same client. Unlock before ensure() below.
    const gate = await pool.connect();
    const client = await pool.connect();
    const laterClient = await pool.connect();
    const evId = nid('ev-viol');
    const assetId = nid('asset-viol');
    const evInvalidId = nid('ev-viol-inv');
    const assetInvalidId = nid('asset-viol-inv');
    const evLater = nid('ev-viol-later');
    const ts = new Date();
    const expirySql =
      `retention_class = 'legal_hold' OR (expires_at IS NOT NULL AND expires_at > created_at)`;
    try {
      await gate.query('SELECT pg_advisory_lock($1)', [87231402]);
      await client.query("SET lock_timeout = '30s'");
      await laterClient.query("SET lock_timeout = '30s'");
      await client.query('BEGIN');
      await client.query(
        `ALTER TABLE orchestrator_research_evidence DROP CONSTRAINT IF EXISTS orchestrator_research_evidence_retention_expiry_check`
      );
      await client.query(
        `ALTER TABLE orchestrator_research_evidence_assets DROP CONSTRAINT IF EXISTS orchestrator_research_evidence_assets_retention_expiry_check`
      );
      const host = await seedHost(client, tenantA);
      const comp = await insertCompetitor(client, tenantA, host.runId);
      await insertEvidence(client, tenantA, host.runId, comp, {
        id: evId,
        retentionClass: 'standard',
        expiresAt: null,
        dedupKey: nid('ededup-viol'),
      });
      await insertAsset(client, tenantA, evId, {
        id: assetId,
        retentionClass: 'standard',
        expiresAt: null,
      });
      await insertEvidence(client, tenantA, host.runId, comp, {
        id: evInvalidId,
        retentionClass: 'short',
        createdAt: ts,
        expiresAt: ts,
        dedupKey: nid('ededup-viol-inv'),
      });
      await insertAsset(client, tenantA, evInvalidId, {
        id: assetInvalidId,
        retentionClass: 'short',
        createdAt: ts,
        expiresAt: ts,
      });
      await client.query(
        `ALTER TABLE orchestrator_research_evidence
           ADD CONSTRAINT orchestrator_research_evidence_retention_expiry_check
           CHECK (${expirySql}) NOT VALID`
      );
      await client.query(
        `ALTER TABLE orchestrator_research_evidence_assets
           ADD CONSTRAINT orchestrator_research_evidence_assets_retention_expiry_check
           CHECK (${expirySql}) NOT VALID`
      );
      await client.query('COMMIT');

      const identified = await identifyLegacyResearchCleanup();
      assert.ok(identified.evidence >= 2);
      assert.ok(identified.assets >= 2);

      const reasons = (await pool.query(
        `SELECT target_id, reason FROM orchestrator_research_legacy_holds
          WHERE tenant_id=$1 AND target_id = ANY($2)
          ORDER BY target_id`,
        [tenantA, [evId, assetId, evInvalidId, assetInvalidId]]
      )).rows;
      const byId = Object.fromEntries(reasons.map((r) => [r.target_id, r.reason]));
      assert.strictEqual(byId[evId], 'missing_expiry');
      assert.strictEqual(byId[assetId], 'missing_expiry');
      assert.strictEqual(byId[evInvalidId], 'invalid_expiry');
      assert.strictEqual(byId[assetInvalidId], 'invalid_expiry');

      await laterClient.query('BEGIN');
      await laterClient.query(
        `ALTER TABLE orchestrator_research_evidence DROP CONSTRAINT IF EXISTS orchestrator_research_evidence_retention_expiry_check`
      );
      const hostLater = await seedHost(laterClient, tenantA);
      const compLater = await insertCompetitor(laterClient, tenantA, hostLater.runId);
      await insertEvidence(laterClient, tenantA, hostLater.runId, compLater, {
        id: evLater,
        retentionClass: 'standard',
        expiresAt: null,
        dedupKey: nid('ededup-viol-later'),
      });
      await laterClient.query(
        `ALTER TABLE orchestrator_research_evidence
           ADD CONSTRAINT orchestrator_research_evidence_retention_expiry_check
           CHECK (${expirySql}) NOT VALID`
      );
      await laterClient.query('COMMIT');
      const later = await identifyLegacyResearchCleanup();
      assert.ok(later.evidence >= 1, 'missing_expiry must still be identified after the short-due snapshot');
      const laterHold = (await pool.query(
        `SELECT reason FROM orchestrator_research_legacy_holds
          WHERE tenant_id=$1 AND target_kind='evidence' AND target_id=$2`,
        [tenantA, evLater]
      )).rows[0];
      assert.strictEqual(laterHold.reason, 'missing_expiry');
    } finally {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      try { await laterClient.query('ROLLBACK'); } catch { /* ignore */ }
      try { await client.query('SET lock_timeout TO DEFAULT'); } catch { /* ignore */ }
      try { await laterClient.query('SET lock_timeout TO DEFAULT'); } catch { /* ignore */ }
      client.release();
      laterClient.release();
      try { await gate.query('SELECT pg_advisory_unlock($1)', [87231402]); } catch { /* ignore */ }
      gate.release();
    }

    await ensureAgentOrchestratorSchema();

    const leftover = (await pool.query(
      `SELECT id, expires_at FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, evId]
    )).rows;
    assert.strictEqual(leftover.length, 1, 'ensure() must not delete violating evidence');
    assert.strictEqual(leftover[0].expires_at, null, 'ensure() must not UPDATE immutable evidence');

    assert.strictEqual(
      await checkValidated('orchestrator_research_evidence', 'orchestrator_research_evidence_retention_expiry_check'),
      false,
      'expiry CHECK must stay NOT VALID while violators exist'
    );
    assert.strictEqual(
      await checkValidated('orchestrator_research_evidence_assets', 'orchestrator_research_evidence_assets_retention_expiry_check'),
      false
    );

    const host2 = await seedHost(pool, tenantA);
    const comp2 = await insertCompetitor(pool, tenantA, host2.runId);
    await assert.rejects(
      () => insertEvidence(pool, tenantA, host2.runId, comp2, {
        id: nid('ev-new-null'),
        retentionClass: 'standard',
        expiresAt: null,
      }),
      /retention_expiry|check/i,
      'NOT VALID CHECK must still reject new standard inserts without expires_at'
    );
  });

  test('sweep indexes exist, are partial, and lead with tenant_id', async () => {
    const ev = await indexDef('idx_orchestrator_research_evidence_tenant_expires');
    const assets = await indexDef('idx_orchestrator_research_evidence_assets_tenant_expires');
    assert.ok(ev, 'idx_orchestrator_research_evidence_tenant_expires must exist');
    assert.ok(assets, 'idx_orchestrator_research_evidence_assets_tenant_expires must exist');
    assert.match(ev, /\(tenant_id,\s*expires_at,\s*id\)/);
    assert.match(assets, /\(tenant_id,\s*expires_at,\s*id\)/);
    assert.match(ev, /WHERE/i);
    assert.match(assets, /WHERE/i);
    assert.match(ev, /retention_class/);
    assert.match(assets, /retention_class/);
  });

  test('content_fingerprint column exists; evidence_hash column does not', async () => {
    const p = db.getPool();
    const cols = (await p.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='orchestrator_research_evidence'
          AND column_name IN ('content_fingerprint','evidence_hash')`
    )).rows.map((r) => r.column_name).sort();
    assert.deepStrictEqual(cols, ['content_fingerprint']);
    assert.ok(await checkExists('orchestrator_research_evidence', 'orchestrator_research_evidence_content_fingerprint_check'));
    assert.strictEqual(
      await checkExists('orchestrator_research_evidence', 'orchestrator_research_evidence_evidence_hash_check'),
      false
    );
    const fpIdx = await indexDef('idx_orchestrator_research_evidence_tenant_fingerprint');
    assert.ok(fpIdx);
    assert.match(fpIdx, /content_fingerprint/);
    assert.strictEqual(await indexDef('idx_orchestrator_research_evidence_tenant_hash'), null);
  });

  test('content_fingerprint column_default is NULL after ensure and stays NULL on a second ensure', async () => {
    const p = db.getPool();
    const columnDefault = async () => {
      const row = (await p.query(
        `SELECT column_default FROM information_schema.columns
          WHERE table_schema='public' AND table_name='orchestrator_research_evidence'
            AND column_name='content_fingerprint'`
      )).rows[0];
      return row ? row.column_default : undefined;
    };
    assert.strictEqual(await columnDefault(), null);
    await ensureAgentOrchestratorSchema();
    assert.strictEqual(await columnDefault(), null);
  });

  test('omitting content_fingerprint fails not-null; supplying a valid 64-hex fingerprint still succeeds', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertCompetitor(p, tenantA, host.runId);
    const omitId = nid('ev-fp-omit');
    const omitDedup = nid('ededup-omit');
    await assert.rejects(
      () => p.query(
        `INSERT INTO orchestrator_research_evidence
           (id, tenant_id, research_run_id, competitor_id, platform, source_type,
            provider_external_id, headline, body_text, excerpt, advertiser_name,
            captured_at, provider_metrics, provenance_method, connector_id, connector_version,
            dedup_key, supersedes_id, retention_class, expires_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now(), $12::jsonb, $13,$14,$15,$16,$17,$18,
                 now() + interval '30 days', now())`,
        [
          omitId,
          tenantA,
          host.runId,
          comp,
          'meta',
          'ad_creative',
          null,
          '',
          '',
          '',
          '',
          JSON.stringify({}),
          'ad_library',
          'meta_research',
          '1.0.0',
          omitDedup,
          null,
          'standard',
        ]
      ),
      (err) => {
        assert.strictEqual(err.code, '23502');
        assert.match(String(err.message), /content_fingerprint/);
        return true;
      },
      'omitting content_fingerprint must fail with not-null (23502), not a silent zero fingerprint'
    );
    const sneaky = (await p.query(
      `SELECT content_fingerprint FROM orchestrator_research_evidence
        WHERE tenant_id=$1 AND id=$2`,
      [tenantA, omitId]
    )).rows;
    assert.strictEqual(sneaky.length, 0, 'omit insert must not write an all-zero fingerprint row');

    const okId = await insertEvidence(p, tenantA, host.runId, comp, {
      id: nid('ev-fp-ok'),
      contentFingerprint: SHA256_A,
    });
    const stored = (await p.query(
      `SELECT content_fingerprint FROM orchestrator_research_evidence
        WHERE tenant_id=$1 AND id=$2`,
      [tenantA, okId]
    )).rows[0];
    assert.strictEqual(stored.content_fingerprint, SHA256_A);
  });

  test('volume quota: concurrent inserts serialize; payload and cross-tenant isolation; 0 is fail-closed; delete frees quota', async () => {
    const pool = db.getPool();
    const tenantConc = (await pool.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [`AORO conc ${SUFFIX}`, `aoro-conc-${SUFFIX}`]
    )).rows[0].id;
    const tenantZero = (await pool.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [`AORO zero ${SUFFIX}`, `aoro-zero-${SUFFIX}`]
    )).rows[0].id;
    const tenantPay = (await pool.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [`AORO pay ${SUFFIX}`, `aoro-pay-${SUFFIX}`]
    )).rows[0].id;
    const tenantDec = (await pool.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [`AORO dec ${SUFFIX}`, `aoro-dec-${SUFFIX}`]
    )).rows[0].id;

    try {
      await seedResearchLimits(pool, tenantConc, { records: 2, bytes: 104857600 });
      await seedResearchLimits(pool, tenantB, { records: 10000, bytes: 104857600 });
      await seedResearchLimits(pool, tenantPay, { records: 100, bytes: 1500 });
      await seedResearchLimits(pool, tenantDec, { records: 1, bytes: 104857600 });

      const hostConc = await seedHost(pool, tenantConc);
      const compConc = await insertCompetitor(pool, tenantConc, hostConc.runId);
      const clients = [];
      try {
        for (let i = 0; i < 5; i += 1) clients.push(await pool.connect());
        const results = await Promise.allSettled(
          clients.map((c, i) => insertEvidence(c, tenantConc, hostConc.runId, compConc, {
            id: nid(`ev-conc-${i}`),
            dedupKey: nid(`ededup-conc-${i}`),
          }))
        );
        const ok = results.filter((r) => r.status === 'fulfilled');
        const fail = results.filter((r) => r.status === 'rejected');
        assert.strictEqual(ok.length, 2, 'exactly 2 concurrent inserts must succeed under max_records=2');
        assert.strictEqual(fail.length, 3, 'exactly 3 concurrent inserts must fail');
        for (const f of fail) {
          assert.match(
            String(f.reason && f.reason.message),
            /orchestrator_research_evidence_limit_exceeded/
          );
        }
      } finally {
        for (const c of clients) c.release();
      }

      const hostB = await seedHost(pool, tenantB);
      const compB = await insertCompetitor(pool, tenantB, hostB.runId);
      await insertEvidence(pool, tenantB, hostB.runId, compB, { id: nid('ev-xtenant') });

      const hostPay = await seedHost(pool, tenantPay);
      const compPay = await insertCompetitor(pool, tenantPay, hostPay.runId);
      const fat = 'b'.repeat(1000);
      await insertEvidence(pool, tenantPay, hostPay.runId, compPay, {
        id: nid('ev-pay-1'),
        bodyText: fat,
      });
      await assert.rejects(
        () => insertEvidence(pool, tenantPay, hostPay.runId, compPay, {
          id: nid('ev-pay-2'),
          bodyText: fat,
        }),
        /orchestrator_research_evidence_limit_exceeded/,
        'same tenant must not exceed payload bytes'
      );

      const hostZero = await seedHost(pool, tenantZero);
      const compZero = await insertCompetitor(pool, tenantZero, hostZero.runId);
      await assert.rejects(
        () => insertEvidence(pool, tenantZero, hostZero.runId, compZero, { id: nid('ev-zero') }),
        /orchestrator_research_evidence_limit_exceeded/,
        'missing/zero limits must reject the first insert'
      );

      const hostDec = await seedHost(pool, tenantDec);
      const compDec = await insertCompetitor(pool, tenantDec, hostDec.runId);
      const createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const expiredAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const expiredId = await insertEvidence(pool, tenantDec, hostDec.runId, compDec, {
        id: nid('ev-dec-1'),
        createdAt,
        expiresAt: expiredAt,
      });
      await assert.rejects(
        () => insertEvidence(pool, tenantDec, hostDec.runId, compDec, { id: nid('ev-dec-block') }),
        /orchestrator_research_evidence_limit_exceeded/
      );
      await pool.query(
        `DELETE FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
        [tenantDec, expiredId]
      );
      await insertEvidence(pool, tenantDec, hostDec.runId, compDec, { id: nid('ev-dec-2') });
    } finally {
      await pool.query(`DELETE FROM tenants WHERE id = ANY($1)`, [[tenantConc, tenantZero, tenantPay, tenantDec]]);
    }
  });

  test('orchestrator_research_quota is tenant PK CASCADE and limits default to 0', async () => {
    const p = db.getPool();
    const pk = (await p.query(
      `SELECT string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS cols
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
          AND tc.table_name = kcu.table_name
        WHERE tc.table_schema='public' AND tc.table_name='orchestrator_research_quota'
          AND tc.constraint_type='PRIMARY KEY'
        GROUP BY tc.constraint_name`
    )).rows[0];
    assert.strictEqual(pk.cols, 'tenant_id');

    const fk = (await p.query(
      `SELECT confrel.relname AS foreign_table, con.confdeltype AS delete_type
         FROM pg_constraint con
         JOIN pg_class rel ON rel.oid = con.conrelid
         JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
         JOIN pg_class confrel ON confrel.oid = con.confrelid
        WHERE nsp.nspname='public'
          AND rel.relname='orchestrator_research_quota'
          AND con.contype='f'
          AND confrel.relname='tenants'`
    )).rows[0];
    assert.ok(fk);
    assert.strictEqual(fk.delete_type, 'c');

    const tenantD = (await p.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [`AORO def ${SUFFIX}`, `aoro-def-${SUFFIX}`]
    )).rows[0].id;
    await p.query(`INSERT INTO orchestrator_tenant_limits (tenant_id) VALUES ($1)`, [tenantD]);
    const limits = (await p.query(
      `SELECT max_research_evidence_records, max_research_evidence_payload_bytes
         FROM orchestrator_tenant_limits WHERE tenant_id=$1`,
      [tenantD]
    )).rows[0];
    assert.strictEqual(limits.max_research_evidence_records, 0);
    assert.strictEqual(Number(limits.max_research_evidence_payload_bytes), 0);
    await p.query(`DELETE FROM tenants WHERE id=$1`, [tenantD]);
  });

  test('research triggers remain installed after a second ensure()', async () => {
    await ensureAgentOrchestratorSchema();
    const p = db.getPool();
    const rows = (await p.query(`
      SELECT c.relname AS table_name, t.tgname
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND NOT t.tgisinternal
         AND c.relname IN (
           'orchestrator_research_runs',
           'orchestrator_research_competitors',
           'orchestrator_research_evidence',
           'orchestrator_research_evidence_assets'
         )
       ORDER BY 1, 2
    `)).rows;
    const names = new Set(rows.map((r) => `${r.table_name}:${r.tgname}`));
    for (const want of [
      'orchestrator_research_runs:orchestrator_research_runs_approval_bind',
      'orchestrator_research_runs:orchestrator_research_runs_identity_immutable',
      'orchestrator_research_competitors:orchestrator_research_competitors_immutable',
      'orchestrator_research_evidence:orchestrator_research_evidence_immutable',
      'orchestrator_research_evidence:orchestrator_research_evidence_supersedes_bind',
      'orchestrator_research_evidence:orchestrator_research_evidence_quota_insert',
      'orchestrator_research_evidence:orchestrator_research_evidence_quota_delete',
      'orchestrator_research_evidence_assets:orchestrator_research_evidence_assets_immutable',
    ]) {
      assert.ok(names.has(want), `missing trigger ${want}`);
    }
  });

  test('legacy holds and cleanup_ops tables are tenant-scoped with integer-only cleanup counts', async () => {
    const p = db.getPool();
    const holdPk = (await p.query(
      `SELECT string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS cols
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
          AND tc.table_name = kcu.table_name
        WHERE tc.table_schema='public' AND tc.table_name='orchestrator_research_legacy_holds'
          AND tc.constraint_type='PRIMARY KEY'
        GROUP BY tc.constraint_name`
    )).rows[0];
    assert.strictEqual(holdPk.cols, 'tenant_id,target_kind,target_id');

    const opsPk = (await p.query(
      `SELECT string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS cols
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
          AND tc.table_name = kcu.table_name
        WHERE tc.table_schema='public' AND tc.table_name='orchestrator_research_cleanup_ops'
          AND tc.constraint_type='PRIMARY KEY'
        GROUP BY tc.constraint_name`
    )).rows[0];
    assert.strictEqual(opsPk.cols, 'tenant_id,id');
    assert.ok(await checkExists('orchestrator_research_cleanup_ops', 'orchestrator_research_cleanup_ops_tenant_unique_idempotency_key'));

    const tgtPk = (await p.query(
      `SELECT string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS cols
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
          AND tc.table_name = kcu.table_name
        WHERE tc.table_schema='public' AND tc.table_name='orchestrator_research_cleanup_targets'
          AND tc.constraint_type='PRIMARY KEY'
        GROUP BY tc.constraint_name`
    )).rows[0];
    assert.strictEqual(tgtPk.cols, 'tenant_id,op_id,target_kind,target_id');
    assert.ok(await checkExists('orchestrator_research_cleanup_targets', 'orchestrator_research_cleanup_targets_target_kind_check'));
    assert.ok(await checkExists('orchestrator_research_cleanup_targets', 'orchestrator_research_cleanup_targets_op_fkey'));
    const tgtIdx = await indexDef('idx_orchestrator_research_cleanup_targets_tenant_op');
    assert.ok(tgtIdx, 'tenant-leading index on cleanup_targets must exist');
    assert.match(tgtIdx, /tenant_id.*op_id/);

    const forbidden = (await p.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name IN (
            'orchestrator_research_legacy_holds',
            'orchestrator_research_cleanup_ops',
            'orchestrator_research_cleanup_targets'
          )
          AND column_name IN ('headline','body_text','excerpt','email','body','raw_payload')`
    )).rows;
    assert.deepStrictEqual(forbidden, []);

    await assert.rejects(
      () => p.query(
        `INSERT INTO orchestrator_research_cleanup_ops
           (id, tenant_id, idempotency_key, state, confirmation_sha256)
         VALUES ($1,$2,$3,'previewed',$4)`,
        [nid('op-bad'), tenantA, nid('op-idemp'), 'not-a-hash']
      ),
      /confirmation_sha256|check/i
    );
  });

  test('quota recompute refuses corrupt-low cache, heals on DELETE, and ignores corrupt-high cache', async () => {
    const pool = db.getPool();
    const tenantQ = (await pool.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [`AORO q ${SUFFIX}`, `aoro-q-${SUFFIX}`]
    )).rows[0].id;
    try {
      await seedResearchLimits(pool, tenantQ, { records: 2, bytes: 104857600 });
      const host = await seedHost(pool, tenantQ);
      const comp = await insertCompetitor(pool, tenantQ, host.runId);
      const createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const expiredAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const futureAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      const liveId = await insertEvidence(pool, tenantQ, host.runId, comp, {
        id: nid('ev-q-live'),
        createdAt,
        expiresAt: futureAt,
      });
      const expiredId = await insertEvidence(pool, tenantQ, host.runId, comp, {
        id: nid('ev-q-exp'),
        createdAt,
        expiresAt: expiredAt,
      });

      await pool.query(
        `UPDATE orchestrator_research_quota SET evidence_count=0, payload_bytes=0 WHERE tenant_id=$1`,
        [tenantQ]
      );
      await assert.rejects(
        () => insertEvidence(pool, tenantQ, host.runId, comp, { id: nid('ev-q-bypass') }),
        /orchestrator_research_evidence_limit_exceeded/,
        'corrupt-low cache must not bypass COUNT(*) cap'
      );

      await pool.query(
        `DELETE FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
        [tenantQ, expiredId]
      );
      const afterDel = (await pool.query(
        `SELECT evidence_count,
                (SELECT COUNT(*)::int FROM orchestrator_research_evidence WHERE tenant_id=$1) AS live
           FROM orchestrator_research_quota WHERE tenant_id=$1`,
        [tenantQ]
      )).rows[0];
      assert.strictEqual(afterDel.live, 1);
      assert.strictEqual(afterDel.evidence_count, 1, 'DELETE must heal cache to COUNT(*)');

      await pool.query(
        `UPDATE orchestrator_research_quota SET evidence_count=999, payload_bytes=1 WHERE tenant_id=$1`,
        [tenantQ]
      );
      await insertEvidence(pool, tenantQ, host.runId, comp, {
        id: nid('ev-q-high'),
        createdAt,
        expiresAt: futureAt,
      });
      const afterHigh = (await pool.query(
        `SELECT evidence_count,
                (SELECT COUNT(*)::int FROM orchestrator_research_evidence WHERE tenant_id=$1) AS live
           FROM orchestrator_research_quota WHERE tenant_id=$1`,
        [tenantQ]
      )).rows[0];
      assert.strictEqual(afterHigh.live, 2);
      assert.strictEqual(afterHigh.evidence_count, 2, 'insert after corrupt-high must write recomputed COUNT(*)');
      await assert.rejects(
        () => insertEvidence(pool, tenantQ, host.runId, comp, { id: nid('ev-q-cap') }),
        /orchestrator_research_evidence_limit_exceeded/
      );
      assert.ok(liveId);
    } finally {
      await pool.query(`DELETE FROM tenants WHERE id=$1`, [tenantQ]);
    }
  });

  test('GUC-only cleanup delete is refused even with a hold; UPDATE stays refused', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertCompetitor(p, tenantA, host.runId);
    const createdAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const futureAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const heldId = await insertEvidence(p, tenantA, host.runId, comp, {
      id: nid('ev-guc-hold'),
      retentionClass: 'short',
      createdAt,
      expiresAt: futureAt,
    });
    const heldAsset = await insertAsset(p, tenantA, heldId, {
      id: nid('asset-guc-hold'),
      retentionClass: 'short',
      createdAt,
      expiresAt: futureAt,
    });
    await p.query(
      `INSERT INTO orchestrator_research_legacy_holds (tenant_id, target_kind, target_id, reason)
       VALUES ($1,'evidence',$2,'missing_expiry'), ($1,'asset',$3,'missing_expiry')
       ON CONFLICT (tenant_id, target_kind, target_id) DO NOTHING`,
      [tenantA, heldId, heldAsset]
    );

    const client = await p.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('infogenie.research_cleanup', 'on', true)`);
      await client.query('SAVEPOINT no_ev');
      await assert.rejects(
        () => client.query(
          `DELETE FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
          [tenantA, heldId]
        ),
        /orchestrator_research_evidence_immutable/,
        'GUC on + hold with no approved op must still refuse DELETE'
      );
      await client.query('ROLLBACK TO SAVEPOINT no_ev');
      await client.query('SAVEPOINT no_asset');
      await assert.rejects(
        () => client.query(
          `DELETE FROM orchestrator_research_evidence_assets WHERE tenant_id=$1 AND id=$2`,
          [tenantA, heldAsset]
        ),
        /orchestrator_research_evidence_assets_immutable/,
        'GUC on + asset hold with no approved op must still refuse DELETE'
      );
      await client.query('ROLLBACK TO SAVEPOINT no_asset');
      await client.query('SAVEPOINT no_update');
      await assert.rejects(
        () => client.query(
          `UPDATE orchestrator_research_evidence SET headline='tamper' WHERE tenant_id=$1 AND id=$2`,
          [tenantA, heldId]
        ),
        /orchestrator_research_evidence_immutable/,
        'UPDATE stays fully refused with cleanup GUC'
      );
      await client.query('ROLLBACK TO SAVEPOINT no_update');
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) { /* already aborted */ }
      throw err;
    } finally {
      client.release();
    }

    const still = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, heldId]
    )).rows;
    assert.strictEqual(still.length, 1);
  });

  test('approved or running cleanup op + snapshot target allows DELETE; UPDATE stays refused', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertCompetitor(p, tenantA, host.runId);
    const createdAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const futureAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const approvedEv = await insertEvidence(p, tenantA, host.runId, comp, {
      id: nid('ev-op-approved'),
      retentionClass: 'short',
      createdAt,
      expiresAt: futureAt,
    });
    const runningEv = await insertEvidence(p, tenantA, host.runId, comp, {
      id: nid('ev-op-running'),
      retentionClass: 'short',
      createdAt,
      expiresAt: futureAt,
    });
    const approvedAsset = await insertAsset(p, tenantA, approvedEv, {
      id: nid('asset-op-approved'),
      retentionClass: 'short',
      createdAt,
      expiresAt: futureAt,
    });
    await p.query(
      `INSERT INTO orchestrator_research_legacy_holds (tenant_id, target_kind, target_id, reason)
       VALUES ($1,'evidence',$2,'missing_expiry'), ($1,'evidence',$3,'missing_expiry'),
              ($1,'asset',$4,'missing_expiry')
       ON CONFLICT (tenant_id, target_kind, target_id) DO NOTHING`,
      [tenantA, approvedEv, runningEv, approvedAsset]
    );

    const approvedOp = await insertCleanupOp(p, tenantA, { state: 'approved' });
    await insertCleanupTarget(p, tenantA, approvedOp, 'evidence', approvedEv);
    await insertCleanupTarget(p, tenantA, approvedOp, 'asset', approvedAsset);

    await assert.rejects(
      () => p.query(
        `UPDATE orchestrator_research_evidence SET headline='tamper' WHERE tenant_id=$1 AND id=$2`,
        [tenantA, approvedEv]
      ),
      /orchestrator_research_evidence_immutable/,
      'UPDATE stays fully refused even with an approved cleanup op'
    );

    await p.query(
      `DELETE FROM orchestrator_research_evidence_assets WHERE tenant_id=$1 AND id=$2`,
      [tenantA, approvedAsset]
    );
    await p.query(
      `DELETE FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, approvedEv]
    );

    const runningOp = await insertCleanupOp(p, tenantA, { state: 'running' });
    await insertCleanupTarget(p, tenantA, runningOp, 'evidence', runningEv);
    await p.query(
      `DELETE FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, runningEv]
    );

    const goneApproved = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, approvedEv]
    )).rows;
    const goneRunning = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, runningEv]
    )).rows;
    const goneAsset = (await p.query(
      `SELECT id FROM orchestrator_research_evidence_assets WHERE tenant_id=$1 AND id=$2`,
      [tenantA, approvedAsset]
    )).rows;
    assert.strictEqual(goneApproved.length, 0, 'approved op + snapshot target must allow DELETE');
    assert.strictEqual(goneRunning.length, 0, 'running op + snapshot target must allow DELETE');
    assert.strictEqual(goneAsset.length, 0, 'approved op + asset snapshot target must allow DELETE');
  });

  test('approved cleanup op does not delete a hold absent from its targets', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertCompetitor(p, tenantA, host.runId);
    const createdAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const futureAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const snapId = await insertEvidence(p, tenantA, host.runId, comp, {
      id: nid('ev-off-snap-in'),
      retentionClass: 'short',
      createdAt,
      expiresAt: futureAt,
    });
    const offSnapId = await insertEvidence(p, tenantA, host.runId, comp, {
      id: nid('ev-off-snap'),
      retentionClass: 'short',
      createdAt,
      expiresAt: futureAt,
    });
    const offSnapAsset = await insertAsset(p, tenantA, offSnapId, {
      id: nid('asset-off-snap'),
      retentionClass: 'short',
      createdAt,
      expiresAt: futureAt,
    });
    await p.query(
      `INSERT INTO orchestrator_research_legacy_holds (tenant_id, target_kind, target_id, reason)
       VALUES ($1,'evidence',$2,'missing_expiry'), ($1,'evidence',$3,'missing_expiry'),
              ($1,'asset',$4,'missing_expiry')
       ON CONFLICT (tenant_id, target_kind, target_id) DO NOTHING`,
      [tenantA, snapId, offSnapId, offSnapAsset]
    );

    const opId = await insertCleanupOp(p, tenantA, { state: 'approved' });
    await insertCleanupTarget(p, tenantA, opId, 'evidence', snapId);

    await assert.rejects(
      () => p.query(
        `DELETE FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
        [tenantA, offSnapId]
      ),
      /orchestrator_research_evidence_immutable/,
      'hold that is not in the approved op targets must stay refused'
    );
    await assert.rejects(
      () => p.query(
        `DELETE FROM orchestrator_research_evidence_assets WHERE tenant_id=$1 AND id=$2`,
        [tenantA, offSnapAsset]
      ),
      /orchestrator_research_evidence_assets_immutable/,
      'asset hold absent from the approved op targets must stay refused'
    );
    await assert.rejects(
      () => p.query(
        `UPDATE orchestrator_research_evidence SET headline='tamper' WHERE tenant_id=$1 AND id=$2`,
        [tenantA, offSnapId]
      ),
      /orchestrator_research_evidence_immutable/,
      'UPDATE stays fully refused for an off-snapshot hold'
    );

    const still = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id IN ($2,$3) ORDER BY 1`,
      [tenantA, snapId, offSnapId]
    )).rows;
    assert.strictEqual(still.length, 2);
  });

  test('NOSUPERUSER ensure succeeds; missing CREATE fails preflight with no schema change', async () => {
    const admin = db.getPool();
    const { host, port, database } = dbUrlParts();
    const password = crypto.randomBytes(16).toString('hex');
    const okRole = `orch_nsu_ok_${SUFFIX.replace(/[^a-z0-9_]/g, '')}`.slice(0, 63);
    const denyRole = `orch_nsu_no_${SUFFIX.replace(/[^a-z0-9_]/g, '')}`.slice(0, 63);
    const origGetPool = db.getPool.bind(db);
    let okPool = null;
    let denyPool = null;

    const connectNsu = (role) => new Pool({
      connectionString: `postgres://${role}:${password}@${host}:${port}/${database}`,
      ssl: { rejectUnauthorized: false },
    });

    try {
      await createLoginRole(admin, { name: okRole, password, schemaCreate: true });
      await grantOrchestratorMigrator(admin, okRole);
      okPool = connectNsu(okRole);
      db.getPool = () => okPool;
      await ensureAgentOrchestratorSchema();
      const who = (await okPool.query(`SELECT current_user AS u, rolsuper FROM pg_roles WHERE rolname = current_user`)).rows[0];
      assert.strictEqual(who.u, okRole);
      assert.strictEqual(who.rolsuper, false);
      db.getPool = origGetPool;

      await createLoginRole(admin, { name: denyRole, password, schemaCreate: false });
      await admin.query(
        `GRANT INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public TO ${denyRole}`
      );
      denyPool = connectNsu(denyRole);
      const before = await snapshotPublicSchema(admin);
      db.getPool = () => denyPool;
      await assert.rejects(
        () => ensureAgentOrchestratorSchema(),
        (err) => {
          assert.match(String(err && err.message), /orchestrator_schema_preflight_failed/);
          return true;
        }
      );
      db.getPool = origGetPool;
      const after = await snapshotPublicSchema(admin);
      assert.deepStrictEqual(after.tables, before.tables, 'failed preflight must not create tables');
      assert.deepStrictEqual(after.cons, before.cons, 'failed preflight must not create constraints');
    } finally {
      db.getPool = origGetPool;
      if (okPool) await okPool.end().catch(() => {});
      if (denyPool) await denyPool.end().catch(() => {});
      try { await dropLoginRole(admin, okRole); } catch (_) { /* best-effort */ }
      try { await dropLoginRole(admin, denyRole); } catch (_) { /* best-effort */ }
    }
  });
}
