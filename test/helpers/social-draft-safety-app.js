'use strict';

const express = require('express');

const PROHIBITED = 'guaranteed 100% returns with zero risk';
const SAFE_TEXT = 'Schedule a demo to learn how our platform helps marketing teams.';
const LEGACY_CAPTION_LIMIT = 10_000;
const LEGACY_ALT_LIMIT = 2_000;
const SELF_HEAL_PATH = require.resolve('../../services/social_drafts/self_heal');
const API_PATH = require.resolve('../../services/social_drafts/api');
const GATE_PATH = require.resolve('../../services/ai_governance/route_gate');
const PUBLISHER_PATH = require.resolve('../../services/social_publisher/api');
const KG_PATH = require.resolve('../../services/knowledge_graph/api');

function captionWithProhibitedSuffix() {
  return `${'x'.repeat(LEGACY_CAPTION_LIMIT + 1)}${PROHIBITED}`;
}

function altWithProhibitedSuffix() {
  return `${'a'.repeat(LEGACY_ALT_LIMIT + 1)}${PROHIBITED}`;
}

const tenantCtx = require('../../services/tenants/context');
tenantCtx.resolveTenantId = async (req) => {
  const h = req?.headers?.['x-test-tid'] || req?.headers?.['x-test-tenant'];
  return h ? parseInt(h, 10) : 11;
};

function mountApp(opts = {}) {
  delete require.cache[API_PATH];
  const db = require('../../db');
  db.hasDb = opts.useDb
    ? () => !!process.env.DATABASE_URL
    : () => false;
  const draftsRouter = require(API_PATH);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const tid = Number(req.headers['x-test-tid'] || req.headers['x-test-tenant'] || 11);
    req.user = { id: 3, email: 'safety@test.local' };
    req.tenant = { id: tid, name: 'Test', slug: 'test', status: 'active' };
    next();
  });
  app.use('/api/social-drafts', draftsRouter);
  return { app, draftsRouter };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function jsonFetch(server, method, path, { tid = 11, body, headers = {} } = {}) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-test-tid': String(tid), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

async function createDraft(server, tid, body = {}) {
  const r = await jsonFetch(server, 'POST', '/api/social-drafts', {
    tid,
    body: { profileId: 'p1', text: SAFE_TEXT, platforms: ['instagram'], ...body },
  });
  const assert = require('node:assert/strict');
  assert.equal(r.status, 200);
  return r.body.draft;
}

function seedDraft(draftsRouter, tid, fields = {}) {
  return draftsRouter._createForTenant(tid, {
    profile_id: 'p1',
    status: 'draft',
    text: SAFE_TEXT,
    platforms: ['instagram'],
    media_urls: [],
    meta: {},
    ...fields,
  });
}

async function pendingDraft(server, tid, text = SAFE_TEXT) {
  const draft = await createDraft(server, tid, { text });
  const sub = await jsonFetch(server, 'POST', `/api/social-drafts/${draft.id}/submit-approval`, {
    tid,
    body: { skip_self_heal: true },
  });
  const assert = require('node:assert/strict');
  assert.equal(sub.status, 200);
  return sub.body.draft;
}

function realSelfHeal() {
  return require(SELF_HEAL_PATH).selfHealDraft;
}

function setSelfHeal(fn) {
  require(SELF_HEAL_PATH).selfHealDraft = fn;
}

function restoreSelfHeal(real) {
  require(SELF_HEAL_PATH).selfHealDraft = real;
}

function failSelfHeal(text = PROHIBITED) {
  return { ok: false, passed: false, text, final_verdict: 'fail', attempts: [{ attempt: 1, verdict: 'fail' }] };
}

function passSelfHeal(text, opts = {}) {
  return { ok: true, passed: true, text, final_verdict: 'pass', attempts: [], ...opts };
}

async function withWarningOnlyPolicy(fn) {
  const orch = require('../../services/ai_governance/orchestrator');
  const loadPolicyOrig = orch.loadPolicy;
  const { defaultPolicy } = require('../../services/ai_governance/policy');
  orch.loadPolicy = async (tid) => ({ ...defaultPolicy(tid), content_safety_mode: 'warning_only', content_safety_explicit: true });
  try {
    return await fn();
  } finally {
    orch.loadPolicy = loadPolicyOrig;
  }
}

async function withGateMock(gateFn, fn) {
  const gateCached = require.cache[GATE_PATH];
  const realGate = gateCached.exports.gateRouteText;
  gateCached.exports.gateRouteText = gateFn;
  delete require.cache[API_PATH];
  try {
    return await fn();
  } finally {
    gateCached.exports.gateRouteText = realGate;
    delete require.cache[API_PATH];
  }
}

function stubPublish(draftsRouter, impl) {
  const orig = draftsRouter._publishViaZernio;
  let calls = 0;
  draftsRouter._publishViaZernio = async (...args) => {
    calls += 1;
    return typeof impl === 'function' ? impl(...args) : impl;
  };
  return {
    get calls() { return calls; },
    restore() { draftsRouter._publishViaZernio = orig; },
  };
}

async function withStubPublish(draftsRouter, impl, fn) {
  const publish = stubPublish(draftsRouter, impl);
  try {
    return await fn(publish);
  } finally {
    publish.restore();
  }
}

const GATE_UNAVAILABLE = {
  ok: false,
  error: 'content_safety_unavailable',
  userMessage: 'Content safety checks are temporarily unavailable.',
};

const GATE_BLOCKED = { ok: false, error: 'content_safety_blocked', userMessage: 'blocked' };

