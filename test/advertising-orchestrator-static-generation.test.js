'use strict';

process.env.PERMISSION_ENFORCEMENT = 'on';
process.env.MULTITENANT_ENFORCEMENT = 'on';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/infogenie';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || '_DUMMY_PR5A';

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
const limits = require('../services/agent_orchestrator/limits');
const { fail, OrchError } = require('../services/agent_orchestrator/errors');
const { startProposalGeneration } = require('../services/agent_orchestrator/proposal_store');
const { createProposalRuntime } = require('../services/agent_orchestrator/proposal_generate');
const { approveCreativeArtifact } = require('../services/agent_orchestrator/creative_store');
const { approvalContentHash } = require('../services/agent_orchestrator/creative_validate');
const { DEFAULT_REQUEST_MICROS } = require('../services/agent_orchestrator/pricing');
const outbox = require('../services/agent_orchestrator/outbox');
const { logger } = require('../services/infra/logger');
const {
  processStaticImageJobs, enqueueStaticImageJob, reserveKey,
} = require('../services/agent_orchestrator/generation_jobs');
const {
  createGenerationRuntime, generateStaticImage, validateRaster, fetchProviderBytes, FIXTURE_PNG, hasLiveKey,
} = require('../services/agent_orchestrator/generation_adapter');

const HAS_DB = hasDb();
const COST = Number(DEFAULT_REQUEST_MICROS);
const ik = (t) => `ik-${t}-${crypto.randomBytes(6).toString('hex')}`;
const SRC_PANEL = fs.readFileSync(
  path.join(__dirname, '../components/features/manage/AgentOrchestrator.tsx'), 'utf8'
);

test('PR5A UI static image generation with fixture honesty', () => {
  assert.match(SRC_PANEL, /\/api\/agent-orchestrator\/static-images/);
  assert.match(SRC_PANEL, /Generate static image/);
  assert.match(SRC_PANEL, /Fixture \/ synthetic/);
  assert.match(SRC_PANEL, /does not generate video/);
  assert.match(SRC_PANEL, /does not publish/);
  assert.match(SRC_PANEL, /does not draft or activate campaigns/);
  assert.doesNotMatch(SRC_PANEL, /\/api\/.*publish|activateCampaign/);
});

test('enforcement flags stay on', () => {
  assert.equal(process.env.PERMISSION_ENFORCEMENT, 'on');
  assert.equal(process.env.MULTITENANT_ENFORCEMENT, 'on');
});

test('generation_jobs.js registers setInterval only when backgroundEnabled', () => {
  const src = fs.readFileSync(path.join(__dirname, '../services/agent_orchestrator/generation_jobs.js'), 'utf8');
  assert.match(src, /backgroundEnabled\(\)/);
  assert.match(src, /setInterval/);
  assert.match(src, /startStaticImageWorker/);
  assert.match(src, /startStaticImageWorker\(\)/);
});

test('live OpenAI static-image generation is skipped without a real key', {
  skip: !process.env.OPENAI_API_KEY || /^_DUMMY/i.test(process.env.OPENAI_API_KEY)
    ? 'OPENAI_API_KEY dummy or unset' : false,
}, () => {});

