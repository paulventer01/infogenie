---
name: Tenant write-side wiring (INSERTs)
description: How to choose the tenant_id source when wiring INSERTs under multitenant enforcement=on.
---

Under `MULTITENANT_ENFORCEMENT=on`, every feature table has `tenant_id NOT NULL`, so any INSERT that omits it fails for newer workspaces. When adding/auditing INSERTs in `services/*/api.js`, pick the tenant_id source by route type:

- **Authenticated route** → `_tenantCtx.resolveTenantId(req, {label})`. Many modules expose a local `_tid(req, label)` alias for this — use it if present.
- **Public/ingest route that has a parent row** → inherit `tenant_id` from the parent (SELECT the parent's tenant_id and reuse it). Reference: `services/conversion_boosters/api.js` (~L210-262).
- **Parentless public webhook / cron ingest** (e.g. Vapi voice webhooks, Meta WhatsApp inbound webhook, scroll/site-search beacons) → `_tenantCtx.getDefaultTenantId()` (crons use `getCronTenantId()`).
- **Bulk fire-and-forget loop** → resolve the tenant ONCE in the route handler before `res.json()` and capture it in the closure; do not call `_tid(req,...)` inside the detached async loop (req context is gone).

**Why:** these four cases are the only correct sources; using `allowFallback` was removed in the enforcement-on flip, and resolving inside a detached closure loses request context.

**How to apply:** for `INSERT ... ON CONFLICT`, just prepend `tenant_id` to the column/value list and keep the existing conflict target. NOTE: several of these conflict targets are still GLOBAL single-column unique keys (wa_contacts.wa_id, wa_templates.name, influencers platform+handle, newsletter brand+archive_url, roadmap_progress task_id) — adding tenant_id to the columns does NOT make them tenant-isolated; that needs a composite UNIQUE constraint (separate follow-up). `voice_calls.vapi_call_id` is a genuinely global provider id and is fine as-is.

Dynamic-column builders (e.g. `brand_foundation/api.js` building `cols=['tenant_id',...keys]`) already include tenant_id and read as false positives in a naive regex scanner.

**Delegated-SQL modules (e.g. search_intel):** when a module's `api.js` routes don't run SQL themselves but call a helper file (e.g. `ai_visibility.js`) that owns all the queries, both layers need wiring: routes resolve tid and pass it as an arg, helpers add `tenant_id` to INSERTs and `WHERE tenant_id=$N` to reads. Don't forget the **child-table writes** the helper does as a side effect (e.g. `runQueryAcrossProviders` inserting into `search_intel_llm_runs`) — those child tables are also `tenant_id NOT NULL`, so the side-effect INSERT must carry the parent row's `tenant_id` or the run fails under enforcement=on. Cron/`/run-all`-style batch paths stay intentionally cross-tenant.

**Per-tenant unique rewrites have TWO homes:** the deferred `phase2_migrate.js` REWRITE_UNIQUE list AND the module's own `ensureXSchema()` inline (drop legacy `*_key` constraint, then `addTenantIdColumn(table, {uniqueWithExtra:[...]})`). Do the inline one too so fresh installs / the boot window before the deferred batch don't hit a missing-constraint ON CONFLICT. The new constraint is named `<table>_tenant_unique_<extras>`; ON CONFLICT matches by column list, not name.
