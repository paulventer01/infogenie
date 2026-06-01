---
name: Tenant schema-isolation audit
description: A live-DB test guards the whole-schema per-workspace invariants; how to keep it green when adding tables.
---

# Whole-schema tenant-isolation guard

`test/tenant-schema-audit.test.js` introspects the live Postgres and asserts the
per-workspace invariants across ALL tables (not just the two Task #45 covered):
every business table has `tenant_id`, it's NOT NULL, the phase-2 migration lists
match the DB, and every `REWRITE_UNIQUE` table has a composite `(tenant_id, …)`
key with the legacy single-column natural key gone.

**Why:** Phase 2 touches 100+ tables; a new tenant-scoped table that forgets its
column, its NOT NULL flip, or its composite UNIQUE is a silent cross-tenant leak/
clobber. This test fails loudly instead.

**How to apply when you add a table:**
- Normal feature table → add `tenant_id INT NOT NULL` + migrate it (it'll be
  picked up by the audit's coverage check automatically).
- Genuinely global table → add it to BOTH `KNOWN_GLOBAL` in the test AND the
  documented exclusion list in `services/tenants/phase2_migrate.js`.
- Legitimately-nullable tenant_id (global system rows + scoped rows) → add to
  `NULLABLE_OK` in the test and `PHASE2E_NULLABLE_OK` in phase2_migrate.js.

**Source of truth for the table set:** `phase2_migrate.js` exports `PLAIN_TABLES`
and `REWRITE_UNIQUE`. The audit reuses those exports, so adding a table to the
migration list is enough — don't duplicate the list in the test.

**Caveat:** the audit needs a live `DATABASE_URL` (skips with a message if unset).
It does NOT check write paths — INSERTs that omit `tenant_id` are a separate gap
(features silently fail to persist). See the tenant-write-wiring memory.

**Behavioral real-DB isolation tests** (e.g. `test/search-pulse-tenant-db.test.js`):
the schema audit proves the constraints EXIST; a behavioral test proves they
actually isolate. To make one self-contained and non-destructive: idempotently
call the feature's `ensure*Schema()` + `ensureTenantSchema()`, create two
throwaway `tenants` rows with unique slugs (created_by_user_id may be NULL),
use a random source_url/seed suffix so you never collide with real data, and
clean up in `after` by `DELETE FROM tenants WHERE id = ANY(...)` — the
`tenant_id ... ON DELETE CASCADE` FK removes every row you created. Fake-pool
tests can't catch a dropped/missing UNIQUE; only a real INSERT against the live
constraint can.
