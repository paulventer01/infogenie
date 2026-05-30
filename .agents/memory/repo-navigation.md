---
name: Repo navigation quirks (InfoGenie)
description: Practical notes for working in this large vanilla-JS SPA codebase.
---

# Repo navigation

- `app.js` is ~50,000 lines (single frontend SPA file). The `read` tool has
  mis-reported its total length (e.g. claimed 14,819 lines). Trust `wc -l` and
  use `rg -n` + `sed -n 'A,Bp'` for accurate line numbers when editing it.
- `data.js` is loaded **only** as a browser script (`<script src="/data.js">`),
  never required server-side — so server-side res.json enforcement cannot catch
  fabrication produced there (e.g. generateWebsiteKPIs/generateTrendData). Those
  are tagged for the **frontend** data-mode handling instead.
- View routing: `navigateTo(viewId)` shows `#view-<id>` and calls `build<X>()`
  via a chain of `if (viewId===...)` hooks (~line 3360). Add new views there.
