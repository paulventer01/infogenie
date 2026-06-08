---
name: Load-order guard (script-tag wiring)
description: How the public/js load-order constraints are derived and why they are auto-discovered, not hand-listed.
---

# Load-order guard for public/js module wraps

`scripts/check-script-tags.js` guards against extracted `public/js/ig_*.js`
modules that read+reassign a sibling's `window.<fn>` at load time (the
monkeypatch/wrap pattern) loading BEFORE the script that DEFINES `<fn>` — which
makes the wrap silently no-op with zero runtime signal.

**Decision:** constraints are AST-DISCOVERED, not hand-maintained.
`discoverLoadOrderConstraints()` parses every `ig_*.js` (and app.js only when
needed) with `acorn` and infers the dependency. `MANUAL_LOAD_ORDER_OVERRIDES`
exists only as an escape hatch and is normally empty.

**Why:** the prior hand-maintained `LOAD_ORDER_CONSTRAINTS` list re-introduced
the silent breakage whenever a dev added a new wrap but forgot to register it.

**How to apply / classification heuristic (the non-obvious part):**
- "Load time" = module top level OR an IIFE body. The walker descends into IIFE
  callee bodies + their args but NOT into ordinary function definitions (event
  handlers, view-builders, setTimeout/observer callbacks) — a `window.<fn>`
  touched there is not load-order sensitive.
- A symbol is a WRAP in file F if F captures `const x = window.<fn>` at load time
  AND reassigns `window.<fn> = <expr referencing x>` at load time.
- A symbol is DEFINED in F if F assigns `window.<fn> = <expr>` whose RHS does NOT
  reference the captured original (covers `window.fn = fn` and fresh literals).
- Only CROSS-FILE wraps (wrap present, define absent in same file) become
  constraints. Intra-file define+wrap (e.g. buildRedditPulse, renderOptimizerDashboard)
  and never-reassigned sentinel reads (e.g. buildAmplitudeAgents) are ignored.
- Symbols with no resolvable definer (native window.* APIs, out-of-reach defs)
  are recorded as `unresolved` and produce NO constraint (avoids false positives).

`acorn` is a project dependency added for this scan. app.js (~1.6MB) parses in
~300ms and is only parsed when a wrapped symbol isn't defined by any ig module.
