---
name: Legacy↔React nav bridge (Next dev shell)
description: Why migrated views need a two-way nav bridge or they blank out after legacy navigateTo()
---

In the Next.js dev shell, a migrated view's `#view-<id>` div is stripped from the
replay shell, and `MigratedPanel` is URL-driven (mounts the React panel for the
current pathname). So legacy `navigateTo(view)` for a migrated view finds `target
=== null`, does nothing visible, and never changes the URL → blank page (classic
symptom: dashboard blank right after Analyse completes).

The bridge is two-way:
- **React URL → legacy**: `SpaRouter` watches pathname, calls `window.navigateTo(view)`.
- **legacy → React URL**: `navigateTo` dispatches `ig:spa-navigate` when `target`
  is null; `LegacyNavBridge` (mounted in the dashboard layout) does
  `router.push(viewToPath(view))` so `MigratedPanel` mounts the panel.

**Why no infinite loop:** `LegacyNavBridge` only pushes when `path !==
window.location.pathname`; once the URL matches, repeat events are ignored and
`SpaRouter`'s pathname effect doesn't re-fire.

**Data freshness for migrated panels fed by a legacy `window.*` global** (e.g.
`Dashboard` reads `window.analysisData`): read it reactively via
`useState(getX)` + a custom-event listener, NOT `useMemo([])`. First mount picks
up the global (set before navigation); a re-run while already mounted (URL
unchanged → no remount) refreshes only because legacy fires an event
(`ig:analysis-ready`) that the panel listens for.

**How to apply:** any newly-migrated view that is reachable via legacy
`navigateTo()` (programmatic post-action redirects, cross-tool links) relies on
this bridge — no per-view wiring needed. If such a panel mirrors a mutable
legacy global, add a legacy-side event dispatch + a reactive listener.
