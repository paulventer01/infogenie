'use strict';
// test/playbooks-rate-limit.test.js — fail-closed per-tenant rate limit on
// authenticated /api/playbooks. Env overrides MUST be set before requiring
// helpers (helpers → server.js → vertical_playbooks/api.js, which reads max
// at module load when NODE_ENV === 'test').

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.PLAYBOOKS_RATE_LIMIT_MAX = '3';
process.env.PLAYBOOKS_GENERATE_RATE_LIMIT_MAX = '2';
// Force dummy keys before helpers/server load so generate-custom cannot hit a
// live OpenAI credential injected into this environment.
process.env.AI_INTEGRATIONS_OPENAI_API_KEY = '_DUMMY_PLAYBOOKS_RL';
process.env.OPENAI_API_KEY = '_DUMMY_PLAYBOOKS_RL';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const playbooksApi = require('../services/vertical_playbooks/api');
const { playbooksTenantGuard, tenantIdFromAuthContext } = playbooksApi;
const { bootApp, request, login, makeFixtures, hasDb } = require('./helpers');
const { ensureVerticalPlaybooksSchema } = require('../services/vertical_playbooks/schema');
const db = require('../db');
const OpenAI = require('openai');

// generate-custom has no dummy-key gate; it always constructs the SDK. Stub
// chat.completions.create so this file never waits on api.openai.com.
const _oaProbe = new OpenAI({ apiKey: '_DUMMY_PLAYBOOKS_RL' });
const _completionsProto = Object.getPrototypeOf(_oaProbe.chat.completions);
_completionsProto.create = async function () {
  throw new Error('openai_stubbed_playbooks_rate_limit');
};

const SHARED_MAX = Number.parseInt(process.env.PLAYBOOKS_RATE_LIMIT_MAX, 10);
const GENERATE_MAX = Number.parseInt(process.env.PLAYBOOKS_GENERATE_RATE_LIMIT_MAX, 10);
const skipDb = !hasDb() && 'no DATABASE_URL';

function fakeRes() {
  const headers = {};
  const state = { statusCode: 200, body: null, headers, nextCalled: false };
  const res = {
    setHeader(k, v) { headers[k] = v; return res; },
    status(code) { state.statusCode = code; return res; },
    json(body) { state.body = body; return res; },
  };
  return { res, state };
}

async function seedPlaybooksOwner() {
  const fx = makeFixtures();
  await fx.ensureSchemas();
  await ensureVerticalPlaybooksSchema();
  const tenant = await fx.seedTenant();
  const owner = await fx.seedUser({ tenantId: tenant.id, owner: true });
  return { fx, tenant, owner };
}

async function cleanupTenantPlaybooks(tenantIds) {
  const ids = (tenantIds || []).filter((id) => Number.isFinite(id));
  if (!ids.length || !hasDb()) return;
  const p = db.getPool();
  await p.query('DELETE FROM active_playbooks WHERE tenant_id = ANY($1)', [ids]);
  await p.query('DELETE FROM vertical_playbooks WHERE tenant_id = ANY($1)', [ids]);
}

function retryAfterSec(res) {
  const header = res.headers['retry-after'];
  const n = Number.parseInt(String(header), 10);
  return { header, n };
}

// ── Unit: fail-closed tenant key (no DB) ─────────────────────────────────────

test('playbooksTenantGuard fail-closed: missing tenant does not call next', () => {
  const { res, state } = fakeRes();
  let nextCount = 0;
  playbooksTenantGuard({ tenant: null, body: {}, query: {}, headers: {} }, res, () => { nextCount += 1; });
  assert.equal(nextCount, 0);
  assert.equal(state.statusCode, 400);
  assert.equal(state.body && state.body.ok, false);
  assert.equal(state.body && state.body.error, 'no_tenant');
});

test('playbooksTenantGuard fail-closed: tenant id 0 does not call next', () => {
  const { res, state } = fakeRes();
  let nextCount = 0;
  playbooksTenantGuard({ tenant: { id: 0 }, body: {}, query: {}, headers: {} }, res, () => { nextCount += 1; });
  assert.equal(nextCount, 0);
  assert.equal(state.statusCode, 400);
  assert.equal(state.body && state.body.error, 'no_tenant');
});

test('playbooksTenantGuard fail-closed: non-numeric tenant id does not call next', () => {
  const { res, state } = fakeRes();
  let nextCount = 0;
  playbooksTenantGuard({ tenant: { id: 'nope' }, body: {}, query: {}, headers: {} }, res, () => { nextCount += 1; });
  assert.equal(nextCount, 0);
  assert.equal(state.statusCode, 400);
  assert.equal(state.body && state.body.error, 'no_tenant');
});

test('tenant key ignores body/header/query when req.tenant.id is valid', () => {
  const req = {
    tenant: { id: 7 },
    body: { tenant_id: 99 },
    query: { tenant_id: '99' },
    headers: { 'x-tenant-id': '99', 'X-Tenant-Id': '99', tenant_id: '99' },
  };
  assert.equal(tenantIdFromAuthContext(req), 7);

  const { res, state } = fakeRes();
  let nextCount = 0;
  playbooksTenantGuard(req, res, () => { nextCount += 1; });
  assert.equal(nextCount, 1);
  assert.equal(state.statusCode, 200);
  assert.equal(state.body, null);
});

