'use strict';
// test/advertising-orchestrator-workflows.test.js — PR 1 control-plane integration.
//
// Live Postgres. File-level skip only when DATABASE_URL is missing.
// Concurrency (leases): two overlapping POST /advance calls (Promise.all) share
// one workflow. acquireLease uses SELECT … FOR UPDATE then a live lease row so
// one request wins and the other gets 409 lease_conflict / execution_in_progress.
// Material PATCH during a live unexpired lease is 409 execution_in_progress
// (lease_conflict is "this caller lost the lease"). Advance persist is
// optimistic on the approved version so a PATCH that landed first yields
// 409 approval_stale rather than a post-research state on a stale approval.
// node --test default parallelism is fine; tests do not need a special worker count.
//
// Env must be set BEFORE requiring helpers/server — node --test isolates files.

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
const { sha256Hex, canonicalJson } = require('../services/agent_orchestrator/hash');
const {
  contentHash, approvalSnapshot, materialChanged,
} = require('../services/agent_orchestrator/approvals');
const { canTransition, applyTransition, GATES } = require('../services/agent_orchestrator/states');
const {
  actorId, isTestFail, testHoldMs, safeAuditDetail,
} = require('../services/agent_orchestrator/runner');

const HAS_DB = hasDb();

function ik(tag) {
  return `ik-${tag}-${crypto.randomBytes(8).toString('hex')}`;
}

function createBody(over) {
  return {
    name: 'Autumn launch',
    objective: 'Acquire trial signups',
    product_or_service: 'Analytics suite',
    offer: '14-day trial',
    landing_page_url: 'https://example.com/trial',
    target_markets: ['US', 'UK'],
    target_audiences: ['SMB marketers'],
    selected_platforms: ['meta', 'google'],
    advertising_budget: 1000,
    currency: 'USD',
    ...over,
  };
}

function approveBody(wf, gate, over) {
  return {
    gate,
    object_type: 'workflow',
    object_id: wf.id,
    object_version: wf.version,
    platforms: wf.selected_platforms,
    advertising_budget: wf.advertising_budget,
    credit_ceiling: 0,
    comment: 'ok',
    ...over,
  };
}

// ── Pure unit tests (no DB) ────────────────────────────────────────────────
test('canonical JSON is key-order independent and hashes stably', () => {
  const a = { gate: 'research_execution', b: 1, a: { z: 2, y: 1 } };
  const b = { a: { y: 1, z: 2 }, b: 1, gate: 'research_execution' };
  assert.strictEqual(canonicalJson(a), canonicalJson(b));
  assert.strictEqual(sha256Hex(a), sha256Hex(b));
  assert.match(sha256Hex(a), /^[a-f0-9]{64}$/);
});

test('approval content_hash is stable for the same snapshot', () => {
  const wf = {
    id: 'ow_abc',
    version: 1,
    selected_platforms: ['google', 'meta'],
    advertising_budget: 1000,
    currency: 'USD',
    landing_page_url: 'https://example.com/x',
    offer: 'trial',
    objective: 'signups',
    product_or_service: 'saas',
  };
  const h1 = contentHash(wf, 'research_execution');
  const h2 = contentHash({ ...wf, selected_platforms: ['meta', 'google'] }, 'research_execution');
  assert.strictEqual(h1, h2);
  const snap = approvalSnapshot(wf, 'research_execution');
  assert.strictEqual(snap.gate, 'research_execution');
  const h3 = contentHash({ ...wf, offer: 'changed' }, 'research_execution');
  assert.notStrictEqual(h1, h3);
});

// ── Security regressions (pure) ────────────────────────────────────────────
test('approval scope covers currency and targeting, not just platforms/budget', () => {
  const wf = {
    id: 'ow_scope',
    version: 1,
    selected_platforms: ['meta'],
    advertising_budget: 1000,
    currency: 'USD',
    target_markets: ['US', 'UK'],
    target_audiences: ['SMB'],
    landing_page_url: 'https://example.com/x',
    offer: 'trial',
    objective: 'signups',
    product_or_service: 'saas',
  };
  const base = contentHash(wf, 'research_execution');
  // Same authorisation, different array order → same hash.
  assert.strictEqual(
    contentHash({ ...wf, target_markets: ['UK', 'US'] }, 'research_execution'),
    base
  );
  // Different authorisation → different hash AND a material change.
  for (const over of [
    { currency: 'JPY' },
    { target_markets: ['DE'] },
    { target_audiences: ['Enterprise buyers'] },
  ]) {
    assert.notStrictEqual(contentHash({ ...wf, ...over }, 'research_execution'), base,
      `content_hash must cover ${Object.keys(over)[0]}`);
    assert.strictEqual(materialChanged(wf, { ...wf, ...over }), true,
      `${Object.keys(over)[0]} must invalidate an approval`);
  }
  assert.strictEqual(materialChanged(wf, { ...wf, target_markets: ['UK', 'US'] }), false);
  const snap = approvalSnapshot(wf, 'research_execution');
  assert.deepStrictEqual(snap.target_markets, ['UK', 'US']);
  assert.deepStrictEqual(snap.target_audiences, ['SMB']);
});

test('actor id is a positive session user id, never the synthetic principal', () => {
  assert.strictEqual(actorId({ user: { id: 7 } }), 7);
  assert.strictEqual(actorId({ user: { id: 0 } }), null, 'api-key fallback principal is not attributable');
  assert.strictEqual(actorId({ user: { id: -1 } }), null);
  assert.strictEqual(actorId({ user: { id: 'owner@example.com' } }), null, 'never an email');
  assert.strictEqual(actorId({}), null);
});