test('dummy or missing OpenAI key + mode live throws provider_not_configured without network', async () => {
  const prev = process.env.OPENAI_API_KEY;
  const origFetch = global.fetch;
  let fetched = 0;
  global.fetch = async () => { fetched += 1; throw new Error('network must not be called'); };
  try {
    for (const key of ['_DUMMY_PR5A', '_dummy_key', '', undefined]) {
      fetched = 0;
      if (key === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = key;
      assert.equal(hasLiveKey(), false);
      await assert.rejects(
        () => generateStaticImage({ runtime: createGenerationRuntime({ mode: 'live' }) }),
        (e) => e instanceof OrchError && e.code === 'provider_not_configured'
      );
      assert.equal(fetched, 0);
    }
    const src = fs.readFileSync(path.join(__dirname, '../services/agent_orchestrator/generation_adapter.js'), 'utf8');
    const liveFn = src.slice(src.indexOf('async function liveOpenAi'));
    const gateIdx = liveFn.indexOf('hasLiveKey()');
    const clientIdx = liveFn.indexOf('new OpenAI');
    assert.ok(gateIdx >= 0 && clientIdx > gateIdx, 'dummy-key gate must precede OpenAI client');
  } finally {
    global.fetch = origFetch;
    if (prev === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prev;
  }
});

test('adapter coerces conflicting honesty tags from custom generate', async () => {
  const tagged = async (mode, honesty_class, provenance, source) => generateStaticImage({
    runtime: createGenerationRuntime({
      mode,
      generate: async () => ({
        bytes: FIXTURE_PNG, mime: 'image/png', honesty_class, provenance,
        moderation: { status: 'passed', source },
      }),
    }),
  });

  const leakedLive = await tagged('fixture', 'provider', 'live', 'provider');
  assert.equal(leakedLive.honesty_class, 'fixture');
  assert.equal(leakedLive.provenance, 'fixture');
  assert.equal(leakedLive.moderation.source, 'fixture');
  assert.notEqual(leakedLive.honesty_class, 'live');
  assert.notEqual(leakedLive.honesty_class, 'provider');

  const syn = await tagged('fixture', 'synthetic', 'fixture', 'synthetic');
  assert.equal(syn.honesty_class, 'synthetic');
  assert.equal(syn.provenance, 'fixture');

  const prev = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'unused-not-dummy';
  try {
    const leakedFix = await tagged('live', 'fixture', 'fixture', 'fixture');
    assert.equal(leakedFix.honesty_class, 'provider');
    assert.equal(leakedFix.provenance, 'live');
    assert.equal(leakedFix.moderation.source, 'provider');
    assert.notEqual(leakedFix.honesty_class, 'fixture');
    const keepLive = await tagged('live', 'live', 'live', 'provider');
    assert.equal(keepLive.honesty_class, 'live');
    assert.equal(keepLive.provenance, 'live');
  } finally {
    if (prev === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prev;
  }
});

test('adapter rejects unsafe urls, markup, mismatch, oversize, malformed raster', async () => {
  await assert.rejects(() => fetchProviderBytes('file:///etc/passwd'), (e) => e instanceof OrchError && e.code === 'unsafe_url');
  await assert.rejects(() => fetchProviderBytes('http://127.0.0.1/x'), (e) => e.code === 'unsafe_url');
  await assert.rejects(() => fetchProviderBytes('data:text/html;base64,PHNjcmlwdD4='), (e) => e.code === 'unsafe_url');
  await assert.rejects(() => fetchProviderBytes('vbscript:msgbox(1)'), (e) => e.code === 'unsafe_url');
  await assert.rejects(() => fetchProviderBytes('javascript:alert(1)'), (e) => e.code === 'unsafe_url');
  await assert.rejects(
    () => fetchProviderBytes('https://example.com/x.png', { fetchUrl: async () => ({ status: 302 }) }),
    (e) => e.code === 'unsafe_url'
  );
  assert.throws(() => validateRaster(Buffer.from('<html>x</html>'), 'image/png'), (e) => e.code === 'moderation_failed' || e.code === 'unsafe_asset');
  assert.throws(() => validateRaster(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), (e) => e.code === 'moderation_failed');
  assert.throws(() => validateRaster(Buffer.from('data:text/html,hi')), (e) => e.code === 'moderation_failed');
  assert.throws(() => validateRaster(Buffer.from('vbscript:msgbox(1)')), (e) => e.code === 'moderation_failed');
  assert.throws(() => validateRaster(Buffer.alloc(10 * 1024 * 1024 + 1)), (e) => e.code === 'payload_too_large');
  const bad = Buffer.from(FIXTURE_PNG);
  bad.write('XXXX', 12); // smash IHDR
  assert.throws(() => validateRaster(bad), (e) => e.code === 'unsafe_asset');
  const ok = await generateStaticImage({ runtime: createGenerationRuntime({ mode: 'fixture' }) });
  assert.equal(ok.honesty_class, 'fixture');
  assert.equal(ok.provenance, 'fixture');
  assert.notEqual(ok.honesty_class, 'live');
});

if (!HAS_DB) {
  test('advertising-orchestrator static generation skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else {
  const fx = makeFixtures();
  let app, tenantA, tenantB, ownerA, ownerB, cookieA, cookieB, seq = 0;
  const nid = (p) => { seq += 1; return `${p}-${seq}-${crypto.randomBytes(3).toString('hex')}`; };
  const p = () => db.getPool();
  const imgs = (method, path, { cookie, body, headers } = {}) =>
    request(app.baseUrl, method, `/api/agent-orchestrator/static-images${path}`, { cookie, body, headers });

  async function seedCredits(tenantId) {
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
       VALUES ($1,$2,'PR5A','Awareness','Widget','Trial','https://example.com/p',
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
    const ev = await insertEvidenceItem(p(), {
      id: nid('ev'), tenant_id: tenantId, research_run_id: runId, competitor_id: comp.id, platform: 'meta',
      source_type: 'ad_creative', provider_external_id: nid('ext'),
      canonical_source_url: `https://www.facebook.com/ads/library/?id=${nid('ad')}`,
      advertiser_name: 'Acme Ads', creative_format: 'image', headline: 'Packable warmth',
      body_text: 'Public ad copy', excerpt: 'Public ad copy', captured_at: now, created_at: now,
      retention_class: 'standard', provider_metrics: nonLiveHonestyMetrics(), metrics_kind: 'estimated',
      provenance_method: 'ad_library', connector_id: 'meta_research', connector_version: '1.0.0',
      contract_version: 'v1', dedup_key: nid('dedup'),
    }, { tenantId });
    return { wfId, research, runId, ev };
  }

  async function seedReady(tenantId, userId, { approve = true } = {}) {
    const seed = await seedApprovedRun(tenantId);
    const { generation, artifacts } = await startProposalGeneration(p(), {
      tenantId, userId, workflowId: seed.wfId, researchRunId: seed.runId,
      idempotencyKey: ik('p'), runtime: createProposalRuntime({ mode: 'fixture' }),
    });
    const brief = artifacts.find((a) => a.kind === 'creative_brief' && a.payload && a.payload.format === 'image');
    const hash = approvalContentHash(brief.content_hash, brief.evidence_hash);
    let approved = null;
    if (approve) {
      approved = await approveCreativeArtifact(p(), {
        tenantId, artifactId: brief.artifact_id, req: { user: { id: userId } },
        contentHash: hash, objectVersion: brief.version,
      });
    }
    return { ...seed, generation, brief, approved, approvalHash: hash };
  }

  function postBody(seed, extra = {}) {
    return {
      workflow_id: seed.wfId, proposal_id: seed.generation.id, proposal_version: seed.generation.version,
      proposal_content_hash: seed.generation.content_hash, approval_id: seed.approved && seed.approved.approval_id,
      approval_hash: seed.approvalHash, estimated_max_cost_micros: COST, confirm: true, mode: 'fixture', ...extra,
    };
  }

  function postImg(cookie, seed, tag, extra = {}) {
    return imgs('POST', '', { cookie, body: postBody(seed, extra.body), headers: { 'Idempotency-Key': extra.key || ik(tag) } });
  }

  async function runWorker(tenantId, runtime) {
    return processStaticImageJobs(p(), { tenantId, runtime: runtime || createGenerationRuntime({ mode: 'fixture' }) });
  }

  before(async () => {
    await fx.ensureSchemas();
    await ensureTenantSchema();
    await ensureAgentOrchestratorSchema();
    tenantA = await fx.seedTenant('PR5A A');
    tenantB = await fx.seedTenant('PR5A B');
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

  test('1 fixture generate stores one usable image classified fixture not live', async () => {
    const seed = await seedReady(tenantA.id, ownerA.id);
    const res = await postImg(cookieA, seed, 'ok');
    assert.equal(res.status, 201, res.text);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.replay, false);
    const job = res.json.job;
    assert.equal(job.status, 'queued');
    assert.equal(job.honesty_class, 'fixture');
    assert.equal(job.asset, undefined);
    let n = 0;
    await runWorker(tenantA.id, createGenerationRuntime({
      mode: 'fixture',
      generate: async () => { n += 1; return FIXTURE_PNG; },
    }));
    assert.equal(n, 1);
    const got = await imgs('GET', `/${job.id}`, { cookie: cookieA });
    assert.equal(got.status, 200, got.text);
    assert.equal(got.json.job.status, 'succeeded');
    assert.equal(got.json.job.honesty_class, 'fixture');
    const a = got.json.job.asset;
    assert.ok(a && a.storage_ref && a.asset_hash);
    assert.equal(a.honesty_class, 'fixture');
    assert.equal(a.provenance, 'fixture');
    assert.equal(a.moderation_status, 'passed');
    assert.notEqual(a.honesty_class, 'live');
    assert.ok(!JSON.stringify(got.json).includes('credential_ref'));
    assert.equal((await p().query(`SELECT id FROM orchestrator_static_image_assets WHERE tenant_id=$1 AND job_id=$2 AND usable=true`, [tenantA.id, job.id])).rowCount, 1);
  });

  test('2 unapproved stale expired revoked wrong-gate fail closed with no asset', async () => {
    const unapproved = await seedReady(tenantA.id, ownerA.id, { approve: false });
    const r1 = await postImg(cookieA, unapproved, 'un', { body: { approval_id: unapproved.research.id, approval_hash: unapproved.research.content_hash } });
    assert.ok(['approval_required', 'approval_scope_mismatch', 'approval_stale'].includes(r1.json.error), r1.text);

    const ok = await seedReady(tenantA.id, ownerA.id);
    const r2 = await postImg(cookieA, ok, 'stalev', { body: { proposal_version: Number(ok.generation.version) + 1 } });
    assert.equal(r2.json.error, 'approval_stale', r2.text);
    const r3 = await postImg(cookieA, ok, 'staleh', { body: { proposal_content_hash: 'c'.repeat(64) } });
    assert.equal(r3.json.error, 'approval_stale', r3.text);

    const exp = await seedReady(tenantA.id, ownerA.id);
    await p().query(`UPDATE orchestrator_creative_artifacts SET status='invalidated' WHERE tenant_id=$1 AND id=$2`, [tenantA.id, exp.brief.id]);
    const r4 = await postImg(cookieA, exp, 'exp');
    assert.equal(r4.json.error, 'approval_expired', r4.text);
    await assert.rejects(
      () => enqueueStaticImageJob(p(), {
        tenantId: tenantA.id, userId: ownerA.id, workflowId: ok.wfId, proposalId: ok.generation.id,
        proposalVersion: ok.generation.version, proposalContentHash: ok.generation.content_hash,
        approvalId: ok.approved.approval_id, approvalHash: ok.approvalHash, estimatedMaxCostMicros: COST,
        confirm: true, idempotencyKey: ik('ttl'), mode: 'fixture', now: Date.now() + 40 * 864e5,
      }),
      (e) => e.code === 'approval_expired'
    );

    const rev = await seedReady(tenantA.id, ownerA.id);
    await p().query(
      `INSERT INTO orchestrator_approvals (tenant_id, workflow_id, gate, content_hash, decision, object_version, object_type, object_id, approved_platforms)
       VALUES ($1,$2,'creative_generation',$3,'rejected',$4,'creative_artifact',$5,'[]'::jsonb)`,
      [tenantA.id, rev.wfId, rev.approvalHash, rev.brief.version, rev.brief.artifact_id]
    );
    const r5 = await postImg(cookieA, rev, 'rev');
    assert.equal(r5.json.error, 'approval_revoked', r5.text);

    const gate = await seedReady(tenantA.id, ownerA.id);
    const r6 = await postImg(cookieA, gate, 'gate', { body: { approval_id: gate.research.id, approval_hash: gate.research.content_hash } });
    assert.equal(r6.json.error, 'approval_scope_mismatch', r6.text);

    assert.equal((await p().query(`SELECT id FROM orchestrator_static_image_assets WHERE tenant_id=$1`, [tenantA.id])).rowCount, 1);
  });

  test('3 tenant B cannot read tenant A job; cross-workflow is not_found', async () => {
    const seed = await seedReady(tenantA.id, ownerA.id);
    const created = await postImg(cookieA, seed, 'iso');
    assert.equal(created.status, 201, created.text);
    const r = await imgs('GET', `/${created.json.job.id}`, { cookie: cookieB });
    assert.equal(r.status, 404);
    assert.equal(r.json.error, 'not_found');
    const other = await seedReady(tenantA.id, ownerA.id);
    const xw = await postImg(cookieA, seed, 'xw', { body: { workflow_id: other.wfId } });
    assert.equal(xw.status, 404);
    const mismatch = await postImg(cookieA, seed, 'tid', { body: { tenant_id: tenantB.id } });
    assert.equal(mismatch.json.error, 'validation_failed');
    await runWorker(tenantA.id);
  });

  test('4-5 duplicate and concurrent idempotency: one job, one outbox, one commit, one generate', async () => {
    const seed = await seedReady(tenantA.id, ownerA.id);
    const key = ik('dup');
    const first = await postImg(cookieA, seed, 'dup', { key });
    const second = await postImg(cookieA, seed, 'dup', { key });
    assert.equal(first.status, 201, first.text);
    assert.equal(second.status, 200, second.text);
    assert.equal(first.json.job.id, second.json.job.id);
    const ck = ik('conc');
    const pair = await Promise.all([postImg(cookieA, seed, 'a', { key: ck }), postImg(cookieA, seed, 'b', { key: ck })]);
    const ok = pair.filter((r) => r.json && r.json.ok);
    assert.ok(ok.length >= 1, `${pair[0].status}/${pair[1].status}`);
    assert.equal(new Set(ok.map((r) => r.json.job.id)).size, 1);
    let n = 0;
    await runWorker(tenantA.id, createGenerationRuntime({ mode: 'fixture', generate: async () => { n += 1; return FIXTURE_PNG; } }));
    const jobId = first.json.job.id;
    assert.equal((await p().query(`SELECT id FROM orchestrator_outbox WHERE tenant_id=$1 AND idempotency_key=$2`, [tenantA.id, `staticimg:${key}`])).rowCount, 1);
    assert.equal((await p().query(`SELECT id FROM orchestrator_credit_reservations WHERE tenant_id=$1 AND idempotency_key=$2 AND status='committed'`, [tenantA.id, reserveKey(key)])).rowCount, 1);
    assert.equal((await p().query(`SELECT id FROM orchestrator_static_image_assets WHERE tenant_id=$1 AND job_id=$2`, [tenantA.id, jobId])).rowCount, 1);
    assert.ok(n >= 1);
    const concId = ok[0].json.job.id;
    assert.equal((await p().query(`SELECT id FROM orchestrator_static_image_assets WHERE tenant_id=$1 AND job_id=$2`, [tenantA.id, concId])).rowCount, 1);
  });

  test('6 timeout then terminal releases reservation; new key may reserve once; no double commit on retry', async () => {
    const seed = await seedReady(tenantA.id, ownerA.id);
    const key = ik('to');
    const res = await postImg(cookieA, seed, 'to', { key });
    assert.equal(res.status, 201, res.text);
    await p().query(`UPDATE orchestrator_static_image_jobs SET max_attempts=1 WHERE tenant_id=$1 AND id=$2`, [tenantA.id, res.json.job.id]);
    await runWorker(tenantA.id, createGenerationRuntime({
      mode: 'fixture', generate: async () => { fail('provider_timeout'); },
    }));
    const failed = (await p().query(`SELECT status, error_code FROM orchestrator_static_image_jobs WHERE tenant_id=$1 AND id=$2`, [tenantA.id, res.json.job.id])).rows[0];
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error_code, 'provider_timeout');
    const rel = (await p().query(`SELECT status FROM orchestrator_credit_reservations WHERE tenant_id=$1 AND idempotency_key=$2`, [tenantA.id, reserveKey(key)])).rows[0];
    assert.equal(rel.status, 'released');
    const key2 = ik('to2');
    const again = await postImg(cookieA, seed, 'to2', { key: key2 });
    assert.equal(again.status, 201, again.text);
    await runWorker(tenantA.id, createGenerationRuntime({ mode: 'fixture' }));
    assert.equal((await p().query(`SELECT status FROM orchestrator_credit_reservations WHERE tenant_id=$1 AND idempotency_key=$2`, [tenantA.id, reserveKey(key2)])).rows[0].status, 'committed');
    assert.equal((await p().query(`SELECT id FROM orchestrator_credit_reservations WHERE tenant_id=$1 AND idempotency_key=$2 AND status='committed'`, [tenantA.id, reserveKey(key)])).rowCount, 0);
  });

  test('7 crash/restart expired lease succeeds once', async () => {
    const seed = await seedReady(tenantA.id, ownerA.id);
    const res = await postImg(cookieA, seed, 'crash');
    await p().query(
      `UPDATE orchestrator_static_image_jobs SET status='running', lease_holder='dead', lease_expires_at=now() - interval '2 minutes',
              started_at=now(), attempt_count=1, state_version=state_version+1 WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, res.json.job.id]
    );
    let n = 0;
    await runWorker(tenantA.id, createGenerationRuntime({ mode: 'fixture', generate: async () => { n += 1; return FIXTURE_PNG; } }));
    assert.equal(n, 1);
    const row = (await p().query(`SELECT status, reservation_id FROM orchestrator_static_image_jobs WHERE tenant_id=$1 AND id=$2`, [tenantA.id, res.json.job.id])).rows[0];
    assert.equal(row.status, 'succeeded');
    assert.equal((await p().query(`SELECT id FROM orchestrator_static_image_assets WHERE tenant_id=$1 AND job_id=$2`, [tenantA.id, res.json.job.id])).rowCount, 1);
    assert.equal((await p().query(`SELECT status FROM orchestrator_credit_reservations WHERE tenant_id=$1 AND id=$2`, [tenantA.id, row.reservation_id])).rows[0].status, 'committed');
  });

  test('8 rate/concurrency/cost fail closed with no provider call', async () => {
    const seed = await seedReady(tenantA.id, ownerA.id);
    const restore = {
      credit_ceiling_micros: 10_000_000, requests_per_minute: 60, max_concurrent_ai: 10,
      daily_ai_cost_micros: 10_000_000, monthly_ai_cost_micros: 50_000_000, per_workflow_cost_micros: 10_000_000,
    };
    const before = (await p().query(`SELECT COUNT(*)::int AS n FROM orchestrator_outbox WHERE tenant_id=$1`, [tenantA.id])).rows[0].n;
    try {
      await limits.updateLimits(p(), tenantA.id, { requests_per_minute: 0 }, ownerA.id);
      const r1 = await postImg(cookieA, seed, 'rpm');
      assert.equal(r1.status, 429);
      assert.equal(r1.json.error, 'rate_limit_exceeded');
      await limits.updateLimits(p(), tenantA.id, { ...restore, max_concurrent_ai: 0 }, ownerA.id);
      const r2 = await postImg(cookieA, seed, 'conc');
      assert.equal(r2.status, 429);
      assert.equal(r2.json.error, 'concurrency_limit_exceeded');
      await limits.updateLimits(p(), tenantA.id, { ...restore, daily_ai_cost_micros: 0 }, ownerA.id);
      const r3 = await postImg(cookieA, seed, 'cost');
      assert.equal(r3.status, 409);
      assert.equal(r3.json.error, 'tenant_cost_limit_exceeded');
    } finally {
      await limits.updateLimits(p(), tenantA.id, restore, ownerA.id);
    }
    const after = (await p().query(`SELECT COUNT(*)::int AS n FROM orchestrator_outbox WHERE tenant_id=$1`, [tenantA.id])).rows[0].n;
    assert.equal(after, before);
  });

  test('10-11 moderation fail stores no usable asset; logs/audit/outbox have no secrets', async () => {
    const seed = await seedReady(tenantA.id, ownerA.id);
    const secret = 'sk-PR5A-SECRET-VALUE-not-for-logs';
    const key = ik('mod');
    const res = await postImg(cookieA, seed, 'mod', { key });
    assert.equal(res.status, 201, res.text);
    const lines = [];
    const orig = logger.info.bind(logger);
    logger.info = (msg, fields) => { lines.push(JSON.stringify({ msg, fields })); return orig(msg, fields); };
    try {
      await runWorker(tenantA.id, createGenerationRuntime({
        mode: 'fixture',
        generate: async () => FIXTURE_PNG,
        moderate: async () => ({ status: 'failed' }),
        secret,
      }));
    } finally { logger.info = orig; }
    const job = (await p().query(`SELECT * FROM orchestrator_static_image_jobs WHERE tenant_id=$1 AND id=$2`, [tenantA.id, res.json.job.id])).rows[0];
    assert.equal(job.status, 'failed');
    assert.equal(job.error_code, 'moderation_failed');
    assert.equal((await p().query(`SELECT id FROM orchestrator_static_image_assets WHERE tenant_id=$1 AND job_id=$2`, [tenantA.id, job.id])).rowCount, 0);
    const ob = (await p().query(`SELECT payload, credential_ref FROM orchestrator_outbox WHERE tenant_id=$1 AND id=$2`, [tenantA.id, job.outbox_id])).rows[0];
    const audit = (await p().query(`SELECT detail FROM orchestrator_audit_events WHERE tenant_id=$1 AND workflow_id=$2`, [tenantA.id, seed.wfId])).rows;
    const blob = `${lines.join('\n')}\n${JSON.stringify(job)}\n${JSON.stringify(ob)}\n${JSON.stringify(audit)}`;
    assert.doesNotMatch(blob, /sk-PR5A-SECRET-VALUE-not-for-logs/);
    assert.doesNotMatch(blob, /sk-[A-Za-z0-9]{8,}/);
    assert.doesNotMatch(JSON.stringify(ob.payload), /prompt|visual_direction/);
  });

  test('cancel queued job releases credits', async () => {
    const seed = await seedReady(tenantA.id, ownerA.id);
    const res = await postImg(cookieA, seed, 'can');
    const c = await imgs('POST', `/${res.json.job.id}/cancel`, { cookie: cookieA, body: {} });
    assert.equal(c.status, 200, c.text);
    assert.equal(c.json.job.status, 'cancelled');
    const rid = (await p().query(`SELECT reservation_id FROM orchestrator_static_image_jobs WHERE tenant_id=$1 AND id=$2`, [tenantA.id, res.json.job.id])).rows[0].reservation_id;
    assert.equal((await p().query(`SELECT status FROM orchestrator_credit_reservations WHERE tenant_id=$1 AND id=$2`, [tenantA.id, rid])).rows[0].status, 'released');
  });

  test('cancel running job skips putObject, releases after generate, no second charge', async () => {
    const seed = await seedReady(tenantA.id, ownerA.id);
    const consumedBefore = (await p().query(
      `SELECT consumed_micros FROM orchestrator_credit_accounts WHERE tenant_id=$1`,
      [tenantA.id]
    )).rows[0].consumed_micros;
    const res = await postImg(cookieA, seed, 'canrun');
    assert.equal(res.status, 201, res.text);
    const jobId = res.json.job.id;
    const rid = (await p().query(
      `SELECT reservation_id FROM orchestrator_static_image_jobs WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, jobId]
    )).rows[0].reservation_id;
    assert.equal((await p().query(
      `SELECT status FROM orchestrator_credit_reservations WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, rid]
    )).rows[0].status, 'reserved');

    let releaseGenerate;
    const gate = new Promise((resolve) => { releaseGenerate = resolve; });
    let entered = false;
    const workerP = runWorker(tenantA.id, createGenerationRuntime({
      mode: 'fixture',
      generate: async () => {
        entered = true;
        await gate;
        return FIXTURE_PNG;
      },
    }));
    const t0 = Date.now();
    while (!entered && Date.now() - t0 < 5000) {
      await new Promise((r) => setTimeout(r, 15));
    }
    assert.ok(entered, 'worker never entered generate');
    const running = (await p().query(
      `SELECT status FROM orchestrator_static_image_jobs WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, jobId]
    )).rows[0];
    assert.equal(running.status, 'running');

    const c = await imgs('POST', `/${jobId}/cancel`, { cookie: cookieA, body: {} });
    assert.equal(c.status, 200, c.text);
    assert.equal(c.json.job.status, 'cancelled');
    assert.equal((await p().query(
      `SELECT status FROM orchestrator_credit_reservations WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, rid]
    )).rows[0].status, 'reserved', 'running cancel must not release yet');

    releaseGenerate();
    await workerP;

    const job = (await p().query(
      `SELECT status, error_code FROM orchestrator_static_image_jobs WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, jobId]
    )).rows[0];
    assert.equal(job.status, 'cancelled');
    assert.equal(job.error_code, 'cancelled');
    assert.equal((await p().query(
      `SELECT id FROM orchestrator_static_image_assets WHERE tenant_id=$1 AND job_id=$2`,
      [tenantA.id, jobId]
    )).rowCount, 0);
    assert.equal((await p().query(
      `SELECT id FROM orchestrator_static_image_assets WHERE tenant_id=$1 AND job_id=$2 AND usable=true`,
      [tenantA.id, jobId]
    )).rowCount, 0);
    const reservation = (await p().query(
      `SELECT status FROM orchestrator_credit_reservations WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, rid]
    )).rows[0];
    assert.equal(reservation.status, 'released');
    assert.notEqual(reservation.status, 'committed');
    assert.equal((await p().query(
      `SELECT id FROM orchestrator_credit_ledger WHERE tenant_id=$1 AND reservation_id=$2 AND entry_type='commit'`,
      [tenantA.id, rid]
    )).rowCount, 0);
    const consumedAfter = (await p().query(
      `SELECT consumed_micros FROM orchestrator_credit_accounts WHERE tenant_id=$1`,
      [tenantA.id]
    )).rows[0].consumed_micros;
    assert.equal(String(consumedAfter), String(consumedBefore));
  });

  test('workflow cancel stops worker with no usable asset', async () => {
    const seed = await seedReady(tenantA.id, ownerA.id);
    const res = await postImg(cookieA, seed, 'wfcancel');
    assert.equal(res.status, 201, res.text);
    const jobId = res.json.job.id;
    await p().query(
      `UPDATE orchestrator_workflows SET current_state='cancelled' WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, seed.wfId]
    );
    let n = 0;
    await runWorker(tenantA.id, createGenerationRuntime({
      mode: 'fixture',
      generate: async () => { n += 1; return FIXTURE_PNG; },
    }));
    const job = (await p().query(
      `SELECT status, error_code FROM orchestrator_static_image_jobs WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, jobId]
    )).rows[0];
    assert.notEqual(job.status, 'succeeded');
    assert.ok(job.status === 'cancelled' || job.status === 'failed', job.status);
    assert.equal(job.error_code, 'cancelled');
    assert.equal(n, 0);
    assert.equal((await p().query(
      `SELECT id FROM orchestrator_static_image_assets WHERE tenant_id=$1 AND job_id=$2 AND usable=true`,
      [tenantA.id, jobId]
    )).rowCount, 0);
    assert.equal((await p().query(
      `SELECT id FROM orchestrator_static_image_assets WHERE tenant_id=$1 AND job_id=$2`,
      [tenantA.id, jobId]
    )).rowCount, 0);
  });

  test('released reservation cannot persist an uncharged usable asset', async () => {
    const seed = await seedReady(tenantA.id, ownerA.id);
    const wfBefore = (await p().query(
      `SELECT current_state FROM orchestrator_workflows WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, seed.wfId]
    )).rows[0].current_state;
    const res = await postImg(cookieA, seed, 'chargeskip');
    assert.equal(res.status, 201, res.text);
    const jobId = res.json.job.id;
    const row = (await p().query(
      `SELECT reservation_id, idempotency_key FROM orchestrator_static_image_jobs WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, jobId]
    )).rows[0];
    const rid = row.reservation_id;

    let releaseGenerate;
    const gate = new Promise((resolve) => { releaseGenerate = resolve; });
    let entered = false;
    const workerP = runWorker(tenantA.id, createGenerationRuntime({
      mode: 'fixture',
      generate: async () => {
        entered = true;
        await gate;
        return FIXTURE_PNG;
      },
    }));
    const t0 = Date.now();
    while (!entered && Date.now() - t0 < 5000) {
      await new Promise((r) => setTimeout(r, 15));
    }
    assert.ok(entered, 'worker never entered generate');

    await credits.release({
      pool: p(), tenantId: tenantA.id, reservationId: rid, reasonCode: 'paused',
      idempotencyKey: `release-wf:${seed.wfId}:${rid}`,
    });
    await p().query(
      `UPDATE orchestrator_workflows SET current_state=$3 WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, seed.wfId, wfBefore]
    );

    releaseGenerate();
    await workerP;

    const job = (await p().query(
      `SELECT status, error_code FROM orchestrator_static_image_jobs WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, jobId]
    )).rows[0];
    assert.notEqual(job.status, 'succeeded');
    assert.equal(job.status, 'failed');
    assert.equal(job.error_code, 'insufficient_credits');
    assert.equal((await p().query(
      `SELECT id FROM orchestrator_static_image_assets WHERE tenant_id=$1 AND job_id=$2 AND usable=true`,
      [tenantA.id, jobId]
    )).rowCount, 0);
    assert.equal((await p().query(
      `SELECT id FROM orchestrator_static_image_assets WHERE tenant_id=$1 AND job_id=$2`,
      [tenantA.id, jobId]
    )).rowCount, 0);
    const reservation = (await p().query(
      `SELECT status FROM orchestrator_credit_reservations WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, rid]
    )).rows[0];
    assert.equal(reservation.status, 'released');
    assert.notEqual(reservation.status, 'committed');
    assert.equal((await p().query(
      `SELECT id FROM orchestrator_credit_ledger WHERE tenant_id=$1 AND reservation_id=$2 AND entry_type='commit'`,
      [tenantA.id, rid]
    )).rowCount, 0);
  });

  test('HTTP approve-brief then generate succeeds', async () => {
    const seed = await seedReady(tenantA.id, ownerA.id, { approve: false });
    const ap = await imgs('POST', '/approve-brief', {
      cookie: cookieA,
      body: { proposal_id: seed.generation.id, artifact_id: seed.brief.artifact_id },
    });
    assert.equal(ap.status, 200, ap.text);
    assert.ok(ap.json.approval && ap.json.approval.id);
    const res = await postImg(cookieA, {
      ...seed,
      approved: { approval_id: ap.json.approval.id },
      approvalHash: ap.json.approval.content_hash,
    }, 'httpap');
    assert.equal(res.status, 201, res.text);
    await runWorker(tenantA.id);
    const got = await imgs('GET', `/${res.json.job.id}`, { cookie: cookieA });
    assert.equal(got.json.job.status, 'succeeded', got.text);
  });

  test('tenant B cannot generate from or approve tenant A objects', async () => {
    const seed = await seedReady(tenantA.id, ownerA.id);
    const gen = await postImg(cookieB, seed, 'xtpost');
    assert.equal(gen.status, 404, gen.text);
    assert.equal(gen.json.error, 'not_found');
    const ap = await imgs('POST', '/approve-brief', {
      cookie: cookieB,
      body: { proposal_id: seed.generation.id, artifact_id: seed.brief.artifact_id },
    });
    assert.equal(ap.status, 404, ap.text);
    assert.equal(ap.json.error, 'not_found');
    for (const t of [tenantA.id, tenantB.id]) {
      assert.equal((await p().query(
        `SELECT id FROM orchestrator_static_image_jobs WHERE tenant_id=$1 AND proposal_id=$2`,
        [t, seed.generation.id]
      )).rowCount, 0);
    }
  });

  test('approval on a non-image artifact can neither be minted nor drive generation', async () => {
    const seed = await seedReady(tenantA.id, ownerA.id, { approve: false });
    const rows = (await p().query(
      `SELECT * FROM orchestrator_creative_artifacts WHERE tenant_id=$1 AND workflow_id=$2`,
      [tenantA.id, seed.wfId]
    )).rows;
    const video = rows.find((a) => a.kind === 'creative_brief' && a.payload && a.payload.format === 'video');
    const angle = rows.find((a) => a.kind === 'angle');
    assert.ok(video && angle, 'bundle carries a video brief and text artifacts');

    for (const art of [video, angle]) {
      const r = await imgs('POST', '/approve-brief', {
        cookie: cookieA,
        body: { proposal_id: seed.generation.id, artifact_id: art.artifact_id },
      });
      assert.equal(r.status, 409, r.text);
      assert.equal(r.json.error, 'approval_scope_mismatch');
      assert.equal((await p().query(
        `SELECT status FROM orchestrator_creative_artifacts WHERE tenant_id=$1 AND id=$2`,
        [tenantA.id, art.id]
      )).rows[0].status, 'draft');
    }

    const hash = approvalContentHash(video.content_hash, video.evidence_hash);
    const approved = await approveCreativeArtifact(p(), {
      tenantId: tenantA.id, artifactId: video.artifact_id, objectVersion: video.version,
      contentHash: hash, req: { user: { id: ownerA.id } },
    });
    await assert.rejects(
      () => enqueueStaticImageJob(p(), {
        tenantId: tenantA.id, userId: ownerA.id, workflowId: seed.wfId, proposalId: seed.generation.id,
        proposalVersion: seed.generation.version, proposalContentHash: seed.generation.content_hash,
        approvalId: approved.approval_id, approvalHash: hash, estimatedMaxCostMicros: COST,
        confirm: true, idempotencyKey: ik('vid'), mode: 'fixture',
      }),
      (e) => e.code === 'approval_scope_mismatch'
    );
    assert.equal((await p().query(
      `SELECT id FROM orchestrator_static_image_jobs WHERE tenant_id=$1 AND approval_id=$2`,
      [tenantA.id, approved.approval_id]
    )).rowCount, 0);
  });

  test('brief superseded after enqueue fails the job closed and releases credits', async () => {
    const seed = await seedReady(tenantA.id, ownerA.id);
    const key = ik('matchg');
    const res = await postImg(cookieA, seed, 'matchg', { key });
    assert.equal(res.status, 201, res.text);
    await p().query(
      `UPDATE orchestrator_creative_artifacts SET status='superseded' WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, seed.brief.id]
    );
    await runWorker(tenantA.id);
    const job = (await p().query(
      `SELECT status, error_code FROM orchestrator_static_image_jobs WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, res.json.job.id]
    )).rows[0];
    assert.equal(job.status, 'failed');
    assert.equal(job.error_code, 'approval_scope_mismatch');
    assert.equal((await p().query(
      `SELECT id FROM orchestrator_static_image_assets WHERE tenant_id=$1 AND job_id=$2`,
      [tenantA.id, res.json.job.id]
    )).rowCount, 0);
    assert.equal((await p().query(
      `SELECT status FROM orchestrator_credit_reservations WHERE tenant_id=$1 AND idempotency_key=$2`,
      [tenantA.id, reserveKey(key)]
    )).rows[0].status, 'released');
  });

  test('static-image worker does not complete foreign outbox rows', async () => {
    const seed = await seedReady(tenantA.id, ownerA.id);
    const foreign = await outbox.enqueue(p(), {
      tenantId: tenantA.id, workflowId: seed.wfId, destination: 'internal',
      operation: 'research_ingest', idempotencyKey: ik('foreign-obx'),
    });
    assert.equal(foreign.state, 'pending');
    await runWorker(tenantA.id);
    const row = (await p().query(
      `SELECT state FROM orchestrator_outbox WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, foreign.id]
    )).rows[0];
    assert.ok(row);
    assert.notEqual(row.state, 'completed');
    assert.equal(row.state, 'pending');
  });
}
