// test/tenant-kv-isolation.test.js — per-workspace kv scoping (Task #49)
//
// Verifies the core invariant of the per-workspace data split: keys are
// namespaced per tenant so one workspace can never read or overwrite another's
// data, and the one-time boot migration moves a legacy GLOBAL key into the
// default (owner) tenant idempotently without clobbering existing data. The DB
// is replaced with an in-memory Map so no Postgres is needed.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

// ── In-memory kv_store fake ──────────────────────────────────────────────────
const store = new Map();

const db = require('../db');
db.hasDb = () => true;
db.kvGet = async (key, fallback = null) => (store.has(key) ? store.get(key) : fallback);
db.kvSet = async (key, value) => { store.set(key, value); };
db.getPool = () => ({
  query: async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (/DELETE FROM kv_store WHERE key=\$1/.test(s)) { store.delete(params[0]); return { rows: [] }; }
    return { rows: [] };
  },
});

// Default tenant resolves immediately (no boot-timing poll needed in tests).
const tenantCtx = require('../services/tenants/context');
tenantCtx.getDefaultTenantId = async () => 2;

const kvScope = require('../services/tenants/kv_scope');

beforeEach(() => { store.clear(); });

test('tkey namespaces the same base per tenant', () => {
  assert.strictEqual(kvScope.tkey('alerts', 1), 'alerts:t1');
  assert.strictEqual(kvScope.tkey('alerts', 2), 'alerts:t2');
  assert.notStrictEqual(kvScope.tkey('alerts', 1), kvScope.tkey('alerts', 2));
});

test('two tenants writing the same base do not read each other\'s data', async () => {
  await db.kvSet(kvScope.tkey('webhooks', 1), { hooks: ['t1-only'] });
  await db.kvSet(kvScope.tkey('webhooks', 2), { hooks: ['t2-only'] });

  const t1 = await db.kvGet(kvScope.tkey('webhooks', 1), null);
  const t2 = await db.kvGet(kvScope.tkey('webhooks', 2), null);
  assert.deepStrictEqual(t1, { hooks: ['t1-only'] });
  assert.deepStrictEqual(t2, { hooks: ['t2-only'] });

  // A tenant with no data reads its own (empty) namespace, never a sibling's.
  const t3 = await db.kvGet(kvScope.tkey('webhooks', 3), null);
  assert.strictEqual(t3, null);
});

test('migrateGlobalSingleton moves a legacy global key into the default tenant', async () => {
  store.set('white_label.brand_profile', { brand: 'Acme' });

  const migrated = await kvScope.migrateGlobalSingleton('white_label.brand_profile', 'white_label.brand_profile');
  assert.strictEqual(migrated, true);
  assert.deepStrictEqual(store.get('white_label.brand_profile:t2'), { brand: 'Acme' });
  // Legacy global key is removed so it can't be read globally anymore.
  assert.strictEqual(store.has('white_label.brand_profile'), false);
});

test('migrateGlobalSingleton is idempotent and never clobbers existing tenant data', async () => {
  // Tenant already has its own value; a stale legacy global key must NOT overwrite it.
  store.set('white_label.brand_profile:t2', { brand: 'KeepMe' });
  store.set('white_label.brand_profile', { brand: 'Stale' });

  const migrated = await kvScope.migrateGlobalSingleton('white_label.brand_profile', 'white_label.brand_profile');
  assert.strictEqual(migrated, false);
  assert.deepStrictEqual(store.get('white_label.brand_profile:t2'), { brand: 'KeepMe' });
});

test('migrateGlobalSingleton no-ops when the legacy key is absent', async () => {
  const migrated = await kvScope.migrateGlobalSingleton('nope.missing', 'nope.missing');
  assert.strictEqual(migrated, false);
  assert.strictEqual(store.has('nope.missing:t2'), false);
});
