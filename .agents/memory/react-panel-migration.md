---
name: React panel migration (Next Phase 3)
description: Registry-driven pattern for porting one legacy #view-* panel to a native React page without breaking prod.
---

# Porting a legacy SPA panel to React (Phase 3)

Replace one legacy `#view-*` panel with a React component, driven by a registry.
Full how-to lives in `docs/react-panel-migration.md`; this is the durable why.

## The mechanism
- `lib/migratedViews.ts` is the single source of truth (`{ view, legacyModule }`).
- `components/features/registry.tsx` maps view id → React component.
- `components/layout/MigratedPanel.tsx` (mounted once in the dashboard layout)
  resolves the active view from the URL and renders the component, else null.
- `lib/legacyShell.ts` strips each migrated view's `#view-<id>` div AND drops its
  `public/js` module from the **dev replay shell** so the legacy panel can't
  double-render and its module stops loading.

## Two non-obvious traps
- **MigratedPanel's wrapper must NOT have class `.view`.** Legacy `navigateTo`
  hides every `.view` div on each nav — a `.view` wrapper gets hidden out from
  under React. It only mounts for migrated views, so it's always the sole panel.
- **Do NOT physically delete the legacy `#view-*` markup or `public/js` module
  yet.** Prod still serves the vanilla-JS SPA via Express (no Next.js in prod).
  Those files ARE what prod renders — deleting them = prod regression. Suppression
  is dev-shell-only. Physical deletion is the final step, gated on Next owning the
  prod front door. The `navigateTo` build call is already null-guarded so a
  removed module won't throw.

- **`legacyModule` must be `null` for any panel whose builder lives in a SHARED
  `public/js` module** (e.g. ig_seo.js, ig_manage_pack.js, ig_moat_features.js,
  ig_intelligence_tools.js) or inline in app.js. Those modules still build many
  not-yet-migrated sibling views, so dropping the whole module would break them.
  Suppression then relies SOLELY on stripping the `#view-<id>` div — which works
  because every legacy builder early-returns when its target div/wrap is missing.
  Only a panel with a DEDICATED module (like the pilot's ig_seo_roadmap.js) may
  set `legacyModule` to drop it.

**Why registry-driven + dev-only suppression:** lets panels migrate one at a time
with zero prod regression; flipping prod later makes deletion a mechanical step.

## Two port-time TypeScript/ESLint traps (cost a build cycle each)
- **Custom API response interfaces must carry `error?: string` (and `ok`).**
  `apiGet<T>`/`apiPost<T>` return your `T` as-is; if you type `apiGet<CallsResponse>`
  and then read `r.error`, TS errors unless `CallsResponse` declares `error?`. For
  a custom **helper** constrained `<T extends ApiResult>` (e.g. a wrapper like
  Studio's `sGet`), pass `MyType & ApiResult` — the bare `MyType & { ok: boolean }`
  fails the `ApiResult` index-signature constraint.
- **Never name a non-hook helper `useX`.** ESLint `react-hooks/rules-of-hooks`
  treats any `use`-prefixed function as a hook and errors when it's called inside a
  callback/JSX handler. Name plain helpers `applyX`/`pickX` instead.

## Verify
`npx tsc --noEmit` + `npm run build:next` ("Compiled successfully" — note the
build's lint step fails on PRE-EXISTING `<a>`-vs-`<Link>` errors in the Phase 1
auth pages `accept-invite`/`reset-password`, unrelated to panel work). Dashboard
routes require the `infogenie.sid` cookie, so an unauthenticated screenshot/curl
307s to `/login` — that's correct, not a failure.

## Status
Pilot: `seo-roadmap` (Reach). Manage group (42) done in batch 2. **Batch 3 ported
ALL remaining groups — Analyse, Create, Reach, Grow, AI Team (156 panels)** — so
every nav panel now has a React component in `components/features/<group>/`
(folders: analyse/create/reach/grow/aiteam/manage) and `registry.tsx` +
`migratedViews.ts` carry 199 entries. New entries all use `legacyModule: null`
(shared/inline builders). Component naming = PascalCase of the view id.
Bulk-port method: per-batch subagents create ONLY component files + a manifest;
main agent generates registry/migratedViews centrally from a master view→component
map. Subagents on big panels (studio/content/dashboard) time out at the
StartToClose limit — keep batches to 1–2 complex panels; files written before the
timeout still land, so re-audit disk and re-dispatch only the missing.
