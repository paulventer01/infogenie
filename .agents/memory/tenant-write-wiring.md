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