test('X-Orch-Test-* headers are inert unless NODE_ENV is exactly "test"', () => {
  const req = { headers: { 'x-orch-test-fail': '1', 'x-orch-test-hold': '250' } };
  const saved = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'test';
    assert.strictEqual(isTestFail(req), true, 'available under the test runner');
    assert.strictEqual(testHoldMs(req), 250);
    for (const env of ['production', 'development', 'Test', '']) {
      process.env.NODE_ENV = env;
      assert.strictEqual(isTestFail(req), false, `must be inert when NODE_ENV=${env || '(empty)'}`);
      assert.strictEqual(testHoldMs(req), 0, `must be inert when NODE_ENV=${env || '(empty)'}`);
    }
    delete process.env.NODE_ENV;
    assert.strictEqual(isTestFail(req), false, 'must be inert when NODE_ENV is unset');
    assert.strictEqual(testHoldMs(req), 0);
  } finally {
    if (saved === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved;
  }
});

test('audit detail is an allowlist: brief material cannot reach the trail', () => {
  const safe = safeAuditDetail({
    from: 'draft',
    to: 'research_approval_required',
    gate: 'research_execution',
    version: 2,
    stub: true,
    offer: 'SECRET_BRIEF_CANARY',
    objective: 'SECRET_BRIEF_CANARY',
    product_or_service: 'SECRET_BRIEF_CANARY',
    landing_page_url: 'https://secret.example.com/x',
    comment: 'SECRET_BRIEF_CANARY',
    brief: 'SECRET_BRIEF_CANARY',
    api_key: 'sk-live-abc',
    nested: { offer: 'SECRET_BRIEF_CANARY' },
  });
  assert.deepStrictEqual(safe, {
    from: 'draft',
    to: 'research_approval_required',
    gate: 'research_execution',
    version: 2,
    stub: true,
  });
  assert.ok(!JSON.stringify(safe).includes('SECRET_BRIEF_CANARY'));
  assert.ok(!JSON.stringify(safe).includes('sk-live'));
  assert.strictEqual(safeAuditDetail({ state: 'x'.repeat(500) }).state.length, 120);
});

test('transition table: approve/resume from draft is invalid_transition', () => {
  assert.strictEqual(canTransition('draft', 'approve', { gate: 'research_execution' }).code, 'invalid_transition');
  assert.strictEqual(canTransition('draft', 'resume').code, 'invalid_transition');
  const req = applyTransition('draft', 'request_approval', { gate: 'research_execution' });
  assert.strictEqual(req.to, 'research_approval_required');
  const appr = applyTransition('research_approval_required', 'approve', { gate: 'research_execution' });
  assert.strictEqual(appr.to, 'research_approved');
  assert.ok(GATES.includes('optimization_application'));
});

