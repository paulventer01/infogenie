---
name: Next.js dev hydration "crashes" are usually HMR transients
description: How to triage recurring "Hydration failed" reports on the Next dev front door before touching the shell
---

Recurring "the app crashed with a hydration runtime error" reports on the Next.js
dev front door are almost always **dev-only Fast Refresh / HMR / cold-compile
transients on a stale browser tab**, not deterministic bugs in the shell.

**Why:** The dashboard shell is provably SSR-static — every `app/(dashboard)/**/page.tsx`
returns `null`, the Navbar is static, `LegacyBody` uses `dangerouslySetInnerHTML`
(React does NOT hydrate its children, so its inner markup can't mismatch), and
`MigratedPanel`/`AccountMenu` render `null` first on both server and first client
render (mount-guard / fetch-guard). There is no `Date.now`/`Math.random`/`toLocale`/
`window`-branch anywhere in the SSR'd React path. Production uses `next start`
(no HMR) so the transient can't occur there.

**How to apply (triage order before editing anything):**
1. Compare the error's epoch timestamp (e.g. `1781523836868`) against the latest
   `Start application` server-start time. These reports consistently show the
   error firing *before* the most recent restart — it's the browser console
   buffer holding a stale entry, not a live error.
2. Look for `[Fast Refresh] rebuilding` lines near the error — HMR swaps under an
   open tab produce one-shot recoverable hydration errors ("this tree will be
   regenerated on the client"). The multi-merge restart storm amplifies this.
3. Confirm cleanliness empirically: forge a session row in `user_sessions`
   (shape `{userId,email}`, cookie `s:`+`cookie-signature.sign(sid, SESSION_SECRET||INFOGENIE_API_KEY)`)
   and load authed routes. A clean load = no deterministic bug.
4. Resolution is a workflow restart + hard refresh, NOT a code change. Do not make
   speculative edits to the precedence-stylesheet / themeInit / mount-guard setup —
   it was tuned across several tasks and is delicate; changes risk FOUC regressions.

**Gotcha:** puppeteer-core + system Chromium repeatedly OOM-kills (exit 137) in this
container when run alongside the warm Next dev server, especially with
`--single-process`. Use minimal flags (`--no-sandbox --disable-setuid-sandbox
--disable-dev-shm-usage --disable-gpu`) and few reloads; even so it's flaky.
Prefer reasoning over the SSR tree to chasing an intermittent repro.
