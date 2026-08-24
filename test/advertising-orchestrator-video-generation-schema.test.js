'use strict';

process.env.PERMISSION_ENFORCEMENT = 'on';
process.env.MULTITENANT_ENFORCEMENT = 'on';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const db = require('../db');
const { ensureAgentOrchestratorSchema } = require('../services/agent_orchestrator/schema');
const { ensureTenantSchema } = require('../services/tenants/schema');

const HAS_DB = db.hasDb();
const TABLES = ['orchestrator_video_generation_jobs', 'orchestrator_video_generation_outputs'];
const HEX = 'a'.repeat(64);
const SUFFIX = `ao5b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let seq = 0;
const nid = (p) => { seq += 1; return `${p}-${SUFFIX}-${seq}`; };
const nextHex = () => { seq += 1; return seq.toString(16).padStart(64, '0'); };
const href = (tid) => `orchestrator/video/${tid}/${nid('obj')}`;

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

async function seedHost(p, tenantId) {
  const wfId = nid('wf'); const proposalId = nid('prop'); const runId = nid('run');
  await p.query(`INSERT INTO orchestrator_workflows (id, tenant_id, name) VALUES ($1,$2,$3)`, [wfId, tenantId, wfId]);
  const approvalId = (await p.query(
    `INSERT INTO orchestrator_approvals (tenant_id, workflow_id, gate, content_hash, decision, object_version, approved_platforms)
     VALUES ($1,$2,'research_execution',$3,'approved',1,'["meta"]'::jsonb) RETURNING id`, [tenantId, wfId, HEX]
  )).rows[0].id;
  await p.query(
    `INSERT INTO orchestrator_research_runs (id, tenant_id, workflow_id, approval_id, approval_object_version, requested_platforms, idempotency_key, state)
     VALUES ($1,$2,$3,$4,1,$5::text[],$6,'pending')`, [runId, tenantId, wfId, approvalId, ['meta'], nid('ridemp')]
  );
  await p.query(
    `INSERT INTO orchestrator_proposal_generations
       (id, tenant_id, workflow_id, research_run_id, version, prompt_template_version, provider, model,
        evidence_snapshot_hash, research_approval_id, research_approval_hash, research_approval_object_version, content_hash, idempotency_key)
     VALUES ($1,$2,$3,$4,1,'v1','fixture','fixture-v1',$5,$6,$5,1,$5,$7)`,
    [proposalId, tenantId, wfId, runId, HEX, approvalId, nid('pidemp')]
  );
  return { wfId, approvalId, proposalId };
}

async function insertJob(p, tenantId, host, opts = {}) {
  const id = opts.id || nid('job');
  await p.query(
    `INSERT INTO orchestrator_video_generation_jobs
       (id, tenant_id, workflow_id, proposal_id, proposal_version, proposal_content_hash, approval_id, approval_hash,
        contract_hash, contract_json, generation_request_hash, provider, model, idempotency_key, status,
        estimated_cost_micros, reserved_cost_micros, honesty_class, credential_ref)
     VALUES ($1,$2,$3,$4,1,$5,$6,$5,$5,'{}'::jsonb,$7,$8,'stub-chargeable',$9,$10,0,0,'fixture',$11)`,
    [id, tenantId, host.wfId, host.proposalId, HEX, host.approvalId, opts.requestHash || nextHex(),
      opts.provider || 'placeholder', opts.idempotencyKey || nid('jidemp'), opts.status || 'queued',
      opts.credentialRef === undefined ? null : opts.credentialRef]
  );
  return id;
}

async function insertOutput(p, tenantId, host, jobId, opts = {}) {
  await p.query(
    `INSERT INTO orchestrator_video_generation_outputs
       (id, tenant_id, workflow_id, job_id, proposal_id, proposal_version, proposal_content_hash, approval_hash,
        contract_hash, request_hash, mime_type, width_px, height_px, duration_ms, fps, storage_ref,
        honesty_class, provenance, moderation_status, moderation_source, usable)
     VALUES ($1,$2,$3,$4,$5,1,$6,$6,$6,$6,$7,8,8,1000,24,$8,$9,'fixture','passed','fixture',true)`,
    [opts.id || nid('out'), tenantId, host.wfId, jobId, host.proposalId, HEX, opts.mimeType || 'video/mp4',
      opts.storageRef || href(tenantId), opts.honestyClass || 'fixture']
  );
}

if (!HAS_DB) {
  test('advertising-orchestrator video-generation schema skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else {
  let tenantA = null; let tenantB = null; let hostA = null; let hostB = null;

  before(async () => {
    await ensureTenantSchema();
    await ensureAgentOrchestratorSchema();
    const p = db.getPool();
    const mk = async (label, slug) => (await p.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`, [label, slug]
    )).rows[0].id;
    tenantA = await mk(`AO5B A ${SUFFIX}`, `ao5b-a-${SUFFIX}`);
    tenantB = await mk(`AO5B B ${SUFFIX}`, `ao5b-b-${SUFFIX}`);
    hostA = await seedHost(p, tenantA);
    hostB = await seedHost(p, tenantB);
  });

  after(async () => {
    const ids = [tenantA, tenantB].filter(Boolean);
    if (ids.length) await db.getPool().query(`DELETE FROM tenants WHERE id = ANY($1)`, [ids]);
  });

  test('PR5B tables exist with composite PK including NOT NULL tenant_id', async () => {
    const p = db.getPool();
    const present = (await p.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1)`,
      [TABLES]
    )).rows.map((r) => r.table_name).sort();
    assert.deepStrictEqual(present, [...TABLES].sort());
    for (const table of TABLES) {
      const col = (await p.query(
        `SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name='tenant_id'`,
        [table]
      )).rows[0];
      assert.ok(col); assert.strictEqual(col.is_nullable, 'NO');
      const pk = (await pkAndUniques(table)).filter((c) => c.constraint_type === 'PRIMARY KEY');
      assert.ok(pk.some((c) => c.cols === 'tenant_id,id'), `${table} PK must be (tenant_id, id)`);
    }
  });

  test('named uniques (tenant_id, idempotency_key) and (tenant_id, job_id)', async () => {
    const jobs = await pkAndUniques('orchestrator_video_generation_jobs');
    assert.ok(jobs.some((c) => c.constraint_name === 'orchestrator_video_generation_jobs_tenant_unique_idemp'
      && c.cols === 'tenant_id,idempotency_key'));
    const outs = await pkAndUniques('orchestrator_video_generation_outputs');
    assert.ok(outs.some((c) => c.constraint_name === 'orchestrator_video_generation_outputs_tenant_unique_job'
      && c.cols === 'tenant_id,job_id'));
  });

  test('invalid status rejected; queued→succeeded blocked; running→succeeded allowed', async () => {
    const p = db.getPool();
    await assert.rejects(() => insertJob(p, tenantA, hostA, { status: 'pending' }), /status|check/i);
    const blockedId = await insertJob(p, tenantA, hostA);
    await assert.rejects(
      () => p.query(`UPDATE orchestrator_video_generation_jobs SET status='succeeded' WHERE tenant_id=$1 AND id=$2`, [tenantA, blockedId]),
      /orchestrator_video_generation_jobs_immutable/
    );
    const okId = await insertJob(p, tenantA, hostA);
    await p.query(`UPDATE orchestrator_video_generation_jobs SET status='reserved', reservation_id=$3 WHERE tenant_id=$1 AND id=$2`, [tenantA, okId, nid('res')]);
    await p.query(`UPDATE orchestrator_video_generation_jobs SET status='running' WHERE tenant_id=$1 AND id=$2`, [tenantA, okId]);
    await p.query(`UPDATE orchestrator_video_generation_jobs SET status='succeeded', output_id=$3, actual_cost_micros=0 WHERE tenant_id=$1 AND id=$2`, [tenantA, okId, nid('outok')]);
    const st = (await p.query(`SELECT status FROM orchestrator_video_generation_jobs WHERE tenant_id=$1 AND id=$2`, [tenantA, okId])).rows[0].status;
    assert.strictEqual(st, 'succeeded');
  });

  test('cross-tenant PK isolation: two tenants may share the same id', async () => {
    const p = db.getPool();
    const sharedId = nid('shared');
    await insertJob(p, tenantA, hostA, { id: sharedId, idempotencyKey: nid('ia') });
    await insertJob(p, tenantB, hostB, { id: sharedId, idempotencyKey: nid('ib') });
    const n = (await p.query(`SELECT COUNT(*)::int AS n FROM orchestrator_video_generation_jobs WHERE id=$1`, [sharedId])).rows[0].n;
    assert.strictEqual(n, 2);
  });

  test('output storage_ref rejects https/data; honesty_class live rejected', async () => {
    const p = db.getPool();
    const jobId = await insertJob(p, tenantA, hostA);
    await assert.rejects(() => insertOutput(p, tenantA, hostA, jobId, { storageRef: 'https://evil.example/v.mp4' }), /storage_ref|check/i);
    await assert.rejects(() => insertOutput(p, tenantA, hostA, jobId, { storageRef: 'data:video/mp4;base64,aa' }), /storage_ref|check/i);
    await assert.rejects(() => insertOutput(p, tenantA, hostA, jobId, { honestyClass: 'live' }), /honesty_class|check/i);
    await insertOutput(p, tenantA, hostA, jobId);
    await assert.rejects(() => insertOutput(p, tenantA, hostA, jobId), /unique|duplicate/i);
  });

  test('jobs cannot set credential_ref or provider=openai', async () => {
    const p = db.getPool();
    await assert.rejects(() => insertJob(p, tenantA, hostA, { credentialRef: 'vault:video' }), /credential_ref|check/i);
    await assert.rejects(() => insertJob(p, tenantA, hostA, { provider: 'openai' }), /provider|check/i);
  });
}
