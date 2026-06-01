// test/drip-unsubscribe-isolation.test.js — public unsubscribe is single-tenant.
//
// The public, unauthenticated GET /api/drips/unsubscribe must mutate EXACTLY ONE
// workspace's drip state — never fan out across tenants. This guards against a
// regression where a missing/forged `t` param broadcasts the unsubscribe (and
// its enrollment changes) into every active workspace. Tests exercise the shared
// core (services/drips/unsubscribe.js) used by the route, with an in-memory
// per-tenant store, under both modern (`t` present) and legacy (no `t`) links.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const { unsubscribeEmail } = require('../services/drips/unsubscribe');

// Per-tenant in-memory drip store mirroring global._dripStore's contract.
const enroll = new Map(); // tid -> [{ email, status }]
const unsub = new Map();  // tid -> [email]
const store = {
  lock: (fn) => fn(),
  load: async (tid) => enroll.get(tid) || [],
  save: async (tid, list) => { enroll.set(tid, list); },
  loadUnsubs: async (tid) => new Set(unsub.get(tid) || []),
  saveUnsubs: async (tid, set) => { unsub.set(tid, [...set]); },
};

let defaultTid;
const ctx = { getDefaultTenantId: async () => defaultTid };

beforeEach(() => {
  enroll.clear();
  unsub.clear();
  defaultTid = 2;
  // Both workspaces have the same email actively enrolled.
  enroll.set(2, [{ email: 'alice@x.com', status: 'active' }]);
  enroll.set(3, [{ email: 'alice@x.com', status: 'active' }]);
});

test('modern link (t=3) unsubscribes only that workspace', async () => {
  const r = await unsubscribeEmail({ email: 'alice@x.com', tParam: '3', store, ctx });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.tid, 3);
  assert.strictEqual(r.touched, 1);

  // Tenant 3 changed.
  assert.strictEqual(enroll.get(3)[0].status, 'unsubscribed');
  assert.deepStrictEqual([...(unsub.get(3) || [])], ['alice@x.com']);
  // Tenant 2 is completely untouched.
  assert.strictEqual(enroll.get(2)[0].status, 'active');
  assert.strictEqual((unsub.get(2) || []).length, 0);
});

test('legacy link (no t) falls back to the default tenant only', async () => {
  const r = await unsubscribeEmail({ email: 'alice@x.com', tParam: undefined, store, ctx });
  assert.strictEqual(r.tid, 2); // default/owner tenant
  assert.strictEqual(r.touched, 1);

  // Only the default tenant changed.
  assert.strictEqual(enroll.get(2)[0].status, 'unsubscribed');
  assert.deepStrictEqual([...(unsub.get(2) || [])], ['alice@x.com']);
  // Sibling workspace stays active — no cross-tenant broadcast.
  assert.strictEqual(enroll.get(3)[0].status, 'active');
  assert.strictEqual((unsub.get(3) || []).length, 0);
});

test('no resolvable tenant is a no-op, never a broadcast', async () => {
  defaultTid = null;
  const r = await unsubscribeEmail({ email: 'alice@x.com', tParam: undefined, store, ctx });
  assert.strictEqual(r.touched, 0);
  // Nothing written to any workspace.
  assert.strictEqual(enroll.get(2)[0].status, 'active');
  assert.strictEqual(enroll.get(3)[0].status, 'active');
  assert.strictEqual((unsub.get(2) || []).length, 0);
  assert.strictEqual((unsub.get(3) || []).length, 0);
});

test('missing email is rejected', async () => {
  const r = await unsubscribeEmail({ email: '', tParam: '2', store, ctx });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'missing_email');
});
