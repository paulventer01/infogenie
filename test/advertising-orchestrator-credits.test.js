'use strict';
// test/advertising-orchestrator-credits.test.js — PR 2 credit engines + APIs.
//
// Live Postgres. File-level skip only when DATABASE_URL is missing.
// ZERO per-test skips when HAS_DB.

process.env.PERMISSION_ENFORCEMENT = 'on';
process.env.MULTITENANT_ENFORCEMENT = 'on';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/infogenie';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

require('./helpers/env');

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const { bootApp, request, login, makeFixtures, hasDb } = require('./helpers');
const db = require('../db');
const { ensureTenantSchema } = require('../services/tenants/schema');
const { ensureAgentOrchestratorSchema } = require('../services/agent_orchestrator/schema');
const { sha256Hex } = require('../services/agent_orchestrator/hash');
const credits = require('../services/agent_orchestrator/credits');
const limits = require('../services/agent_orchestrator/limits');
const outbox = require('../services/agent_orchestrator/outbox');
const { fromPg } = require('../services/agent_orchestrator/money');
const { DEFAULT_REQUEST_MICROS } = require('../services/agent_orchestrator/pricing');
const { contentHash, materialChanged } = require('../services/agent_orchestrator/approvals');
const { capPayload } = require('../services/agent_orchestrator/payload_cap');

const HAS_DB = hasDb();
const http = require('node:http');

function runCapPayload(req) {
  let nextCalled = false;
  let resumed = false;
  if (typeof req.resume !== 'function') {
    req.resume = () => { resumed = true; };
  }
  const res = {
    headersSent: false,
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(b) { this.body = b; this.headersSent = true; return this; },
  };
  capPayload(req, res, () => { nextCalled = true; });
  return { nextCalled, resumed, res };
}

test('capPayload rejects misleading Content-Length when rawBody exceeds cap', () => {
  const big = 'x'.repeat(70 * 1024);
  const { nextCalled, res } = runCapPayload({
    method: 'POST',
    headers: { 'content-length': '10' },
    rawBody: big,
  });
  assert.strictEqual(nextCalled, false);
  assert.strictEqual(res.statusCode, 413);
  assert.strictEqual(res.body.ok, false);
  assert.strictEqual(res.body.error, 'payload_too_large');
});

test('capPayload rejects large rawBody when Content-Length is absent', () => {
  const big = 'x'.repeat(70 * 1024);
  const { nextCalled, res } = runCapPayload({
    method: 'POST',
    headers: {},
    rawBody: big,
  });
  assert.strictEqual(nextCalled, false);
  assert.strictEqual(res.statusCode, 413);
  assert.strictEqual(res.body.error, 'payload_too_large');
});

test('capPayload rejects large parsed body when rawBody is missing', () => {
  const body = { amount_micros: 1000, pad: 'x'.repeat(70 * 1024) };
  const { nextCalled, res } = runCapPayload({
    method: 'POST',
    headers: {},
    body,
  });
  assert.strictEqual(nextCalled, false);
  assert.strictEqual(res.statusCode, 413);
  assert.strictEqual(res.body.error, 'payload_too_large');
});

test('capPayload skips GET requests', () => {
  const { nextCalled, res } = runCapPayload({
    method: 'GET',
    headers: { 'content-length': '999999' },
    rawBody: 'x'.repeat(70 * 1024),
  });
  assert.strictEqual(nextCalled, true);
  assert.strictEqual(res.headersSent, false);
});

test('capPayload rejects unmeasurable body when Content-Length is missing', () => {
  const { nextCalled, resumed, res } = runCapPayload({
    method: 'POST',
    headers: {},
  });
  assert.strictEqual(nextCalled, false);
  assert.strictEqual(res.statusCode, 413);
  assert.strictEqual(res.body.ok, false);
  assert.strictEqual(res.body.error, 'payload_too_large');
  assert.strictEqual(resumed, true);
});

test('capPayload rejects misleading Content-Length when parser skipped the body', () => {
  const { nextCalled, resumed, res } = runCapPayload({
    method: 'POST',
    headers: { 'content-length': '10' },
  });
  assert.strictEqual(nextCalled, false);
  assert.strictEqual(res.statusCode, 413);
  assert.strictEqual(res.body.error, 'payload_too_large');
  assert.strictEqual(resumed, true);
});

test('capPayload allows provably empty body (Content-Length 0, no chunked TE)', () => {
  const { nextCalled, resumed, res } = runCapPayload({
    method: 'POST',
    headers: { 'content-length': '0' },
  });
  assert.strictEqual(nextCalled, true);
  assert.strictEqual(res.headersSent, false);
  assert.strictEqual(resumed, false);
});

test('capPayload rejects Content-Length 0 when Transfer-Encoding is chunked', () => {
  const { nextCalled, resumed, res } = runCapPayload({
    method: 'POST',
    headers: { 'content-length': '0', 'transfer-encoding': 'chunked' },
  });
  assert.strictEqual(nextCalled, false);
  assert.strictEqual(res.statusCode, 413);
  assert.strictEqual(res.body.error, 'payload_too_large');
  assert.strictEqual(resumed, true);
});

function ik(tag) {
  return `ik-${tag}-${crypto.randomBytes(8).toString('hex')}`;
}

