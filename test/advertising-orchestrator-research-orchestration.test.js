'use strict';

process.env.PERMISSION_ENFORCEMENT = 'on';
process.env.MULTITENANT_ENFORCEMENT = 'on';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/infogenie';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

require('./helpers/env');

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const { bootApp, request, login, makeFixtures, hasDb } = require('./helpers');
const db = require('../db');
const { ensureTenantSchema } = require('../services/tenants/schema');
const { ensureAgentOrchestratorSchema } = require('../services/agent_orchestrator/schema');
const { ensureResearchLimits } = require('../services/agent_orchestrator/research_store');
const {
  startResearchRun, continueResearchRun, cancelResearchRun, executeResearchRun,
} = require('../services/agent_orchestrator/research_ingest');
const { acquireLease, releaseLease } = require('../services/agent_orchestrator/leases');
const { planHash, validatePlan, previewPlan } = require('../services/agent_orchestrator/research_plan');
const { approvalSnapshot, materialChanged, contentHash } = require('../services/agent_orchestrator/approvals');
const limits = require('../services/agent_orchestrator/limits');
const credits = require('../services/agent_orchestrator/credits');
const { OrchError } = require('../services/agent_orchestrator/errors');

const HAS_DB = hasDb();

function ik(tag) {
  return `ik-${tag}-${crypto.randomBytes(6).toString('hex')}`;
}

function hopRuntime(opts = {}) {
  const hops = [];
  const failOn = new Set(opts.failPlatforms || []);
  const pagesWanted = opts.pagesPerPlatform || 1;
  return {
    hops,
    mode: 'fixture',
    connectors: {
      meta_research: { version: '1.0.0' },
      google_research: { version: '1.0.0' },
      tiktok_research: { version: '1.0.0' },
    },
    async fetchPage(req) {
      hops.push({ connector: req.connector_id, cursor: req.cursor || null, key: req.idempotency_key });
      if (opts.tokenError && req.connector_id === opts.tokenError) {
        return { ok: false, error: 'terminal', message: 'Authorization: Bearer sk-fake-token-value-12' };
      }
      const platform = String(req.connector_id || '').replace(/_research$/, '');
      if (failOn.has(platform) || failOn.has(req.connector_id)) {
        return { ok: false, error: 'terminal', message: `${platform}_unavailable` };
      }
      const seen = hops.filter((h) => h.connector === req.connector_id).length;
      const hasMore = seen < pagesWanted;
      return {
        ok: true,
        contract_version: 'v1',
        connector_id: req.connector_id,
        connector_version: '1.0.0',
        competitors: [],
        evidence: [],
        page: { has_more: hasMore, next_cursor: hasMore ? `${req.connector_id}:p${seen}` : null },
        continuation_state: { honesty_class: 'fixture' },
      };
    },
  };
}

test('research plan hash is canonical and empty {} is stable', () => {
  const a = validatePlan({
    requested_platforms: ['tiktok', 'meta', 'google'],
    search_parameters: { query: 'ads', max_pages: 1 },
  });
  const b = validatePlan({
    contract_version: 'v1',
    requested_platforms: ['google', 'meta', 'tiktok'],
    search_parameters: { max_pages: 1, query: 'ads' },
    evidence_contract_version: 'v1',
  });
  assert.strictEqual(planHash(a), planHash(b));
  assert.match(planHash({}), /^[a-f0-9]{64}$/);
  assert.strictEqual(planHash({}), planHash({}));
  const preview = previewPlan({ requested_platforms: ['meta'] });
  assert.strictEqual(preview.plan.requested_platforms[0], 'meta');
  assert.throws(() => validatePlan({ requested_platforms: ['meta'], extra: 1 }), OrchError);
});

