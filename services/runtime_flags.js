// Single source of truth for whether THIS process should run background work:
//   • binding network ports (the Express preview/external listens)
//   • cron timers — recurring setInterval ticks and their boot-kick setTimeouts
//   • the BOOT_TASKS schema-ensure / cron-start runner
//
// server.js calls setBackground() exactly once at startup, passing true only
// when it is the process entry point (`node server.js`, used by scripts/dev.js
// and scripts/start.js). When server.js is instead required as a module — the
// test harness calling buildApp() — the flag stays false, so importing the app
// binds no port and starts no timers/crons. Route modules read backgroundEnabled()
// before their register-time listen()/setInterval() calls and skip them in that
// build-only mode, letting tests consume the real app builder without spinning up
// the whole live process.
let _background = false;

function setBackground(on) { _background = !!on; }
function backgroundEnabled() { return _background; }

module.exports = { setBackground, backgroundEnabled };
