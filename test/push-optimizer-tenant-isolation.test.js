// test/push-optimizer-tenant-isolation.test.js — Task #41 regression guard
//
// Both optimizer_settings and webpush_subs previously had a GLOBAL single-column
// primary key (key / endpoint), so a second workspace's INSERT ... ON CONFLICT
// silently overwrote the first workspace's row. The fix made the conflict target
// composite — UNIQUE (tenant_id, key) and UNIQUE (tenant_id, endpoint) — so each
// workspace owns its own row. These tests assert that isolation holds: the same
// key/endpoint written by two tenants persists as two independent rows, and a
// scoped read for tenant A never returns tenant B's value.
//
// Postgres is replaced with an in-memory fake pool that honours the composite
// conflict targets, so no database is required.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

// ── In-memory fake of the two composite-keyed tables ─────────────────────────
// Rows keyed by `${tenant_id}\u0000${naturalKey}` to mirror the real
// UNIQUE (tenant_id, <key|endpoint>) constraint.
const settings = new Map();   // optimizer_settings
const subs = new Map();       // webpush_subs

function settingKey(tid, key) { return `${tid}\u0000${key}`; }

function fakeQuery(sql, params = []) {
  const s = sql.replace(/\s+/g, ' ').trim();

  // ── optimizer_settings ──
  if (/^SELECT value FROM optimizer_settings WHERE tenant_id=\$1 AND key=\$2/.test(s)) {
    const row = settings.get(settingKey(params[0], params[1]));
    return { rows: row ? [{ value: row.value }] : [] };
  }
  if (/^INSERT INTO optimizer_settings/.test(s)) {
    const [tid, key, valueJson] = params;
    // value column is JSONB; setSetting passes a JSON string, Postgres stores
    // it parsed. ON CONFLICT (tenant_id, key) updates only the matching row.
    settings.set(settingKey(tid, key), { value: JSON.parse(valueJson) });
    return { rows: [] };
  }

  // ── webpush_subs ──
  if (/^INSERT INTO webpush_subs/.test(s)) {
    const [tid, endpoint, keysJson, contact] = params;
    // ON CONFLICT (tenant_id, endpoint) — collisions are per-tenant only.
    subs.set(settingKey(tid, endpoint), {
      tenant_id: tid, endpoint, keys: JSON.parse(keysJson), contact,
    });
    return { rows: [] };
  }
  if (/^SELECT endpoint, keys FROM webpush_subs WHERE tenant_id=\$1/.test(s)) {
    const tid = params[0];
    const rows = [...subs.values()]
      .filter(r => r.tenant_id === tid)
      .map(r => ({ endpoint: r.endpoint, keys: r.keys }));
    return { rows };
  }
  if (/^DELETE FROM webpush_subs WHERE tenant_id=\$1 AND endpoint=\$2/.test(s)) {
    subs.delete(settingKey(params[0], params[1]));
    return { rows: [] };
  }

  return { rows: [] };
}

const db = require('../db');
db.hasDb = () => true;
db.getPool = () => ({ query: async (sql, params) => fakeQuery(sql, params) });

const optimizer = require('../services/optimizer/schema');
const webpush = require('../services/omnichannel/webpush');

beforeEach(() => { settings.clear(); subs.clear(); });

// ── optimizer_settings ───────────────────────────────────────────────────────

test('two tenants writing the same optimizer setting key keep independent rows', async () => {
  await optimizer.setSetting(1, 'optimizer_live', { live: true });
  await optimizer.setSetting(2, 'optimizer_live', { live: false });

  // Both rows persist — neither write overwrote the other.
  assert.strictEqual(settings.size, 2);
  assert.deepStrictEqual(await optimizer.getSetting(1, 'optimizer_live'), { live: true });
  assert.deepStrictEqual(await optimizer.getSetting(2, 'optimizer_live'), { live: false });
});

test('getSetting(tenantA) never returns tenantB\'s value', async () => {
  await optimizer.setSetting(2, 'optimizer_live', { live: true });

  // Tenant A has no setting of its own → falls back, never sees tenant B's row.
  assert.strictEqual(await optimizer.getSetting(1, 'optimizer_live', null), null);
  assert.strictEqual(await optimizer.getSetting(1, 'optimizer_live', 'def'), 'def');
});

