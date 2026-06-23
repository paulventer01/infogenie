---
name: Next.js dev hydration "crashes" — triage and deterministic fixes
description: How to triage recurring "Hydration failed" reports on the Next dev front door; includes the one real deterministic bug that was found and fixed
---

## Transient errors (most reports)

Recurring "the app crashed with a hydration runtime error" reports on the Next.js
dev front door are **usually** dev-only Fast Refresh / HMR / cold-compile
transients on a stale browser tab, not deterministic bugs in the shell.

**Triage order before editing anything:**
1. Compare the error's epoch timestamp against the latest `Start application`
   server-start time. Reports that fire *before* the most recent restart are
   stale browser console buffer, not live errors.
2. Look for `[Fast Refresh] rebuilding` lines near the error — HMR swaps under
   an open tab produce one-shot recoverable hydration errors. The multi-merge
   restart storm amplifies this.
3. Resolution is a workflow restart + hard refresh (Ctrl/Cmd+Shift+R).
   Do **not** make speculative edits to the precedence-stylesheet / themeInit /
   mount-guard setup — it was tuned carefully and changes risk FOUC regressions.

---

## Real deterministic bug (FIXED — LegacyBody)

**Root cause:** `getLegacyShell()` was called **twice** per request — once in
`DashboardLayout` (to get `scripts`) and once inside `<LegacyBody />` (to get
`bodyHtml`). Next.js 15's App Router generates the SSR HTML stream and the RSC
Flight payload in separate passes. If those two `parse()` calls (each a fresh
`readFileSync` + regex transform of `index.html`) return even slightly different
strings (e.g. due to an in-flight HMR write, or browser whitespace serialisation
collapsing the nav-strip's surrounding newlines differently), the `__html` prop
in the Flight payload won't match the `innerHTML` already in the SSR DOM →
deterministic hydration mismatch on every hard refresh.

**Symptoms:** error at `components/layout/LegacyBody.tsx (11:5)`, diff showing
the `__html` value differing by 1 extra `\n` between + (client prop) and -
(server DOM). Error message: "This won't be patched up."

**Fix (both applied):**
1. `lib/legacyShell.ts`: wrapped `getLegacyShell` with React's `cache(parse)`.
   `cache()` deduplicates calls within the same render request so the SSR stream
   and RSC Flight payload always share one identical `parse()` result.
2. `lib/legacyShell.ts`: normalise runs of 3+ consecutive `\n` to `\n\n` after
   stripping — the nav-strip leaves surrounding newlines that the browser HTML
   serialiser collapses differently (4→3), so capping at 2 makes both sides agree.
3. `components/layout/LegacyBody.tsx`: added `suppressHydrationWarning` to the
   wrapper div as belt-and-suspenders for any future minor whitespace variance in
   `dangerouslySetInnerHTML` content.

**Why:** The `dangerouslySetInnerHTML` container holds the 200+ `#view-*` panels
from the legacy SPA — React doesn't hydrate their children, but it does compare
the `__html` prop against `element.innerHTML`. The browser HTML serialiser can
produce slightly different whitespace than the raw string, so the container div
needs `suppressHydrationWarning` as a permanent guard.

---

**Gotcha:** puppeteer-core + system Chromium repeatedly OOM-kills (exit 137) in
this container alongside the warm Next dev server, especially with
`--single-process`. Use minimal flags; even so it's flaky. Prefer reasoning over
the SSR tree to chasing an intermittent repro.