test('approval snapshot includes research_plan_hash and plan edits are material', () => {
  const wf = {
    id: 'ow_plan',
    version: 1,
    selected_platforms: ['meta'],
    advertising_budget: 100,
    credit_ceiling_micros: 0,
    currency: 'USD',
    landing_page_url: 'https://example.com/x',
    offer: 'trial',
    objective: 'signups',
    product_or_service: 'saas',
    research_plan: {},
  };
  const snap = approvalSnapshot(wf, 'research_execution');
  assert.match(snap.research_plan_hash, /^[a-f0-9]{64}$/);
  assert.strictEqual(snap.research_plan_hash, planHash({}));
  const plan = validatePlan({ requested_platforms: ['meta', 'google'] });
  assert.strictEqual(materialChanged(wf, { ...wf, research_plan: plan }), true);
  assert.notStrictEqual(contentHash({ ...wf, research_plan: plan }, 'research_execution'), contentHash(wf, 'research_execution'));
});

test('live research orchestration smoke', {
  skip: process.env.INFOGENIE_LIVE_RESEARCH_ORCHESTRATION === '1'
    ? false
    : 'INFOGENIE_LIVE_RESEARCH_ORCHESTRATION unset',
}, () => {});

if (!HAS_DB) {
  test('advertising-orchestrator research orchestration skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else {
  const fx = makeFixtures();
  let app;
  let tenantA;
  let tenantB;
  let ownerA;
  let ownerB;
  let cookieA;
  let cookieB;

  function orch(method, urlPath, { cookie, body, headers } = {}) {
    return request(app.baseUrl, method, `/api/agent-orchestrator/workflows${urlPath}`, {
      cookie, body, headers,
    });
  }

  function research(method, urlPath, { cookie, body } = {}) {
    return request(app.baseUrl, method, `/api/agent-orchestrator/research${urlPath}`, {
      cookie, body,
    });
  }

  async function createWorkflow(cookie, over) {
    const created = await orch('POST', '', {
      cookie,
      body: {
        name: 'PR3C host',
        objective: 'Collect public ads',
        product_or_service: 'Analytics',
        offer: 'Trial',
        landing_page_url: 'https://example.com/trial',
        target_markets: ['US'],
        target_audiences: ['SMB'],
        selected_platforms: ['meta', 'google', 'tiktok'],
        advertising_budget: 100,
        currency: 'USD',
        ...over,
      },
      headers: { 'Idempotency-Key': ik('c') },
    });
    assert.ok(created.json && created.json.ok, created.text);
    return created.json.workflow;
  }

  async function putPlan(cookie, workflowId, over) {
    const res = await research('PUT', '/plans', {
      cookie,
      body: {
        workflow_id: workflowId,
        requested_platforms: ['meta', 'google', 'tiktok'],
        search_parameters: { query: 'ads', max_pages: 1 },
        ...over,
      },
    });
    assert.ok(res.json && res.json.ok, res.text);
    return res.json;
  }

  async function approveWorkflow(cookie, wf, over) {
    const reqd = await orch('POST', `/${wf.id}/request-approval`, {
      cookie, body: { gate: 'research_execution' }, headers: { 'Idempotency-Key': ik('ra') },
    });
    wf = reqd.json.workflow;
    const ceiling = over && over.credit_ceiling_micros != null
      ? { credit_ceiling_micros: over.credit_ceiling_micros }
      : { credit_ceiling: 0 };
    const appr = await orch('POST', `/${wf.id}/approve`, {
      cookie,
      body: {
        gate: 'research_execution',
        object_type: 'workflow',
        object_id: wf.id,
        object_version: wf.version,
        platforms: wf.selected_platforms,
        advertising_budget: wf.advertising_budget,
        comment: 'ok',
        ...ceiling,
        ...over,
      },
      headers: { 'Idempotency-Key': ik('ap') },
    });
    assert.strictEqual(appr.status, 200, appr.text);
    return appr.json.workflow;
  }

  async function plannedApproved(cookie, { plan, ceiling } = {}) {
    const created = await createWorkflow(cookie, ceiling != null ? { credit_ceiling_micros: ceiling } : {});
    await putPlan(cookie, created.id, plan);
    const fresh = (await orch('GET', `/${created.id}`, { cookie })).json.workflow;
    return approveWorkflow(cookie, fresh, ceiling != null ? { credit_ceiling_micros: ceiling } : {});
  }

  async function evidenceCount(tenantId, runId) {
    const r = await db.getPool().query(
      `SELECT COUNT(*)::int AS n FROM orchestrator_research_evidence
        WHERE tenant_id=$1 AND research_run_id=$2`,
      [tenantId, runId]
    );
    return r.rows[0].n;
  }

  async function seedTenantCredits(tenantId) {
    const pool = db.getPool();
    await limits.updateLimits(pool, tenantId, {
      credit_ceiling_micros: 10_000_000,
      requests_per_minute: 60,
      max_concurrent_ai: 10,
      daily_ai_cost_micros: 10_000_000,
      monthly_ai_cost_micros: 50_000_000,
      per_workflow_cost_micros: 10_000_000,
    }, ownerA.id);
  }

  before(async () => {
    await fx.ensureSchemas();
    await ensureTenantSchema();
    await ensureAgentOrchestratorSchema();
    tenantA = await fx.seedTenant('Orch A');
    tenantB = await fx.seedTenant('Orch B');
    ownerA = await fx.seedUser({ tenantId: tenantA.id, owner: true });
    ownerB = await fx.seedUser({ tenantId: tenantB.id, owner: true });
    await ensureResearchLimits(db.getPool(), tenantA.id, { records: 1000, bytes: 104857600 });
    await ensureResearchLimits(db.getPool(), tenantB.id, { records: 1000, bytes: 104857600 });
    app = await bootApp();
    cookieA = (await login(app.baseUrl, ownerA.email, ownerA.password)).cookie;
    cookieB = (await login(app.baseUrl, ownerB.email, ownerB.password)).cookie;
  });

  after(async () => {
    if (app) await app.close();
    const ids = [tenantA && tenantA.id, tenantB && tenantB.id].filter(Boolean);
    if (ids.length && db.hasDb()) {
      await db.getPool().query(`DELETE FROM tenants WHERE id = ANY($1)`, [ids]);
    }
    await fx.cleanup();
  });

  test('preview and put plan do not call connectors or insert evidence', async () => {
    const wf = await createWorkflow(cookieA);
    const before = (await db.getPool().query(
      `SELECT COUNT(*)::int AS n FROM orchestrator_research_evidence WHERE tenant_id=$1`,
      [tenantA.id]
    )).rows[0].n;
    const preview = await research('POST', '/plans/preview', {
      cookie: cookieA,
      body: { requested_platforms: ['meta', 'google'], search_parameters: { query: 'x' } },
    });
    assert.strictEqual(preview.status, 200, preview.text);
    assert.match(preview.json.plan_hash, /^[a-f0-9]{64}$/);
    const put = await putPlan(cookieA, wf.id);
    assert.match(put.plan_hash, /^[a-f0-9]{64}$/);
    const runs = await db.getPool().query(
      `SELECT id FROM orchestrator_research_runs WHERE tenant_id=$1 AND workflow_id=$2`,
      [tenantA.id, wf.id]
    );
    assert.strictEqual(runs.rowCount, 0);
    const after = (await db.getPool().query(
      `SELECT COUNT(*)::int AS n FROM orchestrator_research_evidence WHERE tenant_id=$1`,
      [tenantA.id]
    )).rows[0].n;
    assert.strictEqual(after, before);
  });

  test('start without approval is approval_required with zero hops', async () => {
    const wf = await createWorkflow(cookieA);
    await putPlan(cookieA, wf.id);
    const runtime = hopRuntime();
    await assert.rejects(
      () => startResearchRun(db.getPool(), {
        tenantId: tenantA.id,
        userId: ownerA.id,
        workflowId: wf.id,
        idempotencyKey: ik('noap'),
        runtime,
      }),
      (err) => err && err.code === 'approval_required'
    );
    assert.strictEqual(runtime.hops.length, 0);
  });

  test('approve then change plan hash makes start approval_stale with zero hops', async () => {
    const wf = await plannedApproved(cookieA);
    await putPlan(cookieA, wf.id, { search_parameters: { query: 'changed', max_pages: 1 } });
    const runtime = hopRuntime();
    await assert.rejects(
      () => startResearchRun(db.getPool(), {
        tenantId: tenantA.id,
        userId: ownerA.id,
        workflowId: wf.id,
        idempotencyKey: ik('stale'),
        runtime,
      }),
      (err) => err && err.code === 'approval_stale'
    );
    assert.strictEqual(runtime.hops.length, 0);
  });

  test('one approved workflow runs meta+google+tiktok to completed', async () => {
    const wf = await plannedApproved(cookieA);
    const runtime = hopRuntime();
    const started = await startResearchRun(db.getPool(), {
      tenantId: tenantA.id,
      userId: ownerA.id,
      workflowId: wf.id,
      idempotencyKey: ik('all3'),
      credentialRefs: {
        meta_research: 'user_integrations',
        google_research: 'user_integrations',
        tiktok_research: 'user_integrations',
      },
      runtime,
    });
    assert.strictEqual(started.run.state, 'completed');
    assert.strictEqual(started.run.continuation_state.outcome, 'completed');
    for (const p of ['meta', 'google', 'tiktok']) {
      assert.strictEqual(started.run.continuation_state.platform_progress[p].state, 'completed', p);
    }
    assert.strictEqual(runtime.hops.length, 3);
  });

  test('google failure still completes others as partially_completed', async () => {
    const wf = await plannedApproved(cookieA);
    const runtime = hopRuntime({ failPlatforms: ['google'] });
    const started = await startResearchRun(db.getPool(), {
      tenantId: tenantA.id,
      userId: ownerA.id,
      workflowId: wf.id,
      idempotencyKey: ik('part'),
      credentialRefs: {
        meta_research: 'user_integrations',
        google_research: 'user_integrations',
        tiktok_research: 'user_integrations',
      },
      runtime,
    });
    assert.strictEqual(started.run.state, 'completed');
    assert.strictEqual(started.run.continuation_state.outcome, 'partially_completed');
    assert.strictEqual(started.run.continuation_state.platform_progress.google.state, 'failed');
    assert.strictEqual(started.run.continuation_state.platform_progress.meta.state, 'completed');
    assert.strictEqual(started.run.continuation_state.platform_progress.tiktok.state, 'completed');
    const googleEv = await db.getPool().query(
      `SELECT id FROM orchestrator_research_evidence
        WHERE tenant_id=$1 AND research_run_id=$2 AND platform='google'`,
      [tenantA.id, started.run.id]
    );
    assert.strictEqual(googleEv.rowCount, 0);
  });

  test('idempotent start does not duplicate evidence or credit reserve', async () => {
    await seedTenantCredits(tenantA.id);
    await credits.grant({
      pool: db.getPool(),
      tenantId: tenantA.id,
      amountMicros: 1_000_000,
      actorUserId: ownerA.id,
      idempotencyKey: ik('grant'),
    });
    const wf = await plannedApproved(cookieA, { ceiling: 1_000_000 });
    const runtime = hopRuntime();
    const key = ik('idemp');
    const first = await startResearchRun(db.getPool(), {
      tenantId: tenantA.id,
      userId: ownerA.id,
      workflowId: wf.id,
      idempotencyKey: key,
      credentialRefs: { meta_research: 'user_integrations', google_research: 'user_integrations', tiktok_research: 'user_integrations' },
      runtime,
    });
    const ev1 = await evidenceCount(tenantA.id, first.run.id);
    const hops1 = runtime.hops.length;
    const replay = await startResearchRun(db.getPool(), {
      tenantId: tenantA.id,
      userId: ownerA.id,
      workflowId: wf.id,
      idempotencyKey: key,
      runtime,
    });
    assert.strictEqual(replay.replay, true);
    assert.strictEqual(replay.run.id, first.run.id);
    assert.strictEqual(runtime.hops.length, hops1);
    assert.strictEqual(await evidenceCount(tenantA.id, first.run.id), ev1);
    const reserves = await db.getPool().query(
      `SELECT id FROM orchestrator_credit_reservations
        WHERE tenant_id=$1 AND idempotency_key=$2`,
      [tenantA.id, `research:${key}:reserve`]
    );
    assert.strictEqual(reserves.rowCount, 1);
  });

  test('continue resumes from stored cursor and skips completed pages', async () => {
    const wf = await plannedApproved(cookieA, {
      plan: { requested_platforms: ['meta'], search_parameters: { query: 'ads', max_pages: 2 } },
    });
    const runtime = hopRuntime({ pagesPerPlatform: 2 });
    const created = await startResearchRun(db.getPool(), {
      tenantId: tenantA.id,
      userId: ownerA.id,
      workflowId: wf.id,
      idempotencyKey: ik('resume'),
      credentialRefs: { meta_research: 'user_integrations' },
      execute: false,
    });
    const lease = await acquireLease(db.getPool(), tenantA.id, wf.id, { actorUserId: ownerA.id });
    try {
      await executeResearchRun(db.getPool(), {
        tenantId: tenantA.id,
        runId: created.run.id,
        userId: ownerA.id,
        holder: lease.holder,
        runtime,
        credentialRefs: { meta_research: 'user_integrations' },
        betweenPages: async () => {
          throw Object.assign(new Error('pause'), { code: 'pause' });
        },
      });
      assert.fail('expected pause');
    } catch (err) {
      if (!err || err.code !== 'pause') throw err;
    } finally {
      await releaseLease(db.getPool(), tenantA.id, wf.id, lease.holder);
    }
    assert.strictEqual(runtime.hops.length, 1);
    assert.strictEqual(runtime.hops[0].cursor, null);
    const resumed = await continueResearchRun(db.getPool(), {
      tenantId: tenantA.id,
      userId: ownerA.id,
      runId: created.run.id,
      runtime,
      credentialRefs: { meta_research: 'user_integrations' },
    });
    assert.strictEqual(resumed.run.state, 'completed');
    assert.ok(runtime.hops.length >= 2);
    assert.strictEqual(runtime.hops[1].cursor, 'meta_research:p1');
    assert.strictEqual(runtime.hops.filter((h) => h.connector === 'meta_research' && h.cursor == null).length, 1);
  });

  test('lost lease cannot persist later pages', async () => {
    const wf = await plannedApproved(cookieA, { plan: { requested_platforms: ['google'] } });
    const runtime = hopRuntime();
    const created = await startResearchRun(db.getPool(), {
      tenantId: tenantA.id,
      userId: ownerA.id,
      workflowId: wf.id,
      idempotencyKey: ik('lease'),
      credentialRefs: { google_research: 'user_integrations' },
      execute: false,
    });
    const lost = await executeResearchRun(db.getPool(), {
      tenantId: tenantA.id,
      runId: created.run.id,
      userId: ownerA.id,
      holder: 'not-the-holder',
      runtime,
      credentialRefs: { google_research: 'user_integrations' },
    });
    assert.notStrictEqual(lost.state, 'completed');
    assert.strictEqual(runtime.hops.length, 0);
    assert.strictEqual(await evidenceCount(tenantA.id, created.run.id), 0);
  });

  test('cancel stops later platforms', async () => {
    const wf = await plannedApproved(cookieA);
    const runtime = hopRuntime({ pagesPerPlatform: 2 });
    const created = await startResearchRun(db.getPool(), {
      tenantId: tenantA.id,
      userId: ownerA.id,
      workflowId: wf.id,
      idempotencyKey: ik('cx'),
      credentialRefs: {
        meta_research: 'user_integrations',
        google_research: 'user_integrations',
        tiktok_research: 'user_integrations',
      },
      execute: false,
    });
    const lease = await acquireLease(db.getPool(), tenantA.id, wf.id, { actorUserId: ownerA.id });
    try {
      await executeResearchRun(db.getPool(), {
        tenantId: tenantA.id,
        runId: created.run.id,
        userId: ownerA.id,
        holder: lease.holder,
        runtime,
        credentialRefs: {
          meta_research: 'user_integrations',
          google_research: 'user_integrations',
          tiktok_research: 'user_integrations',
        },
        betweenPages: async () => {
          await cancelResearchRun(db.getPool(), tenantA.id, created.run.id);
        },
      });
    } finally {
      try { await releaseLease(db.getPool(), tenantA.id, wf.id, lease.holder); } catch (_) { /* ignore */ }
    }
    const connectors = new Set(runtime.hops.map((h) => h.connector));
    assert.ok(!connectors.has('google_research') || runtime.hops[0].connector === 'google_research');
    assert.ok(runtime.hops.length <= 2);
    const later = runtime.hops.filter((h) => h.connector !== runtime.hops[0].connector);
    assert.strictEqual(later.length, 0);
  });

  test('tenant B cannot GET, continue, or cancel tenant A run', async () => {
    const wf = await plannedApproved(cookieA, { plan: { requested_platforms: ['meta'] } });
    const started = await research('POST', '/runs', {
      cookie: cookieA,
      body: {
        workflow_id: wf.id,
        idempotency_key: ik('iso'),
        credential_refs: { meta_research: 'user_integrations' },
      },
    });
    assert.ok(started.json && started.json.ok, started.text);
    const id = started.json.run.id;
    const readB = await research('GET', `/runs/${id}`, { cookie: cookieB });
    assert.strictEqual(readB.status, 404);
    const contB = await research('POST', `/runs/${id}/continue`, { cookie: cookieB, body: {} });
    assert.strictEqual(contB.status, 404);
    const cancelB = await research('POST', `/runs/${id}/cancel`, { cookie: cookieB });
    assert.strictEqual(cancelB.status, 404);
  });

  test('positive ceiling and zero balance is a credit error with zero hops', async () => {
    await seedTenantCredits(tenantA.id);
    await db.getPool().query(
      `UPDATE orchestrator_credit_accounts
          SET available_micros=0, reserved_micros=0
        WHERE tenant_id=$1`,
      [tenantA.id]
    );
    const wf = await plannedApproved(cookieA, { ceiling: 1_000_000 });
    const runtime = hopRuntime();
    await assert.rejects(
      () => startResearchRun(db.getPool(), {
        tenantId: tenantA.id,
        userId: ownerA.id,
        workflowId: wf.id,
        idempotencyKey: ik('nocred'),
        runtime,
        requireCredits: true,
      }),
      (err) => err && (err.code === 'insufficient_credits' || err.code === 'credit_ceiling_exceeded')
    );
    assert.strictEqual(runtime.hops.length, 0);
  });

  test('fake token in page error is redacted and continuation has no Authorization', async () => {
    const wf = await plannedApproved(cookieA, { plan: { requested_platforms: ['meta'] } });
    const runtime = hopRuntime({ tokenError: 'meta_research' });
    const started = await startResearchRun(db.getPool(), {
      tenantId: tenantA.id,
      userId: ownerA.id,
      workflowId: wf.id,
      idempotencyKey: ik('tok'),
      credentialRefs: { meta_research: 'user_integrations' },
      runtime,
    });
    const text = JSON.stringify(started.run);
    assert.doesNotMatch(text, /sk-fake-token|Authorization|Bearer /i);
    assert.ok(started.run.error_message === 'redacted' || !/Bearer|sk-fake/.test(String(started.run.error_message || '')));
  });

  test('fixture honesty_class remains fixture', async () => {
    const wf = await plannedApproved(cookieA, { plan: { requested_platforms: ['tiktok'] } });
    const runtime = hopRuntime();
    const started = await startResearchRun(db.getPool(), {
      tenantId: tenantA.id,
      userId: ownerA.id,
      workflowId: wf.id,
      idempotencyKey: ik('hon'),
      credentialRefs: { tiktok_research: 'user_integrations' },
      runtime,
    });
    assert.strictEqual(started.run.continuation_state.honesty_class, 'fixture');
    assert.strictEqual(started.run.continuation_state.platform_progress.tiktok.honesty_class, 'fixture');
    assert.notStrictEqual(started.run.continuation_state.honesty_class, 'live');
  });
}
