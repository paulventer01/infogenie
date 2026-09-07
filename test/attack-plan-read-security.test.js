'use strict';
// Security controls for the saved-attack-plan read surface.
//
// Three boundaries are locked here:
//   1. The `:id` param guard. A bare `/:id` under a single-segment /api prefix
//      is reachable anonymously through the `/^\/api\/[^\/]+\/status$/` entry in
//      server.js's public allowlist, and enforceMatrix skips requests carrying
//      no req.user — so `/api/ai-attack-plan/status` is gated by neither. The
//      guard must reject a non-id param BEFORE any tenant resolution or kv read
//      so that path cannot become a tenant-data read primitive. This mirrors
//      what /api/battle-cards already does. See docs/security-guardrails.md.
//   2. The permission matrix row for the prefix, and the role grants behind it.
//      Reading a saved plan requires the same key that renders the `battleplan`
//      panel; generating one is a write and requires the edit key.
//   3. Honesty markers and secret hygiene on the stored blob — a stored
//      template plan must still trip strict data mode, and no key material may
//      ever land in kv.
//
// Hermetic: in-memory kv, stubbed providers, no vendor network (rule 04 / 07).

require('./helpers/env');

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const https = require('node:https');
const express = require('express');

const register = require('../services/ai_content/routes');
const matrix = require('../services/tenants/permission_matrix');
const { SYSTEM_ROLES, isValidPermission } = require('../services/tenants/permissions');
const { detectFabrication } = require('../services/admin/enforcement');

const VIEW_KEY = 'compete.battle_cards.view';
const EDIT_KEY = 'compete.battle_cards.edit';
const PREFIX = '/api/ai-attack-plan';

// Key material that must never reach the stored blob or the response.
const SECRET_SENTINEL = 'sk-live-attackplan-must-not-persist';

const KEY_ENVS = [
  'AI_INTEGRATIONS_OPENAI_API_KEY',
  'OPENAI_API_KEY',
  'AI_INTEGRATIONS_ANTHROPIC_API_KEY',
  'ANTHROPIC_API_KEY',
];
const savedKeys = {};
for (const k of KEY_ENVS) savedKeys[k] = process.env[k];

function restoreKeys() {
  for (const k of KEY_ENVS) {
    if (savedKeys[k] === undefined) delete process.env[k];
    else process.env[k] = savedKeys[k];
  }
}

function tkey(base, tid) { return `${base}:t${tid}`; }

// Counters prove the `:id` guard short-circuits before tenant/kv work.
const calls = { resolveTenantId: 0, tkvRead: 0, tkvWrite: 0 };

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
      resolveTenantId: async (req) => {
        calls.resolveTenantId += 1;
        return req.tenant && req.tenant.id != null ? req.tenant.id : null;
      },
    },
    _tkvRead: async (base, tid, fallback) => {
      calls.tkvRead += 1;
      if (tid == null) return typeof fallback === 'function' ? fallback() : fallback;
      const k = tkey(base, tid);
      return store.has(k) ? store.get(k) : (typeof fallback === 'function' ? fallback() : fallback);
    },
    _tkvWrite: async (base, tid, value) => {
      calls.tkvWrite += 1;
      if (tid == null) return false;
      store.set(tkey(base, tid), value);
      return true;
    },
    anthropic: { messages: { create: async () => { throw new Error('anthropic stub'); } } },
    callDataForSEO: async () => { throw new Error('unused'); },
    callRapidAPI: async () => { throw new Error('unused'); },
    getDataForSEOAuth: () => '',
    getRapidApiKey: () => '',
    https,
    loadAivisHistory: async () => ({}),
    openai: { chat: { completions: { create: async () => { throw new Error('openai stub'); } } } },
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
  restoreKeys();
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  kvStore.clear();
  calls.resolveTenantId = 0;
  calls.tkvRead = 0;
  calls.tkvWrite = 0;
  for (const k of KEY_ENVS) process.env[k] = `_DUMMY_${SECRET_SENTINEL}`;
});

function asTenant(tenantId) {
  return { headers: { 'Content-Type': 'application/json', 'x-test-tenant': String(tenantId) } };
}

async function postPlan(tenantId, body) {
  const res = await fetch(`${baseUrl}${PREFIX}`, {
    method: 'POST',
    ...asTenant(tenantId),
    body: JSON.stringify(body || {
      myDomain: 'acme.test',
      competitor: 'rival.test',
      industry: 'payroll software',
    }),
  });
  return { status: res.status, json: await res.json() };
}

async function getJson(tenantId, path) {
  const res = await fetch(`${baseUrl}${path}`, asTenant(tenantId));
  return { status: res.status, json: await res.json() };
}

