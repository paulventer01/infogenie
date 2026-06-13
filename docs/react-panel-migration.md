# Porting a legacy SPA panel to a native React page

This is the repeatable pattern for replacing one legacy `#view-*` panel with a
real React component, established by the pilot (**Reach → SEO Roadmap**,
`seo-roadmap`). Background: `.agents/memory/nextjs-phase2-spa-shell.md` and
`.agents/memory/nextjs-migration.md`.

## How it fits together

In dev, Next is the front door: it renders the React `<Navbar/>` and replays the
legacy SPA body + scripts (`LegacyBody` + `LegacyScripts`). A small registry lets
individual panels render from React instead of the replayed legacy `#view-*` div:

- **`lib/migratedViews.ts`** — the single source of truth: a list of ported
  views, each `{ view, legacyModule }`. Everything else derives from it.
- **`components/features/registry.tsx`** — maps each migrated `view` id to its
  React component.
- **`components/layout/MigratedPanel.tsx`** — mounted once in the dashboard
  layout. It resolves the active view from the URL (`pathToViewId`) and renders
  the registered component, or `null` so the replayed legacy panel handles it.
- **`lib/legacyShell.ts`** — when building the dev replay shell, it strips each
  migrated view's `#view-<id>` div from the body AND drops its `public/js`
  module from the replayed scripts. So the legacy panel never double-renders and
  its module stops loading in dev.

Navigation is unchanged: the navbar (and `lib/nav.ts#goToView`) call the legacy
`window.navigateTo(view)` (instant legacy panel swap / no-op for migrated views)
**and** `router.push(viewToPath(view))`. The route change is what mounts the
right React component in `<MigratedPanel/>`.

> **Why `<MigratedPanel/>`'s wrapper has no `.view` class:** legacy `navigateTo`
> hides every `.view` div on each navigation. A `.view` wrapper would get hidden
> out from under React. The panel only mounts for migrated views (whose legacy
> div is stripped), so it is always the sole visible panel for that route.

## ⚠️ Prod safety — do NOT delete the legacy files yet

Production still serves the vanilla-JS SPA directly via Express; **there is no
Next.js in prod yet.** The legacy `#view-<id>` markup in `index.html` and the
`public/js/<module>.js` file are what prod renders, so they must stay on disk.
Suppression via the registry is **dev-shell-only** and leaves them untouched —
zero prod regression. Physically deleting the legacy view + module (the step that
shrinks the shipped bundle) is the **final** move, deferred until Next owns the
prod front door. At that point, deletion is mechanical: remove the `#view-<id>`
block from `index.html`, delete the module + its `<script>` tag, and remove the
now-dead build call in `app.js`'s `navigateTo` (it is already null-guarded:
`window.buildX && window.buildX()`).

## Steps to port a panel

1. **Read the legacy source.** Find the `#view-<id>` div in `index.html` and the
   builder (`public/js/ig_*.js` or a `buildX()` in `app.js`). Note every API it
   calls — you will hit the **same** `/api/*` endpoints from React.
2. **Write the component** under `components/features/<group>/<Name>.tsx`
   (`"use client"`). Port the markup to JSX and the data flow to React state.
   - Fetch via `lib/api` (`apiGet`/`apiPost`/…), which preserves the
     `{ ok, … }` contract and normalises transport errors.
   - Navigate to other tools via `lib/nav#goToView(router, view)`.
   - Reuse the legacy CSS classes / `style.css` variables so the look is
     identical. Keep panel-specific CSS in a `<style>` block in the component.
   - **No fabricated/sample data** — render real API data or an explicit empty
     state, same as the legacy panel.
3. **Register it:** add the component to `components/features/registry.tsx` and
   add a `{ view, legacyModule }` entry to `lib/migratedViews.ts`
   (`legacyModule: null` if the builder lived inline in `app.js`).
4. **Verify (dev):** `npx tsc --noEmit`, then load `/<group>/<view>`. Confirm the
   React panel renders, data reads/writes work, the legacy panel does **not**
   double-render, and other (still-legacy) panels are unaffected.
5. **Defer deletion** of the legacy view/module until Next owns prod (see above).

## Pilot reference

- View: `seo-roadmap` (Reach) · API: `GET`/`POST /api/seo-roadmap/progress`
- Component: `components/features/reach/SeoRoadmap.tsx`
- Legacy (kept on disk for prod): `#view-seo-roadmap` in `index.html` +
  `public/js/ig_seo_roadmap.js`
