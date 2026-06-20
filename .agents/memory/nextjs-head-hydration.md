---
name: Root-layout <head> must stay free of hand-authored reconciled children
description: Why app/layout.tsx loads fonts via next/font, not <link>, and how legacy CSS font names still resolve
---

The Replit dev proxy injects its devtools `<script>` into `<head>` *after* Next
renders. Any hand-authored, React-reconciled children in the root layout `<head>`
(font `<link>`/`<preconnect>`, inline `<script>`) get their child ordering shifted
by that injection, so React's `<head>` virtual DOM no longer matches the server
HTML and reports a **deterministic** hydration mismatch (the "artifact encountered
an error" banner on `/` and `/login`). This is NOT the HMR transient described in
hydration-dev-transients.md.

**Rule:** keep the root `<head>` free of hand-authored reconciled children.
- Load fonts via `next/font/google` (self-hosted, Next-managed), never a manual
  `<link href="...fonts.googleapis...">`. Guarded by `test/layout-fonts-guard.test.js`
  (in the `test:core` gate).
- Render the pre-paint theme-init via `next/script` `strategy="beforeInteractive"`
  (Next-managed) instead of a plain inline `<script>` child.

**Why fonts still render after dropping the `<link>`:** the legacy CSS references
literal family names (`'Inter'`, `'Plus Jakarta Sans'`) in many places —
`styles/globals.css`, `styles/auth.module.css`, and ~100 lines in the legacy
`style.css`. next/font scopes the family to a hashed name exposed via CSS vars
(`--font-inter`, `--font-jakarta`, set on `<html className>`). Those refs were
rewritten to `var(--font-inter, 'Inter')` / `var(--font-jakarta, 'Plus Jakarta Sans')`.
**How to apply:** the literal fallback is load-bearing — the legacy SPA is still
served directly by Express (no Next, so the var is undefined) where `index.html`
loads the real Google Fonts; the var resolves under Next, the literal under Express.
Only Inter + Plus Jakarta Sans are loaded (Space Grotesk/Sora were never in the
layout link, so they still fall back under Next — don't add them).
