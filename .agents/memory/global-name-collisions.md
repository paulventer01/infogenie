---
name: Global name collisions in public/js
description: How to detect and fix function name conflicts between app.js and public/js scripts; which were found and fixed.
---

# Global name collisions in public/js

All `public/js/ig_*.js` scripts are plain `<script>` tags loaded after `app.js`
in `index.html`. They share the **same global scope** — any top-level
`function foo()` in a later script silently overwrites an earlier one.

## Detection command

```bash
{ grep -h "^function \|^async function " app.js public/js/*.js | \
  grep -oP '(?<=function )\w+'; } | sort | uniq -d
```

This lists every top-level function name that appears more than once.
IIFEs (`(function(){...})()`) scope their helpers — those are NOT conflicts.
Check whether each file uses an IIFE wrapper before treating a match as real.

## Confirmed fixed conflicts

| Name | Winner (loads last) | Loser (overwritten) | Impact |
|------|---------------------|---------------------|--------|
| `_trRender` | `ig_true_roas.js` (0-arg) | `app.js` line 26541 (3-arg Trending Topics) | Broke T2 Trending Topics |
| `_csRender` | `ig_intel_pack_a.js` (churn-risk) | `ig_content_traffic.js` (content score) | Broke Content Traffic scorer |

**Fix applied:** renamed the later-loaded version in each public/js file
(`_trRender` → `_trRoasRender`, `_csRender` → `_csTrafficRender`) and updated
all internal call sites within those files.

## Harmless duplicates (same implementation)

- `_csEsc` — `ig_creative_suite.js` and `ig_creator_suite.js` both define
  identical HTML-escape helpers; no functional difference.
- `_csPost` — `ig_creative_suite.js` uses `_csFetch` wrapper,
  `ig_creator_suite.js` uses raw `fetch`; both result in JSON POST, both
  use session-cookie auth (no auth headers needed). Functionally equivalent
  for the success path.

## Files confirmed in IIFEs (no global leak)

`ig_growth_flywheel.js` and `ig_seo_roadmap.js` wrap everything in
`(function(){...})()` — their `_esc` and `_nav` helpers are local.

## How to apply when extracting new code from app.js

1. Prefix helpers with a file-unique prefix (e.g., `_trRoas`, `_ctraf`, `_ipaRender`)
   OR wrap the whole file in an IIFE.
2. Run the detection command above after any new extraction.
3. The load order in `index.html` (app.js first, then public/js files) means
   any duplicate name in public/js WINS — so the app.js version is the one
   that breaks silently.