test('updating one tenant\'s setting does not touch another\'s', async () => {
  await optimizer.setSetting(1, 'target_roas', { value: 2 });
  await optimizer.setSetting(2, 'target_roas', { value: 5 });
  // Re-write tenant 1 only.
  await optimizer.setSetting(1, 'target_roas', { value: 9 });

  assert.deepStrictEqual(await optimizer.getSetting(1, 'target_roas'), { value: 9 });
  assert.deepStrictEqual(await optimizer.getSetting(2, 'target_roas'), { value: 5 });
});

test('setSetting/getSetting refuse a null tenant id', async () => {
  assert.strictEqual(await optimizer.setSetting(null, 'k', { a: 1 }), false);
  assert.strictEqual(settings.size, 0);
  assert.strictEqual(await optimizer.getSetting(null, 'k', 'fallback'), 'fallback');
});

// ── webpush_subs ─────────────────────────────────────────────────────────────

const SAME_ENDPOINT = 'https://push.example.com/sub/shared-endpoint';
const keysA = { p256dh: 'keyA', auth: 'authA' };
const keysB = { p256dh: 'keyB', auth: 'authB' };

test('two tenants subscribing the same endpoint keep independent rows', async () => {
  assert.deepStrictEqual(
    await webpush.subscribe({ endpoint: SAME_ENDPOINT, keys: keysA }, 'a@x.com', 1),
    { ok: true });
  assert.deepStrictEqual(
    await webpush.subscribe({ endpoint: SAME_ENDPOINT, keys: keysB }, 'b@x.com', 2),
    { ok: true });

  // Same endpoint string, but two distinct per-tenant rows — no overwrite.
  assert.strictEqual(subs.size, 2);
  assert.deepStrictEqual(subs.get(settingKey(1, SAME_ENDPOINT)).keys, keysA);
  assert.deepStrictEqual(subs.get(settingKey(2, SAME_ENDPOINT)).keys, keysB);
});

test('broadcast only reads the calling tenant\'s subscriptions', async () => {
  await webpush.subscribe({ endpoint: SAME_ENDPOINT, keys: keysA }, 'a@x.com', 1);
  await webpush.subscribe({ endpoint: SAME_ENDPOINT, keys: keysB }, 'b@x.com', 2);
  await webpush.subscribe({ endpoint: 'https://push.example.com/sub/extra', keys: keysB }, 'b2@x.com', 2);

  // No VAPID keys configured in the test env → stub path, but the SELECT is
  // still tenant-scoped, so the count reflects only that tenant's rows.
  const t1 = await webpush.broadcast('hi', 'body', null, 1);
  const t2 = await webpush.broadcast('hi', 'body', null, 2);
  assert.strictEqual(t1.sent, 1);
  assert.strictEqual(t2.sent, 2);
});

test('re-subscribing the same (tenant, endpoint) updates in place, never another tenant', async () => {
  await webpush.subscribe({ endpoint: SAME_ENDPOINT, keys: keysA }, 'a@x.com', 1);
  await webpush.subscribe({ endpoint: SAME_ENDPOINT, keys: keysB }, 'b@x.com', 2);
  // Tenant 1 refreshes its keys for the same endpoint.
  const refreshed = { p256dh: 'keyA2', auth: 'authA2' };
  await webpush.subscribe({ endpoint: SAME_ENDPOINT, keys: refreshed }, 'a@x.com', 1);

  assert.strictEqual(subs.size, 2);
  assert.deepStrictEqual(subs.get(settingKey(1, SAME_ENDPOINT)).keys, refreshed);
  assert.deepStrictEqual(subs.get(settingKey(2, SAME_ENDPOINT)).keys, keysB);
});

test('subscribe refuses a null tenant id', async () => {
  assert.deepStrictEqual(
    await webpush.subscribe({ endpoint: SAME_ENDPOINT, keys: keysA }, 'a@x.com', null),
    { ok: false, error: 'no tenant' });
  assert.strictEqual(subs.size, 0);
});
