'use strict';
// Tenant-scoped persistence for POST/GET /api/ai-attack-plan.
// Hermetic in-memory kv — no vendor network (rule 04 / rule 07).

require('./helpers/env');

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const https = require('node:https');
const express = require('express');
const { EventEmitter } = require('events');

const register = require('../services/ai_content/routes');
const { detectFabrication } = require('../services/admin/enforcement');

const KEY_ENVS = [
  'AI_INTEGRATIONS_OPENAI_API_KEY',
  'OPENAI_API_KEY',
  'AI_INTEGRATIONS_ANTHROPIC_API_KEY',
  'ANTHROPIC_API_KEY',
];

const savedKeys = {};
for (const k of KEY_ENVS) savedKeys[k] = process.env[k];

function setKeys(map) {
  for (const k of KEY_ENVS) {
    if (map[k] === undefined) delete process.env[k];
    else process.env[k] = map[k];
  }
}

function restoreKeys() {
  for (const k of KEY_ENVS) {
    if (savedKeys[k] === undefined) delete process.env[k];
    else process.env[k] = savedKeys[k];
  }
}

let networkHits = 0;

function isLocalUrl(urlOrOpts) {
  try {
    if (typeof urlOrOpts === 'string') {
      const u = new URL(urlOrOpts);
      return u.hostname === '127.0.0.1' || u.hostname === 'localhost';
    }
    const host = (urlOrOpts && (urlOrOpts.hostname || urlOrOpts.host)) || '';
    return host === '127.0.0.1' || host === 'localhost' || String(host).startsWith('127.0.0.1:');
  } catch {
    return false;
  }
}

function makeBlockedReq() {
  const req = new EventEmitter();
  req.setTimeout = () => req;
  req.write = () => {};
  req.destroy = () => {};
  req.end = () => {
    networkHits += 1;
    req.emit('error', new Error('network must not be called'));
  };
  return req;
}

const origHttpsRequest = https.request;
const origHttpRequest = http.request;
const origFetch = global.fetch;

https.request = function blockedHttps(urlOrOpts, optsOrCb, maybeCb) {
  if (isLocalUrl(urlOrOpts)) return origHttpsRequest.apply(this, arguments);
  return makeBlockedReq();
};
http.request = function guardedHttp(urlOrOpts, optsOrCb, maybeCb) {
  if (isLocalUrl(urlOrOpts)) return origHttpRequest.apply(this, arguments);
  return makeBlockedReq();
};
global.fetch = async function guardedFetch(url, opts) {
  const raw = typeof url === 'string' ? url : (url && (url.url || url.href)) || '';
  if (isLocalUrl(raw)) return origFetch(url, opts);
  networkHits += 1;
  throw new Error('network must not be called');
};

const stubOpenai = {
  chat: { completions: { create: async () => { throw new Error('openai stub'); } } },
};
const stubAnthropic = {
  messages: { create: async () => { throw new Error('anthropic stub'); } },
};

function tkey(base, tid) { return `${base}:t${tid}`; }

function mountApp() {
  const store = new Map();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const raw = req.headers['x-test-tenant'];
    if (raw != null && raw !== '') req.tenant = { id: Number(raw) };
    next();
  });
  register(app, {
    _tkvCtx: {
      resolveTenantId: async (req) => (req.tenant && req.tenant.id != null ? req.tenant.id : null),
    },
    _tkvRead: async (base, tid, fallback) => {
      if (tid == null) return typeof fallback === 'function' ? fallback() : fallback;
      const k = tkey(base, tid);
      return store.has(k) ? store.get(k) : (typeof fallback === 'function' ? fallback() : fallback);
    },
    _tkvWrite: async (base, tid, value) => {
      if (tid == null) return false;
      store.set(tkey(base, tid), value);
      return true;
    },
    anthropic: stubAnthropic,
    callDataForSEO: async () => { throw new Error('unused'); },
    callRapidAPI: async () => { throw new Error('unused'); },
    getDataForSEOAuth: () => '',
    getRapidApiKey: () => '',
    https,
    loadAivisHistory: async () => ({}),
    openai: stubOpenai,
    path: require('path'),
  });
  return { app, store };
}

let server;
let baseUrl;
let kvStore;

