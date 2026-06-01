// services/tenants/kv_scope.js — per-workspace (tenant) scoping for kv_store keys.
//
// Phase 2G (Task #49): the last globally-shared blobs in kv_store and the
// data/*.json disk files are moved behind tenant-namespaced keys so one
// workspace can never read or overwrite another's data. Two key shapes:
//
//   • Singleton per feature:        `${base}:t<tid>`        (e.g. white_label.brand_profile:t1)
//   • Per-record collection prefix: `${prefix}t<tid>:<id>`  (e.g. question_mine:t1:qmine_abc)
//
// Legacy un-namespaced keys/blobs are migrated ONCE at boot into the default
// (original owner) tenant — idempotent, nothing dropped. Mirrors the pattern
// already proven in services/infographics/api.js and services/linksell/api.js.

const _db = require('../../db');
const _ctx = require('./context');

// Per-tenant singleton/collection key.
function tkey(base, tid) { return `${base}:t${tid}`; }

// Sentinel for "key absent" reads. NOTE: db.kvGet's signature is
// `kvGet(key, fallback = null)` — passing `undefined` as the fallback triggers
// the DEFAULT (`null`), so a missing key reads back as `null`, indistinguishable
// from a stored null. We pass this object sentinel instead so an absent key is
// unambiguous (kvGet returns it verbatim; it is never a stored value).
const _MISSING = Symbol('kv_missing');

// Resolve the default tenant id, polling briefly if it isn't ready yet.
// These migration helpers are invoked at module-load (require time) from the
// service modules, which can run BEFORE the tenants/users schema exists — at
// which point getDefaultTenantId() returns null and the migration silently
// skips. getDefaultTenantId() only caches on success (a null result is never
// cached), so we re-poll every second for ~20s to cover the boot window.
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function _resolveDefaultTenantWithRetry(tries = 20, gapMs = 1000) {
  for (let i = 0; i < tries; i++) {
    if (!_db.hasDb()) { await _sleep(gapMs); continue; }
    const tid = await _ctx.getDefaultTenantId();
    if (tid) return tid;
    await _sleep(gapMs);
  }
  return null;
}

// Move a legacy GLOBAL singleton key into the default tenant's namespaced key.
// Idempotent: no-op if the tenant key already exists or the legacy key is absent.
async function migrateGlobalSingleton(globalKey, base) {
  if (!_db.hasDb()) return false;
  try {
    const tid = await _resolveDefaultTenantWithRetry();
    if (!tid) return false; // no resolvable tenant yet — retry on next boot
    const newKey = tkey(base, tid);
    const already = await _db.kvGet(newKey, _MISSING);
    if (already !== _MISSING) return false;
    const legacy = await _db.kvGet(globalKey, _MISSING);
    if (legacy === _MISSING || legacy === null) return false;
    await _db.kvSet(newKey, legacy);
    await _db.getPool().query(`DELETE FROM kv_store WHERE key=$1`, [globalKey]);
    console.log(`[kv_scope] migrated singleton ${globalKey} -> ${newKey}`);
    return true;
  } catch (e) { console.warn('[kv_scope] migrateGlobalSingleton', globalKey, e.message); return false; }
}

// Write an already-loaded legacy blob (from disk or a `file:<name>` kv copy)
// into the default tenant's namespaced key. Idempotent on the destination key.
async function migrateBlobToTenant(base, legacyValue) {
  if (!_db.hasDb()) return false;
  try {
    const tid = await _resolveDefaultTenantWithRetry();
    if (!tid) return false;
    const newKey = tkey(base, tid);
    const already = await _db.kvGet(newKey, _MISSING);
    if (already !== _MISSING) return false;
    if (legacyValue === undefined || legacyValue === null) return false;
    await _db.kvSet(newKey, legacyValue);
    console.log(`[kv_scope] migrated blob -> ${newKey}`);
    return true;
  } catch (e) { console.warn('[kv_scope] migrateBlobToTenant', base, e.message); return false; }
}

