---
name: Global name collisions in public/js
description: How to detect and fix function name conflicts between app.js and public/js scripts; which were found and fixed.
---

# Global name collisions in public/js

All `public/js/ig_*.js` scripts are plain `<script>` tags loaded after `app.js`
in `index.html`. They share the **same global scope** — any top-level
`function foo()` in a later script silently overwrites an earlier one.

## Automated lint (preferred)

`scripts/check-duplicate-globals.js` (run by `npm run lint` + `node --test`,
test in `test/duplicate-globals.test.js`) now catches this automatically. It
flags any global **function** defined in both app.js and a public/js module, or
in two modules, outside a documented `ALLOWLIST`. Key design choices, learned
the hard way:
- **Functions only, not all `window.X =`.** Modules legitimately read AND write
  shared *state* left in app.js (`window._socialPosts`, `_contentTab`,
  `analysisData`). Flagging those is noise — only a name holding a FUNCTION in
  two files is the silent-shadow hazard.
- **IIFE-awareness is required.** Files that open with an IIFE scope their
  top-level `function X` (NOT a leak → only `window.X` counts). A non-IIFE file
  DOES leak every top-level function. As of the namespace-leak cleanup, ALL
  `public/js/*.js` modules are now IIFE-wrapped — when wrapping a previously
  bare file, re-attach to `window` every top-level fn that is referenced by
  another file OR used inside an inline `onclick=`/`on*=` handler string; truly
  internal helpers (escapers, render/Html builders) stay file-local. The IIFE
  bodies are NOT indented, so column-0 alone is a false signal.
- **The scanner must be a real lexer.** Naive string-stripping breaks two ways:
  (1) regex literals contain quote chars (`/[&<>"']/g`, `/"/g`) that flip a
  flat scanner into a fake string state and silently blank the REAL defs after
  them (false negative); (2) template literals with `${...}` and nested
  backticks desync a flat state machine. The lint uses a mode-stack lexer with
  regex-vs-division detection and `${}` brace tracking. Detection went from 181
  to 463 globals after fixing this.
- Allowlist currently: `_ccGo`/`buildSettings` (intentional load-time wraps,
  also pinned by LOAD_ORDER_CONSTRAINTS in check-script-tags.js) and
  `_csEsc`/`_csPost` (identical self-contained helper copies, below).

## Manual detection command (quick, IIFE-blind)

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

Every `public/js/*.js` module is IIFE-wrapped. `_csEsc`/`_csPost` (formerly
allowlisted "harmless duplicate" leaks) are now file-local in both
ig_creative_suite.js and ig_creator_suite.js, so they were removed from the
duplicate-global lint ALLOWLIST.

## How to apply when extracting new code from app.js

1. Prefix helpers with a file-unique prefix (e.g., `_trRoas`, `_ctraf`, `_ipaRender`)
   OR wrap the whole file in an IIFE.
2. Run the detection command above after any new extraction.
3. The load order in `index.html` (app.js first, then public/js files) means
   any duplicate name in public/js WINS — so the app.js version is the one
   that breaks silently.
