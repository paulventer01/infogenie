---
name: Tenant kv migration (boot)
description: Two non-obvious traps when migrating legacy global kv blobs into per-tenant keys at boot.
---

# Boot-time migration of legacy global data into per-tenant kv keys

When moving globally-shared `kv_store` blobs (or disk-migrated `file:<name>.json`
copies) into `${base}:t<tid>` per-workspace keys via the `kv_scope.js` migrate
helpers, several traps will silently make every migration a no-op:

## 1. Schema-readiness timing
The migration must NOT assume the tenant schema exists when it fires.
`getDefaultTenantId()` joins `tenants` + `users`; at module-load (when service
modules `require` and immediately call a migrate helper) those tables aren't
created yet, so it returns `null` and every migration skips with no error.

Two complementary fixes, both needed:
- **Service-module callers** (fire `migrateGlobalSingleton/migrateLegacyPrefix` at
  require time): the migrate helpers in `kv_scope.js` poll `getDefaultTenantId()`
  for ~20s (1s gaps) before giving up. This is safe because `getDefaultTenantId()`
  only caches on success — a `null` result is never cached, so re-polling re-queries.
- **server.js boot blocks**: defer with `setTimeout(..., 9000)` so the schema is
  ready, matching the Phase 2 migration pattern.

**Why:** silent no-op, no warning logged — you only notice because the `*:t<tid>`
keys never appear in `kv_store`.

## 2. db.kvGet default-parameter trap
`db.kvGet(key, fallback = null)` uses a **default parameter**. Passing `undefined`
explicitly (`kvGet(newKey, undefined)`) triggers the default, so a MISSING key reads
back as `null`, not `undefined`. Any "already migrated?" guard written as
`if (already !== undefined) return false` therefore always bails (`null !== undefined`
is true). **Fix:** pass an object/Symbol sentinel (`const _MISSING = Symbol(...)`) as
the fallback so an absent key is unambiguous: `kvGet(key, _MISSING); if (v !== _MISSING) ...`.

**How to apply:** any code that needs to distinguish "key absent" from "stored null"
via `db.kvGet` MUST pass a non-null/non-undefined sentinel as the fallback — never
`undefined` (it collapses to the `null` default) and never `null` (ambiguous with a
stored null).

## 3. Directory-based disk stores need their own migration
`db.js`'s flat-file boot migration only copies top-level `data/*.json` into
`file:<name>.json` kv keys. A feature that stores files in a SUBDIRECTORY (e.g.
`data/diag-captures/<slug>.json`) is invisible to it, so those records never get a
`file:` key and a `migrateFileKeyToTenant` will silently no-op. Such stores need a
dedicated boot migration that reads the disk files directly and writes them into the
per-tenant keys, gated on an idempotency check (e.g. skip if the tenant already has
any rows for that prefix).

**How to apply:** when converting any disk-backed feature to per-tenant kv, confirm
whether its data is a flat file or a directory. Flat file → add a
`['file:<name>.json', base]` entry. Directory → write a bespoke readdir→kvSet loop.

## Cover legacy keys even when this environment has none
Add migration entries for every store that *could* have legacy data in another
deployment (e.g. production), not just the ones with data on this disk. Stores like
`alerts_snapshot` / `drip_unsubs` had no file here, but production may — a
`migrateFileKeyToTenant` entry is a cheap idempotent no-op when the source is absent.

## Default tenant
`getDefaultTenantId()` = first `active` tenant whose `created_by_user_id` is an
`is_owner=TRUE` user (lowest tenant id), else any active tenant (lowest id). Do NOT
assume tenant id 1 — the owner's first workspace is often a higher id.