// Anonymous (no x-test-tenant) — mirrors a request admitted by the public
// allowlist, which reaches the router with no req.user and no req.tenant.
async function getAnon(path) {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, json: await res.json() };
}

// ── 1. The `:id` param guard ────────────────────────────────────────────────

test('anonymous /status does not reach tenant resolution or kv', async () => {
  const res = await getAnon(`${PREFIX}/status`);
  assert.strictEqual(res.status, 404);
  assert.deepStrictEqual(res.json, { ok: false, error: 'not_found' });
  assert.strictEqual(calls.resolveTenantId, 0,
    '/status must be rejected before any tenant lookup — it is admitted anonymously by the /api/*/status allowlist');
  assert.strictEqual(calls.tkvRead, 0, '/status must never trigger a kv read');
});

test('a non-id :id param is rejected before any tenant or kv work', async () => {
  const junk = [
    'status', 'list-all', 'AP_123_ABCDEF', 'ap_123', 'ap__abc',
    'ap_12x_abcdef', `ap_1_${'f'.repeat(33)}`, '../admin', 'null', '0',
  ];
  for (const id of junk) {
    const res = await getJson(1, `${PREFIX}/${encodeURIComponent(id)}`);
    assert.strictEqual(res.status, 404, `${id} should 404`);
    assert.strictEqual(res.json.error, 'not_found', `${id} should return the not_found shape`);
  }
  assert.strictEqual(calls.resolveTenantId, 0, 'no junk id may reach tenant resolution');
  assert.strictEqual(calls.tkvRead, 0, 'no junk id may reach a kv read');
});

test('a well-formed but unknown id still resolves the tenant and 404s', async () => {
  // Proves the guard is not over-blocking: real ids take the normal path.
  const res = await getJson(1, `${PREFIX}/ap_1700000000000_0123456789ab`);
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.json.error, 'not_found');
  assert.strictEqual(calls.resolveTenantId, 1, 'a real id shape is looked up for the caller tenant');
  assert.ok(calls.tkvRead >= 1, 'a real id shape reads that tenant kv key');
});

test('a real id issued to one tenant is not readable by another', async () => {
  await postPlan(1, { myDomain: 'secret.test', competitor: 'Rival', industry: 'fintech' });
  const mine = await getJson(1, `${PREFIX}/latest`);
  assert.ok(mine.json.id, 'tenant 1 has a saved plan id');

  const theirs = await getJson(2, `${PREFIX}/${mine.json.id}`);
  assert.strictEqual(theirs.status, 404, 'a valid id from another tenant must 404, not leak');
  assert.strictEqual(theirs.json.plan, undefined);

  // Anonymous callers cannot use a known id either (null tenant → empty list).
  const anon = await getAnon(`${PREFIX}/${mine.json.id}`);
  assert.strictEqual(anon.status, 404);
});

