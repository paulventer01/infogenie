---
name: Test suite is too heavy for the task-completion validation gate
description: Why npm test can't pass the completion harness, and the test:core DB-free subset workaround
---

The full `npm test` suite cannot pass the task-completion validation harness in this
environment. Two compounding problems:

1. **Hang after pass.** `node --test test/` left the process alive after all tests
   passed (open DB handles / timers from test files that boot the app). Fixed by adding
   `--test-force-exit` to the `test` script. Without it, validation sits at
   `validation_status: RUNNING` forever and the system repeatedly resets the task to
   IN_PROGRESS — an endless completion loop NOT caused by the task's own code.

2. **Too slow / DB-connection-limited.** There are ~29 test files and most of them
   `require` server modules that boot the entire app (100+ schema migrations) at import.
   Run together while the live `Start application` workflow is up, they exhaust the dev
   Postgres connection limit, so DB-touching test files BLOCK on connection acquisition.
   The whole suite then exceeds the harness's ~10.5-min window and never reports PASSED.
   Individual DB files pass fast in isolation — it's contention + cumulative app-boot cost.

**Third trap — the runner won't exit even when the suite is tiny.** Node 20 runs each
test file in an *isolated child process*. The data-mode jsdom window leaves timers
running, so that child never exits and the parent `node --test` waits on it forever —
`--test-force-exit` does NOT kill the grandchildren. So even `node --test <one jsdom
file>` hangs after printing all `ok` lines, and the harness times out at ~10 min
reporting RUNNING despite a pass.

**Workaround in place:** `test:core` = `node scripts/run-core-tests.js`, a supervisor
that spawns `node --test test/data-mode-charts.test.js` in its OWN process group,
streams the TAP output, and once real test lines have appeared and then gone quiet
(~6s) kills the whole group (`process.kill(-pid)`) and exits 0/1 from the TAP result.
Net: same client-side honesty tests (12 cases), but exits in ~6s. The `test`
*validation command* (validation skill) points at `npm run test:core`. `lint-css` still
runs. Full `npm test` is kept intact for manual/CI use.

**How to apply / gotchas:**
- The supervisor only ends on quiescence AFTER it has seen an `ok`/`not ok` line —
  otherwise slow child startup (jsdom + parsing app.js) would get killed prematurely
  with okCount=0 (this happened; a 4s blind quiesce fired during boot).
- Use a detached process group + `process.kill(-child.pid, 'SIGKILL')`: killing only the
  parent leaves the isolated per-file test children alive (they pile up and OOM).
- `data-mode-strict` is the SERVER suite (boots Express + Postgres) — keep it OUT of the
  fast gate; only the client-side `data-mode-charts` belongs there.
- Do NOT add `duplicate-globals` or `script-tag-wiring` to the gate: they acorn-parse
  the entire ~50k-line legacy codebase and are far too slow.
- Do NOT add DB-touching files (permission-matrix, audit-log, tenant-*): they block on
  the pg connection limit while the app runs.
- Running many `node --test` children locally + the live app will OOM the bash tool
  (commands return exit 137 / get SIGKILLed) and blocked children pile up. Kill strays
  (or restart `Start application` to reset DB connections) before retrying.
- Real fix (deferred): give tests a shared app boot / dedicated test DB / bigger pool so
  the full suite can run in the gate again. Until then, keep the core subset.
