---
name: Permission matrix enforcement
description: How role→permission backend enforcement is wired and how to extend/flip it.
---

# Permission matrix enforcement

Backend authorization is a **central matrix + global middleware**, not per-handler
decorators across ~120 routers.

- `services/tenants/permission_matrix.js` — `ROUTE_GROUPS` (mount-prefix →
  `{view, write}` keys; longest-prefix wins; write = mutating verbs, falls back to
  view) and `COMPONENT_MATRIX` (`data-view` → permission, consumed by the nav-menu).
  `validate()` asserts every referenced key exists in `permissions.js`; the test
  fails on a typo.
- `services/tenants/permission_enforce.js` — `enforceMatrix` middleware + shared
  `isPlatformAdmin()`/`hasPermission()`. Mounted once in `server.js` right after the
  auth gate, before `/api/admin`. The Admin Portal reuses `isPlatformAdmin` (one model).

**Why route-GROUP granularity:** a reviewable single table beats scattering guards
across hundreds of handlers, and the menu task needs "what does this surface
require" answerable in one place.

**Rollout flag** `PERMISSION_ENFORCEMENT` mirrors `MULTITENANT_ENFORCEMENT`:
`off` (kill-switch) · `shadow` (DEFAULT — logs/counts would-be denials, allows) ·
`on` (strict 403). Mode is read at module load — tests must clear the require cache
to switch modes (see `test/permission-matrix.test.js`).

**How to apply:** to gate a new router, add a `{prefix, view, write}` entry. Unmapped
authenticated `/api/` paths are allowed but logged so gaps surface. Owner-only
`GET /api/_debug/permissions` shows counters + recent would-be denials.

**Gotcha:** the legacy owner-gate in `server.js` still 403s non-owners on feature
data ("owner_only") until per-row data scoping ships — so permission enforcement is
the forward-looking boundary that becomes authoritative once that gate is lifted.
Role grants live in `SYSTEM_ROLES` (permissions.js): e.g. Marketer has
`grow.optimizer.view` but NOT `grow.optimizer.control`, and `brand.view` but NOT
`brand.edit` — check the actual grant before assuming.
