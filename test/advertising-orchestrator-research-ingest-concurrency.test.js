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
  startResearchRun, cancelResearchRun, executeResearchRun, persistPage,
} = require('../services/agent_orchestrator/research_ingest');
const { acquireLease, releaseLease } = require('../services/agent_orchestrator/leases');
const googleFixture = require('../services/agent_orchestrator/fixtures/research/google.v1.json');

const HAS_DB = hasDb();

function ik(tag) {
  return `ik-${tag}-${crypto.randomBytes(6).toString('hex')}`;
}

function honestySource(metrics) {
  const src = metrics && metrics.source;
  if (src === 'fixture' || src === 'mock' || src === 'synthetic') return src;
  return 'mock';
}

function assertHonestyMetrics(row) {
  assert.ok(
    row.provider_metrics.source === 'mock'
    || row.provider_metrics.source === 'fixture'
    || row.provider_metrics.source === 'synthetic',
    row.provider_metrics.source
  );
  assert.strictEqual(row.provider_metrics._fabricated, true);
  assert.strictEqual(row.provider_metrics._estimated, true);
  assert.strictEqual(row.metrics_kind, 'estimated');
  assert.notStrictEqual(row.metrics_kind, 'provider_reported');
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

if (!HAS_DB) {
  test('advertising-orchestrator research ingest concurrency skipped — no DATABASE_URL', {
    skip: 'no DATABASE_URL',
  }, () => {});
} else {
  const fx = makeFixtures();
  let app;
  let tenantA;
  let tenantB;
  let ownerA;
  let cookieA;

  function orch(method, urlPath, { cookie, body, headers } = {}) {
    return request(app.baseUrl, method, `/api/agent-orchestrator/workflows${urlPath}`, {
      cookie, body, headers,
    });
  }

  async function approvedWorkflow(cookie, over) {
    const created = await orch('POST', '', {
      cookie,
      body: {
        name: 'Research concurrency host',
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
        source: honestySource(baseEv.provider_metrics),
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

  function persistCtx(host, over) {
    return {
      tenantId: tenantA.id,
      runId: host.run.id,
      workflowId: host.wf.id,
      holder: host.lease.holder,
      mode: 'fixture',
      version: host.run.approval_object_version,
      approval_object_version: host.run.approval_object_version,
      ...over,
    };
  }

  function fixtureRuntime(page) {
    return {
      mode: 'fixture',
      fetchPage: async () => JSON.parse(JSON.stringify(page)),
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

  before(async () => {
    await fx.ensureSchemas();
    await ensureTenantSchema();
    await ensureAgentOrchestratorSchema();
    tenantA = await fx.seedTenant('Research Conc A');
    tenantB = await fx.seedTenant('Research Conc B');
    ownerA = await fx.seedUser({ tenantId: tenantA.id, owner: true });
    await ensureResearchLimits(db.getPool(), tenantA.id, { records: 1000, bytes: 104857600 });
    await ensureResearchLimits(db.getPool(), tenantB.id, { records: 1000, bytes: 104857600 });
    app = await bootApp();
    cookieA = (await login(app.baseUrl, ownerA.email, ownerA.password)).cookie;
  });

  after(async () => {
    if (app) await app.close();
    const ids = [tenantA && tenantA.id, tenantB && tenantB.id].filter(Boolean);
    if (ids.length && db.hasDb()) {
      await db.getPool().query(`DELETE FROM tenants WHERE id = ANY($1)`, [ids]);
    }
    await fx.cleanup();
  });

  test('concurrent persistPage races cancel and lease release without later evidence', async () => {
    const pool = db.getPool();

    const cancelHost = await runningResearchWithLease('rcc');
    const cancelPage = multiRowGooglePage(tenantA.id, cancelHost.run.id, 'rcc');
    const afterFirstCancel = deferred();
    const cancelDone = deferred();
    const persistCancel = persistPage(pool, cancelPage, persistCtx(cancelHost, {
      beforeWrite: async ({ records }) => {
        if (records === 1) {
          afterFirstCancel.resolve();
          await cancelDone.promise;
        }
      },
    }));
    const cancelSibling = (async () => {
      await afterFirstCancel.promise;
      const row = await cancelResearchRun(pool, tenantA.id, cancelHost.run.id);
      cancelDone.resolve();
      return row;
    })();
    const [cancelledPersist, cancelledRun] = await Promise.all([persistCancel, cancelSibling]);
    assert.strictEqual(cancelledRun.state, 'cancelled');
    assert.strictEqual(cancelledPersist.stale, true);
    assert.strictEqual(cancelledPersist.records, 1);
    const afterRaceCancel = await countPersisted(cancelHost.run.id);
    assert.deepStrictEqual(afterRaceCancel.competitors, ['comp-rcc-1']);
    assert.deepStrictEqual(afterRaceCancel.evidence, []);

    const leaseHost = await runningResearchWithLease('rcl');
    const leasePage = multiRowGooglePage(tenantA.id, leaseHost.run.id, 'rcl');
    const afterFirstLease = deferred();
    const leaseDropped = deferred();
    const persistLease = persistPage(pool, leasePage, persistCtx(leaseHost, {
      beforeWrite: async ({ records }) => {
        if (records === 3) {
          afterFirstLease.resolve();
          await leaseDropped.promise;
        }
      },
    }));
    const releaseSibling = (async () => {
      await afterFirstLease.promise;
      await releaseLease(pool, tenantA.id, leaseHost.wf.id, leaseHost.lease.holder);
      leaseDropped.resolve();
    })();
    const [lostLeasePersist] = await Promise.all([persistLease, releaseSibling]);
    assert.strictEqual(lostLeasePersist.stale, true);
    assert.strictEqual(lostLeasePersist.records, 3);
    const afterRaceLease = await countPersisted(leaseHost.run.id);
    assert.deepStrictEqual(afterRaceLease.competitors, ['comp-rcl-1', 'comp-rcl-2']);
    assert.deepStrictEqual(afterRaceLease.evidence, ['ev-rcl-1']);
  });

  test('overlapping persistPage executions cannot persist a stale page', async () => {
    const pool = db.getPool();

    const liveHost = await runningResearchWithLease('ovp');
    const livePage = multiRowGooglePage(tenantA.id, liveHost.run.id, 'ovp-live');
    const stalePage = multiRowGooglePage(tenantA.id, liveHost.run.id, 'ovp-stale');
    const [livePersist, stalePersist] = await Promise.all([
      persistPage(pool, livePage, persistCtx(liveHost)),
      persistPage(pool, stalePage, persistCtx(liveHost, { holder: 'stale-not-holder' })),
    ]);
    assert.strictEqual(livePersist.stale, false);
    assert.strictEqual(livePersist.records, 4);
    assert.strictEqual(stalePersist.stale, true);
    assert.strictEqual(stalePersist.records, 0);
    const afterOverlap = await countPersisted(liveHost.run.id);
    assert.deepStrictEqual(afterOverlap.competitors, ['comp-ovp-live-1', 'comp-ovp-live-2']);
    assert.deepStrictEqual(afterOverlap.evidence, ['ev-ovp-live-1', 'ev-ovp-live-2']);
    const honesty = await pool.query(
      `SELECT provider_metrics, metrics_kind FROM orchestrator_research_evidence
        WHERE tenant_id=$1 AND research_run_id=$2`,
      [tenantA.id, liveHost.run.id]
    );
    for (const row of honesty.rows) assertHonestyMetrics(row);
    await releaseLease(pool, tenantA.id, liveHost.wf.id, liveHost.lease.holder);

    const sameHost = await runningResearchWithLease('ovp-id');
    const samePage = multiRowGooglePage(tenantA.id, sameHost.run.id, 'ovp-id');
    const [firstSame, secondSame] = await Promise.all([
      persistPage(pool, samePage, persistCtx(sameHost)),
      persistPage(pool, samePage, persistCtx(sameHost)),
    ]);
    assert.strictEqual(firstSame.stale, false);
    assert.strictEqual(secondSame.stale, false);
    assert.strictEqual(firstSame.records + secondSame.records, 4);
    const afterIdem = await countPersisted(sameHost.run.id);
    assert.deepStrictEqual(afterIdem.competitors, ['comp-ovp-id-1', 'comp-ovp-id-2']);
    assert.deepStrictEqual(afterIdem.evidence, ['ev-ovp-id-1', 'ev-ovp-id-2']);
    await releaseLease(pool, tenantA.id, sameHost.wf.id, sameHost.lease.holder);

    const raceHost = await runningResearchWithLease('ovc');
    const firstPage = multiRowGooglePage(tenantA.id, raceHost.run.id, 'ovc-a');
    const secondPage = multiRowGooglePage(tenantA.id, raceHost.run.id, 'ovc-b');
    const afterFirst = deferred();
    const secondStarted = deferred();
    const firstPersist = persistPage(pool, firstPage, persistCtx(raceHost, {
      beforeWrite: async ({ records }) => {
        if (records === 1) {
          afterFirst.resolve();
          await secondStarted.promise;
        }
      },
    }));
    const overlappingStale = (async () => {
      await afterFirst.promise;
      const cancelled = await cancelResearchRun(pool, tenantA.id, raceHost.run.id);
      const secondPersist = persistPage(pool, secondPage, persistCtx(raceHost));
      secondStarted.resolve();
      const second = await secondPersist;
      return { cancelled, second };
    })();
    const [first, overlap] = await Promise.all([firstPersist, overlappingStale]);
    assert.strictEqual(overlap.cancelled.state, 'cancelled');
    assert.strictEqual(first.stale, true);
    assert.strictEqual(first.records, 1);
    assert.strictEqual(overlap.second.stale, true);
    assert.strictEqual(overlap.second.records, 0);
    const afterStaleSecond = await countPersisted(raceHost.run.id);
    assert.deepStrictEqual(afterStaleSecond.competitors, ['comp-ovc-a-1']);
    assert.deepStrictEqual(afterStaleSecond.evidence, []);
    assert.ok(!afterStaleSecond.competitors.includes('comp-ovc-b-1'));
    assert.ok(!afterStaleSecond.evidence.includes('ev-ovc-b-1'));
  });

  test('overlapping executeResearchRun stale holder persists no evidence', async () => {
    const pool = db.getPool();
    const host = await runningResearchWithLease('exe');
    const livePage = multiRowGooglePage(tenantA.id, host.run.id, 'exe-live');
    const stalePage = multiRowGooglePage(tenantA.id, host.run.id, 'exe-stale');
    const [liveRun, staleRun] = await Promise.all([
      executeResearchRun(pool, {
        tenantId: tenantA.id,
        runId: host.run.id,
        userId: ownerA.id,
        holder: host.lease.holder,
        runtime: fixtureRuntime(livePage),
        credentialRefs: { google_research: 'user_integrations' },
      }),
      executeResearchRun(pool, {
        tenantId: tenantA.id,
        runId: host.run.id,
        userId: ownerA.id,
        holder: 'stale-not-holder',
        runtime: fixtureRuntime(stalePage),
        credentialRefs: { google_research: 'user_integrations' },
      }),
    ]);
    assert.ok(liveRun && liveRun.id === host.run.id);
    assert.ok(staleRun && staleRun.id === host.run.id);
    assert.ok(['running', 'completed'].includes(liveRun.state), liveRun.state);
    const afterExec = await countPersisted(host.run.id);
    assert.deepStrictEqual(afterExec.competitors, ['comp-exe-live-1', 'comp-exe-live-2']);
    assert.deepStrictEqual(afterExec.evidence, ['ev-exe-live-1', 'ev-exe-live-2']);
    const staleRows = await pool.query(
      `SELECT id FROM orchestrator_research_evidence
        WHERE tenant_id=$1 AND research_run_id=$2 AND id LIKE $3`,
      [tenantA.id, host.run.id, 'ev-exe-stale-%']
    );
    assert.strictEqual(staleRows.rowCount, 0);
    const otherTenant = await pool.query(
      `SELECT id FROM orchestrator_research_evidence
        WHERE tenant_id=$1 AND research_run_id=$2`,
      [tenantB.id, host.run.id]
    );
    assert.strictEqual(otherTenant.rowCount, 0);
    await releaseLease(pool, tenantA.id, host.wf.id, host.lease.holder);
  });
}
