'use strict';

process.env.PERMISSION_ENFORCEMENT = 'on';
process.env.MULTITENANT_ENFORCEMENT = 'on';

const { test, before, after } = require('node:test');
const assert = require('node:assert');

const db = require('../db');
const { ensureAgentOrchestratorSchema } = require('../services/agent_orchestrator/schema');
const { ensureTenantSchema } = require('../services/tenants/schema');

const HAS_DB = db.hasDb();
const TABLES = ['orchestrator_static_image_jobs', 'orchestrator_static_image_assets'];
const HEX = 'a'.repeat(64);
const SUFFIX = `ao5a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let seq = 0;
function nid(prefix) { seq += 1; return `${prefix}-${SUFFIX}-${seq}`; }
function nextHex() { seq += 1; return seq.toString(16).padStart(64, '0'); }

async function pkAndUniques(table) {
  const p = db.getPool();
  return (await p.query(
    `SELECT tc.constraint_name, tc.constraint_type,
            string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS cols
       FROM information_schema.table_constraints tc
       LEFT JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
        AND tc.table_name = kcu.table_name
      WHERE tc.table_schema = 'public' AND tc.table_name = $1
        AND tc.constraint_type IN ('PRIMARY KEY','UNIQUE')
      GROUP BY tc.constraint_name, tc.constraint_type`,
    [table]
  )).rows;
}

async function seedHost(p, tenantId) {
  const wfId = nid('wf');
  const proposalId = nid('prop');
  const runId = nid('run');
  await p.query(`INSERT INTO orchestrator_workflows (id, tenant_id, name) VALUES ($1,$2,$3)`,
    [wfId, tenantId, wfId]);
  const approvalId = (await p.query(
    `INSERT INTO orchestrator_approvals
       (tenant_id, workflow_id, gate, content_hash, decision, object_version, approved_platforms)
     VALUES ($1,$2,'research_execution',$3,'approved',1,'["meta"]'::jsonb) RETURNING id`,
    [tenantId, wfId, HEX]
  )).rows[0].id;
  await p.query(
    `INSERT INTO orchestrator_research_runs
       (id, tenant_id, workflow_id, approval_id, approval_object_version,
        requested_platforms, idempotency_key, state)
     VALUES ($1,$2,$3,$4,1,$5::text[],$6,'pending')`,
    [runId, tenantId, wfId, approvalId, ['meta'], nid('ridemp')]
  );
  await p.query(
    `INSERT INTO orchestrator_proposal_generations
       (id, tenant_id, workflow_id, research_run_id, version, prompt_template_version,
        provider, model, evidence_snapshot_hash, research_approval_id, research_approval_hash,
        research_approval_object_version, content_hash, idempotency_key)
     VALUES ($1,$2,$3,$4,1,'v1','fixture','fixture-v1',$5,$6,$5,1,$5,$7)`,
    [proposalId, tenantId, wfId, runId, HEX, approvalId, nid('pidemp')]
  );
  return { wfId, approvalId, proposalId };
}

async function insertJob(p, tenantId, host, opts = {}) {
  const id = opts.id || nid('job');
  await p.query(
    `INSERT INTO orchestrator_static_image_jobs
       (id, tenant_id, workflow_id, proposal_id, proposal_version, proposal_content_hash,
        approval_id, approval_hash, generation_request_hash, provider, model,
        idempotency_key, status, estimated_cost_micros, reserved_cost_micros, honesty_class)
     VALUES ($1,$2,$3,$4,1,$5,$6,$5,$7,'fixture','fixture-v1',$8,$9,0,0,'fixture')`,
    [id, tenantId, host.wfId, host.proposalId, HEX, host.approvalId,
      opts.requestHash || nextHex(), opts.idempotencyKey || nid('jidemp'), opts.status || 'queued']
  );
  return id;
}

async function insertAsset(p, tenantId, host, jobId, opts = {}) {
  await p.query(
    `INSERT INTO orchestrator_static_image_assets
       (id, tenant_id, workflow_id, job_id, proposal_id, proposal_version, proposal_content_hash,
        approval_hash, provider, model, model_version, request_hash, mime_type, width_px, height_px,
        byte_size, asset_hash, storage_ref, moderation_status, moderation_source, honesty_class,
        provenance, usable)
     VALUES ($1,$2,$3,$4,$5,1,$6,$6,'fixture','fixture-v1','v1',$6,$7,8,8,32,$6,$8,$9,'fixture','fixture','fixture',$10)`,
    [opts.id || nid('asset'), tenantId, host.wfId, jobId, host.proposalId, HEX,
      opts.mimeType || 'image/png', opts.storageRef || `s3://ig/${nid('obj')}`,
      opts.moderationStatus || 'passed', opts.usable === true]
  );
}

