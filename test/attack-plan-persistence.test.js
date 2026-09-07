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

// Delay inside `_tkvRead` so two in-flight persists interleave their reads
// unless they go through `_tkvMutate`. Mirrors server.js (lines 336–346).
const TKV_READ_DELAY_MS = 20;

function makeTkvHelpers(store, writeWrap) {
  const _tkvRead = async (base, tid, fallback) => {
    if (tid == null) return typeof fallback === 'function' ? fallback() : fallback;
    await new Promise((r) => setTimeout(r, TKV_READ_DELAY_MS));
    const k = tkey(base, tid);
    return store.has(k) ? store.get(k) : (typeof fallback === 'function' ? fallback() : fallback);
  };
  const baseWrite = async (base, tid, value) => {
    if (tid == null) return false;
    store.set(tkey(base, tid), value);
    return true;
  };
  const _tkvWrite = writeWrap
    ? async (base, tid, value) => writeWrap(baseWrite, base, tid, value)
    : baseWrite;
  return { _tkvRead, _tkvWrite };
}

function mountAttackPlanApp({ withMutate = true, writeWrap } = {}) {
  const store = new Map();
  const tkvChain = new Map();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const raw = req.headers['x-test-tenant'];
    if (raw != null && raw !== '') req.tenant = { id: Number(raw) };
    next();
  });
  const { _tkvRead, _tkvWrite } = makeTkvHelpers(store, writeWrap);
  const ctx = {
    _tkvCtx: {
      resolveTenantId: async (req) => (req.tenant && req.tenant.id != null ? req.tenant.id : null),
    },
    _tkvRead,
    _tkvWrite,
    anthropic: stubAnthropic,
    callDataForSEO: async () => { throw new Error('unused'); },
    callRapidAPI: async () => { throw new Error('unused'); },
    getDataForSEOAuth: () => '',
    getRapidApiKey: () => '',
    https,
    loadAivisHistory: async () => ({}),
    openai: stubOpenai,
    path: require('path'),
  };
  if (withMutate) {
    ctx._tkvMutate = async (base, tid, fallback, mutator) => {
      const key = `${base}:t${tid}`;
      const prev = tkvChain.get(key) || Promise.resolve();
      const run = prev.then(async () => {
        const cur = await _tkvRead(base, tid, fallback);
        const updated = await mutator(cur);
        if (updated !== undefined) await _tkvWrite(base, tid, updated);
        return updated;
      });
      tkvChain.set(key, run.catch(() => {}));
      return run;
    };
  }
  register(app, ctx);
  return { app, store };
}

function mountApp() {
  return mountAttackPlanApp({ withMutate: true });
}

let server;
let baseUrl;
let kvStore;
let fallbackServer;
let fallbackBaseUrl;
let fallbackKvStore;

