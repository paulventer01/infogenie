---
name: Tenant scoping of feature read/delete routes
description: How feature modules isolate workspace data, which routes are intentionally unscoped, and the separate write-side gap.
---

# Tenant isolation in services/*/api.js read/delete routes

Multitenant enforcement is ON in production. Every GET/DELETE handler that touches a
tenant-scoped table (any table with a `tenant_id NOT NULL` column) MUST resolve the
caller's tenant and filter every SQL statement by `tenant_id`, or one workspace can
read/destroy another's data.

**Pattern** (reference: `services/cold_email/api.js`, `services/carousel/api.js`,
`services/audiences/api.js`):
- `const _tenantCtx = require('../tenants/context');`
- `const tid = await _tenantCtx.resolveTenantId(req, { label: '<mod>:<route>' });`
- List → `WHERE tenant_id=$N`; by-id → `WHERE id=$1 AND tenant_id=$2`; child tables
  queried by parent id → also `AND tenant_id=$N` (defense in depth).
- If `tid` is null the query simply returns/affects nothing — safe (no leak), matches
  the cold_email reference (no explicit 400 needed).

**Intentionally NOT tenant-scoped (do not "fix" these):**
- `services/admin/api.js` — platform portal, gated to platform_owner/platform_admin
  only; operates cross-tenant BY DESIGN (selects which tenant/client to act on).
- `services/audiences` `GET /:id/members` & `/:id/log` — already secure: they verify
  the parent segment belongs to the tenant via `_audienceForTenant(id, tid)` before
  querying child rows by `segment_id`. Parent-check is a valid isolation pattern.
- Genuinely PUBLIC routes (no session): `ai_traffic GET /beacon`, `*/embed*.js` and
  `*/embed/:id.js` (conversion_boosters, seo_widget), `employee_advocacy GET
  /public/:shareKey`, and the public `POST /event` ingest routes (scroll_tracker,
  site_search). Their analytics READ counterparts (`/insights`, `/summary`, `/page`,
  `/stats`, `/sites`) ARE authenticated dashboard reads (called from app.js) and MUST
  be scoped.

**How to tell a read is dashboard vs public:** grep `app.js` for the endpoint — if the
authenticated SPA calls it via `_api(...)`/`fetch`, it's a dashboard read → scope it.
The public embed/tracking snippet only ever POSTs to `/event` or hits `/embed*.js`.

**Leaks hide in non-GET routes too:** the read/delete audit must also cover POST
*action* routes that READ a tenant-scoped table by an arbitrary id/name or with no
filter, then act on it — these leak/act cross-tenant just like a list read. Real
cases found: a public share page selecting child rows without scoping to the parent
key's tenant; a `/reset` that `DELETE`d a whole table; `/run-now` selecting rows by
arbitrary id or all-rows; a bulk-send resolving a template by id/name unscoped (and
`name` is only unique WITHIN a tenant after REWRITE_UNIQUE). Fix = resolve tid and
add `AND tenant_id=$N` / inherit it from the validated parent row.

**Parent-check is the dominant safe pattern here** — `/widgets/:id/events`,
`/:id/runs`, audiences members all SELECT child rows by parent id AFTER verifying the
parent belongs to the tenant. A naive "SQL literal lacks tenant_id" scan flags these
as false positives; check for the preceding ownership SELECT before "fixing".

**Separate write-side gap (OUT OF SCOPE of the read/delete audit, real bug):** many
"unwired" feature modules never set `tenant_id` on INSERT, so writes FAIL the NOT NULL
constraint and are swallowed by try/catch — these features silently can't persist new
rows. Their list pages only show data backfilled during the tenants phase2 migration.
**Why:** the phase2 rollout added `tenant_id NOT NULL` + backfilled existing rows, but
the per-module INSERT statements were not updated. Fixing reads stops the leak; the
features still need their writes wired (resolve tid + include `tenant_id` in INSERT)
to actually function per-workspace.
