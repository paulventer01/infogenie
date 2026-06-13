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

**Why registry-driven + dev-only suppression:** lets panels migrate one at a time
with zero prod regression; flipping prod later makes deletion a mechanical step.

## Verify
`npx tsc --noEmit` + `npm run build:next` ("Compiled successfully" — note the
build's lint step fails on PRE-EXISTING `<a>`-vs-`<Link>` errors in the Phase 1
auth pages `accept-invite`/`reset-password`, unrelated to panel work). Dashboard
routes require the `infogenie.sid` cookie, so an unauthenticated screenshot 307s
to `/login` — that's correct, not a failure.

Pilot: `seo-roadmap` (Reach) → `components/features/reach/SeoRoadmap.tsx`,
API `GET`/`POST /api/seo-roadmap/progress`.
