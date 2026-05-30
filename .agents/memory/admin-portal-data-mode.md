---
name: Admin Portal & Data-Mode enforcement
description: Durable design decisions for the owner/admin portal, data-mode honesty policy, and code-driven issues system.
---

# Admin Portal, Data-Mode & Issues (services/admin/*)

## Client-level data mode MUST be tenant-scope-verified
`clientId` can arrive from an untrusted query param / header. Before honoring a
client-level demo/strict override, confirm the client's `tenant_id` equals the
request's resolved tenant — otherwise any authenticated caller flips another
tenant's honesty policy (cross-tenant broken-access-control).
**Why:** a code review caught `resolveDataMode` trusting `clientId` blindly; the
same resolver feeds both the global enforcement interceptor and the public
`/api/data-mode/effective` endpoint, so the bypass was reachable everywhere.
**How to apply:** keep the tenant-match guard centralized in `resolveDataMode`
so every consumer inherits it; never re-add a path that trusts a raw client id.

## Honesty must cover ALL fabricated surfaces, not just the KPI block
The task requires demo badges (demo) / "data unavailable" states (strict) on
every fabricated surface: KPI tiles, the CTR/ROAS/Trend/Spend charts, competitor
benchmark tiles, and AI-generated backlink lists — a toast/event broadcast alone
is not acceptance.
**How to apply:** charts go through a shared `_applyChartDataMode(canvasId,
isEstimated, source)` that badges or hides the canvas; sections use
`_applySectionDataMode`. Drive "isEstimated" from the same flags the KPI block
uses (`window._kpiEstimated` / `_hasRealTraffic`). Server-fetched fabricated data
(e.g. backlinks) is already transformed to `{data_unavailable}` / `_demo` by the
enforcement interceptor — read those response markers and render accordingly.

## Router mount ordering (server.js) — a hard constraint
`/api/admin` must be mounted **after** the api-key/session auth gate but
**before** the owner-only legacy gate.
**Why:** before the auth gate, api-key callers have no `req.user` and get
`auth_required`; after the owner gate, non-owner `platform_admin`s get blocked.
The router self-gates on platform role, so it has to sit in that window.
**How to apply:** any new pre-owner-gate router (e.g. tenant-scoped public
resolvers) follows the same rule.

## Frontend honesty needs an effective resolver, not the platform default
Browser-generated fabrications (e.g. `data.js` KPI/trend estimates) have no
server round-trip, so the SPA must learn the effective mode itself.
**Why:** reading only the admin platform-default (`/api/admin/data-mode`) is
admin-only and ignores client/tenant overrides — regular users would always see
strict regardless of config.
**How to apply:** resolve via a non-admin endpoint that runs the full
client → tenant → platform → strict chain, reachable by any authenticated user
(mounted before the owner gate). Cache it client-side; re-fetch when an admin
toggles the mode. `resolveDataMode()` returns `{mode, source}` — read `.mode`.

## Data-mode resolution order (single source of truth)
client.data_mode → tenant.data_mode_default → platform default (kv) → `strict`.
`inherit` means "fall through". Strict is the safe default so honesty wins when
nothing is configured. Policy is identical dev/prod — never NODE_ENV-gated.

## Fabrication detection is marker-driven
The response interceptor only acts on existing markers
(`source ∈ {placeholder, fallback, template, serp-fallback, demo, mock,
sample}`, `_estimated`, `_fabricated`), scanned 2 levels deep. To make a new
fabrication point honest, just tag its fallback with one of those markers — no
per-route code. demo → annotate + badge; strict → replace with
`data_unavailable` and raise an issue.

## Issues must always attribute to a tenant
`issues.tenant_id` is NOT NULL. `raiseIssue()` falls back to the default tenant
(`getCronTenantId()` → owner's first active tenant) when the request has no
tenant context, so strict-mode blocks still record. If no active tenant exists
at all, the issue can't persist — there is always one in practice (owner's).

## Per-client mode is inert unless the SPA propagates client context
Server-side resolution & enforcement are correct, but they only see a client if
the browser sends one. The SPA holds an active-client id (persisted in
localStorage) and the global fetch interceptor injects it as an `x-ig-client`
header on same-origin `/api/` calls (never `/api/admin/`, never cross-origin).
**Why:** a code review flagged the per-client override as unreachable at runtime
because nothing emitted `clientId`/`x-ig-client`; the feature looked done but had
no effect end-to-end.
**How to apply:** the same interceptor that injects the header reads response
markers; the effective-mode loader is called with the active client id on boot
and whenever it changes. Admin "Preview as client" sets/clears that context.

## Email alerts are best-effort
Issue emails use Resend `RESEND_FROM_EMAIL`; an unverified domain logs a 403 and
the inbox/dedupe still work. Same verified-domain gotcha noted in replit.md.
