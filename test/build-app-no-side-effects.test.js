'use strict';
// test/build-app-no-side-effects.test.js — server.js must be require-safe.
//
// server.js gates ALL background work — port binds (app.listen), cron timers
// (setInterval ticks + their boot-kick setTimeouts), boot-migrations and the
// BOOT_TASKS runner — behind services/runtime_flags.js. The flag is set ONCE,
// near the top of server.js, from `require.main === module`: true only when the
// file is the process entry point (`node server.js`), false when it is merely
// *required* (the test harness, every other test, and this one). With the flag
// off, requiring server.js must be side-effect-free beyond constructing the
// Express `app`: no port is bound and no timers are left running.
//
// Nothing else stops a future edit from re-introducing an UNGUARDED
// `app.listen()`, `setInterval`, `setTimeout` boot-kick, or BOOT_TASKS push at
// module scope. Any of those would either bind a port (breaking parallel test
// runs / leaking a server) or leave an open handle that hangs `node --test`
// forever (the suite needs --test-force-exit precisely to paper over such
// leaks). This test locks the seam: it snapshots the process's active handles
// and timer resources, requires server.js, and asserts the require introduced
// no new listening server and no new live timer.
//
// It must pass both WITH and WITHOUT DATABASE_URL — server.js is required the
// same way in either case and may not start background work regardless.
//
// Run: node --test --test-force-exit test/build-app-no-side-effects.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const net = require('node:net');

// Vault/session config must be in place before server.js is required (it reads
// config once at require time). Same ordering the harness guarantees.
require('./helpers/env');

// Count currently-listening server handles (net.Server / http.Server). A live
// `app.listen()` at module scope shows up here as an extra listening socket.
function listeningServerCount() {
  return process._getActiveHandles().filter(
    (h) => h instanceof net.Server && typeof h.address === 'function' && h.address() != null,
  ).length;
}

// Count live timer resources (setInterval / setTimeout). A cron tick or a
// boot-kick setTimeout fired at module scope shows up here as an extra timer.
function timerCount() {
  // getActiveResourcesInfo() lists resource *types* keeping the loop alive;
  // 'Timeout' covers both setInterval and setTimeout handles.
  if (typeof process.getActiveResourcesInfo === 'function') {
    return process.getActiveResourcesInfo().filter((t) => t === 'Timeout').length;
  }
  // Fallback for older Node: inspect active handles directly.
  return process._getActiveHandles().filter(
    (h) => h && h.constructor && h.constructor.name === 'Timeout',
  ).length;
}

test('requiring server.js starts no background work', () => {
  const listenersBefore = listeningServerCount();
  const timersBefore = timerCount();

  const server = require('../server');

  const listenersAfter = listeningServerCount();
  const timersAfter = timerCount();

  // (a) buildApp + app are exported and usable.
  assert.strictEqual(
    typeof server.buildApp,
    'function',
    'server.js must export buildApp() for the test harness',
  );
  assert.ok(server.app, 'server.js must export the Express app');
  assert.strictEqual(
    server.buildApp(),
    server.app,
    'buildApp() must return the singleton app constructed at require time',
  );

  // (b) No new listening http.Server handle — nothing bound a port at require.
  assert.strictEqual(
    listenersAfter,
    listenersBefore,
    `requiring server.js bound a port (listening servers ${listenersBefore} → ${listenersAfter}); ` +
      'an unguarded app.listen() at module scope must be moved behind runtime_flags.backgroundEnabled()',
  );

  // (c) No new live timer — no cron interval or boot-kick setTimeout started.
  assert.strictEqual(
    timersAfter,
    timersBefore,
    `requiring server.js started a timer (live timers ${timersBefore} → ${timersAfter}); ` +
      'an unguarded setInterval/setTimeout at module scope must be moved behind runtime_flags.backgroundEnabled()',
  );

  // The background flag stays off when server.js is required (not run directly),
  // which is the mechanism the assertions above depend on.
  assert.strictEqual(
    require('../services/runtime_flags').backgroundEnabled(),
    false,
    'runtime_flags.backgroundEnabled() must be false when server.js is required as a module',
  );
});