before(async () => {
  const mounted = mountApp();
  kvStore = mounted.store;
  server = await new Promise((resolve) => {
    const s = mounted.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  https.request = origHttpsRequest;
  http.request = origHttpRequest;
  global.fetch = origFetch;
  restoreKeys();
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  networkHits = 0;
  kvStore.clear();
  setKeys({
    AI_INTEGRATIONS_OPENAI_API_KEY: '_DUMMY_ATTACK_PLAN',
    OPENAI_API_KEY: '_DUMMY_ATTACK_PLAN',
    AI_INTEGRATIONS_ANTHROPIC_API_KEY: '_dummy_claude',
    ANTHROPIC_API_KEY: '_dummy_claude',
  });
});

function asTenant(tenantId) {
  return { headers: { 'Content-Type': 'application/json', 'x-test-tenant': String(tenantId) } };
}

async function postPlan(tenantId, body) {
  const res = await fetch(`${baseUrl}/api/ai-attack-plan`, {
    method: 'POST',
    ...asTenant(tenantId),
    body: JSON.stringify(body || {
      myDomain: 'acme.test',
      competitor: 'rival.test',
      industry: 'payroll software',
      prefillKeywords: ['payroll comparison'],
    }),
  });
  return { status: res.status, json: await res.json() };
}

async function getJson(tenantId, path) {
  const res = await fetch(`${baseUrl}${path}`, asTenant(tenantId));
  return { status: res.status, json: await res.json() };
}

test('POST persists a template plan; list and latest return it', async () => {
  const posted = await postPlan(1);
  assert.strictEqual(posted.status, 200);
  assert.strictEqual(posted.json.ok, true);
  assert.strictEqual(posted.json.source, 'template');
  assert.strictEqual(posted.json._fabricated, true);

  const list = await getJson(1, '/api/ai-attack-plan/list');
  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.json.ok, true);
  assert.strictEqual(list.json.plans.length, 1);
  assert.strictEqual(list.json.plans[0].competitor, 'rival.test');
  assert.strictEqual(list.json.plans[0].myDomain, 'acme.test');
  assert.strictEqual(list.json.plans[0].industry, 'payroll software');
  assert.strictEqual(list.json.plans[0].source, 'template');
  assert.strictEqual(list.json.plans[0]._fabricated, true);
  assert.deepStrictEqual(list.json.plans[0].sources, ['template']);
  assert.strictEqual(list.json.plans[0].plan, undefined);

  const latest = await getJson(1, '/api/ai-attack-plan/latest');
  assert.strictEqual(latest.status, 200);
  assert.strictEqual(latest.json.ok, true);
  assert.ok(latest.json.plan);
  assert.strictEqual(latest.json.source, 'template');
  assert.strictEqual(latest.json._fabricated, true);
  assert.deepStrictEqual(latest.json.sources, ['template']);
  assert.strictEqual(latest.json.competitor, 'rival.test');
  assert.ok(latest.json.id);

  const byId = await getJson(1, `/api/ai-attack-plan/${latest.json.id}`);
  assert.strictEqual(byId.status, 200);
  assert.strictEqual(byId.json.ok, true);
  assert.strictEqual(byId.json.plan.executiveSummary, latest.json.plan.executiveSummary);
  assert.strictEqual(networkHits, 0);
});

test('empty tenant returns ok:true with plan:null on latest', async () => {
  const latest = await getJson(1, '/api/ai-attack-plan/latest');
  assert.strictEqual(latest.status, 200);
  assert.deepStrictEqual(latest.json, { ok: true, plan: null });

  const list = await getJson(1, '/api/ai-attack-plan/list');
  assert.strictEqual(list.status, 200);
  assert.deepStrictEqual(list.json, { ok: true, plans: [] });
});

test('latest?competitor= filters to newest plan for that competitor', async () => {
  await postPlan(1, { myDomain: 'a.test', competitor: 'Alpha', industry: 'saas' });
  await postPlan(1, { myDomain: 'b.test', competitor: 'Beta', industry: 'saas' });
  await postPlan(1, { myDomain: 'c.test', competitor: 'Alpha', industry: 'saas' });

  const latestAll = await getJson(1, '/api/ai-attack-plan/latest');
  assert.strictEqual(latestAll.json.competitor, 'Alpha');
  assert.strictEqual(latestAll.json.myDomain, 'c.test');

  const latestAlpha = await getJson(1, '/api/ai-attack-plan/latest?competitor=Alpha');
  assert.strictEqual(latestAlpha.json.competitor, 'Alpha');
  assert.strictEqual(latestAlpha.json.myDomain, 'c.test');

  const latestBeta = await getJson(1, '/api/ai-attack-plan/latest?competitor=beta');
  assert.strictEqual(latestBeta.json.competitor, 'Beta');
  assert.strictEqual(latestBeta.json.myDomain, 'b.test');

  const latestMissing = await getJson(1, '/api/ai-attack-plan/latest?competitor=Gamma');
  assert.deepStrictEqual(latestMissing.json, { ok: true, plan: null });
});

test('tenant B cannot read tenant A saved plans', async () => {
  const posted = await postPlan(1, { myDomain: 'secret.test', competitor: 'Rival', industry: 'fintech' });
  assert.strictEqual(posted.json.ok, true);

  const t2List = await getJson(2, '/api/ai-attack-plan/list');
  assert.deepStrictEqual(t2List.json, { ok: true, plans: [] });

  const t2Latest = await getJson(2, '/api/ai-attack-plan/latest');
  assert.deepStrictEqual(t2Latest.json, { ok: true, plan: null });

  const t1Latest = await getJson(1, '/api/ai-attack-plan/latest');
  const t2ById = await getJson(2, `/api/ai-attack-plan/${t1Latest.json.id}`);
  assert.strictEqual(t2ById.status, 404);
  assert.strictEqual(t2ById.json.ok, false);
  assert.strictEqual(t2ById.json.error, 'not_found');
});

test('honesty markers survive the round trip', async () => {
  await postPlan(1);
  const latest = await getJson(1, '/api/ai-attack-plan/latest');
  assert.strictEqual(latest.json.source, 'template');
  assert.strictEqual(latest.json._fabricated, true);
  assert.deepStrictEqual(latest.json.sources, ['template']);
  assert.ok(detectFabrication(latest.json));
});

test('over-long metadata is truncated on persist; POST response unchanged', async () => {
  const longComp = 'C'.repeat(200);
  const longDomain = 'D'.repeat(200);
  const longIndustry = 'I'.repeat(200);

  const posted = await postPlan(1, {
    myDomain: longDomain,
    competitor: longComp,
    industry: longIndustry,
  });
  assert.strictEqual(posted.status, 200);
  assert.strictEqual(posted.json.ok, true);
  const summary = posted.json.plan.executiveSummary;
  assert.ok(summary.includes(longComp), 'POST plan body should keep full competitor');
  assert.ok(summary.includes(longDomain), 'POST plan body should keep full myDomain');
  assert.ok(summary.includes(longIndustry), 'POST plan body should keep full industry');

  const expectedComp = longComp.slice(0, 80);
  const expectedDomain = longDomain.slice(0, 80);
  const expectedIndustry = longIndustry.slice(0, 80);

  const list = await getJson(1, '/api/ai-attack-plan/list');
  assert.strictEqual(list.json.plans[0].competitor, expectedComp);
  assert.strictEqual(list.json.plans[0].myDomain, expectedDomain);
  assert.strictEqual(list.json.plans[0].industry, expectedIndustry);

  const latest = await getJson(1, '/api/ai-attack-plan/latest');
  assert.strictEqual(latest.json.competitor, expectedComp);
  assert.strictEqual(latest.json.myDomain, expectedDomain);
  assert.strictEqual(latest.json.industry, expectedIndustry);
  assert.ok(latest.json.plan.executiveSummary.includes(longComp));
});

test('20-entry cap keeps newest plans only', async () => {
  for (let i = 0; i < 22; i += 1) {
    await postPlan(1, {
      myDomain: `site-${i}.test`,
      competitor: `comp-${i}`,
      industry: 'saas',
    });
  }
  const list = await getJson(1, '/api/ai-attack-plan/list');
  assert.strictEqual(list.json.plans.length, 20);
  assert.strictEqual(list.json.plans[0].competitor, 'comp-21');
  assert.strictEqual(list.json.plans[19].competitor, 'comp-2');
  assert.ok(!list.json.plans.some((p) => p.competitor === 'comp-0' || p.competitor === 'comp-1'));
});