function createBody(over) {
  return {
    name: 'Credit launch',
    objective: 'Acquire trial signups',
    product_or_service: 'Analytics suite',
    offer: '14-day trial',
    landing_page_url: 'https://example.com/trial',
    target_markets: ['US'],
    target_audiences: ['SMB marketers'],
    selected_platforms: ['meta'],
    advertising_budget: 1000,
    currency: 'USD',
    credit_ceiling_micros: 0,
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

test('credit_ceiling_micros is hashed and is a material field', () => {
  const wf = {
    id: 'ow_c',
    version: 1,
    selected_platforms: ['meta'],
    advertising_budget: 1000,
    credit_ceiling_micros: 0,
    currency: 'USD',
    landing_page_url: 'https://example.com/x',
    offer: 'trial',
    objective: 'signups',
    product_or_service: 'saas',
  };
  const h0 = contentHash(wf, 'research_execution');
  const h1 = contentHash({ ...wf, credit_ceiling_micros: 10_000 }, 'research_execution');
  assert.notStrictEqual(h0, h1);
  assert.strictEqual(materialChanged(wf, { ...wf, credit_ceiling_micros: 10_000 }), true);
  assert.strictEqual(materialChanged(wf, { ...wf, credit_ceiling_micros: 0 }), false);
});

if (!HAS_DB) {
  test('advertising-orchestrator credits skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else {
  const fx = makeFixtures();
  let app;
  let tenantA;
  let tenantB;
  let ownerA;
  let ownerB;
  let marketerA;
  let adminA;
  let cookieA;
  let cookieB;
  let cookieM;
  let cookieAdmin;

  function orch(method, urlPath, { cookie, body, headers, key } = {}) {
    const h = { ...(headers || {}) };
    if (key) h['Idempotency-Key'] = key;
    return request(app.baseUrl, method, `/api/agent-orchestrator/workflows${urlPath}`, {
      cookie, body, headers: h,
    });
  }

  function cred(method, urlPath, { cookie, body, headers, key } = {}) {
    const h = { ...(headers || {}) };
    if (key) h['Idempotency-Key'] = key;
    return request(app.baseUrl, method, `/api/agent-orchestrator/credits${urlPath}`, {
      cookie, body, headers: h,
    });
  }

  function credChunked(method, urlPath, { cookie, body, headers, key } = {}) {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const h = {
      'content-type': 'application/json',
      ...(headers || {}),
    };
    if (key) h['Idempotency-Key'] = key;
    if (cookie) h.cookie = cookie;
    return new Promise((resolve, reject) => {
      const r = http.request(`${app.baseUrl}/api/agent-orchestrator/credits${urlPath}`, {
        method, headers: h,
      }, (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c; });
        res.on('end', () => {
          let json = null;
          try { json = buf ? JSON.parse(buf) : null; } catch (_) { /* non-JSON */ }
          resolve({ status: res.statusCode, headers: res.headers, json, text: buf });
        });
      });
      r.on('error', reject);
      r.write(data);
      r.end();
    });
  }

  // Non-JSON body so express.json skips verify/rawBody. Omitting Content-Length
  // makes http.request use chunked Transfer-Encoding. Passing content-length in
  // headers lets the test lie independently of the bytes written.
  function credUnparsed(method, urlPath, { cookie, body, headers, key } = {}) {
    const data = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const h = {
      'content-type': 'text/plain',
      connection: 'close',
      ...(headers || {}),
    };
    if (key) h['Idempotency-Key'] = key;
    if (cookie) h.cookie = cookie;
    return new Promise((resolve, reject) => {
      const r = http.request(`${app.baseUrl}/api/agent-orchestrator/credits${urlPath}`, {
        method, headers: h,
      }, (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c; });
        res.on('end', () => {
          let json = null;
          try { json = buf ? JSON.parse(buf) : null; } catch (_) { /* non-JSON */ }
          resolve({ status: res.statusCode, headers: res.headers, json, text: buf });
        });
      });
      r.on('error', reject);
      r.write(data);
      r.end();
    });
  }

  // Sends a gzip body with an honest Content-Length. The header is truthful
  // about the bytes on the wire and still far below the cap, so only a check
  // against the decompressed body can reject the payload.
  function credGzip(method, urlPath, { cookie, body, headers, key } = {}) {
    const gz = zlib.gzipSync(Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8'));
    const h = {
      'content-type': 'application/json',
      'content-encoding': 'gzip',
      'content-length': String(gz.length),
      ...(headers || {}),
    };
    if (key) h['Idempotency-Key'] = key;
    if (cookie) h.cookie = cookie;
    return new Promise((resolve, reject) => {
      const r = http.request(`${app.baseUrl}/api/agent-orchestrator/credits${urlPath}`, {
        method, headers: h,
      }, (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c; });
        res.on('end', () => {
          let json = null;
          try { json = buf ? JSON.parse(buf) : null; } catch (_) { /* non-JSON */ }
          resolve({ status: res.statusCode, headers: res.headers, json, text: buf, wireBytes: gz.length });
        });
      });
      r.on('error', reject);
      r.write(gz);
      r.end();
    });
  }

  async function creditSnapshot(pool, tenantId) {
    const acct = (await pool.query(
      `SELECT available_micros, reserved_micros, consumed_micros
         FROM orchestrator_credit_accounts WHERE tenant_id=$1`,
      [tenantId]
    )).rows[0];
    const ledger = (await pool.query(
      `SELECT COUNT(*)::int AS n, COALESCE(MAX(id), 0)::text AS max_id
         FROM orchestrator_credit_ledger WHERE tenant_id=$1`,
      [tenantId]
    )).rows[0];
    const reservations = (await pool.query(
      `SELECT COUNT(*)::int AS n FROM orchestrator_credit_reservations WHERE tenant_id=$1`,
      [tenantId]
    )).rows[0];
    const limits = (await pool.query(
      `SELECT credit_ceiling_micros, provider_limits
         FROM orchestrator_tenant_limits WHERE tenant_id=$1`,
      [tenantId]
    )).rows[0];
    const idem = (await pool.query(
      `SELECT COUNT(*)::int AS n FROM orchestrator_idempotency_keys WHERE tenant_id=$1`,
      [tenantId]
    )).rows[0];
    return {
      account: acct ? {
        available_micros: String(acct.available_micros),
        reserved_micros: String(acct.reserved_micros),
        consumed_micros: String(acct.consumed_micros),
      } : null,
      ledgerCount: ledger.n,
      ledgerMaxId: ledger.max_id,
      reservationCount: reservations.n,
      limits: limits ? {
        credit_ceiling_micros: String(limits.credit_ceiling_micros),
        provider_limits: limits.provider_limits,
      } : null,
      idempotencyCount: idem.n,
    };
  }

  async function assertIdempotencyKeyAbsent(pool, tenantId, key) {
    const r = await pool.query(
      `SELECT 1 FROM orchestrator_idempotency_keys WHERE tenant_id=$1 AND key=$2`,
      [tenantId, key]
    );
    assert.strictEqual(r.rows.length, 0, `idempotency key ${key} must not be inserted`);
  }

  async function createWf(cookie, over, key) {
    const res = await orch('POST', '', { cookie, body: createBody(over), key: key || ik('c') });
    assert.ok(res.status === 200 || res.status === 201, `create status ${res.status} ${res.text}`);
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

  async function openTenantLimits(cookie, over) {
    const res = await cred('PUT', '/limits', {
      cookie,
      key: ik('lim'),
      body: {
        credit_ceiling_micros: 10_000_000,
        requests_per_minute: 60,
        max_concurrent_ai: 10,
        daily_ai_cost_micros: 10_000_000,
        monthly_ai_cost_micros: 50_000_000,
        per_workflow_cost_micros: 10_000_000,
        ...over,
      },
    });
    assert.strictEqual(res.status, 200, res.text);
    return res.json.limits;
  }

  async function grantMicros(cookie, amount, key) {
    const res = await cred('POST', '/grant', {
      cookie, key: key || ik('g'), body: { amount_micros: amount },
    });
    assert.strictEqual(res.status, 200, res.text);
    return res.json.account;
  }

  before(async () => {
    await fx.ensureSchemas();
    await ensureTenantSchema();
    await ensureAgentOrchestratorSchema();
    tenantA = await fx.seedTenant('Credits A');
    tenantB = await fx.seedTenant('Credits B');
    ownerA = await fx.seedUser({ tenantId: tenantA.id, owner: true });
    ownerB = await fx.seedUser({ tenantId: tenantB.id, owner: true });
    marketerA = await fx.seedUser({ tenantId: tenantA.id, owner: false, roleKey: 'marketer' });
    adminA = await fx.seedUser({ tenantId: tenantA.id, owner: false, roleKey: 'tenant_admin' });
    app = await bootApp();
    cookieA = (await login(app.baseUrl, ownerA.email, ownerA.password)).cookie;
    cookieB = (await login(app.baseUrl, ownerB.email, ownerB.password)).cookie;
    cookieM = (await login(app.baseUrl, marketerA.email, marketerA.password)).cookie;
    cookieAdmin = (await login(app.baseUrl, adminA.email, adminA.password)).cookie;
    assert.ok(cookieA && cookieB && cookieM && cookieAdmin);
  });

  after(async () => {
    if (app) await app.close();
    const ids = (fx.created.tenantIds || []).slice();
    if (ids.length && db.hasDb()) {
      await db.getPool().query(`DELETE FROM tenants WHERE id = ANY($1)`, [ids]);
    }
    await fx.cleanup();
  });

  test('14. marketer can view credits; cannot grant/adjust/edit limits; admin can grant', async () => {
    const view = await cred('GET', '', { cookie: cookieM });
    assert.strictEqual(view.status, 200, view.text);
    assert.strictEqual(view.json.ok, true);
    assert.strictEqual(view.json.account.available_micros, 0);
    assert.strictEqual(view.json.limits.credit_ceiling_micros, 0);

    const grantM = await cred('POST', '/grant', {
      cookie: cookieM, key: ik('mg'), body: { amount_micros: 10000 },
    });
    assert.strictEqual(grantM.status, 403, grantM.text);
    assert.ok(grantM.json.error === 'forbidden' || grantM.json.error === 'permission_denied');

    const adjM = await cred('POST', '/adjust', {
      cookie: cookieM, key: ik('ma'), body: { amount_micros: 10000, direction: 'credit', reason_code: 'refund' },
    });
    assert.strictEqual(adjM.status, 403);

    const limM = await cred('PUT', '/limits', {
      cookie: cookieM, key: ik('ml'), body: { credit_ceiling_micros: 1 },
    });
    assert.strictEqual(limM.status, 403);

    const grantA = await cred('POST', '/grant', {
      cookie: cookieAdmin, key: ik('ag'), body: { amount: 0.01 },
    });
    assert.strictEqual(grantA.status, 200, grantA.text);
    assert.strictEqual(grantA.json.account.available_micros, 10_000);
  });

  test('1. cross-tenant isolation (404) on credits + reservations', async () => {
    await openTenantLimits(cookieA);
    await grantMicros(cookieA, 50_000);
    const pool = db.getPool();
    const wf = await createWf(cookieA, { name: 'iso', credit_ceiling_micros: 1_000_000 });
    const reserved = await credits.reserve({
      pool,
      tenantId: tenantA.id,
      amountMicros: 10_000n,
      workflowId: wf.id,
      provider: 'placeholder',
      operation: 'test',
      model: 'stub-chargeable',
      estimatedMicros: 10_000n,
      actorUserId: ownerA.id,
      idempotencyKey: ik('iso-r'),
      runPreflight: false,
    });
    const id = reserved.reservation.id;

    const fromB = await cred('GET', '', { cookie: cookieB });
    assert.strictEqual(fromB.status, 200, fromB.text);
    assert.ok(!fromB.json.reservations.some((r) => r.id === id), 'tenant B must not see A reservations');
    assert.ok(fromB.json.account.available_micros === 0 || fromB.json.account.available_micros < 50_000);

    const resB = await cred('GET', `/reservations/${id}`, { cookie: cookieB });
    assert.strictEqual(resB.status, 404, resB.text);
    assert.strictEqual(resB.json.error, 'not_found');

    const resA = await cred('GET', `/reservations/${id}`, { cookie: cookieA });
    assert.strictEqual(resA.status, 200, resA.text);
    assert.strictEqual(resA.json.reservation.id, id);

    await assert.rejects(
      () => credits.commit({
        pool,
        tenantId: tenantB.id,
        reservationId: id,
        actualMicros: 10_000n,
        actorUserId: ownerB.id,
        idempotencyKey: ik('x-commit'),
      }),
      (err) => err && err.code === 'not_found'
    );
  });

  test('2. concurrent reservations do not over-commit or go negative', async () => {
    const pool = db.getPool();
    const tC = await fx.seedTenant('Credits concurrent');
    const uC = await fx.seedUser({ tenantId: tC.id, owner: true });
    await credits.grant({
      pool, tenantId: tC.id, amountMicros: 15_000n, actorUserId: uC.id, idempotencyKey: ik('cg'),
    });
    const results = await Promise.allSettled([
      credits.reserve({
        pool, tenantId: tC.id, amountMicros: 10_000n, runPreflight: false,
        actorUserId: uC.id, idempotencyKey: ik('cr1'),
      }),
      credits.reserve({
        pool, tenantId: tC.id, amountMicros: 10_000n, runPreflight: false,
        actorUserId: uC.id, idempotencyKey: ik('cr2'),
      }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const denied = results.filter((r) => r.status === 'rejected');
    assert.strictEqual(ok.length, 1, `exactly one reserve should succeed: ${JSON.stringify(results.map((r) => r.status === 'rejected' ? r.reason && r.reason.code : 'ok'))}`);
    assert.strictEqual(denied.length, 1);
    assert.strictEqual(denied[0].reason.code, 'insufficient_credits');

    const acct = (await pool.query(
      `SELECT available_micros, reserved_micros FROM orchestrator_credit_accounts WHERE tenant_id=$1`,
      [tC.id]
    )).rows[0];
    const avail = fromPg(acct.available_micros);
    const reserved = fromPg(acct.reserved_micros);
    assert.ok(avail >= 0n && reserved >= 0n, 'balances must stay non-negative');
    assert.strictEqual(reserved, 10_000n);
  });

  test('3. insufficient_credits on reserve and debit adjust', async () => {
    const pool = db.getPool();
    await assert.rejects(
      () => credits.reserve({
        pool, tenantId: tenantA.id, amountMicros: 9_000_000_000_000n, runPreflight: false,
        actorUserId: ownerA.id, idempotencyKey: ik('ins'),
      }),
      (err) => err && err.code === 'insufficient_credits'
    );
    const adj = await cred('POST', '/adjust', {
      cookie: cookieA, key: ik('deb'),
      body: { amount_micros: 9_000_000_000_000, direction: 'debit', reason_code: 'clawback' },
    });
    assert.strictEqual(adj.status, 409, adj.text);
    assert.strictEqual(adj.json.error, 'insufficient_credits');
  });

  test('4. credit_ceiling=0 fail-closed on chargeable advance', async () => {
    let wf = await createWf(cookieA, { name: 'ceil0', credit_ceiling_micros: 0 });
    wf = await requestGate(cookieA, wf.id, 'research_execution');
    wf = await approveGate(cookieA, wf, 'research_execution', { credit_ceiling: 0 });
    const adv = await orch('POST', `/${wf.id}/advance`, {
      cookie: cookieA, body: {}, key: ik('adv0'),
      headers: { 'x-orch-test-charge': '1' },
    });
    assert.strictEqual(adv.status, 409, adv.text);
    assert.strictEqual(adv.json.error, 'credit_ceiling_exceeded');
    const got = await orch('GET', `/${wf.id}`, { cookie: cookieA });
    assert.strictEqual(got.json.workflow.current_state, 'paused');
    assert.strictEqual(got.json.workflow.block_reason, 'credit_ceiling_exceeded');
    const steps = await orch('GET', `/${wf.id}/steps`, { cookie: cookieA });
    const last = steps.json.steps[steps.json.steps.length - 1];
    assert.ok(last.state === 'abandoned' || last.state === 'failed');
    assert.notStrictEqual(last.state, 'completed');
  });

  test('5. double-charge prevention: grant replay and commit replay', async () => {
    const key = ik('dbl-g');
    const first = await cred('POST', '/grant', {
      cookie: cookieA, key, body: { amount_micros: 20_000 },
    });
    assert.strictEqual(first.status, 200, first.text);
    const avail = first.json.account.available_micros;
    const second = await cred('POST', '/grant', {
      cookie: cookieA, key, body: { amount_micros: 20_000 },
    });
    assert.strictEqual(second.status, 200, second.text);
    assert.strictEqual(second.json.account.available_micros, avail);

    const pool = db.getPool();
    const r1 = await credits.reserve({
      pool, tenantId: tenantA.id, amountMicros: 10_000n, runPreflight: false,
      actorUserId: ownerA.id, idempotencyKey: ik('dbl-r'),
    });
    const ck = ik('dbl-c');
    const c1 = await credits.commit({
      pool, tenantId: tenantA.id, reservationId: r1.reservation.id,
      actualMicros: 10_000n, actorUserId: ownerA.id, idempotencyKey: ck,
    });
    const consumed = fromPg(c1.account.consumed_micros);
    const c2 = await credits.commit({
      pool, tenantId: tenantA.id, reservationId: r1.reservation.id,
      actualMicros: 10_000n, actorUserId: ownerA.id, idempotencyKey: ck,
    });
    assert.strictEqual(c2.replay, true);
    assert.strictEqual(fromPg(c2.account.consumed_micros), consumed);
  });

  test('6. reservation release on failure and on pause/cancel', async () => {
    await openTenantLimits(cookieA);
    await grantMicros(cookieA, 100_000);
    let wf = await createWf(cookieA, { name: 'rel', credit_ceiling_micros: 1_000_000 });
    wf = await requestGate(cookieA, wf.id, 'research_execution');
    wf = await approveGate(cookieA, wf, 'research_execution', {
      credit_ceiling_micros: 1_000_000,
    });

    const pool = db.getPool();
    const reserved = await credits.reserve({
      pool, tenantId: tenantA.id, amountMicros: DEFAULT_REQUEST_MICROS, workflowId: wf.id,
      runPreflight: false, actorUserId: ownerA.id, idempotencyKey: ik('rel-r'),
    });
    await credits.release({
      pool, tenantId: tenantA.id, reservationId: reserved.reservation.id,
      reasonCode: 'failed', idempotencyKey: ik('rel-x'),
    });
    const afterRel = (await pool.query(
      `SELECT status FROM orchestrator_credit_reservations WHERE id=$1 AND tenant_id=$2`,
      [reserved.reservation.id, tenantA.id]
    )).rows[0];
    assert.strictEqual(afterRel.status, 'released');

    await credits.reserve({
      pool, tenantId: tenantA.id, amountMicros: DEFAULT_REQUEST_MICROS, workflowId: wf.id,
      runPreflight: false, actorUserId: ownerA.id, idempotencyKey: ik('rel-r2'),
    });
    const paused = await orch('POST', `/${wf.id}/pause`, { cookie: cookieA, body: {}, key: ik('pz') });
    assert.strictEqual(paused.status, 200, paused.text);
    const left = await pool.query(
      `SELECT COUNT(*)::int AS n FROM orchestrator_credit_reservations
        WHERE tenant_id=$1 AND workflow_id=$2 AND status='reserved'`,
      [tenantA.id, wf.id]
    );
    assert.strictEqual(left.rows[0].n, 0);

    let wf2 = await createWf(cookieA, { name: 'rel-c', credit_ceiling_micros: 1_000_000 });
    await credits.reserve({
      pool, tenantId: tenantA.id, amountMicros: DEFAULT_REQUEST_MICROS, workflowId: wf2.id,
      runPreflight: false, actorUserId: ownerA.id, idempotencyKey: ik('rel-c'),
    });
    const cancelled = await orch('POST', `/${wf2.id}/cancel`, { cookie: cookieA, body: {}, key: ik('cx') });
    assert.strictEqual(cancelled.status, 200, cancelled.text);
    const left2 = await pool.query(
      `SELECT COUNT(*)::int AS n FROM orchestrator_credit_reservations
        WHERE tenant_id=$1 AND workflow_id=$2 AND status='reserved'`,
      [tenantA.id, wf2.id]
    );
    assert.strictEqual(left2.rows[0].n, 0);
  });

  test('7. stale idempotency recovery: expired pending lease, retry, one effect', async () => {
    const pool = db.getPool();
    const key = ik('stale');
    const body = { amount_micros: 11_000 };
    const endpoint = '/api/agent-orchestrator/credits/grant';
    const hash = sha256Hex({ ...body });
    await pool.query(
      `INSERT INTO orchestrator_idempotency_keys
         (tenant_id, key, endpoint, action, request_hash, response_status, response_body,
          status, owner_token, lease_expires_at)
       VALUES ($1,$2,$3,'grant',$4,0,'{}'::jsonb,'pending','old-owner', now() - interval '2 minutes')`,
      [tenantA.id, key, endpoint, hash]
    );
    const before = (await pool.query(
      `SELECT available_micros FROM orchestrator_credit_accounts WHERE tenant_id=$1`,
      [tenantA.id]
    )).rows[0];
    const beforeAvail = fromPg(before.available_micros);
    const res = await cred('POST', '/grant', { cookie: cookieA, key, body });
    assert.strictEqual(res.status, 200, res.text);
    const after = fromPg((await pool.query(
      `SELECT available_micros FROM orchestrator_credit_accounts WHERE tenant_id=$1`,
      [tenantA.id]
    )).rows[0].available_micros);
    assert.strictEqual(after - beforeAvail, 11_000n);
    const replay = await cred('POST', '/grant', { cookie: cookieA, key, body });
    assert.strictEqual(replay.status, 200);
    const after2 = fromPg((await pool.query(
      `SELECT available_micros FROM orchestrator_credit_accounts WHERE tenant_id=$1`,
      [tenantA.id]
    )).rows[0].available_micros);
    assert.strictEqual(after2, after);
  });

  test('8. concurrent idempotency retries: one wins, single side effect', async () => {
    const pool = db.getPool();
    const key = ik('conc');
    const body = { amount_micros: 13_000 };
    const endpoint = '/api/agent-orchestrator/credits/grant';
    const hash = sha256Hex({ ...body });
    await pool.query(
      `INSERT INTO orchestrator_idempotency_keys
         (tenant_id, key, endpoint, action, request_hash, response_status, response_body,
          status, owner_token, lease_expires_at)
       VALUES ($1,$2,$3,'grant',$4,0,'{}'::jsonb,'pending','old-owner', now() - interval '2 minutes')`,
      [tenantA.id, key, endpoint, hash]
    );
    const before = fromPg((await pool.query(
      `SELECT available_micros FROM orchestrator_credit_accounts WHERE tenant_id=$1`,
      [tenantA.id]
    )).rows[0].available_micros);
    const [a, b] = await Promise.all([
      cred('POST', '/grant', { cookie: cookieA, key, body }),
      cred('POST', '/grant', { cookie: cookieA, key, body }),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.ok(statuses.includes(200), `${a.status} ${a.text} / ${b.status} ${b.text}`);
    const other = statuses[0] === 200 ? statuses[1] : statuses[0];
    assert.ok(other === 200 || other === 409, `peer status ${other}`);
    if (other === 409) {
      const err = a.status === 409 ? a.json.error : b.json.error;
      assert.strictEqual(err, 'execution_in_progress');
    }
    const after = fromPg((await pool.query(
      `SELECT available_micros FROM orchestrator_credit_accounts WHERE tenant_id=$1`,
      [tenantA.id]
    )).rows[0].available_micros);
    assert.strictEqual(after - before, 13_000n);
  });

  test('9. outbox retries then dead-letter', async () => {
    const pool = db.getPool();
    const wf = await createWf(cookieA, { name: 'outbox' });
    const row = await credits.withTx({ pool }, async (c) => outbox.enqueue(c, {
      tenantId: tenantA.id,
      workflowId: wf.id,
      destination: 'internal',
      operation: 'noop',
      credentialRef: 'vault-key-id-test',
      idempotencyKey: ik('obx'),
      maxAttempts: 3,
    }));
    assert.ok(row.payload);
    assert.deepStrictEqual(Object.keys(row.payload).sort(), ['credential_ref', 'operation', 'workflow_id']);
    assert.ok(!JSON.stringify(row.payload).includes('sk-'));
    let last = row;
    for (let i = 0; i < 3; i += 1) {
      await pool.query(
        `UPDATE orchestrator_outbox SET next_attempt_at=now() - interval '1 second'
          WHERE tenant_id=$1 AND id=$2`,
        [tenantA.id, last.id]
      );
      last = await outbox.processOnce(pool, {
        tenantId: tenantA.id, workerId: 'test', failCode: 'publisher_unavailable',
      });
      assert.ok(last, `attempt ${i} should claim`);
    }
    assert.strictEqual(last.state, 'dead_letter');
    assert.strictEqual(last.last_error_code, 'publisher_unavailable');
    assert.strictEqual(Number(last.attempt_count), 3);
  });

  test('10. rate, concurrency, and tenant cost limits fail closed at zero and when exceeded', async () => {
    const pool = db.getPool();
    let wf = await createWf(cookieA, { name: 'lim', credit_ceiling_micros: 1_000_000 });
    await credits.withTx({ pool }, async (c) => {
      await limits.updateLimits(c, tenantA.id, {
        credit_ceiling_micros: 1_000_000,
        requests_per_minute: 0,
        max_concurrent_ai: 10,
        daily_ai_cost_micros: 1_000_000,
        monthly_ai_cost_micros: 1_000_000,
        per_workflow_cost_micros: 1_000_000,
      }, ownerA.id);
    });
    await assert.rejects(
      () => credits.withTx({ pool }, (c) => limits.preflight(c, {
        tenantId: tenantA.id, workflowId: wf.id, provider: 'placeholder', model: 'stub-chargeable',
        estimatedMicros: 10_000n,
      })),
      (err) => err && err.code === 'rate_limit_exceeded'
    );

    await credits.withTx({ pool }, async (c) => {
      await limits.updateLimits(c, tenantA.id, {
        requests_per_minute: 60, max_concurrent_ai: 0,
      }, ownerA.id);
    });
    await assert.rejects(
      () => credits.withTx({ pool }, (c) => limits.preflight(c, {
        tenantId: tenantA.id, workflowId: wf.id, provider: 'placeholder', model: 'stub-chargeable',
        estimatedMicros: 10_000n,
      })),
      (err) => err && err.code === 'concurrency_limit_exceeded'
    );

    await credits.withTx({ pool }, async (c) => {
      await limits.updateLimits(c, tenantA.id, {
        max_concurrent_ai: 10, daily_ai_cost_micros: 0,
      }, ownerA.id);
    });
    await assert.rejects(
      () => credits.withTx({ pool }, (c) => limits.preflight(c, {
        tenantId: tenantA.id, workflowId: wf.id, provider: 'placeholder', model: 'stub-chargeable',
        estimatedMicros: 10_000n,
      })),
      (err) => err && err.code === 'tenant_cost_limit_exceeded'
    );

    await openTenantLimits(cookieA, { requests_per_minute: 1 });
    await credits.grant({
      pool, tenantId: tenantA.id, amountMicros: 100_000n, actorUserId: ownerA.id, idempotencyKey: ik('rlg'),
    });
    await credits.withTx({ pool }, (c) => limits.preflight(c, {
      tenantId: tenantA.id, workflowId: wf.id, provider: 'placeholder', model: 'stub-chargeable',
      estimatedMicros: 10_000n, recordStart: true,
    }));
    await assert.rejects(
      () => credits.withTx({ pool }, (c) => limits.preflight(c, {
        tenantId: tenantA.id, workflowId: wf.id, provider: 'placeholder', model: 'stub-chargeable',
        estimatedMicros: 10_000n,
      })),
      (err) => err && err.code === 'rate_limit_exceeded'
    );
  });

  test('11. increasing credit_ceiling_micros or budget invalidates approval', async () => {
    let wf = await createWf(cookieA, { name: 'inv-ceil', credit_ceiling_micros: 10_000 });
    wf = await requestGate(cookieA, wf.id, 'research_execution');
    wf = await approveGate(cookieA, wf, 'research_execution', { credit_ceiling_micros: 10_000 });
    const v1 = Number(wf.version);
    const patch = await orch('PATCH', `/${wf.id}`, {
      cookie: cookieA, body: { credit_ceiling_micros: 50_000 }, key: ik('pceil'),
    });
    assert.strictEqual(patch.status, 200, patch.text);
    assert.ok(Number(patch.json.workflow.version) > v1);
    assert.strictEqual(patch.json.workflow.current_state, 'research_approval_required');
    assert.strictEqual(patch.json.workflow.credit_ceiling_micros, 50_000);

    let wf2 = await createWf(cookieA, { name: 'inv-bud' });
    wf2 = await requestGate(cookieA, wf2.id, 'research_execution');
    wf2 = await approveGate(cookieA, wf2, 'research_execution');
    const patch2 = await orch('PATCH', `/${wf2.id}`, {
      cookie: cookieA, body: { advertising_budget: 2000 }, key: ik('pbud'),
    });
    assert.strictEqual(patch2.status, 200, patch2.text);
    assert.strictEqual(patch2.json.workflow.current_state, 'research_approval_required');
  });

  test('12. pause during chargeable advance releases reservation and is not reverted', async () => {
    await openTenantLimits(cookieA);
    await grantMicros(cookieA, 200_000);
    let wf = await createWf(cookieA, { name: 'chg-pause', credit_ceiling_micros: 1_000_000 });
    wf = await requestGate(cookieA, wf.id, 'research_execution');
    wf = await approveGate(cookieA, wf, 'research_execution', { credit_ceiling_micros: 1_000_000 });

    const [adv, pause] = await Promise.all([
      orch('POST', `/${wf.id}/advance`, {
        cookie: cookieA, body: {}, key: ik('chg-adv'),
        headers: { 'X-Orch-Test-Hold': '400', 'x-orch-test-charge': '1' },
      }),
      (async () => {
        await new Promise((r) => setTimeout(r, 120));
        return orch('POST', `/${wf.id}/pause`, { cookie: cookieA, body: {}, key: ik('chg-pz') });
      })(),
    ]);
    assert.strictEqual(pause.status, 200, pause.text);
    const settled = (await orch('GET', `/${wf.id}`, { cookie: cookieA })).json.workflow;
    assert.strictEqual(settled.current_state, 'paused');
    const reserved = await db.getPool().query(
      `SELECT COUNT(*)::int AS n FROM orchestrator_credit_reservations
        WHERE tenant_id=$1 AND workflow_id=$2 AND status='reserved'`,
      [tenantA.id, wf.id]
    );
    assert.strictEqual(reserved.rows[0].n, 0, 'pause must release reserved credits');
    if (adv.status === 409) {
      assert.ok(
        adv.json.error === 'workflow_paused' || adv.json.error === 'credit_ceiling_exceeded',
        adv.text
      );
    }
  });

  test('13. SSRF landing_page_url: http, loopback, userinfo are rejected', async () => {
    for (const url of [
      'http://example.com/trial',
      'https://127.0.0.1/',
      'https://user:pass@example.com/trial',
    ]) {
      const res = await orch('POST', '', {
        cookie: cookieA, body: createBody({ name: `ssrf ${url}`, landing_page_url: url }), key: ik('ssrf'),
      });
      assert.strictEqual(res.status, 400, `${url} → ${res.status} ${res.text}`);
      assert.ok(res.json.error === 'unsafe_url' || res.json.error === 'validation_failed', res.json.error);
    }
    const ok = await orch('POST', '', {
      cookie: cookieA, body: createBody({ name: 'ssrf ok' }), key: ik('ssrf-ok'),
    });
    assert.ok(ok.status === 200 || ok.status === 201, ok.text);
  });

  test('15. ledger UPDATE is rejected by immutability trigger', async () => {
    const pool = db.getPool();
    await credits.grant({
      pool, tenantId: tenantA.id, amountMicros: 1000n, actorUserId: ownerA.id, idempotencyKey: ik('imm'),
    });
    const row = (await pool.query(
      `SELECT id FROM orchestrator_credit_ledger WHERE tenant_id=$1 ORDER BY id DESC LIMIT 1`,
      [tenantA.id]
    )).rows[0];
    await assert.rejects(
      () => pool.query(`UPDATE orchestrator_credit_ledger SET reason_code='tamper' WHERE id=$1`, [row.id]),
      /orchestrator_credit_ledger_immutable/
    );
  });

  test('GET pricing returns placeholder catalog; GET ledger is tenant-filtered', async () => {
    const pricing = await cred('GET', '/pricing', { cookie: cookieA });
    assert.strictEqual(pricing.status, 200, pricing.text);
    assert.ok(Array.isArray(pricing.json.catalog) && pricing.json.catalog.length > 0, pricing.text);
    assert.ok(pricing.json.catalog.some((r) => r.provider === 'placeholder' && r.model_or_service === 'stub-chargeable'));

    const ledA = await cred('GET', '/ledger', { cookie: cookieA });
    assert.strictEqual(ledA.status, 200);
    for (const e of ledA.json.ledger) {
      assert.ok(!('actor_user_id' in e), 'ledger must not expose actor as PII');
    }
    const ledB = await cred('GET', '/ledger', { cookie: cookieB });
    const idsA = new Set(ledA.json.ledger.map((e) => String(e.id)));
    for (const e of ledB.json.ledger) {
      assert.ok(!idsA.has(String(e.id)), 'tenant B must not see tenant A ledger ids');
    }
  });

  // ── Security re-review locks (PR 2) ───────────────────────────────────────

  test('16. an approval cannot claim a ceiling above the workflow it binds', async () => {
    let wf = await createWf(cookieA, { name: 'ceil-over', credit_ceiling_micros: 10_000 });
    wf = await requestGate(cookieA, wf.id, 'research_execution');

    // Spend is enforced against the workflow's credit_ceiling_micros, so an
    // approval recording more than that would overstate what was authorised.
    const over = await orch('POST', `/${wf.id}/approve`, {
      cookie: cookieA,
      key: ik('ap-over'),
      body: approveBody(wf, 'research_execution', { credit_ceiling_micros: 50_000 }),
    });
    assert.strictEqual(over.status, 409, over.text);
    assert.strictEqual(over.json.error, 'approval_scope_mismatch');

    // Equal to the bound ceiling is the authorisation the gate exists to record.
    const exact = await orch('POST', `/${wf.id}/approve`, {
      cookie: cookieA,
      key: ik('ap-exact'),
      body: approveBody(wf, 'research_execution', { credit_ceiling_micros: 10_000 }),
    });
    assert.strictEqual(exact.status, 200, exact.text);
    assert.strictEqual(exact.json.approval.approved_credit_ceiling_micros, 10_000);
  });

  test('17. the credits read withholds workflow names from a credits-only role', async () => {
    const pool = db.getPool();
    // A tenant role holding the two credit `.view` keys and nothing else. No
    // system role is shaped this way, and the point of the test is that
    // `orchestrator.credits.view` is authority over cost facts, not over the
    // free text an operator typed into a workflow.
    const role = (await pool.query(
      `INSERT INTO roles (tenant_id, key, name, description, scope, is_system, permissions)
       VALUES ($1, 'credits_only', 'Credits Only', 'test', 'tenant', FALSE, $2::jsonb)
       ON CONFLICT (tenant_id, key) WHERE tenant_id IS NOT NULL
         DO UPDATE SET permissions=EXCLUDED.permissions
       RETURNING id`,
      [tenantA.id, JSON.stringify([
        'dashboard.view', 'orchestrator.credits.view', 'orchestrator.credits.limits.view',
      ])]
    )).rows[0];
    const creditsOnly = await fx.seedUser({ tenantId: tenantA.id, owner: false });
    await pool.query(
      `UPDATE tenant_users SET role_id=$1 WHERE tenant_id=$2 AND user_id=$3`,
      [role.id, tenantA.id, creditsOnly.id]
    );
    const cookieC = (await login(app.baseUrl, creditsOnly.email, creditsOnly.password)).cookie;
    assert.ok(cookieC, 'credits-only user must be able to log in');

    const named = 'Confidential Q4 acquisition push';
    const wf = await createWf(cookieA, { name: named, credit_ceiling_micros: 10_000 });

    const restricted = await cred('GET', '', { cookie: cookieC });
    assert.strictEqual(restricted.status, 200, restricted.text);
    assert.ok(!restricted.text.includes(named), 'a credits-only role must not read workflow names');
    const seen = restricted.json.workflows.find((w) => w.id === wf.id);
    assert.ok(seen, 'the cost facts for the workflow are still disclosed');
    assert.strictEqual(seen.name, null);
    assert.ok('block_reason' in seen && 'credit_ceiling_micros' in seen,
      'block reason and ceiling are cost facts and stay visible');

    // A role that could read the name from the workflows surface still sees it.
    const wide = await cred('GET', '', { cookie: cookieM });
    const wideSeen = wide.json.workflows.find((w) => w.id === wf.id);
    assert.strictEqual(wideSeen.name, named);
  });

  test('18. a credits read does not lock the tenant credit account row', async () => {
    const pool = db.getPool();
    const reader = await pool.connect();
    try {
      await reader.query('BEGIN');
      await credits.ensureAccount(reader, tenantA.id, { lock: false });
      // NOWAIT turns "somebody holds this row" into an error instead of a wait,
      // so this asserts the reserve path is not queued behind a viewer.
      await pool.query(
        `SELECT tenant_id FROM orchestrator_credit_accounts
          WHERE tenant_id=$1 FOR UPDATE NOWAIT`,
        [tenantA.id]
      );
    } finally {
      await reader.query('ROLLBACK').catch(() => {});
      reader.release();
    }

    // The mutating path must still serialise — that is what stops two
    // reservations both passing the ceiling check.
    const writer = await pool.connect();
    try {
      await writer.query('BEGIN');
      await credits.ensureAccount(writer, tenantA.id);
      await assert.rejects(
        () => pool.query(
          `SELECT tenant_id FROM orchestrator_credit_accounts
            WHERE tenant_id=$1 FOR UPDATE NOWAIT`,
          [tenantA.id]
        ),
        (err) => err && err.code === '55P03'
      );
    } finally {
      await writer.query('ROLLBACK').catch(() => {});
      writer.release();
    }
  });

  test('19. the outbox refuses a credential_ref that is not an opaque handle', async () => {
    const pool = db.getPool();
    const wf = await createWf(cookieA, { name: 'obx-ref' });
    for (const bad of [
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln',      // JWT
      'sk-live-AbCdEf0123456789',                        // provider key prefix
      'Bearer abc123',                                   // header value (space)
      'https://hooks.example.com/t/AAA/BBB/ccc',         // signed webhook URL
      'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A=',               // base64/PEM material
      `x${'y'.repeat(200)}`,                             // unbounded blob
    ]) {
      await assert.rejects(
        () => credits.withTx({ pool }, (c) => outbox.enqueue(c, {
          tenantId: tenantA.id,
          workflowId: wf.id,
          destination: 'internal',
          operation: 'noop',
          credentialRef: bad,
          idempotencyKey: ik('obx-bad'),
        })),
        (err) => err && err.code === 'validation_failed',
        `credential_ref must refuse ${bad.slice(0, 24)}`
      );
    }

    // An opaque vault handle is accepted and is the only thing that reaches the
    // row or the sanitized payload.
    const ok = await credits.withTx({ pool }, (c) => outbox.enqueue(c, {
      tenantId: tenantA.id,
      workflowId: wf.id,
      destination: 'internal',
      operation: 'noop',
      credentialRef: 'user_integrations:4821',
      idempotencyKey: ik('obx-good'),
    }));
    assert.strictEqual(ok.credential_ref, 'user_integrations:4821');
    assert.strictEqual(ok.payload.credential_ref, 'user_integrations:4821');

    // Provider error text never reaches the operator-readable row or the log.
    await pool.query(
      `UPDATE orchestrator_outbox SET next_attempt_at=now() - interval '1 second'
        WHERE tenant_id=$1 AND id=$2`,
      [tenantA.id, ok.id]
    );
    const failed = await outbox.processOnce(pool, {
      tenantId: tenantA.id,
      workerId: 'test',
      failCode: 'Invalid access token for ad account act_123 (user bob@example.com)',
    });
    assert.strictEqual(failed.last_error_code, 'outbox_failed');
  });

  test('non-chargeable stub advance still works with credit_ceiling 0', async () => {
    let wf = await createWf(cookieA, { name: 'stub0', credit_ceiling_micros: 0 });
    wf = await requestGate(cookieA, wf.id, 'research_execution');
    wf = await approveGate(cookieA, wf, 'research_execution', { credit_ceiling: 0 });
    const adv = await orch('POST', `/${wf.id}/advance`, {
      cookie: cookieA, body: {}, key: ik('stub0'),
    });
    assert.strictEqual(adv.status, 200, adv.text);
    assert.strictEqual(adv.json.workflow.current_state, 'generation_approval_required');
  });

  test('20. credits mutation payload cap rejects oversized bodies without side effects', async () => {
    const pool = db.getPool();
    const baseline = await creditSnapshot(pool, tenantA.id);

    const keyG = ik('cap-g');
    const overG = await cred('POST', '/grant', {
      cookie: cookieA,
      key: keyG,
      body: { amount_micros: 1000, pad: 'x'.repeat(70 * 1024) },
    });
    assert.strictEqual(overG.status, 413, overG.text);
    assert.strictEqual(overG.json.error, 'payload_too_large');
    assert.deepStrictEqual(await creditSnapshot(pool, tenantA.id), baseline);
    await assertIdempotencyKeyAbsent(pool, tenantA.id, keyG);

    const keyA = ik('cap-a');
    const overA = await cred('POST', '/adjust', {
      cookie: cookieA,
      key: keyA,
      body: {
        amount_micros: 1000,
        direction: 'credit',
        reason_code: 'refund',
        pad: 'x'.repeat(70 * 1024),
      },
    });
    assert.strictEqual(overA.status, 413, overA.text);
    assert.strictEqual(overA.json.error, 'payload_too_large');
    assert.deepStrictEqual(await creditSnapshot(pool, tenantA.id), baseline);
    await assertIdempotencyKeyAbsent(pool, tenantA.id, keyA);

    const keyL = ik('cap-l');
    const overL = await cred('PUT', '/limits', {
      cookie: cookieAdmin,
      key: keyL,
      body: {
        credit_ceiling_micros: 999999,
        provider_limits: { pad: 'x'.repeat(70 * 1024) },
      },
    });
    assert.strictEqual(overL.status, 413, overL.text);
    assert.strictEqual(overL.json.error, 'payload_too_large');
    assert.deepStrictEqual(await creditSnapshot(pool, tenantA.id), baseline);
    await assertIdempotencyKeyAbsent(pool, tenantA.id, keyL);

    const keyC = ik('cap-chunk');
    const overC = await credChunked('POST', '/grant', {
      cookie: cookieA,
      key: keyC,
      body: { amount_micros: 1000, pad: 'x'.repeat(70 * 1024) },
    });
    assert.strictEqual(overC.status, 413, overC.text);
    assert.strictEqual(overC.json.error, 'payload_too_large');
    assert.deepStrictEqual(await creditSnapshot(pool, tenantA.id), baseline);
    await assertIdempotencyKeyAbsent(pool, tenantA.id, keyC);
  });

  test('21. the payload cap measures the decompressed body, not the wire bytes', async () => {
    const pool = db.getPool();
    const baseline = await creditSnapshot(pool, tenantA.id);

    // A gzip body whose Content-Length is honest and small. Anything that
    // trusts Content-Length, or that measures the compressed bytes, lets an
    // arbitrarily large payload reach grant/adjust and the request hash.
    const keyZ = ik('cap-gzip');
    const overZ = await credGzip('POST', '/grant', {
      cookie: cookieA,
      key: keyZ,
      body: { amount_micros: 1000, pad: 'x'.repeat(70 * 1024) },
    });
    assert.ok(overZ.wireBytes < 64 * 1024, `gzip wire bytes ${overZ.wireBytes} must be under the cap`);
    assert.strictEqual(overZ.status, 413, overZ.text);
    assert.strictEqual(overZ.json.error, 'payload_too_large');
    assert.deepStrictEqual(await creditSnapshot(pool, tenantA.id), baseline);
    await assertIdempotencyKeyAbsent(pool, tenantA.id, keyZ);

    // A gzip body that is under the cap once decompressed still succeeds, so
    // the cap is measuring size rather than refusing compression outright.
    const keyOk = ik('cap-gzip-ok');
    const okZ = await credGzip('POST', '/grant', {
      cookie: cookieA,
      key: keyOk,
      body: { amount_micros: 1000 },
    });
    assert.strictEqual(okZ.status, 200, okZ.text);
    assert.strictEqual(okZ.json.ok, true);
  });

  test('22. unparsed non-JSON bodies fail closed before credit mutation', async () => {
    const pool = db.getPool();
    const baseline = await creditSnapshot(pool, tenantA.id);
    const pad = 'x'.repeat(70 * 1024);

    const keyG = ik('cap-plain-g');
    const overG = await credUnparsed('POST', '/grant', {
      cookie: cookieA,
      key: keyG,
      body: pad,
    });
    assert.strictEqual(overG.status, 413, overG.text);
    assert.strictEqual(overG.json.error, 'payload_too_large');
    assert.deepStrictEqual(await creditSnapshot(pool, tenantA.id), baseline);
    await assertIdempotencyKeyAbsent(pool, tenantA.id, keyG);

    const keyA = ik('cap-plain-a');
    const overA = await credUnparsed('POST', '/adjust', {
      cookie: cookieA,
      key: keyA,
      body: pad,
    });
    assert.strictEqual(overA.status, 413, overA.text);
    assert.strictEqual(overA.json.error, 'payload_too_large');
    assert.deepStrictEqual(await creditSnapshot(pool, tenantA.id), baseline);
    await assertIdempotencyKeyAbsent(pool, tenantA.id, keyA);

    const keyL = ik('cap-plain-l');
    const overL = await credUnparsed('PUT', '/limits', {
      cookie: cookieAdmin,
      key: keyL,
      body: pad,
    });
    assert.strictEqual(overL.status, 413, overL.text);
    assert.strictEqual(overL.json.error, 'payload_too_large');
    assert.deepStrictEqual(await creditSnapshot(pool, tenantA.id), baseline);
    await assertIdempotencyKeyAbsent(pool, tenantA.id, keyL);

    const keyM = ik('cap-plain-mislead');
    const overM = await credUnparsed('POST', '/grant', {
      cookie: cookieA,
      key: keyM,
      headers: { 'content-length': '10' },
      body: pad,
    });
    assert.strictEqual(overM.status, 413, overM.text);
    assert.strictEqual(overM.json.error, 'payload_too_large');
    assert.deepStrictEqual(await creditSnapshot(pool, tenantA.id), baseline);
    await assertIdempotencyKeyAbsent(pool, tenantA.id, keyM);
  });
}