// Move legacy per-record keys (`${prefix}<id>`, not already tenant-namespaced)
// into `${prefix}t<tid>:<id>` for the default tenant. Returns count migrated.
async function migrateLegacyPrefix(prefix) {
  if (!_db.hasDb()) return 0;
  try {
    const tid = await _resolveDefaultTenantWithRetry();
    if (!tid) return 0;
    const p = _db.getPool();
    const r = await p.query(
      `SELECT key FROM kv_store WHERE key LIKE $1 AND key NOT LIKE $2`,
      [prefix + '%', prefix + 't%:%']
    );
    for (const row of r.rows) {
      const oldKey = row.key;
      const id = oldKey.slice(prefix.length);
      const newKey = `${prefix}t${tid}:${id}`;
      await p.query(
        `UPDATE kv_store SET key=$1 WHERE key=$2 AND NOT EXISTS (SELECT 1 FROM kv_store WHERE key=$1)`,
        [newKey, oldKey]
      );
      await p.query(`DELETE FROM kv_store WHERE key=$1`, [oldKey]);
    }
    if (r.rows.length) console.log(`[kv_scope] migrated ${r.rows.length} '${prefix}' keys to tenant ${tid}`);
    return r.rows.length;
  } catch (e) { console.warn('[kv_scope] migrateLegacyPrefix', prefix, e.message); return 0; }
}

// Move a legacy disk-migrated blob (stored in kv as `file:<name>` by db.js's
// boot migration) into the default tenant's namespaced key. Idempotent on dest.
// The `file:<name>` copy is left in place as a backup (nothing dropped).
async function migrateFileKeyToTenant(fileKey, base) {
  if (!_db.hasDb()) return false;
  try {
    const v = await _db.kvGet(fileKey, _MISSING);
    if (v === _MISSING || v === null) return false;
    return await migrateBlobToTenant(base, v);
  } catch (e) { console.warn('[kv_scope] migrateFileKeyToTenant', fileKey, e.message); return false; }
}

// Drop a legacy global `file:<name>` backup row now that Task #49's migration
// into per-workspace keys is proven stable. SELF-GUARDING: only deletes the
// backup once the default tenant's `${base}:t<tid>` key actually holds the data,
// so it can never erase the only copy. If the per-tenant key is somehow still
// missing (un-migrated environment), it migrates first and leaves the backup
// for the next boot. Idempotent — no-op once the backup row is gone.
async function cleanupLegacyFileKey(fileKey, base) {
  if (!_db.hasDb()) return false;
  try {
    const legacy = await _db.kvGet(fileKey, _MISSING);
    if (legacy === _MISSING) return false; // already removed (or never existed)
    const tid = await _resolveDefaultTenantWithRetry();
    if (!tid) return false; // no resolvable tenant yet — retry on next boot
    const perTenant = await _db.kvGet(tkey(base, tid), _MISSING);
    if (perTenant === _MISSING) {
      // Not yet migrated here — migrate first, keep the backup until next boot.
      await migrateBlobToTenant(base, legacy);
      return false;
    }
    await _db.getPool().query(`DELETE FROM kv_store WHERE key=$1`, [fileKey]);
    console.log(`[kv_scope] removed legacy backup ${fileKey} (data confirmed in ${tkey(base, tid)})`);
    return true;
  } catch (e) { console.warn('[kv_scope] cleanupLegacyFileKey', fileKey, e.message); return false; }
}

// List all per-tenant collection rows for a prefix+tenant, returning [{id,value}].
async function listTenantPrefix(prefix, tid, limit = 100) {
  if (!_db.hasDb()) return [];
  const full = `${prefix}t${tid}:`;
  const r = await _db.getPool().query(
    `SELECT key, value FROM kv_store WHERE key LIKE $1 ORDER BY key DESC LIMIT ${parseInt(limit, 10) || 100}`,
    [full + '%']
  );
  return r.rows.map(row => ({ id: row.key.slice(full.length), value: row.value }));
}

module.exports = { tkey, migrateGlobalSingleton, migrateBlobToTenant, migrateLegacyPrefix, migrateFileKeyToTenant, cleanupLegacyFileKey, listTenantPrefix, resolveDefaultTenantWithRetry: _resolveDefaultTenantWithRetry };