test('a null tenant reads nothing and writes nothing', async () => {
  const list = await getAnon(`${PREFIX}/list`);
  assert.deepStrictEqual(list.json, { ok: true, plans: [] });
  const latest = await getAnon(`${PREFIX}/latest`);
  assert.deepStrictEqual(latest.json, { ok: true, plan: null });

  // A POST with no resolvable tenant still answers, but persists nothing —
  // never to a global key and never to another tenant.
  const res = await fetch(`${baseUrl}${PREFIX}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ myDomain: 'a.test', competitor: 'b', industry: 'c' }),
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(kvStore.size, 0, 'a null tenant must not create any kv key');
  assert.strictEqual(kvStore.has('attack_plans'), false, 'never the unscoped base key');
});

test('every persisted key is tenant-namespaced', async () => {
  await postPlan(1);
  await postPlan(2);
  assert.deepStrictEqual(
    [...kvStore.keys()].sort(),
    ['attack_plans:t1', 'attack_plans:t2'],
  );
});

// ── 2. Permission matrix + role grants ──────────────────────────────────────

test('matrix: the prefix maps read to view and every mutating verb to edit', () => {
  assert.deepStrictEqual(matrix.validate(), [], 'matrix references only catalog keys');
  assert.ok(isValidPermission(VIEW_KEY));
  assert.ok(isValidPermission(EDIT_KEY));

  const paths = [PREFIX, `${PREFIX}/list`, `${PREFIX}/latest`, `${PREFIX}/ap_1_abcdef`];
  for (const p of paths) {
    assert.strictEqual(matrix.requiredPermissionForRequest(p, 'GET').permission, VIEW_KEY, `GET ${p}`);
    assert.strictEqual(matrix.requiredPermissionForRequest(p, 'POST').permission, EDIT_KEY, `POST ${p}`);
    assert.strictEqual(matrix.requiredPermissionForRequest(p, 'DELETE').permission, EDIT_KEY, `DELETE ${p}`);
  }
});

test('matrix: the API gate and the battleplan panel gate agree', () => {
  // A role that can open the panel can read its saved plans — nothing narrower
  // and nothing wider.
  assert.strictEqual(matrix.requiredPermissionForComponent('battleplan'), VIEW_KEY);
  assert.strictEqual(matrix.requiredPermissionForRequest(`${PREFIX}/list`, 'GET').permission, VIEW_KEY);
  // Same keys as the sibling battle-cards surface.
  assert.strictEqual(matrix.requiredPermissionForRequest('/api/battle-cards', 'GET').permission, VIEW_KEY);
  assert.strictEqual(matrix.requiredPermissionForRequest('/api/battle-cards', 'POST').permission, EDIT_KEY);
});

test('matrix: a look-alike prefix does not inherit this row', () => {
  assert.strictEqual(matrix.requiredPermissionForRequest(`${PREFIX}-export`, 'GET').matched, false);
  // And the row does not shadow the neighbouring ai-* SEO rows.
  assert.strictEqual(
    matrix.requiredPermissionForRequest('/api/ai-visibility/trend', 'GET').permission, 'seo.view');
});

test('roles: generating a plan is a write authority, reading is not', () => {
  const held = (roleKey) => {
    const r = SYSTEM_ROLES.find((x) => x.key === roleKey);
    if (!r) throw new Error(`unknown role ${roleKey}`);
    return new Set(r.permissions);
  };

  // Roles that may generate (and therefore persist + spend AI budget).
  for (const roleKey of ['tenant_owner', 'tenant_admin', 'platform_admin', 'platform_owner', 'marketer']) {
    assert.ok(held(roleKey).has(VIEW_KEY), `${roleKey} should read saved plans`);
    assert.ok(held(roleKey).has(EDIT_KEY), `${roleKey} should generate plans`);
  }

  // Analyst is read-only by definition: it may re-open a saved plan but must
  // not trigger a new generation, which now writes tenant kv.
  const analyst = held('analyst');
  assert.ok(analyst.has(VIEW_KEY), 'analyst reads saved plans');
  assert.strictEqual(analyst.has(EDIT_KEY), false, 'analyst must not generate — POST persists and spends');

  // Roles with no Compete grant reach neither, matching the panel gate.
  for (const roleKey of ['content_creator', 'client_viewer']) {
    assert.strictEqual(held(roleKey).has(VIEW_KEY), false, `${roleKey} must not read saved plans`);
    assert.strictEqual(held(roleKey).has(EDIT_KEY), false, `${roleKey} must not generate plans`);
  }
});

// ── 3. Honesty markers + secret hygiene ─────────────────────────────────────

test('a stored template plan still trips strict data mode on every read', async () => {
  await postPlan(1);

  const byLatest = await getJson(1, `${PREFIX}/latest`);
  assert.ok(detectFabrication(byLatest.json), 'latest must carry the fabrication marker');

  const byId = await getJson(1, `${PREFIX}/${byLatest.json.id}`);
  assert.ok(detectFabrication(byId.json), 'by-id must carry the fabrication marker');

  const list = await getJson(1, `${PREFIX}/list`);
  assert.ok(detectFabrication(list.json), 'list metadata must carry the fabrication marker');
  assert.strictEqual(list.json.plans[0].source, 'template');
  assert.strictEqual(list.json.plans[0]._fabricated, true);
});

test('no key material or session data is persisted or returned', async () => {
  const posted = await postPlan(1);
  const blob = JSON.stringify([...kvStore.entries()]);

  assert.ok(!blob.includes(SECRET_SENTINEL), 'provider key material must never reach kv');
  assert.ok(!/sk-|_DUMMY|Bearer |infogenie\.sid/i.test(blob), 'no key/session material in the stored blob');
  assert.ok(!JSON.stringify(posted.json).includes(SECRET_SENTINEL), 'no key material in the response');

  // The stored entry holds only the declared feature fields.
  const entry = kvStore.get('attack_plans:t1')[0];
  assert.deepStrictEqual(
    Object.keys(entry).sort(),
    ['_fabricated', 'competitor', 'id', 'industry', 'myDomain', 'plan', 'savedAt', 'source', 'sources'],
  );
});

test('list metadata never carries the plan body', async () => {
  await postPlan(1);
  const list = await getJson(1, `${PREFIX}/list`);
  assert.strictEqual(list.json.plans[0].plan, undefined,
    'the index must stay metadata-only so a view grant is not a bulk export');
});