before(async () => {
  const mounted = mountApp();
  kvStore = mounted.store;
  server = await new Promise((resolve) => {
    const s = mounted.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const fallbackMounted = mountAttackPlanApp({ withMutate: false });
  fallbackKvStore = fallbackMounted.store;
  fallbackServer = await new Promise((resolve) => {
    const s = fallbackMounted.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  fallbackBaseUrl = `http://127.0.0.1:${fallbackServer.address().port}`;
});

after(async () => {
  https.request = origHttpsRequest;
  http.request = origHttpRequest;
  global.fetch = origFetch;
  restoreKeys();
  await new Promise((r) => server.close(r));
  await new Promise((r) => fallbackServer.close(r));
});

beforeEach(() => {
  networkHits = 0;
  kvStore.clear();
  fallbackKvStore.clear();
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

async function postPlan(tenantId, body, url = baseUrl) {
  const res = await fetch(`${url}/api/ai-attack-plan`, {
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

async function getJson(tenantId, path, url = baseUrl) {
  const res = await fetch(`${url}${path}`, asTenant(tenantId));
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

test('over-long request fields cannot inflate the generated or stored plan', async () => {
  const longComp = 'C'.repeat(200);
  const longDomain = 'D'.repeat(200);
  const longIndustry = 'I'.repeat(200);
  const longKw = 'K'.repeat(200);
  const longCtx = 'X'.repeat(2000);

  const posted = await postPlan(1, {
    myDomain: longDomain,
    competitor: longComp,
    industry: longIndustry,
    prefillKeywords: [longKw, 'payroll', longKw, 'ok', 'more', 'overflow'],
    prefillContext: longCtx,
  });
  assert.strictEqual(posted.status, 200);
  assert.strictEqual(posted.json.ok, true);
  assert.strictEqual(posted.json.source, 'template');
  assert.strictEqual(posted.json._fabricated, true);

  const expectedComp = longComp.slice(0, 80);
  const expectedDomain = longDomain.slice(0, 80);
  const expectedIndustry = longIndustry.slice(0, 80);
  const expectedKw = longKw.slice(0, 80);

  const summary = posted.json.plan.executiveSummary;
  assert.ok(!summary.includes(longComp), 'generated plan must not embed the unbounded competitor');
  assert.ok(!summary.includes(longDomain), 'generated plan must not embed the unbounded domain');
  assert.ok(!summary.includes(longIndustry), 'generated plan must not embed the unbounded industry');
  assert.ok(summary.includes(expectedComp));
  assert.ok(summary.includes(expectedDomain));
  assert.ok(summary.includes(expectedIndustry));

  const postedKws = (posted.json.plan.keywordTargets || []).map((k) => k.keyword);
  assert.ok(postedKws.length <= 5);
  assert.ok(postedKws.every((k) => String(k).length <= 80), 'each keyword in the plan is length-capped');
  assert.ok(postedKws.includes(expectedKw));
  assert.ok(!postedKws.includes(longKw));

  const postedBlob = JSON.stringify(posted.json.plan);
  assert.ok(!postedBlob.includes(longKw));
  assert.ok(!postedBlob.includes(longCtx));

  const list = await getJson(1, '/api/ai-attack-plan/list');
  assert.strictEqual(list.json.plans[0].competitor, expectedComp);
  assert.strictEqual(list.json.plans[0].myDomain, expectedDomain);
  assert.strictEqual(list.json.plans[0].industry, expectedIndustry);

  const latest = await getJson(1, '/api/ai-attack-plan/latest');
  assert.strictEqual(latest.json.competitor, expectedComp);
  assert.strictEqual(latest.json.myDomain, expectedDomain);
  assert.strictEqual(latest.json.industry, expectedIndustry);
  const storedPlan = JSON.stringify(latest.json.plan);
  assert.ok(!storedPlan.includes(longComp));
  assert.ok(!storedPlan.includes(longDomain));
  assert.ok(!storedPlan.includes(longIndustry));
  assert.ok(!storedPlan.includes(longKw));
  assert.ok(!storedPlan.includes(longCtx));
  assert.ok(storedPlan.includes(expectedComp));
  assert.ok(storedPlan.includes(expectedKw));

  const entry = kvStore.get('attack_plans:t1')[0];
  const packed = JSON.stringify(entry);
  assert.ok(Buffer.byteLength(packed, 'utf8') < 16 * 1024, 'a capped template entry stays far under the 64 KiB backstop');
  assert.ok(!packed.includes(longComp));
  assert.ok(!packed.includes(longKw));
  assert.ok(!packed.includes(longCtx));
});

test('concurrent saves for the same tenant both survive', async () => {
  const [a, b] = await Promise.all([
    postPlan(1, { myDomain: 'a.test', competitor: 'Alpha', industry: 'saas' }),
    postPlan(1, { myDomain: 'b.test', competitor: 'Beta', industry: 'saas' }),
  ]);
  assert.strictEqual(a.status, 200);
  assert.strictEqual(b.status, 200);
  assert.strictEqual(a.json.ok, true);
  assert.strictEqual(b.json.ok, true);

  const list = await getJson(1, '/api/ai-attack-plan/list');
  assert.strictEqual(list.json.ok, true);
  assert.strictEqual(list.json.plans.length, 2, 'last-writer-wins must not drop a concurrent save');
  const comps = list.json.plans.map((p) => p.competitor).sort();
  assert.deepStrictEqual(comps, ['Alpha', 'Beta']);

  const stored = kvStore.get('attack_plans:t1');
  assert.ok(Array.isArray(stored));
  assert.strictEqual(stored.length, 2);
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

test('read/write fallback serializes concurrent saves without loss', async () => {
  const [a, b] = await Promise.all([
    postPlan(1, { myDomain: 'a.test', competitor: 'Alpha', industry: 'saas' }, fallbackBaseUrl),
    postPlan(1, { myDomain: 'b.test', competitor: 'Beta', industry: 'saas' }, fallbackBaseUrl),
  ]);
  assert.strictEqual(a.status, 200);
  assert.strictEqual(b.status, 200);
  assert.strictEqual(a.json.ok, true);
  assert.strictEqual(b.json.ok, true);

  const list = await getJson(1, '/api/ai-attack-plan/list', fallbackBaseUrl);
  assert.strictEqual(list.json.ok, true);
  assert.strictEqual(list.json.plans.length, 2, 'local mutate chain must not drop a concurrent save');
  const comps = list.json.plans.map((p) => p.competitor).sort();
  assert.deepStrictEqual(comps, ['Alpha', 'Beta']);

  const stored = fallbackKvStore.get('attack_plans:t1');
  assert.ok(Array.isArray(stored));
  assert.strictEqual(stored.length, 2);
});

test('read/write fallback keeps newest-first order under concurrent saves', async () => {
  const results = await Promise.all([
    postPlan(1, { myDomain: 'first.test', competitor: 'One', industry: 'saas' }, fallbackBaseUrl),
    postPlan(1, { myDomain: 'second.test', competitor: 'Two', industry: 'saas' }, fallbackBaseUrl),
    postPlan(1, { myDomain: 'third.test', competitor: 'Three', industry: 'saas' }, fallbackBaseUrl),
  ]);
  for (const r of results) {
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.ok, true);
  }

  const list = await getJson(1, '/api/ai-attack-plan/list', fallbackBaseUrl);
  assert.strictEqual(list.json.plans.length, 3);
  const savedAts = list.json.plans.map((p) => p.savedAt);
  for (let i = 0; i < savedAts.length - 1; i += 1) {
    assert.ok(savedAts[i] >= savedAts[i + 1], 'list is newest-first');
  }
});

test('read/write fallback 20-entry cap keeps newest plans only', async () => {
  for (let i = 0; i < 22; i += 1) {
    await postPlan(1, {
      myDomain: `site-${i}.test`,
      competitor: `comp-${i}`,
      industry: 'saas',
    }, fallbackBaseUrl);
  }
  const list = await getJson(1, '/api/ai-attack-plan/list', fallbackBaseUrl);
  assert.strictEqual(list.json.plans.length, 20);
  assert.strictEqual(list.json.plans[0].competitor, 'comp-21');
  assert.strictEqual(list.json.plans[19].competitor, 'comp-2');
  assert.ok(!list.json.plans.some((p) => p.competitor === 'comp-0' || p.competitor === 'comp-1'));
});

test('read/write fallback chain survives a rejected kv write', async () => {
  let failNextWrite = true;
  const mounted = mountAttackPlanApp({
    withMutate: false,
    writeWrap: async (baseWrite, base, tid, value) => {
      if (failNextWrite) {
        failNextWrite = false;
        throw new Error('simulated kv write failure');
      }
      return baseWrite(base, tid, value);
    },
  });
  const rejectServer = await new Promise((resolve) => {
    const s = mounted.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const rejectBaseUrl = `http://127.0.0.1:${rejectServer.address().port}`;
  try {
    const first = await postPlan(1, { myDomain: 'lost.test', competitor: 'Lost', industry: 'saas' }, rejectBaseUrl);
    assert.strictEqual(first.status, 200);
    assert.strictEqual(first.json.ok, true);

    const afterFail = await getJson(1, '/api/ai-attack-plan/list', rejectBaseUrl);
    assert.deepStrictEqual(afterFail.json, { ok: true, plans: [] }, 'failed write must not leave a partial entry');

    const second = await postPlan(1, { myDomain: 'kept.test', competitor: 'Kept', industry: 'saas' }, rejectBaseUrl);
    assert.strictEqual(second.status, 200);
    assert.strictEqual(second.json.ok, true);

    const list = await getJson(1, '/api/ai-attack-plan/list', rejectBaseUrl);
    assert.strictEqual(list.json.plans.length, 1);
    assert.strictEqual(list.json.plans[0].competitor, 'Kept');
  } finally {
    await new Promise((r) => rejectServer.close(r));
  }
});