test('tenantIdFromAuthContext never reads spoofed ids when context is missing', () => {
  const req = {
    tenant: null,
    body: { tenant_id: 99 },
    query: { tenant_id: '99' },
    headers: { 'x-tenant-id': '99', tenant_id: '99' },
  };
  assert.equal(tenantIdFromAuthContext(req), null);
});

// ── Integration: authenticated HTTP ──────────────────────────────────────────

test('GET /api/playbooks/list below the limit succeeds', { skip: skipDb }, async (t) => {
  const { fx, tenant, owner } = await seedPlaybooksOwner();
  const app = await bootApp();
  t.after(async () => {
    await app.close();
    await cleanupTenantPlaybooks([tenant.id]);
    await fx.cleanup();
  });

  const { cookie, status: loginStatus } = await login(app.baseUrl, owner.email, owner.password);
  assert.equal(loginStatus, 200);
  assert.ok(cookie);

  const res = await request(app.baseUrl, 'GET', '/api/playbooks/list', { cookie });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json && res.json.ok, true);
  assert.ok(Array.isArray(res.json.playbooks));
});

test('requests exceeding the shared limit receive 429 rate_limited', { skip: skipDb }, async (t) => {
  const { fx, tenant, owner } = await seedPlaybooksOwner();
  const app = await bootApp();
  t.after(async () => {
    await app.close();
    await cleanupTenantPlaybooks([tenant.id]);
    await fx.cleanup();
  });

  const { cookie } = await login(app.baseUrl, owner.email, owner.password);
  const results = [];
  for (let i = 0; i < SHARED_MAX + 1; i++) {
    results.push(await request(app.baseUrl, 'GET', '/api/playbooks/list', { cookie }));
  }
  const ok = results.filter((r) => r.status === 200);
  const limited = results.filter((r) => r.status === 429);
  assert.equal(ok.length, SHARED_MAX);
  assert.equal(limited.length, 1);
  assert.equal(limited[0].json && limited[0].json.ok, false);
  assert.equal(limited[0].json.error, 'rate_limited');
});

test('429 includes Retry-After seconds matching body retryAfterSec', { skip: skipDb }, async (t) => {
  const { fx, tenant, owner } = await seedPlaybooksOwner();
  const app = await bootApp();
  t.after(async () => {
    await app.close();
    await cleanupTenantPlaybooks([tenant.id]);
    await fx.cleanup();
  });

  const { cookie } = await login(app.baseUrl, owner.email, owner.password);
  let limited = null;
  for (let i = 0; i < SHARED_MAX + 1; i++) {
    const res = await request(app.baseUrl, 'GET', '/api/playbooks/list', { cookie });
    if (res.status === 429) { limited = res; break; }
  }
  assert.ok(limited, 'expected a 429 after exhausting the shared bucket');
  const { header, n } = retryAfterSec(limited);
  assert.ok(header, 'Retry-After header must be present');
  assert.equal(Number.isInteger(n) && n > 0, true, `Retry-After must be a positive integer, got ${header}`);
  assert.equal(limited.json.retryAfterSec, n);
  assert.equal(limited.json.error, 'rate_limited');
});

test('concurrent burst cannot produce more than max successes', { skip: skipDb }, async (t) => {
  const { fx, tenant, owner } = await seedPlaybooksOwner();
  const app = await bootApp();
  t.after(async () => {
    await app.close();
    await cleanupTenantPlaybooks([tenant.id]);
    await fx.cleanup();
  });

  const { cookie } = await login(app.baseUrl, owner.email, owner.password);
  const extra = 4;
  const burst = await Promise.all(
    Array.from({ length: SHARED_MAX + extra }, () =>
      request(app.baseUrl, 'GET', '/api/playbooks/list', { cookie }))
  );
  const successes = burst.filter((r) => r.status === 200 && r.json && r.json.ok === true);
  const limited = burst.filter((r) => r.status === 429 && r.json && r.json.error === 'rate_limited');
  assert.ok(successes.length <= SHARED_MAX, `expected <= ${SHARED_MAX} successes, got ${successes.length}`);
  assert.equal(successes.length + limited.length, burst.length, burst.map((r) => r.status).join(','));
  assert.ok(limited.length >= extra, `expected at least ${extra} 429s, got ${limited.length}`);
});

