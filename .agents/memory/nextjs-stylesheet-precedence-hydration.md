---
name: Next.js stylesheet precedence vs hydration mismatch
description: Why a plain in-body <link rel="stylesheet"> caused a hydration mismatch + FOUC flash in the Next front-door dashboard, and the precedence fix.
---

# In-body `<link rel="stylesheet">` → hydration mismatch + flash

A `<link rel="stylesheet" href="/style.css">` rendered inside the dashboard
layout JSX (i.e. in `<body>`) **without a `precedence` prop** is the classic
cause of the "server rendered HTML didn't match the client" hydration error in
this app, plus a visible flash/redraw of unstyled content on first load.

**Why:** React's stylesheet *resource* hoisting only kicks in when the `<link>`
has a `precedence` prop. Without it, the server renders the link **in place
(body)** but React on the **client hoists it to `<head>`** — that positional
asymmetry is the mismatch, and because the big legacy stylesheet loads
non-blocking from the body, the shell paints unstyled then restyles (FOUC).
React's own Next-managed CSS (`layout.css`) sits in `<head>` with
`data-precedence` precisely because Next gives it a precedence.

**How to apply:** Any stylesheet you author by hand in an App Router
server/client component (especially route-group layouts that pull in legacy
CSS) must use `<link rel="stylesheet" href="..." precedence="default" />`. That
makes React hoist it to `<head>` identically on server and client (verify: the
SSR HTML shows it in `<head>` with `data-precedence`, body no longer has it, and
the RSC flight payload carries `"precedence":"default"`) — fixing both the
hydration mismatch and the FOUC. Don't "fix" this with
`suppressHydrationWarning`; that hides the symptom, not the asymmetry.

**Verifying in this repl:** prod (`next start`) can't be run alongside the dev
workflow here — a 2nd Next + Chromium OOM-kills the bash session (exit 137/143,
no output). Verify against the running dev server instead: curl the SSR HTML
with a logged-in cookie to check link placement, and a single lightweight
Puppeteer load (system chromium, `--single-process --disable-dev-shm-usage`)
to confirm 0 hydration errors once strays are killed and memory has recovered.
