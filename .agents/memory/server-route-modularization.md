---
name: server.js route modularization
description: How to safely extract inline Express routes from the giant server.js into services/<feature>/routes.js without behavior change.
---

# Extracting inline routes from server.js

server.js is ~15k lines with ~195 inline `app.get/post/...` handlers that reference
~100 module-scope helpers by bare name. The safe, behavior-preserving extraction
pattern (proven on the goals/leads/reengage cluster → `services/growth_ops/routes.js`):

## Pattern
- New module: `module.exports = function register(app, ctx) { const { ...helpers } = ctx; <verbatim span> };`
- In server.js, replace the span IN PLACE with `require('./services/<feat>/routes')(app, { ...helpers });`
  so Express registration ORDER is preserved (Express matches in order; middleware
  ordering — api-key gate, owner gate, public-path bypass — must not move).
- ctx object literal at the call site captures module-scope helpers by shorthand.
  All injected helpers MUST be defined ABOVE the call site (function decls are
  hoisted; `const`/`require` bindings are not). Tail clusters (~12k+ lines) work
  because all their shared helpers are defined earlier; early routes are harder
  because helpers are interleaved with routes.

## Before moving any span — three checks (do NOT skip)
1. **Free variables** = exactly what goes in ctx. Compute with a parser, not by eye.
   Throwaway acorn analyzer kept at `/tmp/analyzer/freevars.js` (wraps the span in a
   fn, walks declared vs used idents, subtracts JS globals). `extract.js` does the
   byte-identical move.
2. **Reverse references**: grep every name DEFINED in the span across the rest of
   server.js — if anything outside uses it, the span is not self-contained and moving
   it breaks that ref.
3. **Undeclared-but-used identifiers** (latent bugs): e.g. `_amplitudeAuthHeader` was
   referenced once (`x && x()`) but never defined anywhere → its read throws
   ReferenceError, caught by surrounding try/catch. To PRESERVE behavior, leave such a
   name UNDECLARED in the module (do NOT put it in ctx). If you add it to ctx it
   becomes `undefined`, `undefined && ...` no longer throws, and the catch branch is
   skipped → different output. Reading an undeclared var throws in both strict and
   sloppy mode, so an undeclared bare ref reproduces the original exactly.

## CRITICAL gotcha: relative require() and __dirname rebase
Moved code originally ran from `server.js` at the PROJECT ROOT, so every
`require('./x')` and `path.join(__dirname, ...)` inside a span resolves from root.
A module at `services/<feat>/routes.js` is two levels deep — those paths now resolve
from `services/<feat>/` and break (`Cannot find module './services/...'`, wrong file
paths). DO NOT hand-rewrite each path. Inject a per-module prelude that rebases both:
capture real `require`+`path` at module scope, compute `APP_ROOT = join(__dirname,'..','..')`,
then INSIDE `register()` shadow `const __dirname = APP_ROOT;` and
`const require = p => p.startsWith('./')||p.startsWith('../') ? realRequire(resolve(APP_ROOT,p)) : realRequire(p);`.
Safe because: node builtins/npm pkgs never start with `.`; the cluster's ctx-deps are
already-declared free vars so they can't collide with the shadows; verify no span
declares body-level `const require`/`__dirname` and no `require.resolve/main/cache` use.

## Scaling: auto-detect self-contained clusters (don't extract one-by-one)
Routes are interleaved with helpers across the WHOLE file (no clean tail). To extract
the bulk safely, auto-find maximal CONTIGUOUS top-level statement runs `[i..j]` where:
(a) contains ≥1 route, (b) no `app.use`/router-mount barrier inside, (c) every NAME
declared in the run is used ONLY within the run (self-contained — reverse-ref check),
(d) every free var is a JS/Node global, or defined at a stmt BEFORE `i` (→ goes in ctx),
or genuinely undeclared everywhere (→ leave bare). Reject if any dep is defined AFTER
the run. Extract each run in place (preserves Express order). This found 28 such runs
covering 171 routes; the ~11 leftovers are too interleaved to be self-contained and
stay inline — acceptable. Net: server.js ~15.3k→~3.5k lines, 184 routes in 29 modules.
Build offsets/extraction with acorn (char offsets `node.start/.end`, not lines, for
byte-identical moves); process runs bottom-to-top so offsets stay valid.

## Gotcha: fabrication-lint scope
`scripts/check-fabrication-markers.js` (and test #50) scans ONLY `services/`, never
repo-root `server.js`. Moving a route with `_template*/_fallback*`-named helpers into
services/ newly trips the lint even though code is unchanged. Fix = add the new file
to that script's ALLOWLIST with a reason (it's a name-pattern match, not real
fabrication) — same as the ai_visibility/_fallbackPrompts precedent.

## Boot registry
The ~30 schema/cron boot IIFEs were converted to `BOOT_TASKS.push(async()=>{...})`
(bodies verbatim) + one sequential awaited runner loop. This changed concurrent
fire-and-forget → sequential; safe because each task self-guards (`hasDb()`) and is
fast/idempotent, and the 8s-deferred phase2 migration still fires after boot completes.
Verify a structural boot change by diffing the boot log against baseline AND confirming
deferred phase2 still logs "0 columns added / integrity ok".
