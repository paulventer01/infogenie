---
name: Migrated builder crash-coverage test
description: How the fleet-wide "Analyse Now" crash guard test resolves and exercises every migrated builder
---

# Migrated builder crash-coverage test

`test/migrated-builders-coverage.test.js` extends the 4-builder safety test to the
whole migrated fleet (~178 builders): it parses migrated view ids from
`lib/migratedViews.ts`, resolves each to its builder by parsing the `navigateTo()`
dispatch in app.js, whole-file-evals every `public/js/*.js` into jsdom (+ extracts
inline app.js builders), and asserts each does NOT crash on an empty DOM.

**Why guard-first matters:** the canonical safe pattern is a first-line
`if (!document.getElementById('<root>')) return;`. In prod the legacy SPA always
has the full DOM so the guard never fires (zero behaviour change); under the Next.js
shell the `#view-<id>` panel is stripped, and an unguarded builder blanks the page.

**Non-obvious gotchas when testing these builders:**
- **Async builders reject, they don't throw.** Many builders (e.g. the ig_studio.js
  ones via the shared `_shell` helper) are `async function`; a crash inside the body
  becomes a *rejected promise*, so `assert.doesNotThrow` misses it. Must `await` the
  call and use `assert.doesNotReject`.
- **Do NOT eval app.js wholesale in jsdom** — it fires DOMContentLoaded handlers that
  throw uncaught. Eval whole `public/js` files (they resolve globals at call time) but
  extract individual app.js builders by brace-matching.
- Builders come in 3 def forms: `function X`, `async function X`, `window.X = function`.
  The extractor must handle all three.
- Stub at load: `navigator.clipboard.writeText`, never-resolving `fetch`, and no-op
  `setTimeout/setInterval/requestAnimationFrame/requestIdleCallback/queueMicrotask`,
  plus a top-level `unhandledRejection` swallow for fire-and-forget async noise.
- `dashboard` must be hard-mapped to `buildDashboard` — its only dispatch reference is
  a secondary widget (renderForecastSavingsWidget); the real panel is pre-built.
- ~21 migrated views have no dedicated dispatch builder (React-only / shared) and are
  intentionally skipped.

Registered in `scripts/run-core-tests.js` FILES (the `npm run test:core` gate).
