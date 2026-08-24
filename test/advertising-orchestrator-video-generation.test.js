'use strict';

process.env.PERMISSION_ENFORCEMENT = 'on';
process.env.MULTITENANT_ENFORCEMENT = 'on';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/infogenie';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

require('./helpers/env');

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { bootApp, request, login, makeFixtures, hasDb } = require('./helpers');
const db = require('../db');
const { ensureTenantSchema } = require('../services/tenants/schema');
const { ensureAgentOrchestratorSchema } = require('../services/agent_orchestrator/schema');
const { ensureResearchLimits, insertCompetitor, insertEvidenceItem } = require('../services/agent_orchestrator/research_store');
const { nonLiveHonestyMetrics } = require('../services/agent_orchestrator/research_honesty');
const { contentHash } = require('../services/agent_orchestrator/approvals');
const credits = require('../services/agent_orchestrator/credits');
const { OrchError } = require('../services/agent_orchestrator/errors');
const { startProposalGeneration } = require('../services/agent_orchestrator/proposal_store');
const { createProposalRuntime } = require('../services/agent_orchestrator/proposal_generate');
const { approveCreativeArtifact } = require('../services/agent_orchestrator/creative_store');
const { approvalContentHash } = require('../services/agent_orchestrator/creative_validate');
const { DEFAULT_REQUEST_MICROS } = require('../services/agent_orchestrator/pricing');
const { processVideoJobs, enqueueVideoJob, reserveKey } = require('../services/agent_orchestrator/video_jobs');
const { createVideoRuntime, completeVideoJob } = require('../services/agent_orchestrator/video_adapter');
const { validateContract, isVideoBrief } = require('../services/agent_orchestrator/video_validate');

const HAS_DB = hasDb();
const COST = Number(DEFAULT_REQUEST_MICROS);
const ik = (t) => `ik-${t}-${crypto.randomBytes(6).toString('hex')}`;
const JOBS_SRC = fs.readFileSync(path.join(__dirname, '../services/agent_orchestrator/video_jobs.js'), 'utf8');

function validContract(extra = {}) {
  return {
    contract_version: 'video_generation_v1', aspect_ratio: '9:16', width_px: 1080, height_px: 1920,
    duration_ms: 15000, fps: 30,
    scenes: [{ index: 0, start_ms: 0, end_ms: 15000, visual_direction: 'Hook then product' }],
    visual_direction: 'Hook then product',
    copy: { primary: 'Packable warmth', captions: [], cta: 'Learn more' },
    source_assets: [], audio: { voice_required: false, notes: '' }, output_format: 'mp4',
    safety: { moderation_required: true, prohibited_claims: [] },
    generation_settings: { style: 'neutral', pacing: 'medium' }, ...extra,
  };
}

test('enforcement flags stay on', () => {
  assert.equal(process.env.PERMISSION_ENFORCEMENT, 'on');
  assert.equal(process.env.MULTITENANT_ENFORCEMENT, 'on');
});

test('PR5B UI video generation jobs (no preview/publish)', () => {
  const SRC = fs.readFileSync(path.join(__dirname, '../components/features/manage/AgentOrchestrator.tsx'), 'utf8');
  assert.match(SRC, /\/api\/agent-orchestrator\/video-jobs/);
  assert.match(SRC, /Enqueue video job/);
  assert.match(SRC, /does not call a live provider/);
  assert.match(SRC, /does not publish/);
  assert.doesNotMatch(SRC, /<video/);
  assert.doesNotMatch(SRC, /mode:\s*"live"/);
});

test('video_jobs.js registers setInterval only when backgroundEnabled', () => {
  assert.match(JOBS_SRC, /backgroundEnabled\(\)/);
  assert.match(JOBS_SRC, /setInterval/);
  assert.match(JOBS_SRC, /startVideoWorker\(\)/);
});

test('contract rejects unknown field, https source url, and api_key', () => {
  assert.throws(() => validateContract({ ...validContract(), extra_field: 1 }), (e) => e.code === 'validation_failed');
  assert.throws(() => validateContract({ ...validContract(), source_assets: [{ asset_id: 'asset-1', url: 'https://evil.example/v.mp4' }] }), (e) => e.code === 'validation_failed');
  assert.throws(() => validateContract({ ...validContract(), api_key: 'sk-test' }), (e) => e.code === 'validation_failed');
});

