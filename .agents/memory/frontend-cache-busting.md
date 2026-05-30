---
name: Frontend cache-busting for app.js
description: Editing app.js/ig_*.js has no effect for users until the manual ?v= cache-bust string in index.html is bumped.
---

# Static JS is cache-busted by a manual version query string

`index.html` loads `app.js`, `ig_field_enhancer.js`, `ig_diag.js` with a shared
`?v=YYYYMMDD<tag>` query string. The browser caches each URL aggressively, so
editing the JS files alone does NOT reach returning users — they keep running the
previously-cached bytes under the same `?v=`.

**Why:** a data-mode feature (demo badge on AI-estimated data) was fully correct
server- and client-side, but the user saw no badge because their browser served
a stale `app.js` from before the badge code existed. Server response carried the
`_dataMode:'demo'` marker; the cached script simply lacked the code to read it.

**How to apply:** whenever you change `app.js` (or the other root JS files) in a
way users must pick up, bump the `?v=` string in `index.html` (one sed across all
three tags keeps them consistent). Verify with
`curl "$URL/app.js?v=<new>" | grep <new-symbol>`.
