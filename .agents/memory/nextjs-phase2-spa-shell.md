---
name: Next.js Phase 2 — legacy SPA shell replay
description: How Next renders the legacy vanilla-JS SPA (navbar in React, body + scripts replayed) without regressions.
---

# Phase 2 — Next renders the legacy SPA shell (dev front door)

In dev, Next owns `/` and `/<group>/<view>` and renders the existing SPA so all
~200 static `#view-*` panels + `window.navigateTo()` keep working unchanged.

## The replay pattern

1. **Server reads `index.html` at request time**, splits it: strip the legacy
   `<nav id="navbar">` (re-rendered in React) and **all** `<script>` tags;
   collect every script (head + body) in source order.
2. **Body** is injected via `dangerouslySetInnerHTML` inside a
   `display:contents` wrapper (adds no box; panels flow under the React navbar).
   Inline `onclick=`/`style=` attributes in the legacy markup survive as native
   HTML and keep working.
3. **Scripts are replayed client-side** in order: `src` scripts via
   `<script src async=false>` awaiting onload; inline via `el.text`. CDN scripts
   (Chart.js, Amplitude, PostHog) load first so app.js sees them.

## The DOMContentLoaded gotcha (the key lesson)

The legacy app's core wiring (app.js ~9309) is registered on a **bare
`document.addEventListener('DOMContentLoaded', …)`** with no `readyState`
guard. By the time scripts are replayed under Next, the real DOMContentLoaded
already fired, so those listeners would **never run**. Fix: after injecting all
scripts, **manually dispatch a synthetic `DOMContentLoaded`**, then set
`window.__igLegacyReady` and dispatch `ig:legacy-ready` so the router can drive
the first `navigateTo`. Don't dispatch a synthetic `load`. readyState-guarded
`public/js/*` modules self-init on inject (their designed late-load path) — fine.

## React navbar must mirror the legacy DOM

The React `<Navbar/>` reproduces index.html's nav ids/classes exactly
(`#navbar`, `#navGroups`, `.nav-link[data-view]`, `#navLogo`, `#navAdminLink`,
`.nav-drop-next[data-open-group]`, theme toggle, alerts bell) so the replayed
scripts (app.js nav wiring, `ig_navperms`/`ig_navchrome` MutationObservers, the
inline nav-drop-next delegation, theme toggle) attach with no changes. **Only**
the nav-link click is owned by React: `navigateTo(view)` (instant panel swap) +
`router.push(viewToPath(view))` (URL sync). app.js also wires navigateTo on its
links — double-wiring is idempotent. `lib/viewRoutes.ts` is the single source
for both the navbar render and the URL<->view maps (hard-nav resolves the last
path segment to a `data-view`).

**Why:** rebuilding 200+ panels in React up-front is infeasible; replaying the
legacy bundle behind a React shell migrates the chrome first with zero feature
regression, panel-by-panel migration can follow.

## Hydration mismatches in migrated components
Migrated React panels must never render `new Date().toLocale*()`, `Date.now()`, or other server/client-divergent values directly in JSX or in `useState`/`useMemo` initializers — server (Node) locale/time differs from the browser, producing different HTML and a hydration crash. Fix: add `suppressHydrationWarning` to the exact element for display-only timestamps, or move the value to a `useEffect` that runs after mount for `useState` seeds. The root `<html>` in `app/layout.tsx` carries `suppressHydrationWarning` because the pre-hydration themeInit script sets `data-theme`.
