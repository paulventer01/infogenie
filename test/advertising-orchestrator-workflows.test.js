'use strict';
// test/advertising-orchestrator-workflows.test.js — PR 1 control-plane integration.
//
// Live Postgres. File-level skip only when DATABASE_URL is missing.
// Concurrency (leases): two overlapping POST /advance calls (Promise.all) share
// one workflow. acquireLease uses SELECT … FOR UPDATE then a live lease row so
// one request wins and the other gets 409 lease_conflict / execution_in_progress.
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
const { contentHash, approvalSnapshot } = require('../services/agent_orchestrator/approvals');
const { canTransition, applyTransition, GATES } = require('../services/agent_orchestrator/states');

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

  test('24. existing AgentOrchestrator panel still has error/empty copy', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'components/features/manage/AgentOrchestrator.tsx'),
      'utf8'
    );
    assert.match(src, />\s*Retry\s*</);
    assert.match(src, /No orchestrator modules are available right now\./);
  });
}
