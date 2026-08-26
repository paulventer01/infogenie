'use strict';

process.env.PERMISSION_ENFORCEMENT = 'on';
process.env.MULTITENANT_ENFORCEMENT = 'on';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/infogenie';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.INFOGENIE_API_KEY = process.env.INFOGENIE_API_KEY || '<set-via-environment>';

require('./helpers/env');

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const dnsPromises = require('node:dns').promises;

const { bootApp, request, login, makeFixtures, hasDb } = require('./helpers');
const db = require('../db');
const { ensureTenantSchema } = require('../services/tenants/schema');
const { ensureAgentOrchestratorSchema } = require('../services/agent_orchestrator/schema');
const { CONFIRM_PHRASE } = require('../services/agent_orchestrator/campaign_publish_requests');
const { sha256Hex } = require('../services/agent_orchestrator/hash');
const { approvalContentHash } = require('../services/agent_orchestrator/creative_validate');
const D = require('../services/agent_orchestrator/campaign_delivery_contracts');
const { publicOutbox, publicIntent } = require('../services/agent_orchestrator/campaign_delivery_intents');
const { simulateDelivery } = require('../services/agent_orchestrator/campaign_delivery_fake_connector');
const attempts = require('../services/agent_orchestrator/campaign_delivery_attempts');
const sandboxOutcomes = require('../services/agent_orchestrator/campaign_delivery_sandbox_outcomes');
const worker = require('../services/agent_orchestrator/campaign_delivery_worker');
const runtimeFlags = require('../services/runtime_flags');
const vault = require('../services/credentials/vault');
const campaignValidate = require('../services/agent_orchestrator/campaign_validate');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');

const HAS_DB = hasDb();
const ROOT = path.join(__dirname, '..');
const SRC_WORKER = fs.readFileSync(path.join(ROOT, 'services/agent_orchestrator/campaign_delivery_worker.js'), 'utf8');
const ik = (t) => `ik-${t}-${crypto.randomBytes(6).toString('hex')}`;
const HEX = () => crypto.randomBytes(32).toString('hex');

const _origDnsLookup = dnsPromises.lookup;
function installCampaignDraftDnsStub() {
  dnsPromises.lookup = async (hostname, options) => {
    if (String(hostname).toLowerCase().replace(/\.$/, '') !== 'example.com') {
      throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
    }
    const recs = [{ address: '93.184.216.34', family: 4 }];
    if (options && options.all) return recs;
    return recs[0];
  };
}
function restoreCampaignDraftDnsStub() {
  dnsPromises.lookup = _origDnsLookup;
}
installCampaignDraftDnsStub();
after(() => { restoreCampaignDraftDnsStub(); });

function validContract(wfId, art, extra = {}) {
  return {
    contract_version: 'campaign_draft_v1', objective: 'traffic', platforms: ['meta'],
    accounts: [{ platform: 'meta', credential_ref: 'user_integrations' }],
    destination: { landing_page_url: 'https://example.com/p' },
    budget: { amount_micros: 1000000, currency: 'USD' },
    schedule: { start_at: new Date(Date.now() + 864e5).toISOString() },
    geo: { countries: ['US'] }, audience: { name: 'SMB' },
    creatives: [{ kind: 'creative_brief', asset_id: art.assetId, version: art.version, content_hash: art.contentHash }],
    tracking: { utm_source: 'ig', utm_medium: 'cpc', utm_campaign: 'spring' },
    provenance: { workflow_id: wfId }, ...extra,
  };
}

function daysAhead(ts, from) {
  return (new Date(ts).getTime() - new Date(from).getTime()) / 86400000;
}

test('enforcement flags stay on', () => {
  assert.equal(process.env.PERMISSION_ENFORCEMENT, 'on');
  assert.equal(process.env.MULTITENANT_ENFORCEMENT, 'on');
});