test('adapter rejects bytes Buffer; default fixture has no live honesty', async () => {
  const job = { id: 'vgj_x', tenant_id: 1 };
  const contract = validContract();
  const ok = await completeVideoJob({ job, contract, runtime: createVideoRuntime() });
  assert.equal(ok.honesty_class, 'fixture');
  assert.equal(ok.provenance, 'fixture');
  assert.equal(ok.storage_ref, 'orchestrator/video/1/vgj_x');
  await assert.rejects(
    () => completeVideoJob({ job, contract, runtime: createVideoRuntime({ generate: async () => Buffer.from('bytes') }) }),
    (e) => e instanceof OrchError && e.code === 'provider_malformed'
  );
});

if (!HAS_DB) {
  test('advertising-orchestrator video generation skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else {
  const fx = makeFixtures();
  let app, tenantA, tenantB, ownerA, ownerB, cookieA, cookieB, seq = 0;
  const nid = (p) => { seq += 1; return `${p}-${seq}-${crypto.randomBytes(3).toString('hex')}`; };
  const p = () => db.getPool();
  const vids = (method, path, { cookie, body, headers } = {}) =>
    request(app.baseUrl, method, `/api/agent-orchestrator/video-jobs${path}`, { cookie, body, headers });

  async function seedCredits(tenantId) {
    const limits = require('../services/agent_orchestrator/limits');
    await limits.updateLimits(p(), tenantId, {
      credit_ceiling_micros: 10_000_000, requests_per_minute: 60, max_concurrent_ai: 10,
      daily_ai_cost_micros: 10_000_000, monthly_ai_cost_micros: 50_000_000, per_workflow_cost_micros: 10_000_000,
    }, ownerA.id);
    await credits.grant({ pool: p(), tenantId, amountMicros: 5_000_000, actorUserId: ownerA.id, idempotencyKey: ik('grant') });
  }

  async function seedApprovedRun(tenantId) {
    const wfId = nid('wf');
    await p().query(
      `INSERT INTO orchestrator_workflows
         (id, tenant_id, name, objective, product_or_service, offer, landing_page_url,
          target_markets, target_audiences, selected_platforms, advertising_budget,
          currency, credit_ceiling_micros, current_state, current_phase, version)
       VALUES ($1,$2,'PR5B','Awareness','Widget','Trial','https://example.com/p',
               '["US"]'::jsonb,'["SMB"]'::jsonb,'["meta"]'::jsonb,100,'USD',1000000,'research_approved','research',1)`,
      [wfId, tenantId]
    );
    const wf = (await p().query(`SELECT * FROM orchestrator_workflows WHERE tenant_id=$1 AND id=$2`, [tenantId, wfId])).rows[0];
    const research = (await p().query(
      `INSERT INTO orchestrator_approvals (tenant_id, workflow_id, gate, content_hash, decision, object_version, object_type, object_id, approved_platforms)
       VALUES ($1,$2,'research_execution',$3,'approved',1,'workflow',$2,'["meta"]'::jsonb) RETURNING *`,
      [tenantId, wfId, contentHash(wf, 'research_execution')]
    )).rows[0];
    const runId = nid('run');
    await p().query(
      `INSERT INTO orchestrator_research_runs (id, tenant_id, workflow_id, approval_id, approval_object_version, requested_platforms, idempotency_key, state, research_brief, search_parameters)
       VALUES ($1,$2,$3,$4,1,$5::text[],$6,'completed','','{}'::jsonb)`,
      [runId, tenantId, wfId, research.id, ['meta'], nid('idemp')]
    );
    const comp = await insertCompetitor(p(), {
      id: nid('comp'), tenant_id: tenantId, research_run_id: runId, platform: 'meta',
      provider_advertiser_id: nid('adv'), normalized_name: 'Acme Ads', discovery_source: 'ad_library',
      captured_at: new Date().toISOString(),
    }, { tenantId });
    const now = new Date().toISOString();
    await insertEvidenceItem(p(), {
      id: nid('ev'), tenant_id: tenantId, research_run_id: runId, competitor_id: comp.id, platform: 'meta',
      source_type: 'ad_creative', provider_external_id: nid('ext'),
      canonical_source_url: `https://www.facebook.com/ads/library/?id=${nid('ad')}`,
      advertiser_name: 'Acme Ads', creative_format: 'video', headline: 'Packable warmth',
      body_text: 'Public ad copy', excerpt: 'Public ad copy', captured_at: now, created_at: now,
      retention_class: 'standard', provider_metrics: nonLiveHonestyMetrics(), metrics_kind: 'estimated',
      provenance_method: 'ad_library', connector_id: 'meta_research', connector_version: '1.0.0',
      contract_version: 'v1', dedup_key: nid('dedup'),
    }, { tenantId });
    return { wfId, research, runId };
  }

  async function seedReady(tenantId, userId, { approve = true } = {}) {
    const seed = await seedApprovedRun(tenantId);
    const { generation, artifacts } = await startProposalGeneration(p(), {
      tenantId, userId, workflowId: seed.wfId, researchRunId: seed.runId,
      idempotencyKey: ik('p'), runtime: createProposalRuntime({ mode: 'fixture' }),
    });
    const brief = artifacts.find((a) => a.kind === 'creative_brief' && a.payload && a.payload.format === 'video');
    const imageBrief = artifacts.find((a) => a.kind === 'creative_brief' && a.payload && a.payload.format === 'image');
    assert.ok(brief && isVideoBrief(brief));
    const hash = approvalContentHash(brief.content_hash, brief.evidence_hash);
    let approved = null;
    if (approve) {
      approved = await approveCreativeArtifact(p(), {
        tenantId, artifactId: brief.artifact_id, req: { user: { id: userId } },
        contentHash: hash, objectVersion: brief.version,
      });
    }
    return { ...seed, generation, brief, imageBrief, approved, approvalHash: hash };
  }

  function postBody(seed, extra = {}) {
    return {
      workflow_id: seed.wfId, proposal_id: seed.generation.id, proposal_version: seed.generation.version,
      proposal_content_hash: seed.generation.content_hash, approval_id: seed.approved && seed.approved.approval_id,
      approval_hash: seed.approvalHash, estimated_max_cost_micros: COST, confirm: true, ...extra,
    };
  }
  function postVid(cookie, seed, tag, extra = {}) {
    return vids('POST', '', { cookie, body: postBody(seed, extra.body), headers: { 'Idempotency-Key': extra.key || ik(tag) } });
  }
  const runWorker = (tenantId, runtime, workerId) => processVideoJobs(p(), { tenantId, runtime: runtime || createVideoRuntime(), workerId });

  before(async () => {
    await fx.ensureSchemas();
    await ensureTenantSchema();
    await ensureAgentOrchestratorSchema();
    tenantA = await fx.seedTenant('PR5B A');
    tenantB = await fx.seedTenant('PR5B B');
    ownerA = await fx.seedUser({ tenantId: tenantA.id, owner: true });
    ownerB = await fx.seedUser({ tenantId: tenantB.id, owner: true });
    await ensureResearchLimits(p(), tenantA.id, { records: 10000, bytes: 104857600 });
    await ensureResearchLimits(p(), tenantB.id, { records: 10000, bytes: 104857600 });
    await seedCredits(tenantA.id);
    await seedCredits(tenantB.id);
    app = await bootApp();
    cookieA = (await login(app.baseUrl, ownerA.email, ownerA.password)).cookie;
    cookieB = (await login(app.baseUrl, ownerB.email, ownerB.password)).cookie;
  });

  after(async () => {
    if (app && app.close) await app.close();
    const ids = [tenantA && tenantA.id, tenantB && tenantB.id].filter(Boolean);
    if (ids.length) await p().query(`DELETE FROM tenants WHERE id = ANY($1)`, [ids]);
    await fx.cleanup();
  });

  test('1-2 fixture enqueue+worker succeeds once with opaque storage_ref and committed credits', async () => {
    const seed = await seedReady(tenantA.id, ownerA.id);
    const key = ik('ok');
    const res = await postVid(cookieA, seed, 'ok', { key });
    assert.equal(res.status, 201, res.text);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.job.status, 'reserved');
    assert.equal(res.json.job.honesty_class, 'fixture');
    assert.ok(!JSON.stringify(res.json).includes('credential_ref'));
    await runWorker(tenantA.id);
    const got = await vids('GET', `/${res.json.job.id}`, { cookie: cookieA });
    assert.equal(got.status, 200, got.text);
    assert.equal(got.json.job.status, 'succeeded');
    assert.equal(got.json.job.honesty_class, 'fixture');
    const out = got.json.job.output;
    assert.ok(out && out.storage_ref === `orchestrator/video/${tenantA.id}/${res.json.job.id}`);
    assert.equal(out.honesty_class, 'fixture');
    assert.equal(out.provenance, 'fixture');
    assert.notEqual(out.honesty_class, 'live');
    assert.equal((await p().query(`SELECT data_type FROM information_schema.columns WHERE table_name='orchestrator_video_generation_outputs' AND data_type='bytea'`)).rowCount, 0);
    assert.equal((await p().query(`SELECT id FROM orchestrator_video_generation_outputs WHERE tenant_id=$1 AND job_id=$2 AND usable=true`, [tenantA.id, res.json.job.id])).rowCount, 1);
    assert.equal((await p().query(`SELECT id FROM orchestrator_credit_reservations WHERE tenant_id=$1 AND idempotency_key=$2 AND status='committed'`, [tenantA.id, reserveKey(key)])).rowCount, 1);
  });

  test('3 image-brief approval cannot enqueue or mint video approval', async () => {
    const seed = await seedReady(tenantA.id, ownerA.id, { approve: false });
    const img = await vids('POST', '/approve-brief', { cookie: cookieA, body: { proposal_id: seed.generation.id, artifact_id: seed.imageBrief.artifact_id } });
    assert.equal(img.status, 409, img.text);
    assert.equal(img.json.error, 'approval_scope_mismatch');
    const hash = approvalContentHash(seed.imageBrief.content_hash, seed.imageBrief.evidence_hash);
    const approved = await approveCreativeArtifact(p(), {
      tenantId: tenantA.id, artifactId: seed.imageBrief.artifact_id, objectVersion: seed.imageBrief.version,
      contentHash: hash, req: { user: { id: ownerA.id } },
    });
    await assert.rejects(
      () => enqueueVideoJob(p(), {
        tenantId: tenantA.id, userId: ownerA.id, workflowId: seed.wfId, proposalId: seed.generation.id,
        proposalVersion: seed.generation.version, proposalContentHash: seed.generation.content_hash,
        approvalId: approved.approval_id, approvalHash: hash, estimatedMaxCostMicros: COST,
        confirm: true, idempotencyKey: ik('img'),
      }),
      (e) => e.code === 'approval_scope_mismatch'
    );
  });

  test('4 unapproved/stale/revoked/cross-tenant fail closed', async () => {
    const unapproved = await seedReady(tenantA.id, ownerA.id, { approve: false });
    const r1 = await postVid(cookieA, unapproved, 'un', { body: { approval_id: unapproved.research.id, approval_hash: unapproved.research.content_hash } });
    assert.ok(['approval_required', 'approval_scope_mismatch', 'approval_stale'].includes(r1.json.error), r1.text);
    const ok = await seedReady(tenantA.id, ownerA.id);
    const r2 = await postVid(cookieA, ok, 'staleh', { body: { proposal_content_hash: 'c'.repeat(64) } });
    assert.equal(r2.json.error, 'approval_stale', r2.text);
    const rev = await seedReady(tenantA.id, ownerA.id);
    await p().query(
      `INSERT INTO orchestrator_approvals (tenant_id, workflow_id, gate, content_hash, decision, object_version, object_type, object_id, approved_platforms)
       VALUES ($1,$2,'creative_generation',$3,'rejected',$4,'creative_artifact',$5,'[]'::jsonb)`,
      [tenantA.id, rev.wfId, rev.approvalHash, rev.brief.version, rev.brief.artifact_id]
    );
    const r3 = await postVid(cookieA, rev, 'rev');
    assert.equal(r3.json.error, 'approval_revoked', r3.text);
    const created = await postVid(cookieA, ok, 'iso');
    assert.equal(created.status, 201, created.text);
    const xg = await vids('GET', `/${created.json.job.id}`, { cookie: cookieB });
    assert.equal(xg.status, 404);
    assert.equal(xg.json.error, 'not_found');
    const xc = await vids('POST', `/${created.json.job.id}/cancel`, { cookie: cookieB, body: {} });
    assert.ok(xc.status === 404 || xc.status === 403, xc.text);
    const xp = await postVid(cookieB, ok, 'xtpost');
    assert.equal(xp.status, 404, xp.text);
    const mismatch = await postVid(cookieA, ok, 'tid', { body: { tenant_id: tenantB.id } });
    assert.equal(mismatch.json.error, 'validation_failed');
  });

  test('5 duplicate idempotency_key replays one reservation', async () => {
    const seed = await seedReady(tenantA.id, ownerA.id);
    const key = ik('dup');
    const first = await postVid(cookieA, seed, 'dup', { key });
    const second = await postVid(cookieA, seed, 'dup', { key });
    assert.equal(first.status, 201, first.text);
    assert.equal(second.status, 200, second.text);
    assert.equal(first.json.job.id, second.json.job.id);
    assert.equal((await p().query(`SELECT id FROM orchestrator_credit_reservations WHERE tenant_id=$1 AND idempotency_key=$2`, [tenantA.id, reserveKey(key)])).rowCount, 1);
  });

  test('6 cancel reserved releases credits; worker does not insert output', async () => {
    const seed = await seedReady(tenantA.id, ownerA.id);
    const res = await postVid(cookieA, seed, 'can');
    const c = await vids('POST', `/${res.json.job.id}/cancel`, { cookie: cookieA, body: {} });
    assert.equal(c.status, 200, c.text);
    assert.equal(c.json.job.status, 'cancelled');
    const rid = (await p().query(`SELECT reservation_id FROM orchestrator_video_generation_jobs WHERE tenant_id=$1 AND id=$2`, [tenantA.id, res.json.job.id])).rows[0].reservation_id;
    assert.equal((await p().query(`SELECT status FROM orchestrator_credit_reservations WHERE tenant_id=$1 AND id=$2`, [tenantA.id, rid])).rows[0].status, 'released');
    let n = 0;
    await runWorker(tenantA.id, createVideoRuntime({
      generate: async ({ job }) => {
        if (job && job.id === res.json.job.id) n += 1;
        return { storage_ref: `orchestrator/video/${tenantA.id}/${job.id}` };
      },
    }));
    assert.equal(n, 0);
    assert.equal((await p().query(`SELECT id FROM orchestrator_video_generation_outputs WHERE tenant_id=$1 AND job_id=$2`, [tenantA.id, res.json.job.id])).rowCount, 0);
  });

  test('7 two workers: one success, one skip, one output, one commit', async () => {
    const seed = await seedReady(tenantA.id, ownerA.id);
    const key = ik('two');
    const res = await postVid(cookieA, seed, 'two', { key });
    let n = 0;
    const runtime = createVideoRuntime({
      generate: async ({ job }) => {
        if (job && job.id === res.json.job.id) n += 1;
        return { storage_ref: `orchestrator/video/${tenantA.id}/${job.id}` };
      },
    });
    await Promise.all([runWorker(tenantA.id, runtime, 'w1'), runWorker(tenantA.id, runtime, 'w2')]);
    assert.equal(n, 1);
    assert.equal((await p().query(`SELECT id FROM orchestrator_video_generation_outputs WHERE tenant_id=$1 AND job_id=$2`, [tenantA.id, res.json.job.id])).rowCount, 1);
    assert.equal((await p().query(`SELECT id FROM orchestrator_credit_reservations WHERE tenant_id=$1 AND idempotency_key=$2 AND status='committed'`, [tenantA.id, reserveKey(key)])).rowCount, 1);
    assert.equal((await p().query(`SELECT id FROM orchestrator_credit_ledger WHERE tenant_id=$1 AND reservation_id=(SELECT reservation_id FROM orchestrator_video_generation_jobs WHERE tenant_id=$1 AND id=$2) AND entry_type='commit'`, [tenantA.id, res.json.job.id])).rowCount, 1);
  });

  test('8 crash resume with existing output does not double-commit or re-call adapter', async () => {
    const seed = await seedReady(tenantA.id, ownerA.id);
    const key = ik('crash');
    const res = await postVid(cookieA, seed, 'crash', { key });
    const job = (await p().query(`SELECT * FROM orchestrator_video_generation_jobs WHERE tenant_id=$1 AND id=$2`, [tenantA.id, res.json.job.id])).rows[0];
    await p().query(
      `INSERT INTO orchestrator_video_generation_outputs
         (id, tenant_id, workflow_id, job_id, proposal_id, proposal_version, proposal_content_hash, approval_hash,
          contract_hash, request_hash, mime_type, width_px, height_px, duration_ms, fps, storage_ref,
          honesty_class, provenance, moderation_status, moderation_source, usable)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'video/mp4',1080,1920,15000,30,$11,'fixture','fixture','passed','fixture',true)`,
      [nid('out'), tenantA.id, job.workflow_id, job.id, job.proposal_id, job.proposal_version,
        job.proposal_content_hash, job.approval_hash, job.contract_hash, job.generation_request_hash,
        `orchestrator/video/${tenantA.id}/${job.id}`]
    );
    let n = 0;
    const skipGen = createVideoRuntime({
      generate: async ({ job: j }) => {
        if (j && j.id === job.id) { n += 1; throw new Error('must not generate'); }
        return { storage_ref: `orchestrator/video/${tenantA.id}/${j.id}` };
      },
    });
    await runWorker(tenantA.id, skipGen);
    assert.equal(n, 0);
    await runWorker(tenantA.id, skipGen);
    assert.equal(n, 0);
    const row = (await p().query(`SELECT status FROM orchestrator_video_generation_jobs WHERE tenant_id=$1 AND id=$2`, [tenantA.id, job.id])).rows[0];
    assert.equal(row.status, 'succeeded');
    assert.equal((await p().query(`SELECT id FROM orchestrator_credit_ledger WHERE tenant_id=$1 AND reservation_id=$2 AND entry_type='commit'`, [tenantA.id, job.reservation_id])).rowCount, 1);
  });

  test('9-12 invalid cost, live mode, bytes adapter, insufficient credits fail closed', async () => {
    const seed = await seedReady(tenantA.id, ownerA.id);
    const badCost = await postVid(cookieA, seed, 'cost', { body: { estimated_max_cost_micros: 1 } });
    assert.equal(badCost.json.error, 'validation_failed', badCost.text);
    const origFetch = global.fetch;
    let fetched = 0;
    global.fetch = async () => { fetched += 1; throw new Error('network'); };
    try {
      const live = await postVid(cookieA, seed, 'live', { body: { mode: 'live' } });
      assert.equal(live.json.error, 'capability_not_supported', live.text);
      assert.equal(fetched, 0);
    } finally { global.fetch = origFetch; }
    const bytes = await postVid(cookieA, seed, 'bytes');
    assert.equal(bytes.status, 201, bytes.text);
    await runWorker(tenantA.id, createVideoRuntime({ generate: async () => Buffer.from('video-bytes') }));
    const failed = (await p().query(`SELECT status, error_code FROM orchestrator_video_generation_jobs WHERE tenant_id=$1 AND id=$2`, [tenantA.id, bytes.json.job.id])).rows[0];
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error_code, 'provider_malformed');
    assert.equal((await p().query(`SELECT id FROM orchestrator_video_generation_outputs WHERE tenant_id=$1 AND job_id=$2`, [tenantA.id, bytes.json.job.id])).rowCount, 0);
    const before = (await p().query(`SELECT available_micros FROM orchestrator_credit_accounts WHERE tenant_id=$1`, [tenantA.id])).rows[0].available_micros;
    await p().query(`UPDATE orchestrator_credit_accounts SET available_micros=0 WHERE tenant_id=$1`, [tenantA.id]);
    try {
      const poor = await postVid(cookieA, seed, 'poor');
      assert.equal(poor.json.error, 'insufficient_credits', poor.text);
    } finally {
      await p().query(`UPDATE orchestrator_credit_accounts SET available_micros=$2 WHERE tenant_id=$1`, [tenantA.id, before]);
    }
  });

  test('14 worker after approval revoke does not persist output', async () => {
    const seed = await seedReady(tenantA.id, ownerA.id);
    const res = await postVid(cookieA, seed, 'revw');
    assert.equal(res.status, 201, res.text);
    await p().query(
      `INSERT INTO orchestrator_approvals (tenant_id, workflow_id, gate, content_hash, decision, object_version, object_type, object_id, approved_platforms)
       VALUES ($1,$2,'creative_generation',$3,'rejected',$4,'creative_artifact',$5,'[]'::jsonb)`,
      [tenantA.id, seed.wfId, seed.approvalHash, seed.brief.version, seed.brief.artifact_id]
    );
    await runWorker(tenantA.id);
    const job = (await p().query(`SELECT status, error_code FROM orchestrator_video_generation_jobs WHERE tenant_id=$1 AND id=$2`, [tenantA.id, res.json.job.id])).rows[0];
    assert.notEqual(job.status, 'succeeded');
    assert.equal(job.error_code, 'approval_revoked');
    assert.equal((await p().query(`SELECT id FROM orchestrator_video_generation_outputs WHERE tenant_id=$1 AND job_id=$2`, [tenantA.id, res.json.job.id])).rowCount, 0);
  });
}