test('tenant A exhausting their bucket does not 429 tenant B', { skip: skipDb }, async (t) => {
  const fx = makeFixtures();
  await fx.ensureSchemas();
  await ensureVerticalPlaybooksSchema();
  const tenantA = await fx.seedTenant();
  const tenantB = await fx.seedTenant();
  const ownerA = await fx.seedUser({ tenantId: tenantA.id, owner: true });
  const ownerB = await fx.seedUser({ tenantId: tenantB.id, owner: true });
  const app = await bootApp();
  t.after(async () => {
    await app.close();
    await cleanupTenantPlaybooks([tenantA.id, tenantB.id]);
    await fx.cleanup();
  });

  const loginA = await login(app.baseUrl, ownerA.email, ownerA.password);
  const loginB = await login(app.baseUrl, ownerB.email, ownerB.password);
  assert.ok(loginA.cookie && loginB.cookie);

  for (let i = 0; i < SHARED_MAX + 1; i++) {
    await request(app.baseUrl, 'GET', '/api/playbooks/list', { cookie: loginA.cookie });
  }
  const exhausted = await request(app.baseUrl, 'GET', '/api/playbooks/list', { cookie: loginA.cookie });
  assert.equal(exhausted.status, 429);
  assert.equal(exhausted.json.error, 'rate_limited');

  const bRes = [];
  for (let i = 0; i < SHARED_MAX; i++) {
    bRes.push(await request(app.baseUrl, 'GET', '/api/playbooks/list', { cookie: loginB.cookie }));
  }
  assert.ok(bRes.every((r) => r.status === 200 && r.json && r.json.ok === true),
    `tenant B should have a full allowance, got ${bRes.map((r) => r.status).join(',')}`);
});

test('spoofed tenant_id / X-Tenant-Id / query consume caller bucket only', { skip: skipDb }, async (t) => {
  const fx = makeFixtures();
  await fx.ensureSchemas();
  await ensureVerticalPlaybooksSchema();
  const tenantA = await fx.seedTenant();
  const tenantB = await fx.seedTenant();
  const ownerA = await fx.seedUser({ tenantId: tenantA.id, owner: true });
  const ownerB = await fx.seedUser({ tenantId: tenantB.id, owner: true });
  const app = await bootApp();
  t.after(async () => {
    await app.close();
    await cleanupTenantPlaybooks([tenantA.id, tenantB.id]);
    await fx.cleanup();
  });

  const loginA = await login(app.baseUrl, ownerA.email, ownerA.password);
  const loginB = await login(app.baseUrl, ownerB.email, ownerB.password);

  const spoofPath = `/api/playbooks/list?tenant_id=${tenantB.id}`;
  const spoofHeaders = {
    'X-Tenant-Id': String(tenantB.id),
    'tenant_id': String(tenantB.id),
  };

  const aHits = [];
  for (let i = 0; i < SHARED_MAX + 1; i++) {
    aHits.push(await request(app.baseUrl, 'GET', spoofPath, {
      cookie: loginA.cookie,
      headers: spoofHeaders,
      body: { tenant_id: tenantB.id },
    }));
  }
  const aOk = aHits.filter((r) => r.status === 200);
  const a429 = aHits.filter((r) => r.status === 429);
  assert.equal(aOk.length, SHARED_MAX);
  assert.equal(a429.length, 1);
  assert.equal(a429[0].json.error, 'rate_limited');

  const bHits = [];
  for (let i = 0; i < SHARED_MAX; i++) {
    bHits.push(await request(app.baseUrl, 'GET', '/api/playbooks/list', { cookie: loginB.cookie }));
  }
  assert.ok(bHits.every((r) => r.status === 200 && r.json && r.json.ok === true),
    `tenant B must keep a full bucket after A's spoof, got ${bHits.map((r) => r.status).join(',')}`);
});

test('generate-custom limiter is mounted before the handler', { skip: skipDb }, async (t) => {
  const { fx, tenant, owner } = await seedPlaybooksOwner();
  const app = await bootApp();
  t.after(async () => {
    await app.close();
    await cleanupTenantPlaybooks([tenant.id]);
    await fx.cleanup();
  });

  const { cookie } = await login(app.baseUrl, owner.email, owner.password);
  const under = await request(app.baseUrl, 'POST', '/api/playbooks/generate-custom', {
    cookie,
    body: { industry: 'saas' },
  });
  assert.equal(under.status, 200, under.text);
  assert.equal(under.json && under.json.ok, true);
  assert.ok(under.json.playbook && under.json.playbook.title);

  const rest = [];
  for (let i = 0; i < GENERATE_MAX; i++) {
    rest.push(await request(app.baseUrl, 'POST', '/api/playbooks/generate-custom', {
      cookie,
      body: { industry: `saas-burst-${i}` },
    }));
  }
  // One already succeeded; GENERATE_MAX total allowed, so GENERATE_MAX-1 more
  // 200s and then 429. The loop above fires GENERATE_MAX more = (max-1) 200 + 1 429
  // plus possibly extra 429s if shared also trips. GENERATE_MAX is 2, so 1 more 200 + 1 429.
  const ok = rest.filter((r) => r.status === 200);
  const limited = rest.filter((r) => r.status === 429);
  assert.equal(ok.length, GENERATE_MAX - 1, rest.map((r) => `${r.status}:${r.json && r.json.error}`).join(','));
  assert.ok(limited.length >= 1);
  assert.ok(limited.every((r) => r.json && r.json.error === 'rate_limited'));
  assert.ok(limited[0].headers['retry-after']);
});
