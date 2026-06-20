---
name: buildApp test seam / runtime background flag
description: How tests boot the real Express app without spinning up background work, and the rule for adding new register-time side effects.
---

# buildApp() test seam

server.js exports `buildApp()` and `app`. The test harness (`test/helpers/app.js`)
requires server.js and calls `buildApp()` to get the real, fully-wired app —
it no longer hand-rebuilds the middleware chain.

`services/runtime_flags.js` is the single source of truth: server.js calls
`setBackground(require.main === module)` near the top. So background work runs
ONLY when server.js is the process entry point (`node server.js`, via
scripts/dev.js + scripts/start.js). When server.js is *required* (tests), the
flag is off.

**The rule:** any NEW register-time side effect — `app.listen()`, a cron
`setInterval`/`setTimeout` boot-kick, a one-time boot-migration `setTimeout`, or
the BOOT_TASKS runner — MUST be wrapped in
`if (_runtimeFlags.backgroundEnabled()) { ... }`, or it will fire when tests
require server.js (binding ports / hanging the runner with open handles).

**Why:** node:test with `--test-force-exit` masks hung handles by force-killing,
but an unguarded listen would still grab a port and an unguarded boot-migration
would mutate the DB during a build-only require.

**How to apply:**
- In the "rebased-require" route modules (officer, assistant_ops,
  competitor_detect, external_connectors, cloudflare_status) `require` is
  shadowed inside `register()` by `__root_require__` (resolves relative paths
  against APP_ROOT). So pull runtime_flags at MODULE top with the real node
  require: `const _runtimeFlags = require('../runtime_flags');` — NOT inside
  register with a relative path.
- Recurring crons that live inside `start*Cron()` functions are already covered
  transitively because the only caller is the BOOT_TASKS runner (guarded).

buildApp() returns a singleton app (server.js builds it once at require time); a
full fresh-app-per-call refactor was out of scope. Tests can still `app.listen(0)`
multiple times — each returns its own http.Server over the shared app.
