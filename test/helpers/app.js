// test/helpers/app.js — Boot a test instance of the REAL InfoGenie API.
//
// Consumes server.js's buildApp() (added for exactly this purpose). server.js
// sets a background flag from `require.main === module`: when it is *required*
// (as here) instead of run directly, it binds no port and starts no
// timers/crons/boot-tasks. Requiring it is therefore side-effect-free beyond
// constructing the Express `app`, so this harness uses the real, fully-wired
// middleware chain instead of hand-rebuilding it (which used to drift from
// server.js and was the harness's one known missing seam).
//
// The app returned is the production one, wired in the same order server.js uses:
//
//   express.json (rawBody) → express-session → loadUserFromSession →
//   loadTenantContext → /api/auth → /api/tenants → api-key gate (+ tenant
//   injection) → enforceMatrix → every feature router
//
// so auth, tenant scoping (MULTITENANT_ENFORCEMENT) and permission enforcement
// (PERMISSION_ENFORCEMENT) behave exactly as in production.

require('./env'); // MUST run before server.js (vault/session read config once)

const _server = require('../../server');

// Return the real, fully-configured Express app. `opts.mount(app)` lets a test
// append extra routers/probes; they land after every server route — exactly
// where a feature router sits relative to the api-key gate + enforceMatrix.
//
// NOTE: server.js builds a single app at require time, so buildApp() returns that
// singleton. Auth routes and enforceMatrix are always present — the legacy
// opts.enforceMatrix / opts.includeAuthRoutes toggles are inherent now and no
// longer accepted (no test relied on disabling them). bootApp() can still open as
// many ephemeral ports as needed; each app.listen() returns its own http.Server
// over the shared app.
function buildApp(opts = {}) {
  const app = _server.buildApp();
  if (typeof opts.mount === 'function') opts.mount(app);
  return app;
}

// Boot the app on an ephemeral port. Returns { app, server, port, baseUrl,
// close() } — call close() in an after() hook for a clean teardown.
async function bootApp(opts = {}) {
  const app = buildApp(opts);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;
  return {
    app,
    server,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    close() { return new Promise((r) => server.close(r)); },
  };
}

module.exports = { bootApp, buildApp };