if (!HAS_DB) {
  test('advertising-orchestrator static-generation schema skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else {
  let tenantA = null;
  let tenantB = null;
  let hostA = null;
  let hostB = null;

  before(async () => {
    await ensureTenantSchema();
    await ensureAgentOrchestratorSchema();
    const p = db.getPool();
    const mk = async (label, slug) => (await p.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [label, slug]
    )).rows[0].id;
    tenantA = await mk(`AO5A A ${SUFFIX}`, `ao5a-a-${SUFFIX}`);
    tenantB = await mk(`AO5A B ${SUFFIX}`, `ao5a-b-${SUFFIX}`);
    hostA = await seedHost(p, tenantA);
    hostB = await seedHost(p, tenantB);
  });

  after(async () => {
    const p = db.getPool();
    const ids = [tenantA, tenantB].filter(Boolean);
    if (!ids.length) return;
    await p.query(`DELETE FROM tenants WHERE id = ANY($1)`, [ids]);
  });

  test('PR5A tables exist with composite PK including NOT NULL tenant_id', async () => {
    const p = db.getPool();
    const present = (await p.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' AND table_name = ANY($1)`,
      [TABLES]
    )).rows.map((r) => r.table_name).sort();
    assert.deepStrictEqual(present, [...TABLES].sort());

    for (const table of TABLES) {
      const col = (await p.query(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_schema='public' AND table_name=$1 AND column_name='tenant_id'`,
        [table]
      )).rows[0];
      assert.ok(col, `${table}.tenant_id must exist`);
      assert.strictEqual(col.is_nullable, 'NO');
      const pk = (await pkAndUniques(table)).filter((c) => c.constraint_type === 'PRIMARY KEY');
      assert.ok(pk.some((c) => c.cols === 'tenant_id,id'), `${table} PK must be (tenant_id, id)`);
    }
  });

  test('named uniques (tenant_id, idempotency_key) and (tenant_id, job_id)', async () => {
    const jobs = await pkAndUniques('orchestrator_static_image_jobs');
    assert.ok(jobs.some((c) => c.constraint_name === 'orchestrator_static_image_jobs_tenant_unique_idemp'
      && c.cols === 'tenant_id,idempotency_key'));
    const assets = await pkAndUniques('orchestrator_static_image_assets');
    assert.ok(assets.some((c) => c.constraint_name === 'orchestrator_static_image_assets_tenant_unique_job'
      && c.cols === 'tenant_id,job_id'));
  });

  test('status and mime CHECKs reject illegal values; usable=true requires passed', async () => {
    const p = db.getPool();
    await assert.rejects(
      () => insertJob(p, tenantA, hostA, { status: 'pending' }),
      /status|check/i
    );
    const jobId = await insertJob(p, tenantA, hostA);
    await assert.rejects(
      () => insertAsset(p, tenantA, hostA, jobId, { mimeType: 'image/svg+xml' }),
      /mime_type|check/i
    );
    await assert.rejects(
      () => insertAsset(p, tenantA, hostA, jobId, { mimeType: 'text/html' }),
      /mime_type|check/i
    );
    await assert.rejects(
      () => insertAsset(p, tenantA, hostA, jobId, { moderationStatus: 'failed', usable: true }),
      /usable|check/i
    );
  });

  test('cross-tenant PK isolation: two tenants may share the same id', async () => {
    const p = db.getPool();
    const sharedId = nid('shared');
    await insertJob(p, tenantA, hostA, { id: sharedId, idempotencyKey: nid('ia') });
    await insertJob(p, tenantB, hostB, { id: sharedId, idempotencyKey: nid('ib') });
    const n = (await p.query(
      `SELECT COUNT(*)::int AS n FROM orchestrator_static_image_jobs WHERE id=$1`,
      [sharedId]
    )).rows[0].n;
    assert.strictEqual(n, 2);
  });

  test('job identity UPDATE and any asset UPDATE raise immutability', async () => {
    const p = db.getPool();
    const jobId = await insertJob(p, tenantA, hostA);
    await insertAsset(p, tenantA, hostA, jobId);
    await assert.rejects(
      () => p.query(
        `UPDATE orchestrator_static_image_jobs SET workflow_id=$1 WHERE tenant_id=$2 AND id=$3`,
        [nid('wf-tamper'), tenantA, jobId]
      ),
      /orchestrator_static_image_jobs_immutable/
    );
    await assert.rejects(
      () => p.query(
        `UPDATE orchestrator_static_image_assets SET usable=false WHERE tenant_id=$1 AND job_id=$2`,
        [tenantA, jobId]
      ),
      /orchestrator_static_image_assets_immutable/
    );
  });
}