async function assertApproveSafetyHold(fx, { status, server }) {
  const assert = require('node:assert/strict');
  await withStubPublish(require('../../services/social_drafts/api'), async () => ({ ok: true, post: { id: 'z' } }), async (publish) => {
    const r = await jsonFetch(server, 'POST', `/api/social-drafts/${fx.draftId}/approve`, { tid: fx.tenantId });
    assert.equal(r.status, status);
    assert.equal(r.body.draft, undefined);
    assert.equal(publish.calls, 0);
    const row = await pgDraftRow(fx, fx.draftId);
    assert.equal(row.status, 'pending_approval');
    assert.equal(row.meta?.publishing_claim || null, null);
  });
}

async function mountMemServer() {
  const { app, draftsRouter } = mountApp();
  const server = await listen(app);
  return { server, draftsRouter, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function pgDraftRow(fx, draftId, columns = 'status, meta') {
  return (await fx.db.getPool().query(
    `SELECT ${columns} FROM social_post_drafts WHERE id=$1 AND tenant_id=$2`,
    [draftId, fx.tenantId],
  )).rows[0];
}

async function setupPr10h1bPostgres(fixtureTag) {
  const assert = require('node:assert/strict');
  const PG_URL = process.env.DATABASE_URL || '';
  assert.ok(PG_URL, 'DATABASE_URL is required');
  for (const mod of ['../../db', '../../services/tenants/schema', '../../services/social_drafts/schema', API_PATH, '../../services/tenants/context']) {
    delete require.cache[require.resolve(mod)];
  }
  const db = require('../../db');
  await require('../../services/tenants/schema').ensureTenantSchema();
  await require('../../services/social_drafts/schema').ensureSocialDraftsSchema();
  const tenantId = (await db.getPool().query(
    `INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id`,
    [`PR10H1B ${fixtureTag}`, fixtureTag],
  )).rows[0].id;
  require('../../services/tenants/context').resolveTenantId = async (req) => Number(req.headers['x-test-tid'] || tenantId);
  process.env.ZERNIO_API_KEY = 'test-key-live';
  let server = await listen(mountApp({ useDb: true }).app);
  const draftId = (await pendingDraft(server, tenantId, SAFE_TEXT)).id;
  const gateCached = require.cache[GATE_PATH];
  const realGate = gateCached.exports.gateRouteText;
  gateCached.exports.gateRouteText = async () => GATE_BLOCKED;
  delete require.cache[API_PATH];
  server = await listen(mountApp({ useDb: true }).app);
  return {
    db,
    tenantId,
    draftId,
    server,
    gateCached,
    realGate,
    setGate: (fn) => { gateCached.exports.gateRouteText = fn; delete require.cache[API_PATH]; },
    async cleanup() {
      gateCached.exports.gateRouteText = realGate;
      await new Promise((resolve) => server.close(resolve));
      delete require.cache[API_PATH];
      const p = db.getPool();
      await p.query('DELETE FROM approval_requests WHERE tenant_id = $1', [tenantId]).catch(() => {});
      await p.query('DELETE FROM social_post_drafts WHERE tenant_id = $1', [tenantId]).catch(() => {});
      await p.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => {});
    },
  };
}

function mountPublisherApp(opts = {}) {
  const { app, draftsRouter } = mountApp(opts);
  delete require.cache[PUBLISHER_PATH];
  const publisher = require(PUBLISHER_PATH);
  const zernioCalls = [];
  publisher._zernio = async (...args) => {
    zernioCalls.push({ method: args[0], path: args[1], body: args[2] });
    if (typeof opts.zernio === 'function') return opts.zernio(...args);
    if (opts.zernio) return opts.zernio;
    return { ok: true, data: { post: { id: 'z-test' } } };
  };
  const kg = require(KG_PATH);
  const origIngest = kg.ingestMemoryNode;
  const ingestCalls = [];
  kg.ingestMemoryNode = async (payload) => {
    ingestCalls.push(payload);
    return { id: 'mem-test' };
  };
  app.use('/api/social-publisher', publisher);
  return {
    app,
    draftsRouter,
    publisher,
    zernioCalls,
    ingestCalls,
    restore() {
      kg.ingestMemoryNode = origIngest;
    },
  };
}

function assertNoUsableCopy(body) {
  const assert = require('node:assert/strict');
  assert.equal(body.post, undefined);
  assert.equal(body.text, undefined);
  assert.equal(body.caption, undefined);
  assert.equal(body.draft, undefined);
  assert.equal(body.content, undefined);
}

function assertParallelSubmitWinner(results) {
  const assert = require('node:assert/strict');
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  const loser = results.find((r) => r.status !== 200);
  assert.ok(loser);
  assert.ok([400, 409].includes(loser.status));
}

module.exports = {
  PROHIBITED,
  SAFE_TEXT,
  captionWithProhibitedSuffix,
  altWithProhibitedSuffix,
  mountApp,
  listen,
  jsonFetch,
  createDraft,
  seedDraft,
  pendingDraft,
  realSelfHeal,
  setSelfHeal,
  restoreSelfHeal,
  failSelfHeal,
  passSelfHeal,
  withWarningOnlyPolicy,
  withGateMock,
  stubPublish,
  withStubPublish,
  GATE_UNAVAILABLE,
  GATE_BLOCKED,
  assertApproveSafetyHold,
  mountMemServer,
  mountPublisherApp,
  setupPr10h1bPostgres,
  pgDraftRow,
  assertParallelSubmitWinner,
  assertNoUsableCopy,
};