if (!HAS_DB) {
  test('advertising-orchestrator workflows skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else {
  const fx = makeFixtures();
  let app;
  let tenantA;
  let tenantB;
  let ownerA;
  let ownerB;
  let marketerA;
  let cookieA;
  let cookieB;
  let cookieM;

  function orch(method, urlPath, { cookie, body, headers, key } = {}) {
    const h = { ...(headers || {}) };
    if (key) h['Idempotency-Key'] = key;
    return request(app.baseUrl, method, `/api/agent-orchestrator/workflows${urlPath}`, {
      cookie, body, headers: h,
    });
  }

  async function createWf(cookie, over, key) {
    const res = await orch('POST', '', { cookie, body: createBody(over), key: key || ik('c') });
    assert.ok(res.status === 200 || res.status === 201, `create status ${res.status} ${res.text}`);
    assert.strictEqual(res.json.ok, true);
    return res.json.workflow;
  }

  async function requestGate(cookie, id, gate) {
    const res = await orch('POST', `/${id}/request-approval`, {
      cookie, body: { gate }, key: ik('ra'),
    });
    assert.strictEqual(res.status, 200, res.text);
    return res.json.workflow;
  }

  async function approveGate(cookie, wf, gate, over) {
    const res = await orch('POST', `/${wf.id}/approve`, {
      cookie, body: approveBody(wf, gate, over), key: ik('ap'),
    });
    assert.strictEqual(res.status, 200, `approve ${gate} ${res.text}`);
    return res.json.workflow;
  }

  async function advanceWf(cookie, id, headers) {
    const res = await orch('POST', `/${id}/advance`, {
      cookie, body: {}, key: ik('adv'), headers,
    });
    return res;
  }

  before(async () => {
    await fx.ensureSchemas();
    await ensureTenantSchema();
    await ensureAgentOrchestratorSchema();
    tenantA = await fx.seedTenant('Orch A');
    tenantB = await fx.seedTenant('Orch B');
    ownerA = await fx.seedUser({ tenantId: tenantA.id, owner: true });
    ownerB = await fx.seedUser({ tenantId: tenantB.id, owner: true });
    marketerA = await fx.seedUser({ tenantId: tenantA.id, owner: false, roleKey: 'marketer' });
    app = await bootApp();
    cookieA = (await login(app.baseUrl, ownerA.email, ownerA.password)).cookie;
    cookieB = (await login(app.baseUrl, ownerB.email, ownerB.password)).cookie;
    cookieM = (await login(app.baseUrl, marketerA.email, marketerA.password)).cookie;
    assert.ok(cookieA && cookieB && cookieM, 'all three principals must log in');
  });

  after(async () => {
    if (app) await app.close();
    // Delete tenants (cascades workflows → approvals) BEFORE user DELETE.
    // Approvals are UPDATE-immutable; actor_user_id ON DELETE SET NULL would
    // otherwise UPDATE those rows and trip orchestrator_approvals_immutable.
    const ids = [tenantA && tenantA.id, tenantB && tenantB.id].filter(Boolean);
    if (ids.length && db.hasDb()) {
      await db.getPool().query(`DELETE FROM tenants WHERE id = ANY($1)`, [ids]);
    }
    await fx.cleanup();
  });

  test('1. create + list are tenant-scoped', async () => {
    const wf = await createWf(cookieA, { name: 'Tenant A only' });
    assert.strictEqual(wf.current_state, 'draft');
    assert.strictEqual(wf.created_by_user_id, ownerA.id);
    assert.ok(!('tenant_id' in wf) || wf.tenant_id == null || wf.tenant_id === tenantA.id);

    const listA = await orch('GET', '', { cookie: cookieA });
    assert.strictEqual(listA.status, 200);
    assert.ok(listA.json.workflows.some((w) => w.id === wf.id));

    const listB = await orch('GET', '', { cookie: cookieB });
    assert.strictEqual(listB.status, 200);
    assert.ok(!listB.json.workflows.some((w) => w.id === wf.id), 'tenant B must not list tenant A workflows');
  });

  test('2/11/12. happy path walks all six gates and stops at each next gate', async () => {
    let wf = await createWf(cookieA, { name: 'Six gates' });
    wf = await requestGate(cookieA, wf.id, 'research_execution');
    assert.strictEqual(wf.current_state, 'research_approval_required');

    wf = await approveGate(cookieA, wf, 'research_execution');
    assert.strictEqual(wf.current_state, 'research_approved');

    let adv = await advanceWf(cookieA, wf.id);
    assert.strictEqual(adv.status, 200, adv.text);
    wf = adv.json.workflow;
    assert.strictEqual(wf.current_state, 'generation_approval_required', 'must stop at generation gate');
    assert.strictEqual(wf.next_approval_gate, 'creative_generation');
    assert.notStrictEqual(wf.current_state, 'publishing');
    assert.notStrictEqual(wf.current_state, 'publishing_approval_required');

    wf = await approveGate(cookieA, wf, 'creative_generation');
    adv = await advanceWf(cookieA, wf.id);
    assert.strictEqual(adv.status, 200, adv.text);
    wf = adv.json.workflow;
    assert.strictEqual(wf.current_state, 'creative_review_required');
    assert.strictEqual(wf.next_approval_gate, 'creative_selection');

    wf = await approveGate(cookieA, wf, 'creative_selection');
    adv = await advanceWf(cookieA, wf.id);
    wf = adv.json.workflow;
    assert.strictEqual(wf.current_state, 'publishing_approval_required');
    assert.strictEqual(wf.next_approval_gate, 'campaign_publishing');

    wf = await approveGate(cookieA, wf, 'campaign_publishing');
    adv = await advanceWf(cookieA, wf.id);
    wf = adv.json.workflow;
    assert.strictEqual(wf.current_state, 'activation_approval_required');
    assert.strictEqual(wf.next_approval_gate, 'campaign_activation');

    wf = await approveGate(cookieA, wf, 'campaign_activation');
    adv = await advanceWf(cookieA, wf.id);
    wf = adv.json.workflow;
    assert.strictEqual(wf.current_state, 'optimization_approval_required');
    assert.strictEqual(wf.next_approval_gate, 'optimization_application');

    wf = await approveGate(cookieA, wf, 'optimization_application');
    adv = await advanceWf(cookieA, wf.id);
    wf = adv.json.workflow;
    assert.strictEqual(wf.current_state, 'monitoring');
    assert.notStrictEqual(wf.current_state, 'completed');
  });

  test('3. invalid transition 409 invalid_transition (approve from draft; resume from draft)', async () => {
    const wf = await createWf(cookieA, { name: 'invalid trans' });
    const ap = await orch('POST', `/${wf.id}/approve`, {
      cookie: cookieA,
      body: approveBody(wf, 'research_execution'),
      key: ik('bad-ap'),
    });
    assert.strictEqual(ap.status, 409);
    assert.strictEqual(ap.json.error, 'invalid_transition');

    const rs = await orch('POST', `/${wf.id}/resume`, {
      cookie: cookieA, body: {}, key: ik('bad-rs'),
    });
    assert.strictEqual(rs.status, 409);
    assert.strictEqual(rs.json.error, 'invalid_transition');
  });

  test('4. cross-tenant GET → 404', async () => {
    const wf = await createWf(cookieA, { name: 'x-tenant get' });
    const res = await orch('GET', `/${wf.id}`, { cookie: cookieB });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.json.error, 'not_found');
  });

  test('5. cross-tenant approve → 404 (no leak)', async () => {
    let wf = await createWf(cookieA, { name: 'x-tenant ap' });
    wf = await requestGate(cookieA, wf.id, 'research_execution');
    const res = await orch('POST', `/${wf.id}/approve`, {
      cookie: cookieB,
      body: approveBody(wf, 'research_execution'),
      key: ik('xap'),
    });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.json.error, 'not_found');
    assert.notStrictEqual(res.status, 200);
  });

  test('6. marketer approve → 403 with required gate key', async () => {
    let wf = await createWf(cookieA, { name: 'marketer deny' });
    wf = await requestGate(cookieA, wf.id, 'research_execution');
    const res = await orch('POST', `/${wf.id}/approve`, {
      cookie: cookieM,
      body: approveBody(wf, 'research_execution'),
      key: ik('map'),
    });
    assert.strictEqual(res.status, 403);
    assert.ok(res.json.error === 'forbidden' || res.json.error === 'permission_denied');
    assert.strictEqual(res.json.required, 'orchestrator.workflows.approve.research_execution');
  });

  test('7. approval immutability: SQL UPDATE throws', async () => {
    let wf = await createWf(cookieA, { name: 'immutable' });
    wf = await requestGate(cookieA, wf.id, 'research_execution');
    wf = await approveGate(cookieA, wf, 'research_execution');
    const row = (await db.getPool().query(
      `SELECT id FROM orchestrator_approvals WHERE workflow_id=$1 AND tenant_id=$2 LIMIT 1`,
      [wf.id, tenantA.id]
    )).rows[0];
    assert.ok(row);
    await assert.rejects(
      () => db.getPool().query(`UPDATE orchestrator_approvals SET comment='tamper' WHERE id=$1`, [row.id]),
      /orchestrator_approvals_immutable/
    );
  });

  test('8. approval hash stability already covered; same snapshot via API', async () => {
    const wf = await createWf(cookieA, { name: 'hash api' });
    const h1 = contentHash(wf, 'research_execution');
    const h2 = contentHash({ ...wf, selected_platforms: ['google', 'meta'] }, 'research_execution');
    assert.strictEqual(h1, h2);
  });

  test('9. PATCH material field after approval invalidates; advance is stale/required', async () => {
    let wf = await createWf(cookieA, { name: 'invalidate' });
    wf = await requestGate(cookieA, wf.id, 'research_execution');
    wf = await approveGate(cookieA, wf, 'research_execution');
    const v1 = wf.version;
    const patch = await orch('PATCH', `/${wf.id}`, {
      cookie: cookieA,
      body: { offer: 'new offer' },
      key: ik('patch'),
    });
    assert.strictEqual(patch.status, 200, patch.text);
    wf = patch.json.workflow;
    assert.ok(wf.version > v1);
    assert.strictEqual(wf.current_state, 'research_approval_required');
    const adv = await advanceWf(cookieA, wf.id);
    assert.strictEqual(adv.status, 409);
    assert.ok(adv.json.error === 'approval_stale' || adv.json.error === 'approval_required');
  });

  test('10. extra platform or higher budget → 409 approval_scope_mismatch', async () => {
    let wf = await createWf(cookieA, { name: 'scope', selected_platforms: ['meta', 'google'] });
    wf = await requestGate(cookieA, wf.id, 'research_execution');
    const extra = await orch('POST', `/${wf.id}/approve`, {
      cookie: cookieA,
      body: approveBody(wf, 'research_execution', { platforms: ['meta', 'google', 'tiktok'] }),
      key: ik('plat'),
    });
    assert.strictEqual(extra.status, 409);
    assert.strictEqual(extra.json.error, 'approval_scope_mismatch');

    const hi = await orch('POST', `/${wf.id}/approve`, {
      cookie: cookieA,
      body: approveBody(wf, 'research_execution', { advertising_budget: 999999 }),
      key: ik('bud'),
    });
    assert.strictEqual(hi.status, 409);
    assert.strictEqual(hi.json.error, 'approval_scope_mismatch');
  });

  test('13. advance before approval → 409 approval_required', async () => {
    const wf = await createWf(cookieA, { name: 'no appr' });
    const adv = await advanceWf(cookieA, wf.id);
    assert.strictEqual(adv.status, 409);
    assert.ok(adv.json.error === 'approval_required' || adv.json.error === 'invalid_transition');
    let waiting = await requestGate(cookieA, wf.id, 'research_execution');
    const adv2 = await advanceWf(cookieA, waiting.id);
    assert.strictEqual(adv2.status, 409);
    assert.strictEqual(adv2.json.error, 'approval_required');
  });

  test('14/15. idempotent create replay vs conflict', async () => {
    const key = ik('idem-create');
    const body = createBody({ name: 'idempotent-one' });
    const a = await orch('POST', '', { cookie: cookieA, body, key });
    assert.ok(a.status === 200 || a.status === 201, a.text);
    const id = a.json.workflow.id;
    const b = await orch('POST', '', { cookie: cookieA, body, key });
    assert.ok(b.status === 200 || b.status === 201);
    assert.strictEqual(b.json.workflow.id, id);

    const c = await orch('POST', '', {
      cookie: cookieA,
      body: { ...body, name: 'different-name' },
      key,
    });
    assert.strictEqual(c.status, 409);
    assert.strictEqual(c.json.error, 'idempotency_conflict');
  });

  test('16. concurrent advance: one succeeds, other 409 lease/in-progress; no double-advance', async () => {
    let wf = await createWf(cookieA, { name: 'lease race' });
    wf = await requestGate(cookieA, wf.id, 'research_execution');
    wf = await approveGate(cookieA, wf, 'research_execution');

    const [r1, r2] = await Promise.all([
      orch('POST', `/${wf.id}/advance`, {
        cookie: cookieA, body: {}, key: ik('c1'), headers: { 'X-Orch-Test-Hold': '250' },
      }),
      orch('POST', `/${wf.id}/advance`, {
        cookie: cookieA, body: {}, key: ik('c2'), headers: { 'X-Orch-Test-Hold': '250' },
      }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    const errors = [r1.json && r1.json.error, r2.json && r2.json.error];
    assert.ok(statuses.includes(200), `expected one 200, got ${statuses} ${r1.text} ${r2.text}`);
    assert.ok(statuses.includes(409), `expected one 409, got ${statuses}`);
    const loser = errors.find((e) => e && e !== undefined && (r1.status === 409 ? r1.json.error : r2.json.error));
    const err409 = r1.status === 409 ? r1.json.error : r2.json.error;
    assert.ok(err409 === 'lease_conflict' || err409 === 'execution_in_progress', err409);

    const got = await orch('GET', `/${wf.id}`, { cookie: cookieA });
    assert.strictEqual(got.json.workflow.current_state, 'generation_approval_required');
  });

  test('17. expired lease can be reacquired', async () => {
    let wf = await createWf(cookieA, { name: 'expire lease' });
    wf = await requestGate(cookieA, wf.id, 'research_execution');
    wf = await approveGate(cookieA, wf, 'research_execution');
    await db.getPool().query(
      `INSERT INTO orchestrator_execution_leases (tenant_id, workflow_id, holder, expires_at, heartbeat_at)
       VALUES ($1,$2,'stale-holder', now() - interval '5 seconds', now() - interval '5 seconds')`,
      [tenantA.id, wf.id]
    );
    const adv = await advanceWf(cookieA, wf.id);
    assert.strictEqual(adv.status, 200, adv.text);
    assert.strictEqual(adv.json.workflow.current_state, 'generation_approval_required');
    const leases = await db.getPool().query(
      `SELECT * FROM orchestrator_execution_leases WHERE tenant_id=$1 AND workflow_id=$2`,
      [tenantA.id, wf.id]
    );
    assert.strictEqual(leases.rowCount, 0, 'lease released after advance');
  });

  test('18. pause, resume, cancel', async () => {
    let wf = await createWf(cookieA, { name: 'pause-cancel' });
    wf = await requestGate(cookieA, wf.id, 'research_execution');
    const paused = await orch('POST', `/${wf.id}/pause`, { cookie: cookieA, body: {}, key: ik('p') });
    assert.strictEqual(paused.status, 200, paused.text);
    assert.strictEqual(paused.json.workflow.current_state, 'paused');

    const blocked = await orch('POST', `/${wf.id}/approve`, {
      cookie: cookieA, body: approveBody(wf, 'research_execution'), key: ik('pblk'),
    });
    assert.strictEqual(blocked.status, 409);
    assert.strictEqual(blocked.json.error, 'workflow_paused');

    const resumed = await orch('POST', `/${wf.id}/resume`, { cookie: cookieA, body: {}, key: ik('r') });
    assert.strictEqual(resumed.status, 200, resumed.text);
    assert.strictEqual(resumed.json.workflow.current_state, 'research_approval_required');

    const cancelled = await orch('POST', `/${wf.id}/cancel`, { cookie: cookieA, body: {}, key: ik('x') });
    assert.strictEqual(cancelled.status, 200);
    assert.strictEqual(cancelled.json.workflow.current_state, 'cancelled');

    const after = await orch('POST', `/${wf.id}/pause`, { cookie: cookieA, body: {}, key: ik('xp') });
    assert.strictEqual(after.status, 409);
    assert.strictEqual(after.json.error, 'workflow_cancelled');
  });

  test('19. test-only fail header forces failed state then recover', async () => {
    let wf = await createWf(cookieA, { name: 'force fail' });
    wf = await requestGate(cookieA, wf.id, 'research_execution');
    wf = await approveGate(cookieA, wf, 'research_execution');
    const failRes = await orch('POST', `/${wf.id}/advance`, {
      cookie: cookieA, body: {}, key: ik('fail'), headers: { 'X-Orch-Test-Fail': '1' },
    });
    assert.ok(failRes.status === 200 || failRes.status === 409, failRes.text);
    const failedState = failRes.json.workflow && failRes.json.workflow.current_state
      || (await orch('GET', `/${wf.id}`, { cookie: cookieA })).json.workflow.current_state;
    assert.ok(failedState === 'research_failed' || failedState === 'failed', failedState);

    const rec = await orch('POST', `/${wf.id}/recover`, { cookie: cookieA, body: {}, key: ik('rec') });
    assert.strictEqual(rec.status, 200, rec.text);
    assert.strictEqual(rec.json.workflow.current_state, 'research_approved');
  });

  test('20. audit completeness for create/request/approve/advance/pause/cancel', async () => {
    let wf = await createWf(cookieA, { name: 'audit trail' });
    wf = await requestGate(cookieA, wf.id, 'research_execution');
    wf = await approveGate(cookieA, wf, 'research_execution');
    const adv = await advanceWf(cookieA, wf.id);
    assert.strictEqual(adv.status, 200, adv.text);
    wf = adv.json.workflow;
    await orch('POST', `/${wf.id}/pause`, { cookie: cookieA, body: {}, key: ik('aud-p') });
    await orch('POST', `/${wf.id}/cancel`, { cookie: cookieA, body: {}, key: ik('aud-x') });
    const tl = await orch('GET', `/${wf.id}/timeline`, { cookie: cookieA });
    assert.strictEqual(tl.status, 200, tl.text);
    assert.ok(tl.json && Array.isArray(tl.json.events), `timeline body: ${tl.text}`);
    const events = tl.json.events.map((e) => e.event);
    for (const need of [
      'workflow_created', 'approval_requested', 'approval_granted',
      'phase_started', 'phase_completed', 'workflow_paused', 'workflow_cancelled',
    ]) {
      assert.ok(events.includes(need), `missing ${need} in ${events.join(',')}`);
    }
    const times = tl.json.events.map((e) => new Date(e.created_at).getTime());
    const sorted = [...times].sort((a, b) => a - b);
    assert.deepStrictEqual(times, sorted, 'timeline oldest-first');
  });

  test('21. safe logging does not emit SECRET_BRIEF_CANARY from offer', async () => {
    const logs = [];
    const orig = {
      log: console.log,
      warn: console.warn,
      error: console.error,
    };
    const spy = (fn) => (...args) => {
      logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      return orig[fn].apply(console, args);
    };
    console.log = spy('log');
    console.warn = spy('warn');
    console.error = spy('error');
    try {
      await createWf(cookieA, {
        name: 'canary',
        offer: 'SECRET_BRIEF_CANARY',
        objective: 'normal objective',
      });
    } finally {
      console.log = orig.log;
      console.warn = orig.warn;
      console.error = orig.error;
    }
    const blob = logs.join('\n');
    assert.ok(!blob.includes('SECRET_BRIEF_CANARY'), 'offer must not appear in logs');
    assert.ok(!blob.includes('sk-'), 'no sk- tokens');
    assert.ok(!blob.includes('BEGIN RSA'), 'no RSA material');
  });

  test('22. URL validation rejects http/javascript; oversized body 413', async () => {
    const httpUrl = await orch('POST', '', {
      cookie: cookieA,
      body: createBody({ landing_page_url: 'http://example.com/x' }),
      key: ik('http'),
    });
    assert.strictEqual(httpUrl.status, 400);
    assert.strictEqual(httpUrl.json.error, 'validation_failed');

    const jsUrl = await orch('POST', '', {
      cookie: cookieA,
      body: createBody({ landing_page_url: 'javascript:alert(1)' }),
      key: ik('js'),
    });
    assert.strictEqual(jsUrl.status, 400);

    const big = createBody({ name: 'too-big', offer: 'x'.repeat(70 * 1024) });
    const over = await orch('POST', '', { cookie: cookieA, body: big, key: ik('big') });
    assert.strictEqual(over.status, 413);
    assert.strictEqual(over.json.error, 'payload_too_large');
  });

  test('23. GET /api/agent-orchestrator/status still returns calendar/spine modules', async () => {
    const res = await request(app.baseUrl, 'GET', '/api/agent-orchestrator/status', { cookie: cookieA });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.ok, true);
    const ids = (res.json.modules || []).map((m) => m.id);
    assert.ok(ids.includes('calendar'));
    assert.ok(ids.includes('spine'));
  });

  test('25. timeline needs the distinct audit-history permission', async () => {
    const wf = await createWf(cookieA, { name: 'audit gate' });

    // Marketer holds orchestrator.workflows.view — enough for state and
    // approvals, deliberately not enough for the who-approved-what trail.
    const state = await orch('GET', `/${wf.id}`, { cookie: cookieM });
    assert.strictEqual(state.status, 200, state.text);
    const approvals = await orch('GET', `/${wf.id}/approvals`, { cookie: cookieM });
    assert.strictEqual(approvals.status, 200, approvals.text);
    const steps = await orch('GET', `/${wf.id}/steps`, { cookie: cookieM });
    assert.strictEqual(steps.status, 200, steps.text);

    const denied = await orch('GET', `/${wf.id}/timeline`, { cookie: cookieM });
    assert.strictEqual(denied.status, 403, denied.text);
    assert.strictEqual(denied.json.required, 'orchestrator.workflows.audit.view');
    assert.ok(!denied.text.includes('workflow_created'), 'no audit rows in a denial');

    const allowed = await orch('GET', `/${wf.id}/timeline`, { cookie: cookieA });
    assert.strictEqual(allowed.status, 200, allowed.text);
    assert.ok(Array.isArray(allowed.json.events));
  });

  test('26. every cross-tenant child read is 404, not an empty 200', async () => {
    const wf = await createWf(cookieA, { name: 'x-tenant children' });
    for (const sub of ['', '/timeline', '/approvals', '/steps']) {
      const res = await orch('GET', `/${wf.id}${sub}`, { cookie: cookieB });
      assert.strictEqual(res.status, 404, `GET /:id${sub} → ${res.status} ${res.text}`);
      assert.strictEqual(res.json.error, 'not_found');
    }
    for (const [path, body] of [
      ['/pause', {}],
      ['/cancel', {}],
      ['/recover', {}],
      ['/request-approval', { gate: 'research_execution' }],
    ]) {
      const res = await orch('POST', `/${wf.id}${path}`, {
        cookie: cookieB, body, key: ik('xt'),
      });
      assert.strictEqual(res.status, 404, `POST /:id${path} → ${res.status} ${res.text}`);
    }
    const patched = await orch('PATCH', `/${wf.id}`, {
      cookie: cookieB, body: { name: 'stolen' }, key: ik('xtp'),
    });
    assert.strictEqual(patched.status, 404, patched.text);
    const still = await orch('GET', `/${wf.id}`, { cookie: cookieA });
    assert.strictEqual(still.json.workflow.name, 'x-tenant children', 'tenant B must not have written');
  });

  test('27. owner-gate exemption is workflows-only and path-anchored', async () => {
    // The exemption exists so non-owner roles reach the workflow handlers.
    const list = await orch('GET', '', { cookie: cookieM });
    assert.strictEqual(list.status, 200, list.text);

    // …and nothing else on the hub. suggest/resolve/apply stay owner-gated.
    for (const p of ['/suggest', '/resolve', '/apply']) {
      const res = await request(app.baseUrl, 'POST', `/api/agent-orchestrator${p}`, {
        cookie: cookieM, body: {},
      });
      assert.strictEqual(res.status, 403, `POST ${p} → ${res.status} ${res.text}`);
      assert.strictEqual(res.json.error, 'owner_only');
    }
    const history = await request(app.baseUrl, 'GET', '/api/agent-orchestrator/history', { cookie: cookieM });
    assert.strictEqual(history.status, 403);
    assert.strictEqual(history.json.error, 'owner_only');

    // A look-alike prefix must not inherit the exemption.
    const lookalike = await request(app.baseUrl, 'GET', '/api/agent-orchestrator/workflows-export', {
      cookie: cookieM,
    });
    assert.strictEqual(lookalike.status, 403, lookalike.text);
    assert.strictEqual(lookalike.json.error, 'owner_only');
  });

  test('28. approve must state the version it read, and only approve a workflow', async () => {
    let wf = await createWf(cookieA, { name: 'version claim' });
    wf = await requestGate(cookieA, wf.id, 'research_execution');

    const blind = await orch('POST', `/${wf.id}/approve`, {
      cookie: cookieA,
      body: approveBody(wf, 'research_execution', { object_version: undefined }),
      key: ik('blind'),
    });
    assert.strictEqual(blind.status, 400, blind.text);
    assert.strictEqual(blind.json.error, 'validation_failed');

    const stale = await orch('POST', `/${wf.id}/approve`, {
      cookie: cookieA,
      body: approveBody(wf, 'research_execution', { object_version: Number(wf.version) + 5 }),
      key: ik('stale'),
    });
    assert.strictEqual(stale.status, 409, stale.text);
    assert.strictEqual(stale.json.error, 'approval_stale');

    const wrongType = await orch('POST', `/${wf.id}/approve`, {
      cookie: cookieA,
      body: approveBody(wf, 'research_execution', { object_type: 'tenant' }),
      key: ik('otype'),
    });
    assert.strictEqual(wrongType.status, 400, wrongType.text);

    const okRes = await orch('POST', `/${wf.id}/approve`, {
      cookie: cookieA, body: approveBody(wf, 'research_execution'), key: ik('good'),
    });
    assert.strictEqual(okRes.status, 200, okRes.text);
    const row = (await db.getPool().query(
      `SELECT object_type, actor_user_id, permission_snapshot
         FROM orchestrator_approvals WHERE tenant_id=$1 AND workflow_id=$2`,
      [tenantA.id, wf.id]
    )).rows[0];
    assert.strictEqual(row.object_type, 'workflow');
    assert.strictEqual(row.actor_user_id, ownerA.id, 'actor is the numeric user id');
    assert.ok(Array.isArray(row.permission_snapshot) && row.permission_snapshot.length > 0,
      'permission_snapshot must record the authority exercised');
    assert.ok(
      row.permission_snapshot.includes('orchestrator.workflows.approve.research_execution'),
      `snapshot must name the gate authority: ${JSON.stringify(row.permission_snapshot)}`
    );
  });

  test('29. editing currency or targeting after approval invalidates it', async () => {
    for (const over of [{ currency: 'JPY' }, { target_markets: ['DE'] }, { target_audiences: ['CFOs'] }]) {
      let wf = await createWf(cookieA, { name: `invalidate ${Object.keys(over)[0]}` });
      wf = await requestGate(cookieA, wf.id, 'research_execution');
      wf = await approveGate(cookieA, wf, 'research_execution');
      const v1 = Number(wf.version);

      const patch = await orch('PATCH', `/${wf.id}`, { cookie: cookieA, body: over, key: ik('inv') });
      assert.strictEqual(patch.status, 200, patch.text);
      assert.ok(Number(patch.json.workflow.version) > v1,
        `${Object.keys(over)[0]} must bump the version`);
      assert.strictEqual(patch.json.workflow.current_state, 'research_approval_required');

      const adv = await advanceWf(cookieA, wf.id);
      assert.strictEqual(adv.status, 409, adv.text);
      assert.ok(adv.json.error === 'approval_stale' || adv.json.error === 'approval_required', adv.json.error);
    }
  });

  test('30. body tenant_id / user_id are never trusted', async () => {
    const res = await orch('POST', '', {
      cookie: cookieA,
      body: createBody({
        name: 'body-tenant-spoof',
        tenant_id: tenantB.id,
        user_id: ownerB.id,
        created_by_user_id: ownerB.id,
        current_state: 'active',
        version: 99,
      }),
      key: ik('spoof'),
    });
    assert.ok(res.status === 200 || res.status === 201, res.text);
    const wf = res.json.workflow;
    assert.strictEqual(wf.created_by_user_id, ownerA.id, 'creator comes from the session');
    assert.strictEqual(wf.current_state, 'draft', 'state is not client-settable');
    assert.strictEqual(Number(wf.version), 1);

    const row = (await db.getPool().query(
      `SELECT tenant_id FROM orchestrator_workflows WHERE id=$1`, [wf.id]
    )).rows[0];
    assert.strictEqual(row.tenant_id, tenantA.id, 'row lands in the session tenant');
    const fromB = await orch('GET', `/${wf.id}`, { cookie: cookieB });
    assert.strictEqual(fromB.status, 404);
  });

  test('31. break-glass recover during a run stops the old holder advancing', async () => {
    let wf = await createWf(cookieA, { name: 'lease steal' });
    wf = await requestGate(cookieA, wf.id, 'research_execution');
    wf = await approveGate(cookieA, wf, 'research_execution');

    const inFlight = orch('POST', `/${wf.id}/advance`, {
      cookie: cookieA, body: {}, key: ik('inflight'), headers: { 'X-Orch-Test-Hold': '400' },
    });
    // Force-release the lease under the running advance.
    await new Promise((r) => setTimeout(r, 120));
    const rec = await orch('POST', `/${wf.id}/recover`, { cookie: cookieA, body: {}, key: ik('steal') });
    assert.strictEqual(rec.status, 200, rec.text);

    const res = await inFlight;
    assert.strictEqual(res.status, 409, `lost holder must not advance: ${res.status} ${res.text}`);
    assert.strictEqual(res.json.error, 'lease_conflict');

    const after = await orch('GET', `/${wf.id}`, { cookie: cookieA });
    assert.strictEqual(after.json.workflow.current_state, 'research_approved',
      'state stays where the recover left it — no double advance');
  });

  test('32. marketer cannot recover, and recover is refused after cancel', async () => {
    let wf = await createWf(cookieA, { name: 'recover deny' });
    const denied = await orch('POST', `/${wf.id}/recover`, {
      cookie: cookieM, body: {}, key: ik('mrec'),
    });
    assert.strictEqual(denied.status, 403, denied.text);
    assert.strictEqual(denied.json.required, 'orchestrator.workflows.recover');

    const cancelled = await orch('POST', `/${wf.id}/cancel`, { cookie: cookieA, body: {}, key: ik('rc') });
    assert.strictEqual(cancelled.status, 200, cancelled.text);
    const after = await orch('POST', `/${wf.id}/recover`, { cookie: cookieA, body: {}, key: ik('rac') });
    assert.strictEqual(after.status, 409);
    assert.strictEqual(after.json.error, 'recovery_not_allowed');
  });

  test('33. an idempotency key cannot be replayed onto another endpoint', async () => {
    const wf = await createWf(cookieA, { name: 'key reuse' });
    const key = ik('reuse');
    const paused = await orch('POST', `/${wf.id}/pause`, { cookie: cookieA, body: {}, key });
    assert.strictEqual(paused.status, 200, paused.text);
    const reused = await orch('POST', `/${wf.id}/cancel`, { cookie: cookieA, body: {}, key });
    assert.strictEqual(reused.status, 409, reused.text);
    assert.strictEqual(reused.json.error, 'idempotency_conflict');

    // Same key, other tenant → its own namespace, no collision and no replay.
    const wfB = await createWf(cookieB, { name: 'key reuse B' });
    const tenantBUse = await orch('POST', `/${wfB.id}/pause`, { cookie: cookieB, body: {}, key });
    assert.strictEqual(tenantBUse.status, 200, tenantBUse.text);
    assert.strictEqual(tenantBUse.json.workflow.id, wfB.id);
  });

  test('34. PATCH vs in-flight advance cannot apply research to a stale approval', async () => {
    let wf = await createWf(cookieA, { name: 'patch vs advance', currency: 'USD' });
    wf = await requestGate(cookieA, wf.id, 'research_execution');
    wf = await approveGate(cookieA, wf, 'research_execution');
    const approvedVersion = Number(wf.version);

    const [adv, patch] = await Promise.all([
      orch('POST', `/${wf.id}/advance`, {
        cookie: cookieA, body: {}, key: ik('pva-adv'),
        headers: { 'X-Orch-Test-Hold': '400' },
      }),
      (async () => {
        await new Promise((r) => setTimeout(r, 120));
        return orch('PATCH', `/${wf.id}`, {
          cookie: cookieA, body: { currency: 'JPY' }, key: ik('pva-patch'),
        });
      })(),
    ]);

    if (patch.status === 409) {
      assert.ok(
        patch.json.error === 'execution_in_progress' || patch.json.error === 'lease_conflict',
        `PATCH 409 must be execution_in_progress/lease_conflict, got ${patch.json.error}`
      );
    }
    if (adv.status === 409) {
      assert.ok(
        adv.json.error === 'approval_stale'
          || adv.json.error === 'approval_required'
          || adv.json.error === 'invalid_transition',
        `advance 409 must be approval freshness, got ${adv.json.error}`
      );
    }

    const got = await orch('GET', `/${wf.id}`, { cookie: cookieA });
    assert.strictEqual(got.status, 200, got.text);
    const settled = got.json.workflow;
    const appr = (await db.getPool().query(
      `SELECT object_version, content_hash FROM orchestrator_approvals
        WHERE tenant_id=$1 AND workflow_id=$2 AND gate='research_execution' AND decision='approved'
        ORDER BY created_at DESC LIMIT 1`,
      [tenantA.id, wf.id]
    )).rows[0];
    assert.ok(appr, 'research_execution approval must still exist');

    const postResearchApplied = [
      'research_running', 'research_complete',
      'generation_approval_required', 'generation_approved', 'generation_running',
    ].includes(settled.current_state);
    const boundChanged = settled.currency !== 'USD'
      || Number(settled.version) !== Number(appr.object_version);

    if (postResearchApplied) {
      assert.strictEqual(Number(settled.version), Number(appr.object_version),
        `post-research state ${settled.current_state} must match research_execution approval version`);
      assert.strictEqual(Number(settled.version), approvedVersion);
      assert.strictEqual(settled.currency, 'USD',
        'must not apply research after currency changed');
      assert.strictEqual(contentHash(settled, 'research_execution'), appr.content_hash);
    }
    if (boundChanged) {
      assert.ok(!postResearchApplied,
        `must not apply autonomous research after bound fields changed: state=${settled.current_state} version=${settled.version} currency=${settled.currency}`);
      assert.ok(Number(settled.version) !== Number(appr.object_version)
        || settled.currency !== 'USD');
    }

    if (patch.status === 409) {
      assert.strictEqual(adv.status, 200, `lease-blocked PATCH, advance should complete: ${adv.text}`);
      assert.strictEqual(settled.current_state, 'generation_approval_required');
      assert.strictEqual(settled.currency, 'USD');
      assert.strictEqual(Number(settled.version), approvedVersion);
    } else if (patch.status === 200 && adv.status === 409) {
      assert.notStrictEqual(settled.current_state, 'generation_approval_required');
      assert.strictEqual(settled.currency, 'JPY');
      assert.ok(Number(settled.version) > Number(appr.object_version));
    }
  });

  test('24. existing AgentOrchestrator panel still has error/empty copy', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'components/features/manage/AgentOrchestrator.tsx'),
      'utf8'
    );
    assert.match(src, />\s*Retry\s*</);
    assert.match(src, /No orchestrator modules are available right now\./);
  });
}