test('worker source never completes or fails the outbox and never names the retired flag', () => {
  assert.doesNotMatch(SRC_WORKER, /outbox\.complete\s*\(/);
  assert.doesNotMatch(SRC_WORKER, /outbox\.fail\s*\(/);
  assert.doesNotMatch(SRC_WORKER, /ORCHESTRATOR_DELIVERY_WORKER/);
  assert.match(SRC_WORKER, /D\.FLAG_ENV/);
  assert.match(SRC_WORKER, /startCampaignDeliveryWorker\(\)/);
  assert.match(SRC_WORKER, /backgroundEnabled\(\)/);
  assert.doesNotMatch(SRC_WORKER, /checkCredentials\s*\(/);
  assert.doesNotMatch(SRC_WORKER, /getCredentials\s*\(/);
  assert.doesNotMatch(SRC_WORKER, /hasCredentials\s*\(/);
  assert.doesNotMatch(SRC_WORKER, /require\('\.\.\/credentials\/vault'\)/);
});

test('flag matrix: timer starts only when background and env are both gated', () => {
  const orig = process.env.INFOGENIE_CAMPAIGN_DELIVERY_WORKER;
  try {
    worker.stopCampaignDeliveryWorker();
    runtimeFlags.setBackground(false);
    delete process.env.INFOGENIE_CAMPAIGN_DELIVERY_WORKER;
    assert.equal(worker.startCampaignDeliveryWorker(), null);

    runtimeFlags.setBackground(true);
    assert.equal(worker.startCampaignDeliveryWorker(), null);

    runtimeFlags.setBackground(false);
    process.env.INFOGENIE_CAMPAIGN_DELIVERY_WORKER = '1';
    assert.equal(worker.startCampaignDeliveryWorker(), null);

    runtimeFlags.setBackground(true);
    process.env.INFOGENIE_CAMPAIGN_DELIVERY_WORKER = 'true';
    assert.equal(worker.startCampaignDeliveryWorker(), null);

    process.env.INFOGENIE_CAMPAIGN_DELIVERY_WORKER = '0';
    assert.equal(worker.startCampaignDeliveryWorker(), null);

    process.env.INFOGENIE_CAMPAIGN_DELIVERY_WORKER = 'yes';
    assert.equal(worker.startCampaignDeliveryWorker(), null);

    process.env.INFOGENIE_CAMPAIGN_DELIVERY_WORKER = '1';
    runtimeFlags.setBackground(true);
    const t1 = worker.startCampaignDeliveryWorker();
    assert.ok(t1);
    const t2 = worker.startCampaignDeliveryWorker();
    assert.strictEqual(t2, t1, 'start is idempotent — one interval handle');
    worker.stopCampaignDeliveryWorker();
    const t3 = worker.startCampaignDeliveryWorker();
    assert.ok(t3);
    assert.notStrictEqual(t3, t1, 'stop then start yields a new interval');
    worker.stopCampaignDeliveryWorker();
  } finally {
    worker.stopCampaignDeliveryWorker();
    if (orig === undefined) delete process.env.INFOGENIE_CAMPAIGN_DELIVERY_WORKER;
    else process.env.INFOGENIE_CAMPAIGN_DELIVERY_WORKER = orig;
    runtimeFlags.setBackground(false);
  }
});

if (!HAS_DB) {
  test('advertising-orchestrator campaign-delivery-worker skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else {
  describe('campaign delivery worker db', { concurrency: 1 }, () => {
  const fx = makeFixtures();
  let app, tenantA, tenantB, ownerA, ownerB, cookieA, cookieB, artA, wfA, wfB, seq = 0;
  const nid = (p) => { seq += 1; return `${p}-${seq}-${crypto.randomBytes(3).toString('hex')}`; };
  const p = () => db.getPool();
  const api = (method, path, opts) => request(app.baseUrl, method, `/api/agent-orchestrator/campaign-drafts${path}`, opts);

  async function seedWf(tenantId) {
    const wfId = nid('wf');
    await p().query(`INSERT INTO orchestrator_workflows (id, tenant_id, name) VALUES ($1,$2,'PR6D')`, [wfId, tenantId]);
    return wfId;
  }
  async function seedCreds(userId, platform = 'meta_ads') {
    const z = Buffer.from([0]);
    await p().query(
      `INSERT INTO user_integrations (user_id, platform, ciphertext, iv, tag, status)
       VALUES ($1,$2,$3,$4,$5,'connected') ON CONFLICT (user_id, platform) DO UPDATE SET status='connected'`,
      [userId, platform, z, z, z]
    );
  }
  async function seedBrief(tenantId, userId, wfId) {
    const hex = HEX(); const ev = HEX();
    const artId = nid('art'); const rowId = nid('arow'); const runId = nid('run');
    const apprR = (await p().query(
      `INSERT INTO orchestrator_approvals (tenant_id, workflow_id, gate, content_hash, decision, object_version, object_type, object_id, approved_platforms)
       VALUES ($1,$2,'research_execution',$3,'approved',1,'workflow',$2,'["meta"]'::jsonb) RETURNING id`,
      [tenantId, wfId, hex]
    )).rows[0];
    await p().query(
      `INSERT INTO orchestrator_research_runs (id, tenant_id, workflow_id, approval_id, approval_object_version, requested_platforms, idempotency_key, state)
       VALUES ($1,$2,$3,$4,1,$5::text[],$6,'completed')`,
      [runId, tenantId, wfId, apprR.id, ['meta'], nid('idemp')]
    );
    await p().query(
      `INSERT INTO orchestrator_creative_artifacts
         (id, tenant_id, artifact_id, kind, workflow_id, research_run_id, version, status, content_hash, evidence_hash, payload, created_by)
       VALUES ($1,$2,$3,'creative_brief',$4,$5,1,'draft',$6,$7,$8::jsonb,$9)`,
      [rowId, tenantId, artId, wfId, runId, hex, ev, JSON.stringify({ format: 'image', objective: 'Traffic' }), userId]
    );
    const hash = approvalContentHash(hex, ev);
    const apprC = (await p().query(
      `INSERT INTO orchestrator_approvals (tenant_id, workflow_id, gate, content_hash, decision, object_version, object_type, object_id, actor_user_id, approved_platforms)
       VALUES ($1,$2,'creative_generation',$3,'approved',1,'creative_artifact',$4,$5,'[]'::jsonb) RETURNING id`,
      [tenantId, wfId, hash, artId, userId]
    )).rows[0];
    await p().query(
      `UPDATE orchestrator_creative_artifacts SET status='approved', approval_id=$3, approval_object_version=1, approved_by=$4, approved_at=now()
        WHERE tenant_id=$1 AND id=$2`,
      [tenantId, rowId, apprC.id, userId]
    );
    return { assetId: artId, rowId, version: 1, contentHash: hex };
  }

  function createBody(wfId, art, extra = {}) {
    return { workflow_id: wfId, idempotency_key: extra.idempotency_key || ik('c'), contract: validContract(wfId, art, extra.contract), ...extra.body };
  }
  async function createOk(cookie, wfId, art, extra = {}) {
    const res = await api('POST', '', { cookie, body: createBody(wfId, art, extra) });
    assert.equal(res.status, 201, res.text);
    return res.json.draft;
  }
  async function validateOk(cookie, id) {
    const res = await api('POST', `/${id}/validate`, { cookie, body: {} });
    assert.equal(res.status, 200, res.text);
    return res.json.draft;
  }
  function approveBody(draft, extra = {}) {
    const c = draft.contract;
    return {
      revision: draft.current_revision, contract_hash: draft.contract_hash, platforms: c.platforms,
      accounts: c.accounts.map((a) => a.credential_ref),
      creatives: c.creatives.map((x) => ({ asset_id: x.asset_id, version: x.version })),
      budget: { amount_micros: c.budget.amount_micros, currency: c.budget.currency },
      schedule: c.schedule, targeting: { geo: c.geo }, landing_page_url: c.destination.landing_page_url,
      idempotency_key: extra.idempotency_key || ik('ap'), ...extra,
    };
  }
  async function approveOk(cookie, draft) {
    const res = await api('POST', `/${draft.id}/approve`, { cookie, body: approveBody(draft) });
    assert.equal(res.status, 200, res.text);
    return { draft: res.json.draft, approval: res.json.approval };
  }
  async function readyApproved(cookie, wfId, art) {
    const created = await createOk(cookie, wfId, art);
    const ready = await validateOk(cookie, created.id);
    return approveOk(cookie, ready);
  }
  function publishingBody(draft, approval, extra = {}) {
    return {
      confirmation: CONFIRM_PHRASE,
      approval_id: approval.id,
      revision: draft.current_revision,
      contract_hash: draft.contract_hash,
      snapshot_hash: sha256Hex(approval.snapshot),
      idempotency_key: extra.idempotency_key || ik('pr'),
      ...extra,
    };
  }
  async function requestPublishing(cookie, draft, approval, extra = {}) {
    return api('POST', `/${draft.id}/publishing-requests`, {
      cookie, body: publishingBody(draft, approval, extra),
    });
  }
  async function readyRequested(cookie, wfId, art) {
    const live = await readyApproved(cookie, wfId, art);
    const pub = await requestPublishing(cookie, live.draft, live.approval);
    assert.equal(pub.status, 200, pub.text);
    return { ...live, request: pub.json.request };
  }
  async function readyIntent(cookie, wfId, art) {
    const live = await readyRequested(cookie, wfId, art);
    const res = await api('POST', `/${live.draft.id}/publishing-requests/${live.request.id}/delivery-intents`, {
      cookie,
      body: {
        contract_version: 'campaign_delivery_v1',
        operation: 'create_provider_draft',
        platform: 'meta',
        idempotency_key: ik('di'),
      },
    });
    assert.equal(res.status, 200, res.text);
    return { ...live, intent: res.json.intent, outbox: res.json.outbox };
  }

  async function loadOutbox(tenantId, outboxId) {
    return (await p().query(
      `SELECT * FROM orchestrator_outbox WHERE tenant_id=$1 AND id=$2`,
      [tenantId, outboxId]
    )).rows[0];
  }
  async function loadIntent(tenantId, intentId) {
    return (await p().query(
      `SELECT * FROM orchestrator_campaign_delivery_intents WHERE tenant_id=$1 AND id=$2`,
      [tenantId, intentId]
    )).rows[0];
  }
  async function loadAttempt(tenantId, attemptId) {
    return (await p().query(
      `SELECT * FROM orchestrator_campaign_delivery_attempts WHERE tenant_id=$1 AND id=$2`,
      [tenantId, attemptId]
    )).rows[0];
  }
  async function auditCount(tenantId, outboxId) {
    const r = await p().query(
      `SELECT COUNT(*)::int AS n FROM orchestrator_audit_events
        WHERE tenant_id=$1 AND event=$2 AND detail->>'outbox_id'=$3`,
      [tenantId, D.AUDIT_EVENT_SIMULATED, outboxId]
    );
    return r.rows[0].n;
  }

  before(async () => {
    await fx.ensureSchemas();
    await ensureTenantSchema();
    await ensureAgentOrchestratorSchema();
    tenantA = await fx.seedTenant('PR6D A');
    tenantB = await fx.seedTenant('PR6D B');
    ownerA = await fx.seedUser({ tenantId: tenantA.id, owner: true });
    ownerB = await fx.seedUser({ tenantId: tenantB.id, owner: true });
    await seedCreds(ownerA.id);
    await seedCreds(ownerB.id);
    wfA = await seedWf(tenantA.id);
    wfB = await seedWf(tenantB.id);
    artA = await seedBrief(tenantA.id, ownerA.id, wfA);
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

  test('claim commits before fake execute; no client is held', async () => {
    const live = await readyIntent(cookieA, wfA, artA);
    const pool = p();
    const origFetch = global.fetch;
    global.fetch = async () => { throw new Error('network tripwire'); };
    try {
      const envelope = await worker.claimCampaignDeliveryAttempt({
        pool, tenantId: tenantA.id, outboxId: live.outbox.id, workerId: 'w-claim-1',
        scenario: 'success',
      });
      assert.ok(!envelope.skip, JSON.stringify(envelope));
      assert.equal(envelope.scenario, 'success');
      assert.equal(envelope.outcomeSource, D.OUTCOME_SOURCE_TEST_OPTS);
      const box = await loadOutbox(tenantA.id, live.outbox.id);
      assert.equal(box.state, 'processing');
      assert.equal(box.claimed_by, 'w-claim-1');
      assert.ok(box.claimed_until);
      let executed = false;
      const fake = await worker.executeFake(envelope, {
        simulate: async (args) => {
          const probe = await pool.query('SELECT 1 AS n');
          assert.equal(probe.rows[0].n, 1, 'fake execute uses a fresh pool checkout');
          executed = true;
          return simulateDelivery({ ...args, scenario: 'success' });
        },
      });
      assert.equal(executed, true);
      assert.equal(fake.simulated, true);
      assert.equal(fake.published, false);
      assert.equal(fake.source, D.OUTCOME_SOURCE_TEST_OPTS);
      const settled = await worker.settleCampaignDeliveryAttempt(envelope, fake, { pool });
      assert.equal(settled.fenced_out, false);
      assert.equal(settled.status, 'simulated_ok');
    } finally {
      global.fetch = origFetch;
    }
  });

  test('no outcome source skips without appending an attempt or changing outbox', async () => {
    const live = await readyIntent(cookieA, wfA, artA);
    const pool = p();
    const beforeBox = await loadOutbox(tenantA.id, live.outbox.id);
    const skip = await worker.claimCampaignDeliveryAttempt({
      pool, tenantId: tenantA.id, outboxId: live.outbox.id, workerId: 'w-none',
    });
    assert.equal(skip.skip, true);
    assert.equal(skip.reason, D.SKIP_REASON_NO_OUTCOME);
    const afterBox = await loadOutbox(tenantA.id, live.outbox.id);
    assert.equal(afterBox.state, 'pending');
    assert.equal(String(afterBox.claimed_by), String(beforeBox.claimed_by));
    assert.equal(String(afterBox.next_attempt_at), String(beforeBox.next_attempt_at));
    const listed = await attempts.listAttemptsForOutbox(pool, { tenantId: tenantA.id, outboxId: live.outbox.id });
    assert.equal(listed.length, 0);
    assert.equal(await auditCount(tenantA.id, live.outbox.id), 0);
  });

  test('sandbox outcome seed drives claim→settle and is consumed once', async () => {
    const live = await readyIntent(cookieA, wfA, artA);
    const pool = p();
    await sandboxOutcomes.seedSandboxOutcome(pool, {
      tenantId: tenantA.id, outboxId: live.outbox.id, intentId: live.intent.id, scenario: 'success',
    });
    const settled = await worker.processOne({
      pool, tenantId: tenantA.id, outboxId: live.outbox.id, workerId: 'w-sandbox-1',
    });
    assert.equal(settled.status, 'simulated_ok');
    assert.equal(settled.attempt.simulated, true);
    assert.equal(settled.attempt.published, false);
    assert.equal(settled.attempt.external_action_taken, false);
    assert.equal(settled.attempt.connector, 'fake');
    const box = await loadOutbox(tenantA.id, live.outbox.id);
    assert.equal(box.state, 'pending');
    assert.ok(daysAhead(box.next_attempt_at, new Date()) > 1000);
    const row = (await pool.query(
      `SELECT * FROM orchestrator_campaign_delivery_sandbox_outcomes
        WHERE tenant_id=$1 AND outbox_id=$2`,
      [tenantA.id, live.outbox.id]
    )).rows[0];
    assert.ok(row.consumed_at);
    assert.equal(row.consumed_attempt_id, settled.attempt.id);
    assert.equal(row.source, 'sandbox');
    const later = new Date(Date.now() + D.LEASE_MS + 2000);
    const skip = await worker.claimCampaignDeliveryAttempt({
      pool, tenantId: tenantA.id, outboxId: live.outbox.id, workerId: 'w-sandbox-2', now: later,
    });
    assert.equal(skip.skip, true);
    const listed = await attempts.listAttemptsForOutbox(pool, {
      tenantId: tenantA.id, outboxId: live.outbox.id,
    });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].status, 'simulated_ok');
  });

  test('crash after claim recovers only when a new outcome source exists', async () => {
    const live = await readyIntent(cookieA, wfA, artA);
    const pool = p();
    const first = await worker.claimCampaignDeliveryAttempt({
      pool, tenantId: tenantA.id, outboxId: live.outbox.id, workerId: 'w-crash-1',
      scenario: 'success',
    });
    assert.ok(!first.skip);
    const later = new Date(Date.now() + D.LEASE_MS + 2000);
    const noNew = await worker.claimCampaignDeliveryAttempt({
      pool, tenantId: tenantA.id, outboxId: live.outbox.id, workerId: 'w-crash-2', now: later,
    });
    assert.equal(noNew.skip, true);
    assert.equal(noNew.reason, D.SKIP_REASON_NO_OUTCOME);
    const old = await loadAttempt(tenantA.id, first.attemptId);
    assert.equal(old.status, 'abandoned_lease');
    assert.equal(old.error_code, 'simulated_lease_expired');
    let listed = await attempts.listAttemptsForOutbox(pool, { tenantId: tenantA.id, outboxId: live.outbox.id });
    assert.equal(listed.length, 1);

    await sandboxOutcomes.seedSandboxOutcome(pool, {
      tenantId: tenantA.id, outboxId: live.outbox.id, intentId: live.intent.id, scenario: 'success',
    });
    const second = await worker.claimCampaignDeliveryAttempt({
      pool, tenantId: tenantA.id, outboxId: live.outbox.id, workerId: 'w-crash-3', now: later,
    });
    assert.ok(!second.skip);
    assert.notEqual(second.attemptId, first.attemptId);
    assert.notEqual(second.claimToken, first.claimToken);
    assert.equal(second.attemptNumber, 2);
    assert.equal(second.outcomeSource, D.OUTCOME_SOURCE_SANDBOX);
    listed = await attempts.listAttemptsForOutbox(pool, { tenantId: tenantA.id, outboxId: live.outbox.id });
    assert.equal(listed.length, 2);
    const fake = simulateDelivery({
      scenario: 'success', source: second.outcomeSource, platform: second.platform,
      intentId: second.intentId, outboxId: second.outboxId, attemptId: second.attemptId,
      attemptNumber: second.attemptNumber, generation: second.generation,
    });
    const settled = await worker.settleCampaignDeliveryAttempt(second, fake, { pool, now: later });
    assert.equal(settled.status, 'simulated_ok');
  });

  test('crash after fake before settle is recoverable; stale settle is fenced', async () => {
    const live = await readyIntent(cookieA, wfA, artA);
    const pool = p();
    const first = await worker.claimCampaignDeliveryAttempt({
      pool, tenantId: tenantA.id, outboxId: live.outbox.id, workerId: 'w-stale-1',
      scenario: 'success',
    });
    const fake = await worker.executeFake(first);
    assert.equal(fake.outcome, 'ok');
    const later = new Date(Date.now() + D.LEASE_MS + 2000);
    const second = await worker.claimCampaignDeliveryAttempt({
      pool, tenantId: tenantA.id, outboxId: live.outbox.id, workerId: 'w-stale-2', now: later,
      scenario: 'success',
    });
    assert.notEqual(second.attemptId, first.attemptId);
    const before = await auditCount(tenantA.id, live.outbox.id);
    const stale = await worker.settleCampaignDeliveryAttempt(first, fake, { pool, now: later });
    assert.equal(stale.fenced_out, true);
    const afterFence = await auditCount(tenantA.id, live.outbox.id);
    assert.equal(afterFence, before);
    const old = await loadAttempt(tenantA.id, first.attemptId);
    assert.equal(old.status, 'abandoned_lease');
    const freshFake = await worker.executeFake(second);
    const ok = await worker.settleCampaignDeliveryAttempt(second, freshFake, { pool, now: later });
    assert.equal(ok.fenced_out, false);
    assert.equal(ok.status, 'simulated_ok');
  });

  test('live lease skips without abandoning; two workers claim once', async () => {
    const live = await readyIntent(cookieA, wfA, artA);
    const pool = p();
    const [a, b] = await Promise.all([
      worker.claimCampaignDeliveryAttempt({
        pool, tenantId: tenantA.id, outboxId: live.outbox.id, workerId: 'w-lease-1',
        scenario: 'success',
      }),
      worker.claimCampaignDeliveryAttempt({
        pool, tenantId: tenantA.id, outboxId: live.outbox.id, workerId: 'w-lease-2',
        scenario: 'success',
      }),
    ]);
    const wins = [a, b].filter((x) => x && !x.skip);
    const skips = [a, b].filter((x) => x && x.skip);
    assert.equal(wins.length, 1);
    assert.equal(skips.length, 1);
    const sequential = await worker.claimCampaignDeliveryAttempt({
      pool, tenantId: tenantA.id, outboxId: live.outbox.id, workerId: 'w-lease-3',
      scenario: 'success',
    });
    assert.equal(sequential.skip, true);
    assert.ok(!sequential.reason || sequential.reason === 'leased');
    const listed = await attempts.listAttemptsForOutbox(pool, { tenantId: tenantA.id, outboxId: live.outbox.id });
    assert.equal(listed.length, 1);
    const fake = await worker.executeFake(wins[0]);
    const ok = await worker.settleCampaignDeliveryAttempt(wins[0], fake, { pool });
    assert.equal(ok.status, 'simulated_ok');
  });

  test('fence mismatches independently: claim token, holder, and expired lease', async () => {
    const live = await readyIntent(cookieA, wfA, artA);
    const pool = p();
    const envelope = await worker.claimCampaignDeliveryAttempt({
      pool, tenantId: tenantA.id, outboxId: live.outbox.id, workerId: 'w-fence-1',
      scenario: 'success',
    });
    const fake = await worker.executeFake(envelope);
    const before = await auditCount(tenantA.id, live.outbox.id);

    const wrongToken = await worker.settleCampaignDeliveryAttempt(
      { ...envelope, claimToken: 'x'.repeat(32) }, fake, { pool }
    );
    assert.equal(wrongToken.fenced_out, true);

    const wrongHolder = await worker.settleCampaignDeliveryAttempt(
      { ...envelope, leaseHolder: 'w-other' }, fake, { pool }
    );
    assert.equal(wrongHolder.fenced_out, true);

    const expired = await worker.settleCampaignDeliveryAttempt(
      envelope, fake, { pool, now: new Date(Date.now() + D.LEASE_MS + 5000) }
    );
    assert.equal(expired.fenced_out, true);

    assert.equal(await auditCount(tenantA.id, live.outbox.id), before);
    const still = await loadAttempt(tenantA.id, envelope.attemptId);
    assert.equal(still.status, 'started');
    const box = await loadOutbox(tenantA.id, live.outbox.id);
    assert.equal(box.state, 'processing');

    const ok = await worker.settleCampaignDeliveryAttempt(envelope, fake, { pool });
    assert.equal(ok.fenced_out, false);
    assert.equal(ok.status, 'simulated_ok');
  });

  async function settleWithSpy(live, mutate, scenario = 'success') {
    const pool = p();
    let vaultCalls = 0;
    let credCalls = 0;
    const origHas = vault.hasCredentials;
    const origGet = vault.getCredentials;
    const origCheck = campaignValidate.checkCredentials;
    vault.hasCredentials = async (...args) => { vaultCalls += 1; return origHas.apply(vault, args); };
    vault.getCredentials = async (...args) => { vaultCalls += 1; return origGet.apply(vault, args); };
    campaignValidate.checkCredentials = async (...args) => {
      credCalls += 1;
      return origCheck.apply(campaignValidate, args);
    };
    try {
      if (mutate) await mutate();
      const envelope = await worker.claimCampaignDeliveryAttempt({
        pool, tenantId: tenantA.id, outboxId: live.outbox.id,
        workerId: `w-reval-${crypto.randomBytes(3).toString('hex')}`,
        scenario,
      });
      assert.ok(!envelope.skip, JSON.stringify(envelope));
      const fake = await worker.executeFake(envelope, { scenario });
      const settled = await worker.settleCampaignDeliveryAttempt(envelope, fake, { pool });
      return { settled, vaultCalls, credCalls, envelope };
    } finally {
      vault.hasCredentials = origHas;
      vault.getCredentials = origGet;
      campaignValidate.checkCredentials = origCheck;
    }
  }

  function assertAuthRejected(result, live) {
    assert.equal(result.settled.fenced_out, false);
    assert.equal(result.settled.status, 'authorization_rejected');
    assert.equal(result.settled.retryable, false);
    assert.equal(result.settled.parked, true);
    assert.equal(result.vaultCalls, 0);
    assert.equal(result.credCalls, 0);
    assert.equal(result.settled.attempt.published, false);
    assert.equal(result.settled.attempt.external_action_taken, false);
    assert.equal(result.settled.attempt.simulated, true);
  }

  test('revalidation refuses fake success after revoke, expire, stale hash, wrong actor, inactive member', async () => {
    const revoked = await readyIntent(cookieA, wfA, artA);
    await api('POST', `/${revoked.draft.id}/revoke`, {
      cookie: cookieA, body: { reason: 'Withdraw before simulated delivery' },
    });
    const r1 = await settleWithSpy(revoked);
    assertAuthRejected(r1, revoked);
    let box = await loadOutbox(tenantA.id, revoked.outbox.id);
    assert.equal(box.state, 'pending');
    assert.equal(box.claimed_by, null);
    assert.ok(daysAhead(box.next_attempt_at, new Date()) > 1000);
    publicOutbox(box);
    const intentRow = await loadIntent(tenantA.id, revoked.intent.id);
    assert.equal(intentRow.status, 'pending');
    publicIntent(intentRow);

    const exp = await readyIntent(cookieA, wfA, artA);
    await p().query(`ALTER TABLE orchestrator_campaign_drafts DISABLE TRIGGER orchestrator_campaign_drafts_immutable`);
    try {
      await p().query(
        `UPDATE orchestrator_campaign_drafts SET approval_expires_at=now() - interval '1 hour' WHERE tenant_id=$1 AND id=$2`,
        [tenantA.id, exp.draft.id]
      );
    } finally {
      await p().query(`ALTER TABLE orchestrator_campaign_drafts ENABLE TRIGGER orchestrator_campaign_drafts_immutable`);
    }
    const r2 = await settleWithSpy(exp);
    assertAuthRejected(r2, exp);

    const stale = await readyIntent(cookieA, wfA, artA);
    const orig = (await p().query(
      `SELECT snapshot_json FROM orchestrator_campaign_publish_approvals WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, stale.approval.id]
    )).rows[0].snapshot_json;
    const snap = JSON.parse(JSON.stringify(orig));
    snap.objective = 'sales';
    await p().query(`ALTER TABLE orchestrator_campaign_publish_approvals DISABLE TRIGGER orchestrator_campaign_publish_approvals_immutable`);
    try {
      await p().query(
        `UPDATE orchestrator_campaign_publish_approvals SET snapshot_json=$3::jsonb WHERE tenant_id=$1 AND id=$2`,
        [tenantA.id, stale.approval.id, JSON.stringify(snap)]
      );
      const r3 = await settleWithSpy(stale);
      assertAuthRejected(r3, stale);
    } finally {
      await p().query(
        `UPDATE orchestrator_campaign_publish_approvals SET snapshot_json=$3::jsonb WHERE tenant_id=$1 AND id=$2`,
        [tenantA.id, stale.approval.id, JSON.stringify(orig)]
      );
      await p().query(`ALTER TABLE orchestrator_campaign_publish_approvals ENABLE TRIGGER orchestrator_campaign_publish_approvals_immutable`);
    }

    const actor = await readyIntent(cookieA, wfA, artA);
    const actorOrig = (await p().query(
      `SELECT snapshot_json FROM orchestrator_campaign_publish_approvals WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, actor.approval.id]
    )).rows[0].snapshot_json;
    const actorSnap = JSON.parse(JSON.stringify(actorOrig));
    actorSnap.actor_user_id = ownerB.id;
    await p().query(`ALTER TABLE orchestrator_campaign_publish_approvals DISABLE TRIGGER orchestrator_campaign_publish_approvals_immutable`);
    try {
      await p().query(
        `UPDATE orchestrator_campaign_publish_approvals SET snapshot_json=$3::jsonb WHERE tenant_id=$1 AND id=$2`,
        [tenantA.id, actor.approval.id, JSON.stringify(actorSnap)]
      );
      const r4 = await settleWithSpy(actor);
      assertAuthRejected(r4, actor);
    } finally {
      await p().query(
        `UPDATE orchestrator_campaign_publish_approvals SET snapshot_json=$3::jsonb WHERE tenant_id=$1 AND id=$2`,
        [tenantA.id, actor.approval.id, JSON.stringify(actorOrig)]
      );
      await p().query(`ALTER TABLE orchestrator_campaign_publish_approvals ENABLE TRIGGER orchestrator_campaign_publish_approvals_immutable`);
    }

    const member = await readyIntent(cookieA, wfA, artA);
    await p().query(
      `UPDATE tenant_users SET status='suspended' WHERE tenant_id=$1 AND user_id=$2`,
      [tenantA.id, ownerA.id]
    );
    try {
      const r5 = await settleWithSpy(member);
      assertAuthRejected(r5, member);
    } finally {
      await p().query(
        `UPDATE tenant_users SET status='active' WHERE tenant_id=$1 AND user_id=$2`,
        [tenantA.id, ownerA.id]
      );
    }
  });

  test('cross-tenant claim skips and settle fences', async () => {
    const live = await readyIntent(cookieA, wfA, artA);
    const pool = p();
    const skip = await worker.claimCampaignDeliveryAttempt({
      pool, tenantId: tenantB.id, outboxId: live.outbox.id, workerId: 'w-x-tenant',
      scenario: 'success',
    });
    assert.equal(skip.skip, true);
    const envelope = await worker.claimCampaignDeliveryAttempt({
      pool, tenantId: tenantA.id, outboxId: live.outbox.id, workerId: 'w-x-a',
      scenario: 'success',
    });
    const fake = await worker.executeFake(envelope);
    const fenced = await worker.settleCampaignDeliveryAttempt(
      { ...envelope, tenantId: tenantB.id }, fake, { pool }
    );
    assert.equal(fenced.fenced_out, true);
    const ok = await worker.settleCampaignDeliveryAttempt(envelope, fake, { pool });
    assert.equal(ok.status, 'simulated_ok');
  });

  test('retryable scenarios schedule near future; success/duplicate/dead-letter/auth park far', async () => {
    const pool = p();
    const now = new Date();

    async function run(scenario) {
      const live = await readyIntent(cookieA, wfA, artA);
      const settled = await worker.processOne({
        pool, tenantId: tenantA.id, outboxId: live.outbox.id, scenario, workerId: `w-${scenario}`,
      });
      const box = await loadOutbox(tenantA.id, live.outbox.id);
      const intentRow = await loadIntent(tenantA.id, live.intent.id);
      assert.equal(box.state, 'pending');
      assert.equal(box.claimed_by, null);
      assert.equal(box.claimed_until, null);
      assert.equal(intentRow.status, 'pending');
      publicOutbox(box);
      return { settled, box, live };
    }

    const transient = await run('transient');
    assert.equal(transient.settled.status, 'retry_transient');
    assert.equal(transient.settled.retryable, true);
    assert.ok(daysAhead(transient.box.next_attempt_at, now) < 1, 'retry is near future');

    const rate = await run('rate_limit');
    assert.equal(rate.settled.status, 'retry_rate_limit');
    assert.ok(daysAhead(rate.box.next_attempt_at, now) < 1);

    const timeout = await run('timeout');
    assert.equal(timeout.settled.status, 'retry_timeout');
    assert.ok(daysAhead(timeout.box.next_attempt_at, now) < 1);

    for (const [scenario, status] of [
      ['success', 'simulated_ok'],
      ['duplicate', 'simulated_duplicate'],
      ['permanent', 'dead_letter_permanent'],
      ['malformed', 'dead_letter_malformed'],
      ['blocked', 'dead_letter_blocked'],
    ]) {
      const r = await run(scenario);
      assert.equal(r.settled.status, status, scenario);
      assert.equal(r.settled.retryable, false, scenario);
      assert.ok(daysAhead(r.box.next_attempt_at, now) > 1000, scenario);
      assert.equal(r.settled.attempt.published, false);
      assert.equal(r.settled.attempt.external_action_taken, false);
      assert.equal(r.settled.attempt.simulated, true);
      assert.equal(r.settled.attempt.connector, 'fake');
    }
  });

  test('exhausted retries terminalize dead_letter_permanent with simulated_retry_exhausted', async () => {
    const live = await readyIntent(cookieA, wfA, artA);
    const pool = p();
    let cursor = new Date();
    let lastNow = cursor;
    let last;
    for (let i = 1; i <= D.MAX_ATTEMPTS; i += 1) {
      lastNow = cursor;
      last = await worker.processOne({
        pool, tenantId: tenantA.id, outboxId: live.outbox.id, scenario: 'transient',
        workerId: `w-exh-${i}`, now: cursor,
      });
      cursor = new Date(cursor.getTime() + (D.delaySeconds(i) * 1000) + 1000);
      if (i < D.MAX_ATTEMPTS) {
        assert.equal(last.status, 'retry_transient', `attempt ${i}`);
        assert.equal(last.retryable, true, `attempt ${i}`);
      }
    }
    assert.equal(last.status, 'dead_letter_permanent');
    assert.equal(last.retryable, false);
    assert.equal(last.attempt.error_code, 'simulated_retry_exhausted');
    assert.equal(last.attempt.scenario, 'transient');
    const box = await loadOutbox(tenantA.id, live.outbox.id);
    assert.equal(box.state, 'pending');
    assert.ok(daysAhead(box.next_attempt_at, lastNow) > 1000);
    const listed = await attempts.listAttemptsForOutbox(pool, { tenantId: tenantA.id, outboxId: live.outbox.id });
    assert.equal(listed.length, D.MAX_ATTEMPTS);
    publicOutbox(box);
    const intentRow = await loadIntent(tenantA.id, live.intent.id);
    assert.equal(intentRow.status, 'pending');
  });

  test('tick overlap guard and per-tenant processing keep outbox pending', async () => {
    const live = await readyIntent(cookieA, wfA, artA);
    const pool = p();
    await worker.tickCampaignDeliveryWorker({
      pool, tenantId: tenantA.id, scenario: 'success', outboxId: live.outbox.id, workerId: 'w-tick',
    });
    const box = await loadOutbox(tenantA.id, live.outbox.id);
    assert.equal(box.state, 'pending');
    publicOutbox(box);
    const intentRow = await loadIntent(tenantA.id, live.intent.id);
    assert.equal(intentRow.status, 'pending');
    const listed = await attempts.listAttemptsForOutbox(pool, { tenantId: tenantA.id, outboxId: live.outbox.id });
    assert.ok(listed.length >= 1);
    assert.equal(listed[listed.length - 1].status, 'simulated_ok');
  });

  test('the settled audit row leaks no claim token, credential ref, or intent hash', async () => {
    const live = await readyIntent(cookieA, wfA, artA);
    const pool = p();
    const envelope = await worker.claimCampaignDeliveryAttempt({
      pool, tenantId: tenantA.id, outboxId: live.outbox.id, workerId: 'w-audit-1',
      scenario: 'success',
    });
    assert.ok(!envelope.skip, JSON.stringify(envelope));
    const fake = await worker.executeFake(envelope);
    const settled = await worker.settleCampaignDeliveryAttempt(envelope, fake, { pool });
    assert.equal(settled.status, 'simulated_ok');

    const rows = (await pool.query(
      `SELECT actor_user_id, detail FROM orchestrator_audit_events
        WHERE tenant_id=$1 AND event=$2 AND detail->>'outbox_id'=$3`,
      [tenantA.id, D.AUDIT_EVENT_SIMULATED, live.outbox.id]
    )).rows;
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].actor_user_id), ownerA.id);

    const detail = rows[0].detail;
    const flat = JSON.stringify(detail);
    const attemptRow = await loadAttempt(tenantA.id, envelope.attemptId);
    assert.ok(attemptRow.claim_token && attemptRow.intent_hash);
    assert.ok(!flat.includes(attemptRow.claim_token), 'claim token must not reach the audit row');
    assert.ok(!flat.includes(attemptRow.intent_hash), 'intent hash must not reach the audit row');
    assert.ok(!flat.includes('user_integrations'), 'credential_ref must not reach the audit row');
    for (const k of ['claim_token', 'credential_ref', 'intent_hash', 'payload', 'snapshot', 'snapshot_json', 'confirmation']) {
      assert.strictEqual(detail[k], undefined, k);
    }
    assert.equal(detail.simulated, true);
    assert.equal(detail.published, false);
    assert.equal(detail.external_action_taken, false);
    assert.equal(detail.source, D.OUTCOME_SOURCE_TEST_OPTS);
    assert.equal(detail.status, 'simulated_ok');
    assert.equal(detail.lease_holder, 'w-audit-1');

    await assert.rejects(
      pool.query(
        `UPDATE orchestrator_campaign_delivery_attempts SET published=TRUE
          WHERE tenant_id=$1 AND id=$2`,
        [tenantA.id, envelope.attemptId]
      ),
      /immutable|violates check constraint/i,
      'a settled attempt must not be able to flip published'
    );
  });

  test('corruption parks without claim; mutated claim_token fences', async () => {
    const live = await readyIntent(cookieA, wfA, artA);
    const pool = p();
    await pool.query(
      `UPDATE orchestrator_outbox SET payload=$3::jsonb WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, live.outbox.id, JSON.stringify({ broken: true })]
    );
    const parked = await worker.claimCampaignDeliveryAttempt({
      pool, tenantId: tenantA.id, outboxId: live.outbox.id, workerId: 'w-corr-1',
      scenario: 'success',
    });
    assert.equal(parked.skip, true);
    assert.equal(parked.reason, 'parked');
    assert.equal((await attempts.listAttemptsForOutbox(pool, {
      tenantId: tenantA.id, outboxId: live.outbox.id,
    })).length, 0);

    const live2 = await readyIntent(cookieA, wfA, artA);
    const envelope = await worker.claimCampaignDeliveryAttempt({
      pool, tenantId: tenantA.id, outboxId: live2.outbox.id, workerId: 'w-corr-2',
      scenario: 'success',
    });
    await pool.query(
      `UPDATE orchestrator_campaign_delivery_attempts SET claim_token=$3
        WHERE tenant_id=$1 AND id=$2 AND status='started'`,
      [tenantA.id, envelope.attemptId, 'y'.repeat(64)]
    ).catch(() => null);
    // claim_token is immutable via trigger — mutating must fail; fence path uses wrong envelope token
    const fake = await worker.executeFake(envelope);
    const fenced = await worker.settleCampaignDeliveryAttempt(
      { ...envelope, claimToken: 'z'.repeat(64) }, fake, { pool }
    );
    assert.equal(fenced.fenced_out, true);
  });

  test('>20 older no-outcome rows do not starve a later seeded outbox', async () => {
    const pool = p();
    const older = [];
    for (let i = 0; i < 21; i += 1) {
      older.push(await readyIntent(cookieA, wfA, artA));
    }
    const seeded = await readyIntent(cookieA, wfA, artA);
    const base = new Date('2020-01-01T00:00:00.000Z');
    for (let i = 0; i < older.length; i += 1) {
      await pool.query(
        `UPDATE orchestrator_outbox
            SET next_attempt_at=$3::timestamptz, state='pending', claimed_by=NULL, claimed_until=NULL
          WHERE tenant_id=$1 AND id=$2`,
        [tenantA.id, older[i].outbox.id, new Date(base.getTime() + i * 1000).toISOString()]
      );
    }
    await pool.query(
      `UPDATE orchestrator_outbox
          SET next_attempt_at=$3::timestamptz, state='pending', claimed_by=NULL, claimed_until=NULL
        WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, seeded.outbox.id, new Date(base.getTime() + 60_000).toISOString()]
    );
    await sandboxOutcomes.seedSandboxOutcome(pool, {
      tenantId: tenantA.id, outboxId: seeded.outbox.id, intentId: seeded.intent.id, scenario: 'success',
    });

    const explicitSkip = await worker.claimCampaignDeliveryAttempt({
      pool, tenantId: tenantA.id, outboxId: older[0].outbox.id, workerId: 'w-starve-explicit',
    });
    assert.equal(explicitSkip.skip, true);
    assert.equal(explicitSkip.reason, D.SKIP_REASON_NO_OUTCOME);

    await worker.processTenant(pool, tenantA.id, {
      workerId: 'w-starve', now: new Date(base.getTime() + 120_000),
    });
    const listed = await attempts.listAttemptsForOutbox(pool, {
      tenantId: tenantA.id, outboxId: seeded.outbox.id,
    });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].status, 'simulated_ok');
    for (const row of older) {
      assert.equal((await attempts.listAttemptsForOutbox(pool, {
        tenantId: tenantA.id, outboxId: row.outbox.id,
      })).length, 0);
    }
  });

  test('expired started attempt is abandoned before no-outcome skip', async () => {
    const live = await readyIntent(cookieA, wfA, artA);
    const pool = p();
    const t0 = new Date();
    await pool.query(
      `UPDATE orchestrator_outbox
          SET next_attempt_at=$3::timestamptz, state='pending', claimed_by=NULL, claimed_until=NULL
        WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, live.outbox.id, t0.toISOString()]
    );
    const envelope = await worker.claimCampaignDeliveryAttempt({
      pool, tenantId: tenantA.id, outboxId: live.outbox.id, workerId: 'w-abandon-1',
      scenario: 'success', now: t0,
    });
    assert.ok(!envelope.skip, JSON.stringify(envelope));
    const later = new Date(t0.getTime() + D.LEASE_MS + 1000);
    const skipped = await worker.claimCampaignDeliveryAttempt({
      pool, tenantId: tenantA.id, outboxId: live.outbox.id, workerId: 'w-abandon-2',
      now: later,
    });
    assert.equal(skipped.skip, true);
    assert.equal(skipped.reason, D.SKIP_REASON_NO_OUTCOME);
    const listed = await attempts.listAttemptsForOutbox(pool, {
      tenantId: tenantA.id, outboxId: live.outbox.id,
    });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].status, 'abandoned_lease');
    assert.notEqual(listed[0].status, 'started');
  });

  test('prototype-chain and case-variant scenarios never make rows outcome-ready via test opts', async () => {
    const live = await readyIntent(cookieA, wfA, artA);
    const pool = p();
    for (const scenario of ['constructor', '__proto__', 'toString', 'SUCCESS', 'Success', ' prototype ']) {
      const skipped = await worker.claimCampaignDeliveryAttempt({
        pool, tenantId: tenantA.id, outboxId: live.outbox.id, workerId: `w-proto-${scenario}`,
        scenario,
      });
      assert.equal(skipped.skip, true, scenario);
      assert.equal(skipped.reason, D.SKIP_REASON_NO_OUTCOME, scenario);
      assert.equal((await attempts.listAttemptsForOutbox(pool, {
        tenantId: tenantA.id, outboxId: live.outbox.id,
      })).length, 0, scenario);
    }
  });

  test('settlement fences arbitrary/sensitive outcomeSource and never audits live/secret', async () => {
    const live = await readyIntent(cookieA, wfA, artA);
    const pool = p();
    const envelope = await worker.claimCampaignDeliveryAttempt({
      pool, tenantId: tenantA.id, outboxId: live.outbox.id, workerId: 'w-src',
      scenario: 'success',
    });
    assert.ok(!envelope.skip);
    const fake = await worker.executeFake(envelope);
    for (const bad of ['live', 'secret', 'provider', 'vault_token']) {
      const cloned = { ...envelope, outcomeSource: bad };
      const fenced = await worker.settleCampaignDeliveryAttempt(cloned, fake, { pool });
      assert.equal(fenced.fenced_out, true, bad);
      const rows = (await pool.query(
        `SELECT detail FROM orchestrator_audit_events
          WHERE tenant_id=$1 AND event=$2 AND detail->>'outbox_id'=$3`,
        [tenantA.id, D.AUDIT_EVENT_SIMULATED, live.outbox.id]
      )).rows;
      assert.equal(rows.length, 0, bad);
      assert.ok(!JSON.stringify(rows).includes(bad), bad);
    }
    const ok = await worker.settleCampaignDeliveryAttempt(envelope, fake, { pool });
    assert.equal(ok.fenced_out, false);
    assert.equal(ok.status, 'simulated_ok');
    const audited = (await pool.query(
      `SELECT detail->>'source' AS source FROM orchestrator_audit_events
        WHERE tenant_id=$1 AND event=$2 AND detail->>'outbox_id'=$3`,
      [tenantA.id, D.AUDIT_EVENT_SIMULATED, live.outbox.id]
    )).rows;
    assert.equal(audited.length, 1);
    assert.equal(audited[0].source, D.OUTCOME_SOURCE_TEST_OPTS);
  });

  test('zero-network processOne with outcome source trips no fetch/http/https/net/vault', async () => {
    const live = await readyIntent(cookieA, wfA, artA);
    const pool = p();
    let hits = 0;
    const bump = () => { hits += 1; throw new Error('network tripwire'); };
    const origFetch = global.fetch;
    const origHttp = http.request;
    const origHttps = https.request;
    const origConnect = net.connect;
    const origHas = vault.hasCredentials;
    const origGet = vault.getCredentials;
    global.fetch = async () => bump();
    http.request = (...args) => bump(...args);
    https.request = (...args) => bump(...args);
    net.connect = (...args) => bump(...args);
    vault.hasCredentials = async () => bump();
    vault.getCredentials = async () => bump();
    try {
      await sandboxOutcomes.seedSandboxOutcome(pool, {
        tenantId: tenantA.id, outboxId: live.outbox.id, intentId: live.intent.id, scenario: 'success',
      });
      const settled = await worker.processOne({
        pool, tenantId: tenantA.id, outboxId: live.outbox.id, workerId: 'w-zero-net',
      });
      assert.equal(settled.status, 'simulated_ok');
      assert.equal(hits, 0);
    } finally {
      global.fetch = origFetch;
      http.request = origHttp;
      https.request = origHttps;
      net.connect = origConnect;
      vault.hasCredentials = origHas;
      vault.getCredentials = origGet;
    }
  });

  test('overlapping ticks do not double-claim the same outbox', async () => {
    const live = await readyIntent(cookieA, wfA, artA);
    const pool = p();
    await sandboxOutcomes.seedSandboxOutcome(pool, {
      tenantId: tenantA.id, outboxId: live.outbox.id, intentId: live.intent.id, scenario: 'success',
    });
    await Promise.all([
      worker.tickCampaignDeliveryWorker({
        pool, tenantId: tenantA.id, outboxId: live.outbox.id, workerId: 'w-ov-1',
      }),
      worker.tickCampaignDeliveryWorker({
        pool, tenantId: tenantA.id, outboxId: live.outbox.id, workerId: 'w-ov-2',
      }),
    ]);
    const listed = await attempts.listAttemptsForOutbox(pool, {
      tenantId: tenantA.id, outboxId: live.outbox.id,
    });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].status, 'simulated_ok');
  });
  });
}
