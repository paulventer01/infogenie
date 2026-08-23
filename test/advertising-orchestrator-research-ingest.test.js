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
const { createResearchRuntime } = require('../services/agent_orchestrator/research_runtime');
const {
  startResearchRun, cancelResearchRun, getResearchRun, executeResearchRun, persistPage,
} = require('../services/agent_orchestrator/research_ingest');
const { acquireLease, releaseLease } = require('../services/agent_orchestrator/leases');
const googleFixture = require('../services/agent_orchestrator/fixtures/research/google.v1.json');

const HAS_DB = hasDb();

function ik(tag) {
  return `ik-${tag}-${crypto.randomBytes(6).toString('hex')}`;
}

if (!HAS_DB) {
  test('advertising-orchestrator research ingest skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
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

  async function approvedWorkflow(cookie, over) {
    const created = await orch('POST', '', {
      cookie,
      body: {
        name: 'Research run host',
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
    let wf = created.json.workflow;
    const reqd = await orch('POST', `/${wf.id}/request-approval`, {
      cookie, body: { gate: 'research_execution' }, headers: { 'Idempotency-Key': ik('ra') },
    });
    wf = reqd.json.workflow;
    const appr = await orch('POST', `/${wf.id}/approve`, {
      cookie,
      body: {
        gate: 'research_execution',
        object_type: 'workflow',
        object_id: wf.id,
        object_version: wf.version,
        platforms: wf.selected_platforms,
        advertising_budget: wf.advertising_budget,
        credit_ceiling: 0,
        comment: 'ok',
      },
      headers: { 'Idempotency-Key': ik('ap') },
    });
    assert.strictEqual(appr.status, 200, appr.text);
    return appr.json.workflow;
  }

  before(async () => {
    await fx.ensureSchemas();
    await ensureTenantSchema();
    await ensureAgentOrchestratorSchema();
    tenantA = await fx.seedTenant('Research A');
    tenantB = await fx.seedTenant('Research B');
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

  test('tenant A cannot start, read or cancel tenant B research runs', async () => {
    const wfB = await approvedWorkflow(cookieB);
    const started = await research('POST', '/runs', {
      cookie: cookieB,
      body: {
        workflow_id: wfB.id,
        idempotency_key: ik('b1'),
        requested_platforms: ['google'],
        credential_refs: { google_research: 'user_integrations' },
      },
    });
    assert.ok(started.status === 200 || started.status === 201, started.text);
    const id = started.json.run.id;
    const readA = await research('GET', `/runs/${id}`, { cookie: cookieA });
    assert.strictEqual(readA.status, 404);
    const cancelA = await research('POST', `/runs/${id}/cancel`, { cookie: cookieA });
    assert.strictEqual(cancelA.status, 404);
    const steal = await research('POST', '/runs', {
      cookie: cookieA,
      body: {
        workflow_id: wfB.id,
        idempotency_key: ik('steal'),
        credential_refs: { google_research: 'user_integrations' },
      },
    });
    assert.strictEqual(steal.status, 404);
    const readB = await research('GET', `/runs/${id}`, { cookie: cookieB });
    assert.strictEqual(readB.json.ok, true);
    assert.strictEqual(readB.json.run.tenant_id, tenantB.id);
  });

  test('start persists validated google fixture evidence and is idempotent', async () => {
    const wf = await approvedWorkflow(cookieA);
    const key = ik('idemp');
    const first = await research('POST', '/runs', {
      cookie: cookieA,
      body: {
        workflow_id: wf.id,
        idempotency_key: key,
        requested_platforms: ['google'],
        credential_refs: { google_research: 'user_integrations' },
      },
    });
    assert.ok(first.json.ok, first.text);
    assert.strictEqual(first.json.run.state, 'completed');
    const replay = await research('POST', '/runs', {
      cookie: cookieA,
      body: {
        workflow_id: wf.id,
        idempotency_key: key,
        requested_platforms: ['google'],
        credential_refs: { google_research: 'user_integrations' },
      },
    });
    assert.strictEqual(replay.json.run.id, first.json.run.id);
    const rows = await db.getPool().query(
      `SELECT id, provider_metrics, metrics_kind FROM orchestrator_research_evidence
        WHERE tenant_id=$1 AND research_run_id=$2`,
      [tenantA.id, first.json.run.id]
    );
    assert.ok(rows.rowCount >= 1);
    for (const row of rows.rows) {
      assert.strictEqual(row.provider_metrics.source, 'fixture');
      assert.strictEqual(row.provider_metrics._fabricated, true);
      assert.strictEqual(row.provider_metrics._estimated, true);
      assert.strictEqual(row.metrics_kind, 'estimated');
      assert.notStrictEqual(row.metrics_kind, 'provider_reported');
    }
    const dup = await db.getPool().query(
      `SELECT COUNT(*)::int AS n FROM orchestrator_research_evidence
        WHERE tenant_id=$1 AND research_run_id=$2`,
      [tenantA.id, first.json.run.id]
    );
    const again = await startResearchRun(db.getPool(), {
      tenantId: tenantA.id,
      userId: ownerA.id,
      workflowId: wf.id,
      requestedPlatforms: ['google'],
      idempotencyKey: key,
      credentialRefs: { google_research: 'user_integrations' },
      execute: true,
    });
    assert.strictEqual(again.replay, true);
    const after = await db.getPool().query(
      `SELECT COUNT(*)::int AS n FROM orchestrator_research_evidence
        WHERE tenant_id=$1 AND research_run_id=$2`,
      [tenantA.id, first.json.run.id]
    );
    assert.strictEqual(after.rows[0].n, dup.rows[0].n);
  });

  test('missing credentials and unsupported capabilities fail closed without evidence', async () => {
    const wf = await approvedWorkflow(cookieA);
    const hops = [];
    const runtime = createResearchRuntime({
      mode: 'fixture',
      transport: async (opts) => { hops.push(opts.url); return { ok: true, status: 200 }; },
    });
    const missing = await startResearchRun(db.getPool(), {
      tenantId: tenantA.id,
      userId: ownerA.id,
      workflowId: wf.id,
      requestedPlatforms: ['meta'],
      idempotencyKey: ik('miss'),
      credentialRefs: {},
      runtime,
    });
    assert.strictEqual(missing.run.state, 'failed');
    assert.strictEqual(missing.run.error_code, 'missing_credentials');
    assert.strictEqual(hops.length, 0);

    const denied = await startResearchRun(db.getPool(), {
      tenantId: tenantA.id,
      userId: ownerA.id,
      workflowId: wf.id,
      requestedPlatforms: ['meta'],
      idempotencyKey: ik('cap'),
      credentialRefs: { meta_research: 'user_integrations' },
      operations: { meta_research: 'competitor_account_access' },
      runtime,
    });
    assert.strictEqual(denied.run.state, 'failed');
    assert.strictEqual(denied.run.error_code, 'capability_not_supported');
    assert.strictEqual(hops.length, 0);
  });

  test('cancellation and lost leases prevent later stale writes', async () => {
    const wf = await approvedWorkflow(cookieA);
    const created = await startResearchRun(db.getPool(), {
      tenantId: tenantA.id,
      userId: ownerA.id,
      workflowId: wf.id,
      requestedPlatforms: ['meta'],
      idempotencyKey: ik('hold'),
      credentialRefs: { meta_research: 'user_integrations' },
      execute: false,
    });
    const runId = created.run.id;
    await db.getPool().query(
      `UPDATE orchestrator_research_runs SET state='running', started_at=now()
        WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, runId]
    );
    const cancelled = await cancelResearchRun(db.getPool(), tenantA.id, runId);
    assert.strictEqual(cancelled.state, 'cancelled');
    const lease = await acquireLease(db.getPool(), tenantA.id, wf.id, { actorUserId: ownerA.id });
    const afterCancel = await executeResearchRun(db.getPool(), {
      tenantId: tenantA.id,
      runId,
      userId: ownerA.id,
      holder: lease.holder,
      credentialRefs: { meta_research: 'user_integrations' },
    });
    assert.strictEqual(afterCancel.state, 'cancelled');
    const ev = await db.getPool().query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND research_run_id=$2`,
      [tenantA.id, runId]
    );
    assert.strictEqual(ev.rowCount, 0);
    await releaseLease(db.getPool(), tenantA.id, wf.id, lease.holder);

    const held = await startResearchRun(db.getPool(), {
      tenantId: tenantA.id,
      userId: ownerA.id,
      workflowId: wf.id,
      requestedPlatforms: ['google'],
      idempotencyKey: ik('lease'),
      credentialRefs: { google_research: 'user_integrations' },
      execute: false,
    });
    await db.getPool().query(
      `UPDATE orchestrator_research_runs SET state='running', started_at=now()
        WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, held.run.id]
    );
    const live = await acquireLease(db.getPool(), tenantA.id, wf.id, { actorUserId: ownerA.id });
    await releaseLease(db.getPool(), tenantA.id, wf.id, live.holder);
    const lost = await executeResearchRun(db.getPool(), {
      tenantId: tenantA.id,
      runId: held.run.id,
      userId: ownerA.id,
      holder: 'not-the-holder',
      credentialRefs: { google_research: 'user_integrations' },
    });
    const persisted = await db.getPool().query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND research_run_id=$2`,
      [tenantA.id, held.run.id]
    );
    assert.strictEqual(persisted.rowCount, 0);
    assert.notStrictEqual(lost.state, 'completed');
  });

  function multiRowGooglePage(tenantId, runId, tag) {
    const src = JSON.parse(JSON.stringify(googleFixture));
    const baseComp = src.competitors[0];
    const baseEv = src.evidence[0];
    const competitors = [1, 2].map((n) => {
      const row = { ...baseComp };
      row.id = `comp-${tag}-${n}`;
      row.tenant_id = tenantId;
      row.research_run_id = runId;
      row.provider_advertiser_id = `ext-google-adv-${tag}-${n}`;
      delete row.dedup_key;
      return row;
    });
    const evidence = [1, 2].map((n) => {
      const row = { ...baseEv };
      row.id = `ev-${tag}-${n}`;
      row.tenant_id = tenantId;
      row.research_run_id = runId;
      row.competitor_id = competitors[n - 1].id;
      row.provider_external_id = `ext-google-creative-${tag}-${n}`;
      row.canonical_source_url = `https://adstransparency.google.com/advertiser/AR-${tag}/${n}`;
      row.headline = `${baseEv.headline} ${tag} ${n}`;
      row.provider_metrics = {
        ...baseEv.provider_metrics,
        source: 'fixture',
        _fabricated: true,
        _estimated: true,
      };
      row.metrics_kind = 'estimated';
      delete row.dedup_key;
      delete row.content_fingerprint;
      return row;
    });
    return {
      ...src,
      competitors,
      evidence,
      continuation_state: { honesty_class: 'fixture', ...(src.continuation_state || {}) },
    };
  }

  async function runningResearchWithLease(tag) {
    const wf = await approvedWorkflow(cookieA);
    const created = await startResearchRun(db.getPool(), {
      tenantId: tenantA.id,
      userId: ownerA.id,
      workflowId: wf.id,
      requestedPlatforms: ['google'],
      idempotencyKey: ik(tag),
      credentialRefs: { google_research: 'user_integrations' },
      execute: false,
    });
    await db.getPool().query(
      `UPDATE orchestrator_research_runs SET state='running', started_at=now()
        WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, created.run.id]
    );
    const lease = await acquireLease(db.getPool(), tenantA.id, wf.id, { actorUserId: ownerA.id });
    return { wf, run: created.run, lease };
  }

  async function countPersisted(runId) {
    const pool = db.getPool();
    const comps = await pool.query(
      `SELECT id FROM orchestrator_research_competitors
        WHERE tenant_id=$1 AND research_run_id=$2 ORDER BY id`,
      [tenantA.id, runId]
    );
    const ev = await pool.query(
      `SELECT id FROM orchestrator_research_evidence
        WHERE tenant_id=$1 AND research_run_id=$2 ORDER BY id`,
      [tenantA.id, runId]
    );
    return { competitors: comps.rows.map((r) => r.id), evidence: ev.rows.map((r) => r.id) };
  }

  test('mid-page cancel or lease loss prevents remaining stale writes', async () => {
    const pool = db.getPool();

    const cancelledHost = await runningResearchWithLease('midc');
    const cancelPage = multiRowGooglePage(tenantA.id, cancelledHost.run.id, 'midc');
    const cancelled = await persistPage(pool, cancelPage, {
      tenantId: tenantA.id,
      runId: cancelledHost.run.id,
      workflowId: cancelledHost.wf.id,
      holder: cancelledHost.lease.holder,
      mode: 'fixture',
      version: cancelledHost.run.approval_object_version,
      approval_object_version: cancelledHost.run.approval_object_version,
      beforeWrite: async ({ records }) => {
        if (records === 1) {
          await cancelResearchRun(pool, tenantA.id, cancelledHost.run.id);
        }
      },
    });
    assert.strictEqual(cancelled.stale, true);
    assert.strictEqual(cancelled.records, 1);
    const afterCancel = await countPersisted(cancelledHost.run.id);
    assert.deepStrictEqual(afterCancel.competitors, [`comp-midc-1`]);
    assert.deepStrictEqual(afterCancel.evidence, []);
    const retryCancel = await persistPage(pool, cancelPage, {
      tenantId: tenantA.id,
      runId: cancelledHost.run.id,
      workflowId: cancelledHost.wf.id,
      holder: cancelledHost.lease.holder,
      mode: 'fixture',
      version: cancelledHost.run.approval_object_version,
      approval_object_version: cancelledHost.run.approval_object_version,
    });
    assert.strictEqual(retryCancel.stale, true);
    assert.strictEqual(retryCancel.records, 0);
    const afterRetry = await countPersisted(cancelledHost.run.id);
    assert.deepStrictEqual(afterRetry.competitors, [`comp-midc-1`]);
    assert.deepStrictEqual(afterRetry.evidence, []);

    const leaseHost = await runningResearchWithLease('midl');
    const leasePage = multiRowGooglePage(tenantA.id, leaseHost.run.id, 'midl');
    const lostLease = await persistPage(pool, leasePage, {
      tenantId: tenantA.id,
      runId: leaseHost.run.id,
      workflowId: leaseHost.wf.id,
      holder: leaseHost.lease.holder,
      mode: 'fixture',
      version: leaseHost.run.approval_object_version,
      approval_object_version: leaseHost.run.approval_object_version,
      beforeWrite: async ({ records }) => {
        if (records === 1) {
          await releaseLease(pool, tenantA.id, leaseHost.wf.id, leaseHost.lease.holder);
        }
      },
    });
    assert.strictEqual(lostLease.stale, true);
    assert.strictEqual(lostLease.records, 1);
    const afterLease = await countPersisted(leaseHost.run.id);
    assert.deepStrictEqual(afterLease.competitors, [`comp-midl-1`]);
    assert.deepStrictEqual(afterLease.evidence, []);

    const expiredHost = await runningResearchWithLease('mide');
    const expiredPage = multiRowGooglePage(tenantA.id, expiredHost.run.id, 'mide');
    const expired = await persistPage(pool, expiredPage, {
      tenantId: tenantA.id,
      runId: expiredHost.run.id,
      workflowId: expiredHost.wf.id,
      holder: expiredHost.lease.holder,
      mode: 'fixture',
      version: expiredHost.run.approval_object_version,
      approval_object_version: expiredHost.run.approval_object_version,
      beforeWrite: async ({ records }) => {
        if (records === 1) {
          await pool.query(
            `UPDATE orchestrator_execution_leases
                SET expires_at=now() - interval '1 second'
              WHERE tenant_id=$1 AND workflow_id=$2 AND holder=$3`,
            [tenantA.id, expiredHost.wf.id, expiredHost.lease.holder]
          );
        }
      },
    });
    assert.strictEqual(expired.stale, true);
    assert.strictEqual(expired.records, 1);
    const afterExpire = await countPersisted(expiredHost.run.id);
    assert.deepStrictEqual(afterExpire.competitors, [`comp-mide-1`]);
    assert.deepStrictEqual(afterExpire.evidence, []);
    await releaseLease(pool, tenantA.id, expiredHost.wf.id, expiredHost.lease.holder);

    const supersededHost = await runningResearchWithLease('mids');
    const supersededPage = multiRowGooglePage(tenantA.id, supersededHost.run.id, 'mids');
    const superseded = await persistPage(pool, supersededPage, {
      tenantId: tenantA.id,
      runId: supersededHost.run.id,
      workflowId: supersededHost.wf.id,
      holder: supersededHost.lease.holder,
      mode: 'fixture',
      version: supersededHost.run.approval_object_version,
      approval_object_version: supersededHost.run.approval_object_version,
      beforeWrite: async ({ records }) => {
        if (records === 1) {
          await pool.query(
            `UPDATE orchestrator_workflows SET version=version+1, current_state='cancelled'
              WHERE tenant_id=$1 AND id=$2`,
            [tenantA.id, supersededHost.wf.id]
          );
        }
      },
    });
    assert.strictEqual(superseded.stale, true);
    assert.strictEqual(superseded.records, 1);
    const afterSupersede = await countPersisted(supersededHost.run.id);
    assert.deepStrictEqual(afterSupersede.competitors, [`comp-mids-1`]);
    assert.deepStrictEqual(afterSupersede.evidence, []);
    await releaseLease(pool, tenantA.id, supersededHost.wf.id, supersededHost.lease.holder);
  });

  test('research status is tenant-scoped and omits secret-like fields', async () => {
    const wf = await approvedWorkflow(cookieA);
    const started = await research('POST', '/runs', {
      cookie: cookieA,
      body: {
        workflow_id: wf.id,
        idempotency_key: ik('obs'),
        requested_platforms: ['tiktok'],
        credential_refs: { tiktok_research: 'user_integrations' },
      },
    });
    assert.ok(started.json.ok, started.text);
    const status = await research('GET', `/runs/${started.json.run.id}`, { cookie: cookieA });
    const text = JSON.stringify(status.json);
    assert.doesNotMatch(text, /fixture-token|access_token|Authorization|Bearer /i);
    assert.ok(['completed', 'failed'].includes(status.json.run.state));
    const other = await getResearchRun(db.getPool(), tenantA.id, started.json.run.id);
    assert.strictEqual(other.tenant_id, tenantA.id);
  });
}
